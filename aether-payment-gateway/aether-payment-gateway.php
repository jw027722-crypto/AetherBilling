<?php
/**
 * Plugin Name: Aether Frameworks Universal Payment Client
 * Description: Lightweight, stateless bridge layer connecting templates to the central Aether financial matrix.
 * Version: 1.0.0
 * Author: Elder World Studio Inc.
 */

if (!defined('ABSPATH')) {
    exit; // Stop direct execution paths
}

add_action('admin_menu', 'aether_payment_menu');
function aether_payment_menu() {
    add_options_page('Aether Billing Config', 'Aether Billing', 'manage_options', 'aether-billing', 'aether_billing_settings_page');
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

    if (isset($_POST['aether_save_settings'])) {
        if (!isset($_POST['aether_save_settings_nonce']) || !wp_verify_nonce($_POST['aether_save_settings_nonce'], 'aether_save_settings_verify')) {
            wp_die('Security check failed');
        }

        update_option('aether_merchant_connect_id', sanitize_text_field($_POST['merchant_id']));
        update_option('aether_stripe_public_key', sanitize_text_field($_POST['public_key']));
        update_option('aether_stripe_client_id', sanitize_text_field($_POST['stripe_client_id']));
        update_option('aether_node_base_url', esc_url_raw($_POST['node_base_url']));

        echo '<div class="updated"><p>Aether configuration updated successfully.</p></div>';
    }

    $merchant_id = get_option('aether_merchant_connect_id', '');
    $public_key = get_option('aether_stripe_public_key', '');
    $stripe_client_id = get_option('aether_stripe_client_id', '');
    $node_base_url = get_option('aether_node_base_url', 'http://localhost:5000');

    $connect_url = '';
    if (!empty($stripe_client_id) && !empty($node_base_url)) {
        $redirect_uri = rawurlencode(trailingslashit(rtrim($node_base_url, '/')) . 'api/v1/stripe/callback');
        $state = rawurlencode(site_url());
        $connect_url = "https://connect.stripe.com/oauth/authorize?response_type=code&client_id={$stripe_client_id}&scope=read_write&redirect_uri={$redirect_uri}&state={$state}";
    }
    ?>
    <div class="wrap">
        <h1>Aether Frameworks Billing Node Terminal</h1>
        <form method="POST">
            <?php wp_nonce_field('aether_save_settings_verify', 'aether_save_settings_nonce'); ?>
            <table class="form-table">
                <tr>
                    <th><label for="merchant_id">Stripe Connect ID (acct_xxxx)</label></th>
                    <td><input type="text" id="merchant_id" name="merchant_id" value="<?php echo esc_attr($merchant_id); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="public_key">Stripe Publishable Key</label></th>
                    <td><input type="text" id="public_key" name="public_key" value="<?php echo esc_attr($public_key); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="stripe_client_id">Stripe Connect Client ID</label></th>
                    <td><input type="text" id="stripe_client_id" name="stripe_client_id" value="<?php echo esc_attr($stripe_client_id); ?>" class="regular-text"></td>
                </tr>
                <tr>
                    <th><label for="node_base_url">Central Node Server URL</label></th>
                    <td><input type="text" id="node_base_url" name="node_base_url" value="<?php echo esc_attr($node_base_url); ?>" class="regular-text"></td>
                </tr>
            </table>
            <input type="submit" name="aether_save_settings" class="button button-primary" value="Save Credentials">
        </form>

        <?php if (!empty($connect_url)): ?>
            <p style="margin-top: 24px;">
                <a href="<?php echo esc_url($connect_url); ?>" class="button button-primary">Connect with Stripe</a>
            </p>
        <?php endif; ?>
    </div>
    <?php
}

add_shortcode('aether_checkout', 'render_aether_checkout');
function render_aether_checkout($atts) {
    $a = shortcode_atts(array('amount' => '1000'), $atts);

    wp_enqueue_script('stripe-js', 'https://js.stripe.com/v3/', array(), null, true);
    wp_enqueue_script('aether-elements-handler', plugin_dir_url(__FILE__) . 'assets/js/aether-elements.js', array('stripe-js'), '1.0.0', true);

    wp_localize_script('aether-elements-handler', 'aether_config', array(
        'public_key' => get_option('aether_stripe_public_key', ''),
        'merchant_id' => get_option('aether_merchant_connect_id', ''),
        'amount' => intval($a['amount']),
        'webhook_url' => esc_url_raw(rest_url('aether-connect/v1/fulfill'))
    ));

    ob_start();
    include plugin_dir_path(__FILE__) . 'templates/checkout-form.php';
    return ob_get_clean();
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

    if ($signature !== 'aether_shhh_secure_handshake_token') {
        return new WP_REST_Response(array('status' => 'Unauthorized'), 401);
    }

    // --- EXECUTE LOCAL OPTION 1 INVENTORY LOGIC HERE ---
    // Example: $current_stock = get_option('bakery_cupcake_stock');
    // update_option('bakery_cupcake_stock', max(0, $current_stock - 1));

    return new WP_REST_Response(array('status' => 'Fulfillment processed successfully'), 200);
}
