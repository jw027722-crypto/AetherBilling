(function () {
    const settings = window.wc.wcSettings.getSetting('aether_gateway_data', {});
    const label = window.wp.htmlEntities.decodeEntities(settings.title || 'Aether Payment');
    let stripe = null;
    let elements = null;
    let paymentElement = null;
    let clientSecret = null;

    const Content = function (props) {
        const errorId = 'aether-blocks-card-errors';

        window.wp.element.useEffect(function () {
            const mountCard = function () {
                const container = document.getElementById('aether-blocks-card-element');
                if (!container || paymentElement) {
                    return;
                }

                if (!settings.public_key || !settings.node_base_url || !settings.merchant_id) {
                    const errorContainer = document.getElementById(errorId);
                    if (errorContainer) {
                        errorContainer.textContent = 'Aether checkout is not configured yet.';
                    }
                    return;
                }

                const amount = Number(
                    document.querySelector('.wc-block-components-totals-footer-item .wc-block-components-totals-item__value')
                        ?.textContent.replace(/[^0-9.]/g, '')
                );
                if (!Number.isFinite(amount) || amount <= 0) {
                    return;
                }

                fetch(settings.node_base_url.replace(/\/$/, '') + '/api/v1/create-payment-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        amount: Math.round(amount * 100),
                        merchantConnectId: settings.merchant_id,
                        templateWebhookUrl: settings.webhook_url,
                    }),
                })
                    .then((response) => response.json())
                    .then((data) => {
                        if (!data.success) {
                            throw new Error(data.error || 'Unable to initialize Aether payment.');
                        }

                        clientSecret = data.clientSecret;
                        stripe = window.Stripe(settings.public_key);
                        elements = stripe.elements({ clientSecret: clientSecret });
                        paymentElement = elements.create('payment', { layout: 'tabs' });
                        paymentElement.mount(container);
                    })
                    .catch((error) => {
                        const errorContainer = document.getElementById(errorId);
                        if (errorContainer) {
                            errorContainer.textContent = error.message || 'Unable to initialize Aether payment.';
                        }
                    });
            };

            window.setTimeout(mountCard, 0);
        }, []);

        window.wp.element.useEffect(function () {
            if (!props.eventRegistration || !props.eventRegistration.onPaymentProcessing) {
                return;
            }

            return props.eventRegistration.onPaymentProcessing(async function () {
                if (!stripe || !elements || !clientSecret) {
                    return {
                        type: props.emitResponse.responseTypes.ERROR,
                        message: 'Aether checkout is not ready yet. Please refresh and try again.',
                    };
                }

                const result = await stripe.confirmPayment({
                    elements: elements,
                    redirect: 'if_required',
                });

                if (result.error) {
                    return {
                        type: props.emitResponse.responseTypes.ERROR,
                        message: result.error.message,
                    };
                }

                return {
                    type: props.emitResponse.responseTypes.SUCCESS,
                    meta: {
                        paymentMethodData: {
                            aether_payment_intent_id: result.paymentIntent.id,
                        },
                    },
                };
            });
        }, [props.eventRegistration, props.emitResponse]);

        return window.wp.element.createElement(
            'div',
            null,
            settings.description
                ? window.wp.element.createElement('p', null, window.wp.htmlEntities.decodeEntities(settings.description))
                : null,
            window.wp.element.createElement('div', {
                id: 'aether-blocks-card-element',
                style: {
                    marginBottom: '16px',
                    padding: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                },
            }),
            window.wp.element.createElement('div', {
                id: errorId,
                role: 'alert',
                style: { color: '#d93025', marginBottom: '12px' },
            })
        );
    };

    const AetherPaymentMethod = {
        name: 'aether_gateway',
        label: label,
        content: window.wp.element.createElement(Content, null),
        edit: window.wp.element.createElement(Content, null),
        canMakePayment: function () {
            return !!settings.public_key;
        },
        ariaLabel: label,
        supports: {
            features: settings.supports || ['products'],
        },
        paymentMethodId: 'aether_gateway',
        placeOrderButtonLabel: 'Place Order',
    };

    window.wc.wcBlocksRegistry.registerPaymentMethod(AetherPaymentMethod);
})();
