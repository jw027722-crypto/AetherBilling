const express = require('express');
const router = express.Router();
const db = require('../database');
const crypto = require('crypto');

// Fire and forget response
const sendAsyncResponse = (res) => {
    res.status(202).json({ success: true, status: 'processing' });
};

// Publisher endpoints
router.post('/register-publisher', (req, res) => {
    const { site_url, stripe_account_id } = req.body;
    
    if (!site_url) {
        return res.status(400).json({ error: 'site_url is required' });
    }

    sendAsyncResponse(res);
    
    const siteSecret = crypto.randomBytes(32).toString('hex');
    
    db.run(
        `INSERT INTO sites (site_url, site_secret, stripe_account_id, role) 
         VALUES (?, ?, ?, 'publisher')
         ON CONFLICT(site_url) DO UPDATE SET stripe_account_id = excluded.stripe_account_id`,
        [site_url, siteSecret, stripe_account_id],
        (err) => {
            if (err) console.error('Error registering publisher:', err.message);
        }
    );
});

// Sync ad zones and ads from WP to Node (for centralization)
router.post('/sync-ads', (req, res) => {
    const { site_url, ads } = req.body; // array of ads
    
    if (!site_url || !Array.isArray(ads)) {
        return res.status(400).json({ error: 'site_url and ads array are required' });
    }

    sendAsyncResponse(res);

    db.get(`SELECT id FROM sites WHERE site_url = ?`, [site_url], (err, site) => {
        if (err || !site) return console.error('Site not found for ad sync:', site_url);
        
        // simple replace for now - delete old, insert new
        db.run(`DELETE FROM ads WHERE site_id = ?`, [site.id], () => {
            const stmt = db.prepare(`INSERT INTO ads (site_id, title, content, target_url, image_url) VALUES (?, ?, ?, ?, ?)`);
            ads.forEach(ad => {
                stmt.run(site.id, ad.title, ad.content, ad.target_url, ad.image_url);
            });
            stmt.finalize();
        });
    });
});

// Ad serving endpoints
router.get('/serve', (req, res) => {
    // This is synchronous because the client needs the ad HTML to display it
    const { publisher_site_url } = req.query;
    
    // Pick a random active ad
    db.get(
        `SELECT ads.*, sites.site_url as advertiser_url 
         FROM ads 
         JOIN sites ON ads.site_id = sites.id 
         WHERE ads.status = 'active'
         ORDER BY RANDOM() LIMIT 1`,
        (err, ad) => {
            if (err || !ad) {
                return res.json({ success: false, ad: null });
            }

            // Return the ad immediately
            res.json({ success: true, ad });

            // Record impression asynchronously
            if (publisher_site_url) {
                db.get(`SELECT id FROM sites WHERE site_url = ?`, [publisher_site_url], (err, pubSite) => {
                    if (pubSite) {
                        db.run(
                            `INSERT INTO events (ad_id, publisher_site_id, event_type, revenue) VALUES (?, ?, 'impression', 0.001)`,
                            [ad.id, pubSite.id]
                        );
                    }
                });
            }
        }
    );
});

router.post('/track', (req, res) => {
    const { ad_id, publisher_site_url, event_type } = req.body;
    
    if (!ad_id || !event_type) {
        return res.status(400).json({ error: 'ad_id and event_type required' });
    }

    sendAsyncResponse(res);

    db.get(`SELECT id FROM sites WHERE site_url = ?`, [publisher_site_url], (err, pubSite) => {
        const pubId = pubSite ? pubSite.id : null;
        // higher revenue for clicks
        const rev = event_type === 'click' ? 0.05 : 0.001; 
        
        db.run(
            `INSERT INTO events (ad_id, publisher_site_id, event_type, revenue) VALUES (?, ?, ?, ?)`,
            [ad_id, pubId, event_type, rev],
            (err) => {
                if (err) console.error('Error tracking event:', err.message);
            }
        );
    });
});

module.exports = router;