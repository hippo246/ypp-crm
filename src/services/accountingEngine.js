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

// ─── Days Sales Outstanding (DSO) ─────────────────────────────────────────────

/**
 * DSO = (Total Outstanding / Total Invoiced) × days in period
 * Standard: 30-day rolling period. Lower = faster collections.
 */
export function getDSO(invoices = [], periodDays = 30) {
  const totalInvoiced = getTotalInvoiced(invoices);
  if (!totalInvoiced) return 0;
  const outstanding = getTotalOutstanding(invoices);
  return Math.round((outstanding / totalInvoiced) * periodDays);
}

// ─── Aging buckets ────────────────────────────────────────────────────────────

/**
 * Returns AR aging buckets: current, 1-30, 31-60, 61-90, 90+ days overdue
 */
export function getAgingBuckets(invoices = []) {
  const today = new Date();
  const buckets = [
    { label: "Current",    lo: -Infinity, hi: 0,   color: "#22c55e", items: [] },
    { label: "1–30 days",  lo: 0,         hi: 30,  color: "#f59e0b", items: [] },
    { label: "31–60 days", lo: 30,        hi: 60,  color: "#f97316", items: [] },
    { label: "61–90 days", lo: 60,        hi: 90,  color: "#ef4444", items: [] },
    { label: "90+ days",   lo: 90,        hi: Infinity, color: "#7f1d1d", items: [] },
  ];
  invoices.filter(i => i.status !== "Paid").forEach(inv => {
    if (!inv.due) return;
    const days = Math.floor((today - new Date(inv.due)) / 86_400_000);
    const b = buckets.find(({ lo, hi }) => days > lo && days <= hi)
           || buckets[buckets.length - 1];
    b.items.push(inv);
  });
  return buckets.map(b => ({
    ...b,
    count: b.items.length,
    amount: b.items.reduce((s, i) => s + ((i.amount ?? 0) - (i.paid ?? 0)), 0),
  }));
}

// ─── Month-over-month revenue growth ──────────────────────────────────────────

/**
 * Returns array of { month, collected, growth (pct vs prior month) }
 * for the last N months.
 */
export function getMonthOverMonthGrowth(invoices = [], months = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({ month: d.toLocaleString("en", { month: "short", year: "2-digit" }), key, collected: 0 });
  }
  invoices.forEach(inv => {
    const m = (inv.date || "").slice(0, 7);
    const bucket = buckets.find(b => b.key === m);
    if (bucket) bucket.collected += inv.paid ?? 0;
  });
  return buckets.map((b, i) => ({
    ...b,
    growth: i === 0 ? 0
      : buckets[i - 1].collected === 0 ? null
      : Math.round(((b.collected - buckets[i - 1].collected) / buckets[i - 1].collected) * 100),
  }));
}

// ─── Client payment behaviour score ───────────────────────────────────────────

/**
 * Score 0–100 per client based on:
 *   40 pts — payment rate (paid / invoiced)
 *   30 pts — on-time rate (paid before due)
 *   30 pts — no overdue currently
 */
export function getClientPaymentScores(invoices = []) {
  const map = {};
  invoices.forEach(inv => {
    if (!inv.client) return;
    if (!map[inv.client]) map[inv.client] = { invoiced: 0, paid: 0, onTime: 0, total: 0, overdue: 0 };
    const c = map[inv.client];
    c.total++;
    c.invoiced += inv.amount ?? 0;
    c.paid     += inv.paid ?? 0;
    const isOnTime = inv.status === "Paid" && inv.due && inv.date
      ? inv.due >= (inv.paidDate || inv.due)  // assume on-time if no paidDate
      : inv.status === "Paid";
    if (isOnTime) c.onTime++;
    if (inv.status === "Overdue") c.overdue++;
  });
  return Object.entries(map).map(([client, c]) => {
    const paymentRate = c.invoiced ? c.paid / c.invoiced : 0;
    const onTimeRate  = c.total    ? c.onTime / c.total   : 0;
    const noOverdue   = c.overdue === 0 ? 1 : Math.max(0, 1 - c.overdue / c.total);
    const score = Math.round(paymentRate * 40 + onTimeRate * 30 + noOverdue * 30);
    return { client, score: Math.max(0, Math.min(100, score)), ...c };
  }).sort((a, b) => b.score - a.score);
}

// ─── Write-off candidates ──────────────────────────────────────────────────────

/**
 * Invoices overdue by > thresholdDays with > 0 balance. Ranked by risk.
 */
export function getWriteOffCandidates(invoices = [], thresholdDays = 90) {
  const today = new Date();
  return invoices
    .filter(inv => {
      if (inv.status === "Paid" || !inv.due) return false;
      const days = Math.floor((today - new Date(inv.due)) / 86_400_000);
      return days > thresholdDays && (inv.amount ?? 0) - (inv.paid ?? 0) > 0;
    })
    .map(inv => {
      const days = Math.floor((today - new Date(inv.due)) / 86_400_000);
      const balance = (inv.amount ?? 0) - (inv.paid ?? 0);
      return { ...inv, daysOverdue: days, balance };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

// ─── Cash gap forecast ────────────────────────────────────────────────────────

/**
 * Projected cash position: expected inflows (recurring) minus outstanding balances.
 * Returns { gap, projectedInflow, totalOutstanding, riskLevel }
 */
export function forecastCashGap(invoices = []) {
  const outstanding = getTotalOutstanding(invoices);
  const recurring = invoices.filter(i => i.recurringInterval && i.recurringInterval !== "None");
  const intervals = { monthly: 1, quarterly: 3, yearly: 12 };
  const projectedInflow = recurring.reduce((s, inv) => {
    const months = intervals[inv.recurringInterval] || 1;
    return s + (inv.amount ?? 0) / months; // monthly equivalent
  }, 0);
  const gap = projectedInflow - outstanding;
  const riskLevel = gap < 0
    ? (gap < -outstanding * 0.5 ? "critical" : "high")
    : gap < projectedInflow * 0.2 ? "medium" : "low";
  return { gap, projectedInflow, totalOutstanding: outstanding, riskLevel };
}

// ─── Top debtors ──────────────────────────────────────────────────────────────

/**
 * Returns top N clients by outstanding balance, with days overdue context.
 */
export function getTopDebtors(invoices = [], n = 5) {
  const map = {};
  const today = new Date();
  invoices.filter(i => i.status !== "Paid").forEach(inv => {
    const balance = (inv.amount ?? 0) - (inv.paid ?? 0);
    if (balance <= 0) return;
    if (!map[inv.client]) map[inv.client] = { client: inv.client, balance: 0, maxDaysOverdue: 0, invoiceCount: 0 };
    map[inv.client].balance += balance;
    map[inv.client].invoiceCount++;
    if (inv.due) {
      const days = Math.max(0, Math.floor((today - new Date(inv.due)) / 86_400_000));
      if (days > map[inv.client].maxDaysOverdue) map[inv.client].maxDaysOverdue = days;
    }
  });
  return Object.values(map).sort((a, b) => b.balance - a.balance).slice(0, n);
}

// ─── Bad debt risk scoring ────────────────────────────────────────────────────

/**
 * Risk probability 0–1 that an invoice becomes uncollectible.
 * Based on days overdue (exponential decay model) and partial payment history.
 */
export function getBadDebtRisk(invoice) {
  if (!invoice.due || invoice.status === "Paid") return 0;
  const today = new Date();
  const daysOverdue = Math.max(0, Math.floor((today - new Date(invoice.due)) / 86_400_000));
  if (daysOverdue === 0) return 0;
  // Base risk: ~50% at 90 days, ~80% at 180 days
  const baseRisk = 1 - Math.exp(-daysOverdue / 130);
  // Partial payment reduces risk
  const paymentFactor = invoice.amount ? 1 - ((invoice.paid ?? 0) / invoice.amount) * 0.4 : 1;
  return Math.min(0.99, baseRisk * paymentFactor);
}

// ─── Revenue velocity ─────────────────────────────────────────────────────────

/**
 * Revenue per day over a trailing period (collected / days).
 */
export function getRevenueVelocity(invoices = [], trailingDays = 30) {
  const cutoff = new Date(Date.now() - trailingDays * 86_400_000).toISOString().slice(0, 10);
  const recent = invoices.filter(i => (i.date || "") >= cutoff);
  const collected = recent.reduce((s, i) => s + (i.paid ?? 0), 0);
  return Math.round(collected / trailingDays);
}

// ─── Group invoices by period ─────────────────────────────────────────────────

/**
 * Groups invoices by year-month or year-quarter.
 * Returns [{ period, invoices, invoiced, collected }]
 */
export function groupByPeriod(invoices = [], granularity = "month") {
  const map = {};
  invoices.forEach(inv => {
    const d = inv.date || "";
    let key;
    if (granularity === "quarter") {
      const [y, m] = d.split("-");
      key = `${y}-Q${Math.ceil(Number(m) / 3)}`;
    } else {
      key = d.slice(0, 7);
    }
    if (!map[key]) map[key] = { period: key, invoices: [], invoiced: 0, collected: 0 };
    map[key].invoices.push(inv);
    map[key].invoiced  += inv.amount ?? 0;
    map[key].collected += inv.paid   ?? 0;
  });
  return Object.values(map).sort((a, b) => a.period.localeCompare(b.period));
}

// ─── Bulk reminder email generator ───────────────────────────────────────────

/**
 * Generates a plain-text collection reminder for a given invoice.
 * Tone: "friendly" | "firm" | "final"
 */
export function generateReminderEmail(invoice, tone = "friendly") {
  const balance = (invoice.amount ?? 0) - (invoice.paid ?? 0);
  const penalty = calcOverduePenalty(invoice);
  const templates = {
    friendly: `Subject: Friendly Reminder — Invoice ${invoice.id} Due

Hi ${invoice.client},

I hope you're doing well. Just a quick reminder that Invoice ${invoice.id} for ${balance.toLocaleString("en", { minimumFractionDigits: 2 })} is currently outstanding${invoice.due ? ` (due ${invoice.due})` : ""}.

If you've already sent payment, please disregard this message. Otherwise, we'd appreciate settlement at your earliest convenience.

Thank you for your continued business!`,

    firm: `Subject: Payment Required — Invoice ${invoice.id} Overdue

Dear ${invoice.client},

This is a follow-up regarding Invoice ${invoice.id} for ${balance.toLocaleString("en", { minimumFractionDigits: 2 })}${invoice.due ? `, which was due on ${invoice.due}` : ""}.

We have yet to receive payment. Please arrange settlement within the next 7 days to avoid further action.${penalty > 0 ? `\n\nPlease note that a late penalty of ${penalty.toLocaleString("en", { minimumFractionDigits: 2 })} has accrued.` : ""}

Please contact us if you have any questions.`,

    final: `Subject: FINAL NOTICE — Invoice ${invoice.id}

Dear ${invoice.client},

Despite previous communications, Invoice ${invoice.id} for ${balance.toLocaleString("en", { minimumFractionDigits: 2 })} remains unpaid.${invoice.due ? ` This invoice was due on ${invoice.due}.` : ""}

This is our final notice before we proceed with formal debt recovery. Please make payment immediately to avoid additional costs and legal action.${penalty > 0 ? `\n\nAccrued late penalty: ${penalty.toLocaleString("en", { minimumFractionDigits: 2 })}.` : ""}

Time is of the essence.`,
  };
  return templates[tone] || templates.friendly;
}
