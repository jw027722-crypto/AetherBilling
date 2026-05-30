const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);
const { applicationFeeAmount } = require('../lib/fees');
const { upsertSite } = require('../lib/sites');
const {
    getNodeBaseUrl,
    configuredValue,
    terminalOAuthReturnUrl,
    buildConnectUrl,
} = require('../lib/urls');

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

function stripeCurrency() {
    return (process.env.STRIPE_DEFAULT_CURRENCY || 'usd').toLowerCase();
}

/**
 * Direct charge on connected account — merchant pays Stripe processing fees.
 * Platform keeps application_fee_amount (1%).
 */
function directChargeOptions(merchantConnectId) {
    return { stripeAccount: merchantConnectId };
}

router.get('/public-config', (req, res) => {
    const nodeBaseUrl = getNodeBaseUrl(req);
    const publishableKey = configuredValue(process.env.STRIPE_PLATFORM_PUBLIC_KEY);
    const siteUrl = req.query.site_url ? String(req.query.site_url) : '';
    const returnUrl = req.query.return_url ? String(req.query.return_url) : '';
    const oauthState = returnUrl || siteUrl;
    const connectUrl = buildConnectUrl(req, oauthState);

    if (!publishableKey) {
        return res.status(503).json({
            success: false,
            error: 'STRIPE_PLATFORM_PUBLIC_KEY is not configured on the billing server.',
        });
    }

    res.json({
        service: 'aether-billing-core',
        mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test',
        publishableKey,
        connectUrl,
        callbackUrl: `${nodeBaseUrl}/api/v1/stripe/callback`,
        chargeModel: 'direct',
        applicationFeePercent: 1,
        terminalOnboardingUrl: `${nodeBaseUrl}/api/v1/terminal/onboarding-url`,
        terminalOAuthReturnUrl: terminalOAuthReturnUrl(req),
    });
});

router.post('/register-site', async (req, res) => {
    const { fulfillmentUrl, siteUrl, merchantConnectId } = req.body;

    if (!fulfillmentUrl || !isValidWebhookUrl(fulfillmentUrl)) {
        return res.status(400).json({ success: false, error: 'A valid fulfillment URL is required.' });
    }

    try {
        const siteSecret = deriveSiteSecret(fulfillmentUrl);
        if (siteUrl) {
            await upsertSite({
                siteUrl,
                siteSecret,
                stripeAccountId: merchantConnectId || null,
            });
        }
        return res.json({
            success: true,
            siteSecret,
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
        const finalPlatformFee = applicationFeeAmount(amountInt);
        const fulfillmentSecret = deriveSiteSecret(templateWebhookUrl);

        const paymentIntent = await stripe.paymentIntents.create(
            {
                amount: amountInt,
                currency: stripeCurrency(),
                payment_method: paymentMethodId,
                confirm: true,
                automatic_payment_methods: {
                    enabled: true,
                    allow_redirects: 'never',
                },
                application_fee_amount: finalPlatformFee,
            },
            directChargeOptions(merchantConnectId)
        );

        if (paymentIntent.status === 'succeeded') {
            fetch(templateWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Aether-Signature': fulfillmentSecret,
                },
                body: JSON.stringify({
                    status: 'success',
                    amount_processed: amountInt,
                }),
            }).catch((err) => console.error('Async webhook delivery failed:', err));

            return res.status(200).json({ success: true, chargeId: paymentIntent.id });
        }

        return res.status(400).json({ success: false, error: `Payment failed with status: ${paymentIntent.status}` });
    } catch (error) {
        console.error('Stripe transaction failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/create-payment-intent', async (req, res) => {
    const { amount, merchantConnectId, templateWebhookUrl, orderId } = req.body;
    const amountInt = Number(amount);

    if (!amount || !merchantConnectId || !templateWebhookUrl) {
        return res.status(400).json({ success: false, error: 'Missing required payment intent parameters.' });
    }

    if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a positive integer in the lowest currency unit.' });
    }

    if (!isValidWebhookUrl(templateWebhookUrl)) {
        return res.status(400).json({ success: false, error: 'Template webhook URL must be a valid http(s) URL.' });
    }

    try {
        const finalPlatformFee = applicationFeeAmount(amountInt);

        const paymentIntent = await stripe.paymentIntents.create(
            {
                amount: amountInt,
                currency: stripeCurrency(),
                automatic_payment_methods: {
                    enabled: true,
                },
                application_fee_amount: finalPlatformFee,
                metadata: {
                    orderId: orderId ? String(orderId) : '',
                    templateWebhookUrl,
                },
            },
            directChargeOptions(merchantConnectId)
        );

        return res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            applicationFeeAmount: finalPlatformFee,
        });
    } catch (error) {
        console.error('Stripe PaymentIntent creation failed:', error.message);
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
            console.warn('Invalid state URL from Stripe callback:', state);
            redirectUrl = `${getNodeBaseUrl(req)}/?connected_id=${encodeURIComponent(merchantConnectId)}`;
        }

        console.log(`Connected merchant ${merchantConnectId} from ${state}`);
        return res.redirect(redirectUrl);
    } catch (error) {
        console.error('Stripe OAuth callback failed:', error.message);
        return res.status(500).send(`OAuth handshake failed: ${error.message}`);
    }
});

module.exports = router;
