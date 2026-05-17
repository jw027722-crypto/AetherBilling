const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);

function getNodeBaseUrl(req) {
    let baseUrl = '';
    if (process.env.NODE_BASE_URL) {
        baseUrl = process.env.NODE_BASE_URL.replace(/\/$/, '');
    } else {
        baseUrl = `${req.protocol}://${req.get('host')}`;
    }

    if (baseUrl === 'http://billing.aetherframeworks.dev') {
        return 'https://billing.aetherframeworks.dev';
    }

    return baseUrl;
}

function configuredValue(value, fallback = '') {
    if (!value || String(value).includes('YOUR_')) {
        return fallback;
    }

    return value;
}

function isValidWebhookUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (error) {
        return false;
    }
}

function deriveSiteSecret(fulfillmentUrl) {
    if (!process.env.AETHER_INTERNAL_SECRET) {
        throw new Error('AETHER_INTERNAL_SECRET is not configured.');
    }

    return crypto
        .createHmac('sha256', process.env.AETHER_INTERNAL_SECRET)
        .update(String(fulfillmentUrl))
        .digest('hex');
}

router.get('/public-config', (req, res) => {
    const nodeBaseUrl = getNodeBaseUrl(req);
    const stripeClientId = configuredValue(process.env.STRIPE_CLIENT_ID, 'ca_UQANCaprrc365d1YoGD7Ed5dNK3qEyDH');
    const publishableKey = configuredValue(process.env.STRIPE_PLATFORM_PUBLIC_KEY, 'pk_test_51TRK2DLo7DsjY6wE9gVZqwBrEmNrVGQr8RUc94YE11FW3BghQRet3GKUi0CiY7ybnU6n2sheio93cTROJc0eLBuD00v9KsqsBR');
    const siteUrl = req.query.site_url ? String(req.query.site_url) : '';

    let connectUrl = '';
    if (stripeClientId && siteUrl) {
        connectUrl = `https://connect.stripe.com/oauth/authorize?${new URLSearchParams({
            response_type: 'code',
            client_id: stripeClientId,
            scope: 'read_write',
            redirect_uri: `${nodeBaseUrl}/api/v1/stripe/callback`,
            state: siteUrl,
        }).toString()}`;
    }

    res.json({
        service: 'aether-billing-core',
        mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test',
        publishableKey,
        connectUrl,
        callbackUrl: `${nodeBaseUrl}/api/v1/stripe/callback`,
    });
});

router.post('/register-site', (req, res) => {
    const { fulfillmentUrl } = req.body;

    if (!fulfillmentUrl || !isValidWebhookUrl(fulfillmentUrl)) {
        return res.status(400).json({ success: false, error: 'A valid fulfillment URL is required.' });
    }

    try {
        return res.json({
            success: true,
            siteSecret: deriveSiteSecret(fulfillmentUrl),
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/process-payment', async (req, res) => {
    const { paymentMethodId, amount, merchantConnectId, templateWebhookUrl } = req.body;
    const amountInt = Number(amount);

    if (!paymentMethodId || !amount || !merchantConnectId || !templateWebhookUrl) {
        return res.status(400).json({ success: false, error: 'Missing required orchestration parameters.' });
    }

    if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a positive integer in the lowest currency unit.' });
    }

    if (!isValidWebhookUrl(templateWebhookUrl)) {
        return res.status(400).json({ success: false, error: 'Template webhook URL must be a valid http(s) URL.' });
    }

    try {
        // Calculate a strict 1% platform fee securely on the server.
        // Example: $10.00 checkout = 1000 cents. 1000 * 0.01 = 10 cents platform fee.
        const platformFee = Math.round(amountInt * 0.01);
        const finalPlatformFee = platformFee < 1 && amountInt > 0 ? 1 : platformFee;
        const fulfillmentSecret = deriveSiteSecret(templateWebhookUrl);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInt,
            currency: 'usd',
            payment_method: paymentMethodId,
            confirm: true,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            },
            application_fee_amount: finalPlatformFee,
            transfer_data: {
                destination: merchantConnectId,
            },
        });

        if (paymentIntent.status === 'succeeded') {
            fetch(templateWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Aether-Signature': fulfillmentSecret
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
            stateUrl.searchParams.set('connected_id', merchantConnectId);
            redirectUrl = stateUrl.toString();
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
