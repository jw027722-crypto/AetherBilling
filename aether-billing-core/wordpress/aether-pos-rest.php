<?php
/**
 * Aether Terminal POS — WooCommerce catalog sync (read-only products, in-person orders).
 */

if (!defined('ABSPATH')) {
    exit;
}

function aether_pos_verify_signature(WP_REST_Request $request) {
    $signature = $request->get_header('X-Aether-Signature');
    $expected = aether_get_internal_secret();

    if (empty($expected)) {
        return false;
    }

    $body = $request->get_body();
    $payload = is_string($body) ? $body : '';
    $computed = hash_hmac('sha256', $payload, $expected);

    return hash_equals($computed, (string) $signature);
}

function aether_pos_permission(WP_REST_Request $request) {
    return aether_pos_verify_signature($request);
}

function aether_pos_store_info() {
    return rest_ensure_response(array(
        'success' => true,
        'siteName' => get_bloginfo('name'),
        'siteUrl' => home_url('/'),
        'currency' => function_exists('get_woocommerce_currency')
            ? get_woocommerce_currency()
            : 'EUR',
    ));
}

function aether_pos_list_products() {
    if (!function_exists('wc_get_products')) {
        return new WP_REST_Response(array('success' => false, 'error' => 'WooCommerce is not active.'), 503);
    }

    $products = wc_get_products(array(
        'status' => 'publish',
        'limit' => 200,
        'orderby' => 'title',
        'order' => 'ASC',
        'return' => 'objects',
    ));

    $items = array();
    foreach ($products as $product) {
        if (!$product->is_in_stock() && !$product->backorders_allowed()) {
            continue;
        }

        $price = $product->get_price();
        if ($price === '' || $price === null) {
            continue;
        }

        $items[] = array(
            'id' => $product->get_id(),
            'name' => $product->get_name(),
            'sku' => $product->get_sku(),
            'price' => (float) $price,
            'priceCents' => (int) round(((float) $price) * 100),
            'currency' => get_woocommerce_currency(),
            'inStock' => $product->is_in_stock(),
            'imageUrl' => wp_get_attachment_image_url($product->get_image_id(), 'thumbnail'),
        );
    }

    return rest_ensure_response(array(
        'success' => true,
        'products' => $items,
    ));
}

function aether_pos_create_order(WP_REST_Request $request) {
    if (!function_exists('wc_create_order')) {
        return new WP_REST_Response(array('success' => false, 'error' => 'WooCommerce is not active.'), 503);
    }

    $params = $request->get_json_params();
    $line_items = isset($params['lineItems']) && is_array($params['lineItems']) ? $params['lineItems'] : array();
    $payment_intent_id = isset($params['paymentIntentId']) ? sanitize_text_field($params['paymentIntentId']) : '';
    $currency = isset($params['currency']) ? sanitize_text_field($params['currency']) : get_woocommerce_currency();

    if (empty($line_items) || empty($payment_intent_id)) {
        return new WP_REST_Response(array('success' => false, 'error' => 'lineItems and paymentIntentId are required.'), 400);
    }

    try {
        $order = wc_create_order(array(
            'status' => 'processing',
        ));

        foreach ($line_items as $line) {
            $product_id = isset($line['productId']) ? absint($line['productId']) : 0;
            $quantity = isset($line['quantity']) ? max(1, absint($line['quantity'])) : 1;

            if (!$product_id) {
                continue;
            }

            $product = wc_get_product($product_id);
            if (!$product) {
                return new WP_REST_Response(array(
                    'success' => false,
                    'error' => 'Product not found: ' . $product_id,
                ), 400);
            }

            if (!$product->is_in_stock() && !$product->backorders_allowed()) {
                return new WP_REST_Response(array(
                    'success' => false,
                    'error' => $product->get_name() . ' is out of stock.',
                ), 400);
            }

            $order->add_product($product, $quantity);
        }

        if (!$order->get_item_count()) {
            return new WP_REST_Response(array('success' => false, 'error' => 'No valid line items.'), 400);
        }

        $order->set_currency($currency);
        $pay_in_4 = isset($params['payIn4']) && is_array($params['payIn4']) ? $params['payIn4'] : null;

        if ($pay_in_4 && !empty($pay_in_4['totalCents'])) {
            $order->set_payment_method('aether_gateway');
            $order->set_payment_method_title('Aether Pay in 4 (Terminal)');
            $order->set_created_via('aether_terminal');
            $order->calculate_totals();
            $order->update_meta_data('_aether_payment_intent_id', $payment_intent_id);
            $order->update_meta_data('_aether_terminal_sale', 'yes');
            $order->update_meta_data('_aether_pay_in_4', 'yes');
            $order->update_meta_data('_aether_installment_total_cents', absint($pay_in_4['totalCents']));
            $order->update_meta_data('_aether_installment_paid_count', absint($pay_in_4['paidInstallments'] ?? 1));
            $order->update_meta_data('_aether_installment_count', absint($pay_in_4['installmentCount'] ?? 4));
            if (!empty($pay_in_4['installmentAmounts']) && is_array($pay_in_4['installmentAmounts'])) {
                $order->update_meta_data('_aether_installment_amounts', wp_json_encode($pay_in_4['installmentAmounts']));
            }
            if (!empty($pay_in_4['nextDueAt'])) {
                $order->update_meta_data('_aether_installment_next_due', sanitize_text_field($pay_in_4['nextDueAt']));
            }
            $order->set_status('on-hold');
            $first_cents = isset($pay_in_4['installmentAmounts'][0]) ? absint($pay_in_4['installmentAmounts'][0]) : 0;
            $order->add_order_note(
                sprintf(
                    'Aether Pay in 4 — installment 1/%d collected via Terminal (%s). Next due: %s. PaymentIntent: %s',
                    absint($pay_in_4['installmentCount'] ?? 4),
                    wc_price($first_cents / 100, array('currency' => $currency)),
                    !empty($pay_in_4['nextDueAt']) ? sanitize_text_field($pay_in_4['nextDueAt']) : '—',
                    $payment_intent_id
                )
            );
        } else {
            $order->set_payment_method('aether_gateway');
            $order->set_payment_method_title('Aether Terminal (Tap to Pay)');
            $order->set_created_via('aether_terminal');
            $order->calculate_totals();
            $order->update_meta_data('_aether_payment_intent_id', $payment_intent_id);
            $order->update_meta_data('_aether_terminal_sale', 'yes');
            $order->payment_complete($payment_intent_id);
            $order->add_order_note(
                sprintf('Paid in person via Aether Terminal. Stripe PaymentIntent: %s', $payment_intent_id)
            );
        }

        $order->save();

        return rest_ensure_response(array(
            'success' => true,
            'orderId' => $order->get_id(),
            'orderNumber' => $order->get_order_number(),
        ));
    } catch (Exception $exception) {
        return new WP_REST_Response(array(
            'success' => false,
            'error' => $exception->getMessage(),
        ), 500);
    }
}

function aether_pos_register_rest_routes() {
    register_rest_route('aether/v1', '/store', array(
        'methods' => 'GET',
        'callback' => 'aether_pos_store_info',
        'permission_callback' => 'aether_pos_permission',
    ));

    register_rest_route('aether/v1', '/products', array(
        'methods' => 'GET',
        'callback' => 'aether_pos_list_products',
        'permission_callback' => 'aether_pos_permission',
    ));

    register_rest_route('aether/v1', '/pos-order', array(
        'methods' => 'POST',
        'callback' => 'aether_pos_create_order',
        'permission_callback' => 'aether_pos_permission',
    ));
}

add_action('rest_api_init', 'aether_pos_register_rest_routes');

function aether_pos_sync_site_registration() {
    $merchant_id = aether_get_merchant_connect_id();
    if (empty($merchant_id) || strpos($merchant_id, 'acct_') !== 0) {
        return;
    }

    aether_register_site_secret();
}

add_action('update_option_aether_merchant_connect_id', 'aether_pos_sync_site_registration', 10, 0);
