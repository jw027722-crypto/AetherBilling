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

async function createInstallmentPlan({
    merchantConnectId,
    siteUrl,
    wcOrderId,
    currency,
    totalCents,
    installmentAmounts,
    paymentIntentId,
    nextDueAt,
}) {
    const planId = `aip_${crypto.randomBytes(12).toString('hex')}`;
    const amountsJson = JSON.stringify(installmentAmounts);
    const paymentIdsJson = JSON.stringify([paymentIntentId]);

    await run(
        `INSERT INTO installment_plans (
            plan_id, merchant_connect_id, site_url, wc_order_id, currency,
            total_cents, installment_amounts, paid_count, payment_intent_ids,
            next_due_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            planId,
            merchantConnectId,
            siteUrl || null,
            wcOrderId || null,
            currency,
            totalCents,
            amountsJson,
            1,
            paymentIdsJson,
            nextDueAt || null,
            'active',
        ]
    );

    return { planId, paidCount: 1, installmentCount: installmentAmounts.length };
}

async function getPlanById(planId) {
    return get(`SELECT * FROM installment_plans WHERE plan_id = ?`, [planId]);
}

module.exports = {
    createInstallmentPlan,
    getPlanById,
};
