/**
 * analyticsEngine.js
 * Derives all Dashboard KPIs from raw data.
 * Dashboard becomes pure UI — no logic inline.
 */

import {
  getTotalCollected,
  getTotalOutstanding,
  getCollectionRate,
  getOverdueInvoices,
  getRevenueByService,
} from "./accountingEngine";
import { getPipelineStats, getConversionRate, getWonValue } from "./crmEngine";

// ─── Dashboard KPIs ────────────────────────────────────────────────────────────

export function getDashboardKPIs(data) {
  const { accounting = [], clients = [], leads = [], tasks = [] } = data;

  const totalRevenue = getTotalCollected(accounting);
  const outstanding = getTotalOutstanding(accounting);
  const collectionRate = getCollectionRate(accounting);
  const overdueCount = getOverdueInvoices(accounting).length;

  const activeClients = clients.filter((c) => c.status === "Active").length;
  const expiringClients = clients.filter((c) => {
    if (!c.renewal) return false;
    const diff = (new Date(c.renewal) - new Date()) / 86_400_000;
    return diff >= 0 && diff <= 30;
  }).length;

  const openLeads = leads.filter((l) => !["Won", "Lost"].includes(l.status)).length;
  const wonValue = getWonValue(leads);
  const conversionRate = getConversionRate(leads);

  const pendingTasks = tasks.filter((t) => t.status !== "Done").length;
  const highPriorityTasks = tasks.filter(
    (t) => t.status !== "Done" && t.priority === "High"
  ).length;

  return {
    totalRevenue,
    outstanding,
    collectionRate,
    overdueCount,
    activeClients,
    expiringClients,
    openLeads,
    wonValue,
    conversionRate,
    pendingTasks,
    highPriorityTasks,
  };
}

// ─── MoM delta (% change vs last calendar month) ──────────────────────────────

function getMonthStr(date = new Date()) {
  return date.toISOString().slice(0, 7); // "YYYY-MM"
}

function prevMonthStr() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return getMonthStr(d);
}

export function getMoMRevenue(accounting = []) {
  const thisMonth = getMonthStr();
  const lastMonth = prevMonthStr();

  const thisRev = accounting
    .filter((i) => (i.date ?? "").startsWith(thisMonth))
    .reduce((s, i) => s + (i.paid ?? 0), 0);

  const lastRev = accounting
    .filter((i) => (i.date ?? "").startsWith(lastMonth))
    .reduce((s, i) => s + (i.paid ?? 0), 0);

  const delta = lastRev === 0 ? null : Math.round(((thisRev - lastRev) / lastRev) * 100);
  return { thisRev, lastRev, delta };
}

export function getMoMLeads(leads = []) {
  const thisMonth = getMonthStr();
  const lastMonth = prevMonthStr();
  const thisCount = leads.filter((l) => (l.date ?? "").startsWith(thisMonth)).length;
  const lastCount = leads.filter((l) => (l.date ?? "").startsWith(lastMonth)).length;
  const delta = lastCount === 0 ? null : Math.round(((thisCount - lastCount) / lastCount) * 100);
  return { thisCount, lastCount, delta };
}

// ─── Re-export so Dashboard only imports from analyticsEngine ─────────────────

export { getPipelineStats, getRevenueByService };
