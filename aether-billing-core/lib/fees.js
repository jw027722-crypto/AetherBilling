/**
 * Platform application fee — matches WordPress / WooCommerce billing (1%).
 * @param {number} amountInt - Amount in smallest currency unit
 * @returns {number}
 */
function applicationFeeAmount(amountInt) {
    if (!Number.isInteger(amountInt) || amountInt <= 0) {
        throw new Error('Amount must be a positive integer in the lowest currency unit.');
    }
    const platformFee = Math.round(amountInt * 0.01);
    return platformFee < 1 && amountInt > 0 ? 1 : platformFee;
}

module.exports = { applicationFeeAmount };
