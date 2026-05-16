<?php if (!defined('ABSPATH')) exit; ?>
<div id="aether-checkout-wrapper" style="max-width: 400px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
    <h3>Secure Checkout</h3>
    <form id="aether-payment-form">
        <div id="stripe-card-element" style="margin-bottom: 15px; padding: 10px; border: 1px solid #ccc; border-radius: 4px;"></div>
        <div id="card-errors" role="alert" style="color: red; margin-bottom: 15px;"></div>
        <button id="aether-submit-btn" type="submit" style="width: 100%; padding: 12px; background: #0073aa; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
            Pay $<?php echo number_format(intval($a['amount']) / 100, 2); ?>
        </button>
    </form>
</div>
