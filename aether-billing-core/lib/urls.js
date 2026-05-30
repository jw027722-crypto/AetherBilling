function getNodeBaseUrl(req) {
    let baseUrl = '';
    if (process.env.NODE_BASE_URL) {
        baseUrl = process.env.NODE_BASE_URL.replace(/\/$/, '');
    } else if (req) {
        baseUrl = `${req.protocol}://${req.get('host')}`;
    }

    if (baseUrl === 'http://billing.aetherframeworks.dev') {
        return 'https://billing.aetherframeworks.dev';
    }

    return baseUrl;
}

function defaultTerminalAddress() {
    const country = (process.env.STRIPE_DEFAULT_COUNTRY || 'IE').toUpperCase();
    const byCountry = {
        IE: {
            line1: '1 OConnell Street',
            city: 'Dublin',
            state: 'D',
            postal_code: 'D01 F5P2',
            country: 'IE',
        },
        US: {
            line1: '100 Main St',
            city: 'San Francisco',
            state: 'CA',
            postal_code: '94111',
            country: 'US',
        },
        GB: {
            line1: '1 Oxford Street',
            city: 'London',
            state: 'England',
            postal_code: 'W1D 1BS',
            country: 'GB',
        },
    };
    return byCountry[country] || { ...byCountry.IE, country };
}

function configuredValue(value) {
    if (!value || String(value).includes('your_') || String(value).includes('YOUR_')) {
        return '';
    }
    return value;
}

function terminalOAuthReturnUrl(req) {
    return `${getNodeBaseUrl(req)}/api/v1/terminal/oauth-return`;
}

function buildConnectUrl(req, oauthState) {
    const stripeClientId = configuredValue(process.env.STRIPE_CLIENT_ID);
    if (!stripeClientId || !oauthState) {
        return '';
    }
    const nodeBaseUrl = getNodeBaseUrl(req);
    return `https://connect.stripe.com/oauth/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: stripeClientId,
        scope: 'read_write',
        redirect_uri: `${nodeBaseUrl}/api/v1/stripe/callback`,
        state: oauthState,
    }).toString()}`;
}

module.exports = {
    getNodeBaseUrl,
    defaultTerminalAddress,
    configuredValue,
    terminalOAuthReturnUrl,
    buildConnectUrl,
};
