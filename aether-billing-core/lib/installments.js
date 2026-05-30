const INSTALLMENT_COUNT = 4;
const INSTALLMENT_INTERVAL_DAYS = 14;

function splitInstallments(totalCents, count = INSTALLMENT_COUNT) {
    const total = Math.max(0, Math.round(Number(totalCents) || 0));
    if (total <= 0) {
        return Array.from({ length: count }, () => 0);
    }

    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function nextDueDates(fromDate = new Date(), count = INSTALLMENT_COUNT) {
    const dates = [];
    const start = new Date(fromDate);
    for (let i = 1; i < count; i += 1) {
        const due = new Date(start);
        due.setDate(due.getDate() + INSTALLMENT_INTERVAL_DAYS * i);
        dates.push(due.toISOString());
    }
    return dates;
}

module.exports = {
    INSTALLMENT_COUNT,
    INSTALLMENT_INTERVAL_DAYS,
    splitInstallments,
    nextDueDates,
};
