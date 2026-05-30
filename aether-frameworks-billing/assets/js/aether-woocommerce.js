jQuery(function ($) {
    if (typeof aether_wc_config === 'undefined' || !aether_wc_config.public_key) {
        return;
    }

    const form = $('form.checkout');
    const paymentContainer = $('#aether-woocommerce-payment-element');
    if (!form.length || !paymentContainer.length) {
        return;
    }

    const errorContainer = $('#aether-woocommerce-card-errors');
    if (!aether_wc_config.merchant_id || !aether_wc_config.node_base_url) {
        errorContainer.text('Aether gateway is not configured yet.');
        return;
    }

    const stripe = Stripe(aether_wc_config.public_key);
    let elements = null;
    let paymentElement = null;
    let clientSecret = null;

    function cartAmount() {
        const totalText = $('.wc-block-components-totals-footer-item .wc-block-components-totals-item__value, .order-total .amount').last().text();
        const amount = Number(totalText.replace(/[^0-9.]/g, ''));
        return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    }

    async function mountPaymentElement() {
        if (paymentElement || !aether_wc_config.node_base_url || !aether_wc_config.merchant_id) {
            return;
        }

        const amount = cartAmount();
        if (!amount) {
            errorContainer.text('Unable to calculate checkout total.');
            return;
        }

        const response = await fetch(aether_wc_config.node_base_url.replace(/\/$/, '') + '/api/v1/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amount,
                merchantConnectId: aether_wc_config.merchant_id,
                templateWebhookUrl: aether_wc_config.webhook_url,
            }),
        });
        const data = await response.json();
        if (!data.success) {
            errorContainer.text(data.error || 'Unable to initialize Aether payment.');
            return;
        }

        clientSecret = data.clientSecret;
        elements = stripe.elements({ clientSecret: clientSecret });
        paymentElement = elements.create('payment', {
            layout: 'tabs',
        });
        paymentElement.mount('#aether-woocommerce-payment-element');
    }

    mountPaymentElement().catch(function (error) {
        errorContainer.text(error.message || 'Unable to initialize Aether payment.');
    });

    form.on('checkout_place_order_' + aether_wc_config.gateway_id, function () {
        const deferred = $.Deferred();

        const paymentIntentIdField = $('#aether_payment_intent_id');
        if (paymentIntentIdField.length && paymentIntentIdField.val()) {
            deferred.resolve();
            return deferred.promise();
        }

        if (!elements || !clientSecret) {
            errorContainer.text('Aether payment is still loading. Please wait a moment and try again.');
            deferred.reject();
            return deferred.promise();
        }

        stripe.confirmPayment({
            elements: elements,
            redirect: 'if_required',
            confirmParams: {
                payment_method_data: {
                    billing_details: {
                        name: $('#billing_first_name').val() + ' ' + $('#billing_last_name').val(),
                        email: $('#billing_email').val(),
                    },
                },
            },
        }).then(function (result) {
            if (result.error) {
                errorContainer.text(result.error.message);
                deferred.reject();
            } else {
                paymentIntentIdField.val(result.paymentIntent.id);
                errorContainer.text('');
                deferred.resolve();
            }
        });

        return deferred.promise();
    });
});
