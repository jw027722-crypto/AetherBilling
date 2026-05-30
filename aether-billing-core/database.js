const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'billing.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.serialize(() => {
            // Sites table (Publishers/Advertisers)
            db.run(`CREATE TABLE IF NOT EXISTS sites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_url TEXT UNIQUE,
                site_secret TEXT,
                stripe_account_id TEXT,
                role TEXT DEFAULT 'publisher',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Ads table
            db.run(`CREATE TABLE IF NOT EXISTS ads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id INTEGER,
                title TEXT,
                content TEXT,
                target_url TEXT,
                image_url TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(site_id) REFERENCES sites(id)
            )`);

            // Events table (Tracking impressions/clicks)
            db.run(`CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ad_id INTEGER,
                publisher_site_id INTEGER,
                event_type TEXT,
                revenue REAL DEFAULT 0.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS installment_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id TEXT UNIQUE,
                merchant_connect_id TEXT,
                site_url TEXT,
                wc_order_id INTEGER,
                currency TEXT,
                total_cents INTEGER,
                installment_amounts TEXT,
                paid_count INTEGER DEFAULT 0,
                payment_intent_ids TEXT,
                next_due_at TEXT,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
        });
    }
});

module.exports = db;