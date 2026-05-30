const crypto = require('crypto');
const db = require('../database');

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function normalizeSiteUrl(siteUrl) {
    return String(siteUrl || '').replace(/\/$/, '');
}

async function upsertSite({ siteUrl, siteSecret, stripeAccountId }) {
    const url = normalizeSiteUrl(siteUrl);
    if (!url) return;

    await run(
        `INSERT INTO sites (site_url, site_secret, stripe_account_id)
         VALUES (?, ?, ?)
         ON CONFLICT(site_url) DO UPDATE SET
           site_secret = excluded.site_secret,
           stripe_account_id = COALESCE(excluded.stripe_account_id, sites.stripe_account_id)`,
        [url, siteSecret, stripeAccountId || null]
    );
}

async function linkStripeAccount(siteUrl, stripeAccountId) {
    const url = normalizeSiteUrl(siteUrl);
    if (!url || !stripeAccountId) return;
    await run(
        `UPDATE sites SET stripe_account_id = ? WHERE site_url = ?`,
        [stripeAccountId, url]
    );
}

async function getSiteByStripeAccount(stripeAccountId) {
    if (!stripeAccountId || !String(stripeAccountId).startsWith('acct_')) {
        return null;
    }
    return get(`SELECT * FROM sites WHERE stripe_account_id = ?`, [stripeAccountId]);
}

function signPayload(siteSecret, payload) {
    return crypto
        .createHmac('sha256', siteSecret)
        .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
        .digest('hex');
}

async function fetchWordPressJson(site, path, options = {}) {
    const base = normalizeSiteUrl(site.site_url);
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const method = options.method || 'GET';
    const body = options.body || null;
    const bodyText = body ? JSON.stringify(body) : '';
    const signature = signPayload(site.site_secret, bodyText || '');

    const res = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Aether-Signature': signature,
        },
        body: body ? bodyText : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg =
            typeof data === 'object' && data && 'error' in data
                ? String(data.error)
                : res.statusText;
        throw new Error(msg || 'WordPress request failed');
    }
    return data;
}

module.exports = {
    upsertSite,
    linkStripeAccount,
    getSiteByStripeAccount,
    fetchWordPressJson,
    normalizeSiteUrl,
};
