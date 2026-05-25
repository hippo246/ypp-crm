/**
 * accountingEngine.js
 * Pure functions for all accounting/invoice business logic.
 * Tabs import from here — no raw .reduce() scattered in components.
 */

// ─── Aggregates ────────────────────────────────────────────────────────────────

export function getTotalInvoiced(invoices = []) {
  return invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
}

export function getTotalCollected(invoices = []) {
  return invoices.reduce((s, i) => s + (i.paid ?? 0), 0);
}

export function getTotalOutstanding(invoices = []) {
  return getTotalInvoiced(invoices) - getTotalCollected(invoices);
}

/** Safe collection rate — returns 0 instead of NaN/Infinity when total is 0 */
export function getCollectionRate(invoices = []) {
  const total = getTotalInvoiced(invoices);
  if (!total) return 0;
  return Math.round((getTotalCollected(invoices) / total) * 100);
}

export function getOverdueInvoices(invoices = []) {
  const today = new Date().toISOString().slice(0, 10);
  return invoices.filter(
    (i) => i.status !== "Paid" && i.due && i.due < today
  );
}

export function getRevenueByService(invoices = [], clients = []) {
  const map = {};
  invoices.forEach((inv) => {
    // Try to match client → service
    const client = clients.find((c) => c.name === inv.client);
    const service = client?.service ?? inv.service ?? "Other";
    map[service] = (map[service] ?? 0) + (inv.paid ?? 0);
  });
  return Object.entries(map)
    .map(([label, val]) => ({ label, val }))
    .sort((a, b) => b.val - a.val);
}

// ─── Recurring invoices ────────────────────────────────────────────────────────

/**
 * Generate the next invoice instance from a recurring template.
 * template: { ...invoiceFields, recurringInterval: "monthly" | "quarterly" | "yearly" }
 */
export function generateNextRecurring(template) {
  const base = new Date(template.date ?? Date.now());
  const intervals = { monthly: 1, quarterly: 3, yearly: 12 };
  const months = intervals[template.recurringInterval] ?? 1;
  base.setMonth(base.getMonth() + months);
  const nextDate = base.toISOString().slice(0, 10);

  const dueBase = new Date(template.due ?? template.date ?? Date.now());
  dueBase.setMonth(dueBase.getMonth() + months);
  const nextDue = dueBase.toISOString().slice(0, 10);

  return {
    ...template,
    id: undefined, // caller assigns nextId
    date: nextDate,
    due: nextDue,
    paid: 0,
    status: "Unpaid",
    parentId: template.id,
  };
}

// ─── Overdue penalties ─────────────────────────────────────────────────────────

/**
 * Calculate penalty for an overdue invoice.
 * @param {object} invoice
 * @param {number} dailyRatePct  default 0.1 % per day
 */
export function calcOverduePenalty(invoice, dailyRatePct = 0.1) {
  if (!invoice.due) return 0;
  const today = new Date();
  const due = new Date(invoice.due);
  if (today <= due) return 0;
  const days = Math.floor((today - due) / 86_400_000);
  const balance = (invoice.amount ?? 0) - (invoice.paid ?? 0);
  return Math.round(balance * (dailyRatePct / 100) * days);
}

// ─── VAT ───────────────────────────────────────────────────────────────────────

export function calcVAT(amount, rate = 5) {
  return Math.round(amount * (rate / 100) * 100) / 100;
}

export function amountWithVAT(amount, rate = 5) {
  return amount + calcVAT(amount, rate);
}

// ─── Credit / Debit notes ──────────────────────────────────────────────────────

export function createCreditNote(invoice, creditAmount, reason = "") {
  return {
    type: "credit",
    refInvoiceId: invoice.id,
    client: invoice.client,
    desc: `Credit note: ${reason || invoice.desc}`,
    amount: -Math.abs(creditAmount),
    paid: -Math.abs(creditAmount),
    status: "Paid",
    date: new Date().toISOString().slice(0, 10),
    due: new Date().toISOString().slice(0, 10),
  };
}

export function createDebitNote(invoice, debitAmount, reason = "") {
  return {
    type: "debit",
    refInvoiceId: invoice.id,
    client: invoice.client,
    desc: `Debit note: ${reason || invoice.desc}`,
    amount: Math.abs(debitAmount),
    paid: 0,
    status: "Unpaid",
    date: new Date().toISOString().slice(0, 10),
    due: new Date().toISOString().slice(0, 10),
  };
}

// ─── Partial payment ───────────────────────────────────────────────────────────

export function applyPartialPayment(invoice, paymentAmount) {
  const newPaid = Math.min(
    (invoice.paid ?? 0) + paymentAmount,
    invoice.amount ?? 0
  );
  return {
    ...invoice,
    paid: newPaid,
    status: newPaid >= (invoice.amount ?? 0) ? "Paid" : "Partial",
  };
}
