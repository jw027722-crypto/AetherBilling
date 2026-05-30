<?php
/**
 * Plugin Name: Aether Frameworks Billing
 * Description: Lightweight, stateless WooCommerce payment gateway connecting templates to the central Aether financial matrix.
 * Version: 1.0.4
 * Author: Elder World Studio Inc.
 */

if (!defined('ABSPATH')) {
    exit; // Stop direct execution paths
}

if (defined('AETHER_BILLING_VERSION')) {
    return;
}

define('AETHER_BILLING_VERSION', '1.0.5');
define('AETHER_BILLING_FILE', __FILE__);

require_once __DIR__ . '/includes/aether-pos-rest.php';

add_action('admin_menu', 'aether_payment_menu');
function aether_payment_menu() {
    add_options_page('Aether Billing Config', 'Aether Billing', 'manage_options', 'aether-billing', 'aether_billing_settings_page');
}

function aether_get_config_value($option_name, $constant_name, $default = '') {
    if (defined($constant_name)) {
        return constant($constant_name);
    }
    return get_option($option_name, $default);
}

function aether_get_node_base_url() {
    $node_base_url = aether_get_config_value('aether_node_base_url', 'AETHER_NODE_BASE_URL', 'https://billing.aetherframeworks.dev');
    return $node_base_url ? rtrim($node_base_url, '/') : '';
}

function aether_get_stripe_public_key() {
    $config = aether_get_public_config();
    return isset($config['publishableKey']) ? sanitize_text_field($config['publishableKey']) : '';
}

function aether_get_stripe_client_id() {
    return '';
}

function aether_get_merchant_connect_id() {
    return aether_get_config_value('aether_merchant_connect_id', 'AETHER_STRIPE_CONNECT_ID', '');
}

function aether_get_internal_secret() {
    if (defined('AETHER_INTERNAL_SECRET')) {
        return AETHER_INTERNAL_SECRET;
    }

    $secret = get_option('aether_internal_secret', '');
    if (!empty($secret)) {
        return $secret;
    }

    return aether_register_site_secret();
}

function aether_is_constant_locked($constant_name) {
    return defined($constant_name);
}

function aether_get_public_config() {
    $node_base_url = aether_get_node_base_url();
    if (empty($node_base_url)) {
        return array();
    }

    $cache_key = 'aether_public_config_' . md5($node_base_url);
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return $cached;
    }

    $response = wp_remote_get(
        add_query_arg(
            array('site_url' => admin_url('options-general.php?page=aether-billing')),
            $node_base_url . '/api/v1/public-config'
        ),
        array('timeout' => 15)
    );

    if (is_wp_error($response)) {
        return array();
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body)) {
        return array();
    }

    set_transient($cache_key, $body, 5 * MINUTE_IN_SECONDS);
    return $body;
}

function aether_register_site_secret() {
    $node_base_url = aether_get_node_base_url();
    if (empty($node_base_url)) {
        return '';
    }

    $response = wp_remote_post(
        $node_base_url . '/api/v1/register-site',
        array(
            'headers' => array('Content-Type' => 'application/json'),
            'body' => wp_json_encode(array(
                'siteUrl' => home_url('/'),
                'fulfillmentUrl' => esc_url_raw(rest_url('aether-connect/v1/fulfill')),
                'merchantConnectId' => aether_get_merchant_connect_id(),
            )),
            'timeout' => 15,
        )
    );

    if (is_wp_error($response)) {
        return '';
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (empty($body['success']) || empty($body['siteSecret'])) {
        return '';
    }

    $secret = sanitize_text_field($body['siteSecret']);
    update_option('aether_internal_secret', $secret, false);
    return $secret;
}

function aether_billing_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    if (isset($_GET['connected_id'])) {
        $connected_id = sanitize_text_field(wp_unslash($_GET['connected_id']));
        if (!empty($connected_id)) {
            update_option('aether_merchant_connect_id', $connected_id);
            echo '<div class="updated"><p>Stripe account connected successfully.</p></div>';
        }
    }

    if (isset($_POST['aether_save_settings']) && check_admin_referer('aether_save_settings_action', 'aether_save_settings_nonce')) {
        $old_node_base_url = aether_get_node_base_url();
        if (!aether_is_constant_locked('AETHER_STRIPE_CONNECT_ID')) {
            update_option('aether_merchant_connect_id', sanitize_text_field(wp_unslash($_POST['merchant_id'] ?? '')));
        }
        if (!aether_is_constant_locked('AETHER_NODE_BASE_URL')) {
            update_option('aether_node_base_url', esc_url_raw(wp_unslash($_POST['node_base_url'] ?? '')));
        }
        delete_transient('aether_public_config_' . md5($old_node_base_url));
        delete_transient('aether_public_config_' . md5(aether_get_node_base_url()));
        if (!aether_is_constant_locked('AETHER_INTERNAL_SECRET')) {
            delete_option('aether_internal_secret');
            aether_register_site_secret();
        }
        echo '<div class="updated"><p>Aether configuration updated successfully.</p></div>';
    }

    $merchant_id = aether_get_merchant_connect_id();
    $public_key = aether_get_stripe_public_key();
    $node_base_url = aether_get_node_base_url();
    $internal_secret = aether_get_internal_secret();
    $public_config = aether_get_public_config();
    $connect_url = isset($public_config['connectUrl']) ? $public_config['connectUrl'] : '';
    $service_mode = isset($public_config['mode']) ? $public_config['mode'] : '';
    $callback_url = isset($public_config['callbackUrl']) ? $public_config['callbackUrl'] : '';

    $all_settings_locked = aether_is_constant_locked('AETHER_STRIPE_CONNECT_ID')
        && aether_is_constant_locked('AETHER_NODE_BASE_URL')
        && aether_is_constant_locked('AETHER_INTERNAL_SECRET');
    ?>
    <div class="wrap">
        <h1>Aether Frameworks Billing Node Terminal</h1>
        <p>Aether keeps platform Stripe configuration on the billing server. This site only stores its connected account, server URL, and an automatically generated fulfillment handshake.</p>

        <?php if ($all_settings_locked) : ?>
            <div class="notice notice-success">
                <p><strong>Aether configuration is locked via wp-config.php.</strong> All core credentials are set and cannot be changed from this admin screen.</p>
            </div>
        <?php endif; ?>

        <?php if (empty($node_base_url) || empty($public_key) || empty($connect_url) || empty($internal_secret)) : ?>
            <div class="notice notice-warning inline">
                <p>
                    <strong>Stripe Connect is not ready.</strong>
                    <?php if (empty($node_base_url)) : ?>
                        Your Central Node Server URL is missing.
                    <?php endif; ?>
                    <?php if (empty($public_key)) : ?>
                        Your Stripe Publishable Key is missing.
                    <?php endif; ?>
                    <?php if (empty($internal_secret)) : ?>
                        Automatic site registration has not completed.
                    <?php endif; ?>
                    Please confirm the billing server is configured and reachable.
                </p>
            </div>
        <?php endif; ?>

        <form method="POST">
            <?php wp_nonce_field('aether_save_settings_action', 'aether_save_settings_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th><label for="merchant_id">Stripe Connect Account</label></th>
                    <td>
                        <input type="text" id="merchant_id" name="merchant_id" value="<?php echo esc_attr($merchant_id); ?>" class="regular-text" <?php disabled(aether_is_constant_locked('AETHER_STRIPE_CONNECT_ID')); ?>>
                        <p class="description"><?php echo !empty($merchant_id) ? 'Connected account saved.' : 'Use OAuth or paste an acct_xxxx ID for testing.'; ?></p>
                    </td>
                </tr>
                <tr>
                    <th>Aether Server</th>
                    <td><code><?php echo !empty($public_key) ? 'Connected' : 'Not connected'; ?></code><?php echo !empty($service_mode) ? ' <span class="description">(' . esc_html($service_mode) . ' mode)</span>' : ''; ?></td>
                </tr>
                <tr>
                    <th>OAuth Callback</th>
                    <td><code><?php echo !empty($callback_url) ? esc_html($callback_url) : 'Not available'; ?></code></td>
                </tr>
                <tr>
                    <th>Site Registration</th>
                    <td><code><?php echo !empty($internal_secret) ? 'Registered' : 'Not registered'; ?></code></td>
                </tr>
                <tr>
                    <th><label for="node_base_url">Central Node Server URL</label></th>
                    <td><input type="url" id="node_base_url" name="node_base_url" value="<?php echo esc_attr($node_base_url); ?>" class="regular-text" placeholder="https://billing.aetherframeworks.dev" <?php disabled(aether_is_constant_locked('AETHER_NODE_BASE_URL')); ?>></td>
                </tr>
            </table>
            <p><input type="submit" name="aether_save_settings" class="button button-secondary" value="Save Configuration"></p>
        </form>

        <?php if (!empty($connect_url)) : ?>
            <p>
                <a class="button button-primary" href="<?php echo esc_url($connect_url); ?>" target="_blank" rel="noreferrer noopener">
                    Connect or Create a Stripe Account
                </a>
            </p>
        <?php else : ?>
            <p class="description">When the billing server public config is reachable, the Stripe Connect button will appear here.</p>
        <?php endif; ?>

    </div>
    <?php
}

add_action('admin_notices', 'aether_admin_notice_woocommerce_required');
function aether_admin_notice_woocommerce_required() {
    if (!function_exists('is_plugin_active') || !is_admin()) {
        return;
    }

    if (!class_exists('WooCommerce')) {
        echo '<div class="notice notice-error"><p><strong>Aether:</strong> WooCommerce is required for this gateway to function. Please install and activate WooCommerce.</p></div>';
    }
}

add_action('plugins_loaded', 'aether_init_gateway_class');
function aether_init_gateway_class() {
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }

    class WC_Gateway_Aether extends WC_Payment_Gateway {
        public function __construct() {
            $this->id                 = 'aether_gateway';
            $this->method_title       = 'Aether Gateway';
            $this->method_description = 'Process payments via the centralized Aether Node.js server while keeping WooCommerce inventory and order management native.';
            $this->has_fields         = true;
            $this->supports           = array('products');

            $this->init_form_fields();
            $this->init_settings();

            $this->title        = $this->get_option('title', 'Aether Payment');
            $this->description  = $this->get_option('description', 'Pay securely through Aether payment processing.');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title'   => 'Enable/Disable',
                    'type'    => 'checkbox',
                    'label'   => 'Enable Aether Gateway',
                    'default' => 'yes'
                ),
                'title' => array(
                    'title'       => 'Title',
                    'type'        => 'text',
                    'description' => 'This controls the title shown during checkout.',
                    'default'     => 'Aether Payment',
                    'desc_tip'    => true,
                ),
                'description' => array(
                    'title'       => 'Description',
                    'type'        => 'textarea',
                    'description' => 'Payment method description shown on the checkout page.',
                    'default'     => 'Pay securely using our Aether payment gateway.',
                    'desc_tip'    => true,
                ),
            );
        }

        public function payment_fields() {
            if ($this->description) {
                echo wpautop(wp_kses_post($this->description));
            }
            echo '<div id="aether-woocommerce-payment-element" style="margin-bottom:20px;"></div>';
            echo '<div id="aether-woocommerce-card-errors" role="alert" style="color:#d93025;margin-bottom:12px;"></div>';
            echo '<input type="hidden" id="aether_payment_method_id" name="aether_payment_method_id" value="" />';
            echo '<input type="hidden" id="aether_payment_intent_id" name="aether_payment_intent_id" value="" />';
        }

        public function validate_fields() {
            if (empty($_POST['aether_payment_intent_id']) && empty($_POST['aether_payment_method_id'])) {
                wc_add_notice('Please complete your payment details before placing the order.', 'error');
                return false;
            }
            return true;
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);

            $payment_intent_id = !empty($_POST['aether_payment_intent_id']) ? wc_clean(wp_unslash($_POST['aether_payment_intent_id'])) : '';
            $payment_method_id = !empty($_POST['aether_payment_method_id']) ? wc_clean(wp_unslash($_POST['aether_payment_method_id'])) : '';
            $merchant_id = aether_get_merchant_connect_id();
            $node_base_url = aether_get_node_base_url();
            $webhook_url = esc_url_raw(rest_url('aether-connect/v1/fulfill'));
            $amount = (int) round($order->get_total() * 100);

            if (empty($merchant_id)) {
                wc_add_notice('Aether gateway is not configured with a Stripe Connect account.', 'error');
                return array('result' => 'failure');
            }

            if (!empty($payment_intent_id)) {
                $order->payment_complete($payment_intent_id);
                $order->add_order_note('Aether payment succeeded. PaymentIntent ID: ' . esc_html($payment_intent_id));
                WC()->cart->empty_cart();

                return array(
                    'result'   => 'success',
                    'redirect' => $this->get_return_url($order),
                );
            }

            if (empty($payment_method_id)) {
                wc_add_notice('Payment confirmation was not generated. Please refresh and try again.', 'error');
                return array('result' => 'failure');
            }

            $payload = wp_json_encode(array(
                'paymentMethodId' => $payment_method_id,
                'amount' => $amount,
                'merchantConnectId' => $merchant_id,
                'templateWebhookUrl' => $webhook_url,
            ));

            $response = wp_remote_post($node_base_url . '/api/v1/process-payment', array(
                'headers' => array('Content-Type' => 'application/json'),
                'body' => $payload,
                'timeout' => 60,
            ));

            if (is_wp_error($response)) {
                $order->update_status('failed', 'Aether payment gateway request error: ' . $response->get_error_message());
                wc_add_notice('Payment error: ' . esc_html($response->get_error_message()), 'error');
                return array('result' => 'failure');
            }

            $body = json_decode(wp_remote_retrieve_body($response), true);
            if (empty($body) || empty($body['success'])) {
                $error_message = isset($body['error']) ? $body['error'] : 'Unknown payment gateway failure.';
                $order->update_status('failed', 'Aether payment failed: ' . $error_message);
                wc_add_notice('Payment failed: ' . esc_html($error_message), 'error');
                return array('result' => 'failure');
            }

            $order->payment_complete($body['chargeId']);
            $order->add_order_note('Aether payment succeeded. Charge ID: ' . esc_html($body['chargeId']));
            WC()->cart->empty_cart();

            return array(
                'result'   => 'success',
                'redirect' => $this->get_return_url($order),
            );
        }
    }
}

add_shortcode('aether_checkout', 'render_aether_checkout');
function render_aether_checkout($atts) {
    $a = shortcode_atts(array('amount' => '1000'), $atts);
    $amount = absint($a['amount']);

    wp_enqueue_script('stripe-js', 'https://js.stripe.com/v3/', array(), null, true);
    wp_enqueue_script('aether-elements-handler', plugin_dir_url(__FILE__) . 'assets/js/aether-elements.js', array('stripe-js'), '1.0.0', true);

    wp_localize_script('aether-elements-handler', 'aether_config', array(
        'public_key' => aether_get_stripe_public_key(),
        'merchant_id' => aether_get_merchant_connect_id(),
        'node_base_url' => aether_get_node_base_url(),
        'amount' => $amount,
        'webhook_url' => esc_url_raw(rest_url('aether-connect/v1/fulfill')),
    ));

    ob_start();
    include plugin_dir_path(__FILE__) . 'templates/checkout-form.php';
    return ob_get_clean();
}

add_filter('woocommerce_payment_gateways', 'aether_add_gateway_class');
function aether_add_gateway_class($gateways) {
    $gateways[] = 'WC_Gateway_Aether';
    return $gateways;
}

add_action('woocommerce_blocks_loaded', 'aether_register_blocks_payment_method');
function aether_register_blocks_payment_method() {
    if (!class_exists('Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType')) {
        return;
    }

    if (!class_exists('WC_Gateway_Aether_Blocks')) {
        final class WC_Gateway_Aether_Blocks extends Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType {
            protected $name = 'aether_gateway';
            private $gateway;

            public function initialize() {
                if (!function_exists('WC') || !WC() || !WC()->payment_gateways) {
                    $this->gateway = null;
                    return;
                }

                $gateways = WC()->payment_gateways->payment_gateways();
                $this->gateway = isset($gateways[$this->name]) ? $gateways[$this->name] : null;
            }

            public function is_active() {
                return $this->gateway && 'yes' === $this->gateway->enabled && !empty(aether_get_stripe_public_key()) && !empty(aether_get_merchant_connect_id()) && !empty(aether_get_node_base_url());
            }

            public function get_payment_method_script_handles() {
                wp_register_script('stripe-js', 'https://js.stripe.com/v3/', array(), null, true);
                wp_register_script(
                    'aether-blocks-checkout',
                    plugin_dir_url(__FILE__) . 'assets/js/aether-blocks.js',
                    array('wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities', 'stripe-js'),
                    '1.0.2',
                    true
                );

                return array('stripe-js', 'aether-blocks-checkout');
            }

            public function get_payment_method_data() {
                return array(
                    'title' => $this->gateway ? $this->gateway->title : 'Aether Payment',
                    'description' => $this->gateway ? $this->gateway->description : 'Pay securely through Aether payment processing.',
                    'public_key' => aether_get_stripe_public_key(),
                    'merchant_id' => aether_get_merchant_connect_id(),
                    'node_base_url' => aether_get_node_base_url(),
                    'webhook_url' => esc_url_raw(rest_url('aether-connect/v1/fulfill')),
                );
            }
        }
    }

    add_action(
        'woocommerce_blocks_payment_method_type_registration',
        function ($payment_method_registry) {
            $payment_method_registry->register(new WC_Gateway_Aether_Blocks());
        }
    );
}

add_action('wp_enqueue_scripts', 'aether_gateway_enqueue_scripts');
function aether_gateway_enqueue_scripts() {
    if (!function_exists('is_checkout') || !is_checkout()) {
        return;
    }

    $gateways = WC()->payment_gateways ? WC()->payment_gateways->get_available_payment_gateways() : array();
    if (empty($gateways['aether_gateway'])) {
        return;
    }

    $public_key = aether_get_stripe_public_key();
    if (empty($public_key)) {
        return;
    }

    wp_enqueue_script('stripe-js', 'https://js.stripe.com/v3/', array(), null, true);
    wp_enqueue_script('aether-woocommerce-handler', plugin_dir_url(__FILE__) . 'assets/js/aether-woocommerce.js', array('jquery', 'stripe-js'), '1.0.2', true);

    wp_localize_script('aether-woocommerce-handler', 'aether_wc_config', array(
        'public_key' => $public_key,
        'merchant_id' => aether_get_merchant_connect_id(),
        'node_base_url' => aether_get_node_base_url(),
        'webhook_url' => esc_url_raw(rest_url('aether-connect/v1/fulfill')),
        'gateway_id' => 'aether_gateway',
    ));
}

add_action('rest_api_init', function () {
    register_rest_route('aether-connect/v1', '/fulfill', array(
        'methods' => 'POST',
        'callback' => 'aether_handle_payment_fulfillment',
        'permission_callback' => '__return_true'
    ));
});

function aether_handle_payment_fulfillment(WP_REST_Request $request) {
    $signature = $request->get_header('X-Aether-Signature');
    $expected_signature = aether_get_internal_secret();

    if (empty($expected_signature) || !hash_equals($expected_signature, (string) $signature)) {
        return new WP_REST_Response(array('status' => 'Unauthorized'), 401);
    }

    // Native WooCommerce inventory and order handling stays in WooCommerce.
    // Use this hook to execute custom fulfillment actions like subscriptions, licenses, or external inventory sync.
    do_action('aether_payment_fulfilled', $request);

    return new WP_REST_Response(array('status' => 'Fulfillment processed successfully'), 200);
}
