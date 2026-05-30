document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('stripe-card-element')) return;

    const errorDisplay = document.getElementById('card-errors');
    if (typeof aether_config === 'undefined' || !aether_config.public_key || !aether_config.node_base_url || !aether_config.merchant_id) {
        errorDisplay.textContent = 'Aether checkout is not configured yet.';
        return;
    }

    const stripe = Stripe(aether_config.public_key);
    const elements = stripe.elements();
    const cardElement = elements.create('card');
    cardElement.mount('#stripe-card-element');

    const form = document.getElementById('aether-payment-form');
    const submitBtn = document.getElementById('aether-submit-btn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitBtn.disabled = true;
        errorDisplay.textContent = '';

        const { paymentMethod, error } = await stripe.createPaymentMethod({
            type: 'card',
            card: cardElement,
        });

        if (error) {
            errorDisplay.textContent = error.message;
            submitBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch(aether_config.node_base_url.replace(/\/$/, '') + '/api/v1/process-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paymentMethodId: paymentMethod.id,
                    amount: aether_config.amount,
                    merchantConnectId: aether_config.merchant_id,
                    templateWebhookUrl: aether_config.webhook_url
                })
            });

            const data = await response.json();
            if (data.success) {
                alert('Transaction Completed Successfully!');
                location.reload();
            } else {
                errorDisplay.textContent = 'Transaction Rejected: ' + data.error;
                submitBtn.disabled = false;
            }
        } catch (err) {
            errorDisplay.textContent = 'Fatal Connection Outage to Central Engine.';
            submitBtn.disabled = false;
        }
    });
});
