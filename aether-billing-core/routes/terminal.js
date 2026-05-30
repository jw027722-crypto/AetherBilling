const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);
const { applicationFeeAmount } = require('../lib/fees');
const {
    getNodeBaseUrl,
    defaultTerminalAddress,
    configuredValue,
    terminalOAuthReturnUrl,
    buildConnectUrl,
} = require('../lib/urls');
const { getSiteByStripeAccount, fetchWordPressJson } = require('../lib/sites');
const { splitInstallments, nextDueDates, INSTALLMENT_COUNT } = require('../lib/installments');
const { createInstallmentPlan } = require('../lib/installment-plans');

const APP_DEEP_LINK = 'aetherterminal://account';

/**
 * Mobile POS (Tap to Pay) — direct charges on the connected account.
 * @see https://docs.stripe.com/terminal/features/connect
 */
router.get('/onboarding-url', (req, res) => {
    const connectUrl = buildConnectUrl(req, terminalOAuthReturnUrl(req));
    if (!connectUrl) {
        return res.status(503).json({
            success: false,
            error: 'STRIPE_CLIENT_ID is not configured on the billing server.',
        });
    }
    return res.json({
        success: true,
        connectUrl,
        returnUrl: terminalOAuthReturnUrl(req),
    });
});

/** Stripe OAuth lands here, then opens the Aether Terminal app. */
router.get('/oauth-return', (req, res) => {
    const connectedId = req.query.connected_id ? String(req.query.connected_id) : '';
    const appUrl = connectedId.startsWith('acct_')
        ? `${APP_DEEP_LINK}?connected_id=${encodeURIComponent(connectedId)}`
        : APP_DEEP_LINK;
    const safeId = connectedId.replace(/[<>&"']/g, '');

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Return to Aether Terminal</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1a1d21; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; padding: 2rem; max-width: 24rem; }
    a { color: #2f7cf6; }
    code { font-size: 0.85rem; word-break: break-all; }
  </style>
  <script>
    (function () {
      var appUrl = ${JSON.stringify(appUrl)};
      window.location.replace(appUrl);
    })();
  </script>
</head>
<body>
  <div class="card">
    <h1>Opening Aether Terminal…</h1>
    <p>Your account is linked${safeId ? `: <code>${safeId}</code>` : ''}.</p>
    <p><a href="${appUrl.replace(/"/g, '&quot;')}">Tap here</a> if the app did not open.</p>
  </div>
</body>
</html>`);
});

router.get('/config', (req, res) => {
    const publishableKey = configuredValue(process.env.STRIPE_PLATFORM_PUBLIC_KEY);
    if (!publishableKey) {
        return res.status(503).json({
            success: false,
            error: 'STRIPE_PLATFORM_PUBLIC_KEY is not configured.',
        });
    }
    return res.json({
        success: true,
        mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test',
        currency: (process.env.STRIPE_DEFAULT_CURRENCY || 'eur').toLowerCase(),
        country: (process.env.STRIPE_DEFAULT_COUNTRY || 'IE').toUpperCase(),
        applicationFeePercent: 1,
        billingUrl: getNodeBaseUrl(req),
    });
});

router.get('/store', async (req, res) => {
    const merchantConnectId = String(req.query.merchantConnectId || '');

    if (!merchantConnectId.startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    try {
        const site = await getSiteByStripeAccount(merchantConnectId);
        if (!site) {
            return res.json({
                success: true,
                linked: false,
                siteUrl: null,
                siteName: null,
            });
        }

        let siteName = site.site_url;
        try {
            const info = await fetchWordPressJson(site, '/wp-json/aether/v1/store');
            siteName = info.siteName || siteName;
        } catch {
            // Store may be reachable for catalog even if info fails.
        }

        return res.json({
            success: true,
            linked: true,
            siteUrl: site.site_url,
            siteName,
        });
    } catch (error) {
        console.error('Terminal store lookup failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/catalog', async (req, res) => {
    const merchantConnectId = String(req.query.merchantConnectId || '');

    if (!merchantConnectId.startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    try {
        const site = await getSiteByStripeAccount(merchantConnectId);
        if (!site) {
            return res.json({ success: true, linked: false, products: [] });
        }

        const data = await fetchWordPressJson(site, '/wp-json/aether/v1/products');
        return res.json({
            success: true,
            linked: true,
            siteUrl: site.site_url,
            products: Array.isArray(data.products) ? data.products : [],
        });
    } catch (error) {
        console.error('Terminal catalog failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/pos-order', async (req, res) => {
    const { merchantConnectId, lineItems, paymentIntentId, currency, payIn4 } = req.body;

    if (!merchantConnectId || !String(merchantConnectId).startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    if (!paymentIntentId || !Array.isArray(lineItems) || !lineItems.length) {
        return res.status(400).json({
            success: false,
            error: 'paymentIntentId and lineItems are required.',
        });
    }

    try {
        const site = await getSiteByStripeAccount(merchantConnectId);
        if (!site) {
            return res.status(404).json({
                success: false,
                error: 'No WordPress store linked to this account. Save settings in WooCommerce admin.',
            });
        }

        const chargeCurrency = currency || process.env.STRIPE_DEFAULT_CURRENCY || 'eur';
        let installmentPayload = null;

        if (payIn4 && payIn4.totalCents) {
            const amounts = splitInstallments(payIn4.totalCents);
            const dueDates = nextDueDates();
            installmentPayload = {
                planId: null,
                totalCents: payIn4.totalCents,
                installmentAmounts: amounts,
                paidInstallments: 1,
                installmentCount: INSTALLMENT_COUNT,
                nextDueAt: dueDates[0] || null,
                intervalDays: 14,
            };
        }

        const data = await fetchWordPressJson(site, '/wp-json/aether/v1/pos-order', {
            method: 'POST',
            body: {
                lineItems,
                paymentIntentId,
                currency: chargeCurrency,
                payIn4: installmentPayload,
            },
        });

        let plan = null;
        if (installmentPayload) {
            plan = await createInstallmentPlan({
                merchantConnectId,
                siteUrl: site.site_url,
                wcOrderId: data.orderId,
                currency: chargeCurrency,
                totalCents: installmentPayload.totalCents,
                installmentAmounts: installmentPayload.installmentAmounts,
                paymentIntentId,
                nextDueAt: installmentPayload.nextDueAt,
            });
            installmentPayload.planId = plan.planId;
        }

        return res.json({
            success: true,
            orderId: data.orderId,
            orderNumber: data.orderNumber,
            payIn4: installmentPayload,
            planId: plan?.planId || null,
        });
    } catch (error) {
        console.error('Terminal pos-order failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/connection-token', async (req, res) => {
    const { merchantConnectId } = req.body;

    if (!merchantConnectId || !String(merchantConnectId).startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    try {
        const token = await stripe.terminal.connectionTokens.create(
            {},
            { stripeAccount: merchantConnectId }
        );
        return res.json({ success: true, secret: token.secret });
    } catch (error) {
        console.error('Terminal connection token failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/payment-intent', async (req, res) => {
    const { amount, merchantConnectId, currency, metadata } = req.body;
    const amountInt = Number(amount);
    const chargeCurrency = (currency || process.env.STRIPE_DEFAULT_CURRENCY || 'eur').toLowerCase();

    if (!merchantConnectId || !String(merchantConnectId).startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a positive integer in the lowest currency unit.' });
    }

    try {
        const platformFee = applicationFeeAmount(amountInt);

        const paymentIntent = await stripe.paymentIntents.create(
            {
                amount: amountInt,
                currency: chargeCurrency,
                payment_method_types: ['card_present'],
                capture_method: 'automatic',
                application_fee_amount: platformFee,
                metadata: {
                    ...(metadata || {}),
                    aether_application_fee_bps: '100',
                    aether_application_fee_amount: String(platformFee),
                    aether_channel: 'terminal_tap_to_pay',
                },
            },
            { stripeAccount: merchantConnectId }
        );

        return res.json({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            applicationFeeAmount: platformFee,
            currency: chargeCurrency,
        });
    } catch (error) {
        console.error('Terminal PaymentIntent failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/ensure-location', async (req, res) => {
    const { merchantConnectId, displayName } = req.body;

    if (!merchantConnectId || !String(merchantConnectId).startsWith('acct_')) {
        return res.status(400).json({ success: false, error: 'merchantConnectId (acct_...) is required.' });
    }

    const name = displayName || 'Aether Terminal';

    try {
        const existing = await stripe.terminal.locations.list(
            { limit: 1 },
            { stripeAccount: merchantConnectId }
        );
        if (existing.data.length) {
            return res.json({
                success: true,
                locationId: existing.data[0].id,
                created: false,
            });
        }

        const location = await stripe.terminal.locations.create(
            {
                display_name: name,
                address: defaultTerminalAddress(),
            },
            { stripeAccount: merchantConnectId }
        );

        return res.json({ success: true, locationId: location.id, created: true });
    } catch (error) {
        console.error('Terminal ensure-location failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/location', async (req, res) => {
    const { merchantConnectId, displayName, address } = req.body;

    if (!merchantConnectId || !displayName) {
        return res.status(400).json({ success: false, error: 'merchantConnectId and displayName are required.' });
    }

    try {
        const location = await stripe.terminal.locations.create(
            {
                display_name: displayName,
                address: address || defaultTerminalAddress(),
            },
            { stripeAccount: merchantConnectId }
        );

        return res.json({ success: true, locationId: location.id });
    } catch (error) {
        console.error('Terminal location failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
