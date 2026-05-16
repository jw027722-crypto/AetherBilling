const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);

router.post('/process-payment', async (req, res) => {
    const { paymentMethodId, amount, merchantConnectId, templateWebhookUrl } = req.body;
    const amountInt = Number(amount);

    if (!paymentMethodId || !amount || !merchantConnectId || !templateWebhookUrl) {
        return res.status(400).json({ success: false, error: 'Missing required orchestration parameters.' });
    }

    if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a positive integer in the lowest currency unit.' });
    }

    try {
        const platformFee = Math.max(0, Math.round(amountInt * 0.10));

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInt,
            currency: 'usd',
            payment_method: paymentMethodId,
            confirm: true,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            },
            application_fee_amount: platformFee,
            transfer_data: {
                destination: merchantConnectId,
            },
        });

        if (paymentIntent.status === 'succeeded') {
            fetch(templateWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Aether-Signature': process.env.AETHER_INTERNAL_SECRET
                },
                body: JSON.stringify({
                    status: 'success',
                    amount_processed: amountInt
                })
            }).catch(err => console.error('Async webhook delivery failed down-lane:', err));

            return res.status(200).json({ success: true, chargeId: paymentIntent.id });
        }

        return res.status(400).json({ success: false, error: `Payment failed with status: ${paymentIntent.status}` });
    } catch (error) {
        console.error('Stripe Transaction processing crash:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stripe/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.status(400).send('Missing authorization code from Stripe callback.');
    }

    try {
        const response = await stripe.oauth.token({
            grant_type: 'authorization_code',
            code: code,
        });

        const merchantConnectId = response.stripe_user_id;
        let redirectUrl = '/';

        try {
            const stateUrl = new URL(String(state));
            const base = stateUrl.origin + stateUrl.pathname.replace(/\/$/, '');
            redirectUrl = `${base}/wp-admin/options-general.php?page=aether-billing&connected_id=${encodeURIComponent(merchantConnectId)}`;
        } catch (redirectError) {
            console.warn('Invalid state URL received from Stripe callback:', state);
            redirectUrl = `${process.env.NODE_BASE_URL || 'http://localhost:5000'}/?connected_id=${encodeURIComponent(merchantConnectId)}`;
        }

        console.log(`Successfully connected Merchant ${merchantConnectId} from site ${state}`);
        return res.redirect(redirectUrl);
    } catch (error) {
        console.error('Stripe OAuth callback failed:', error.message);
        return res.status(500).send(`OAuth Handshake Failed: ${error.message}`);
    }
});

module.exports = router;
