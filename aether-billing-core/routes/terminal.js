const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_PLATFORM_SECRET_KEY);
const { applicationFeeAmount } = require('../lib/fees');

/**
 * Mobile POS (Tap to Pay) — direct charges on the connected account.
 * Merchant pays Stripe processing fees; platform collects application_fee_amount.
 * @see https://docs.stripe.com/terminal/features/connect
 */
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
    const chargeCurrency = (currency || process.env.STRIPE_DEFAULT_CURRENCY || 'usd').toLowerCase();

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

router.post('/location', async (req, res) => {
    const { merchantConnectId, displayName, address } = req.body;

    if (!merchantConnectId || !displayName) {
        return res.status(400).json({ success: false, error: 'merchantConnectId and displayName are required.' });
    }

    try {
        const location = await stripe.terminal.locations.create(
            {
                display_name: displayName,
                address: address || {
                    line1: '100 Main St',
                    city: 'San Francisco',
                    state: 'CA',
                    postal_code: '94111',
                    country: 'US',
                },
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
