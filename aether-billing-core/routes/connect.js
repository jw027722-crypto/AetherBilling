const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);

function getNodeBaseUrl(req) {
    if (process.env.NODE_BASE_URL) {
        return process.env.NODE_BASE_URL.replace(/\/$/, '');
    }
    return `${req.protocol}://${req.get('host')}`;
}

/**
 * Custom Connect account (platform-controlled onboarding).
 * Merchant pays Stripe fees via direct charges on this account.
 */
router.post('/custom-account', async (req, res) => {
    const { email, businessName, country } = req.body;
    const appUrl = getNodeBaseUrl(req);

    if (!email) {
        return res.status(400).json({ success: false, error: 'email is required.' });
    }

    try {
        const account = await stripe.accounts.create({
            type: 'custom',
            country: (country || process.env.STRIPE_DEFAULT_COUNTRY || 'US').toUpperCase(),
            email,
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
            business_profile: businessName ? { name: businessName } : undefined,
            metadata: {
                platform: 'aether-frameworks',
                product: 'aether-billing',
            },
        });

        const accountLink = await stripe.accountLinks.create({
            account: account.id,
            refresh_url: `${appUrl}/api/v1/connect/refresh?account=${account.id}`,
            return_url: `${appUrl}/api/v1/connect/return?account=${account.id}`,
            type: 'account_onboarding',
        });

        return res.json({
            success: true,
            accountId: account.id,
            onboardingUrl: accountLink.url,
        });
    } catch (error) {
        console.error('Custom Connect account failed:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/return', (_req, res) => {
    res.send('Stripe Connect onboarding complete. Return to the Aether app or WordPress admin.');
});

router.get('/refresh', async (req, res) => {
    const accountId = req.query.account;
    if (!accountId) {
        return res.status(400).send('Missing account id.');
    }

    try {
        const appUrl = getNodeBaseUrl(req);
        const accountLink = await stripe.accountLinks.create({
            account: String(accountId),
            refresh_url: `${appUrl}/api/v1/connect/refresh?account=${accountId}`,
            return_url: `${appUrl}/api/v1/connect/return?account=${accountId}`,
            type: 'account_onboarding',
        });
        return res.redirect(accountLink.url);
    } catch (error) {
        console.error('Connect refresh failed:', error.message);
        return res.status(500).send(error.message);
    }
});

module.exports = router;
