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

// ─── Task velocity (rolling 7-day completion counts) ──────────────────────────

export function getTaskVelocity(tasks = []) {
  const result = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const dayStr = day.toISOString().slice(0, 10);
    const count = tasks.filter(
      (t) => t.status === "Done" && (t.completedAt ?? t.due ?? "").slice(0, 10) === dayStr
    ).length;
    result.push({ label: day.toLocaleDateString("en-GB", { weekday: "short" }), value: count, date: dayStr });
  }
  return result;
}

// ─── Team performance (per-member stats) ──────────────────────────────────────

export function getTeamPerformance(tasks = []) {
  const members = [...new Set(tasks.map((t) => t.assigned).filter(Boolean))];
  return members
    .map((name) => {
      const mt = tasks.filter((t) => t.assigned === name);
      const completed = mt.filter((t) => t.status === "Done").length;
      const pending = mt.filter((t) => t.status === "Pending").length;
      const overdue = mt.filter(
        (t) => t.status !== "Done" && t.due && t.due < new Date().toISOString().slice(0, 10)
      ).length;
      const avgProgress =
        mt.length ? Math.round(mt.reduce((a, t) => a + (t.progress || 0), 0) / mt.length) : 0;
      return {
        name,
        total: mt.length,
        completed,
        pending,
        overdue,
        avgProgress,
        completionPct: mt.length ? Math.round((completed / mt.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.completed - a.completed);
}

// ─── Delay report (per-task and per-member avg delay days) ────────────────────

export function getDelayReport(tasks = []) {
  const today = new Date().toISOString().slice(0, 10);
  const delayed = tasks
    .filter((t) => t.due && t.status !== "Done" && t.due < today)
    .map((t) => ({
      ...t,
      delayDays: Math.round((new Date(today) - new Date(t.due)) / 86_400_000),
    }))
    .sort((a, b) => b.delayDays - a.delayDays);

  const byMember = {};
  delayed.forEach((t) => {
    const key = t.assigned || "Unassigned";
    byMember[key] = byMember[key] || { name: key, count: 0, totalDays: 0 };
    byMember[key].count++;
    byMember[key].totalDays += t.delayDays;
  });
  const memberSummary = Object.values(byMember).map((m) => ({
    ...m,
    avgDelay: Math.round(m.totalDays / (m.count || 1)),
  }));

  return { tasks: delayed, memberSummary };
}

// ─── Linear regression forecast ───────────────────────────────────────────────

export function getForecast(data = [], field, periods = 3) {
  const vals = data.map((d) => Number(d[field] ?? d) || 0);
  const n = vals.length;
  if (n < 2) return { historical: vals, projected: Array(periods).fill(0) };
  const xm = (n - 1) / 2;
  const ym = vals.reduce((a, b) => a + b, 0) / n;
  const num = vals.reduce((a, y, x) => a + (x - xm) * (y - ym), 0);
  const den = vals.reduce((a, _, x) => a + (x - xm) ** 2, 0) || 1;
  const slope = num / den;
  const intercept = ym - slope * xm;
  const projected = Array.from({ length: periods }, (_, i) =>
    Math.max(0, Math.round(slope * (n + i) + intercept))
  );
  return { historical: vals, projected, slope, intercept };
}

// ─── Heatmap data (activity count by day-of-week × ISO week) ─────────────────

export function getHeatmapData(tasks = []) {
  const map = {};
  tasks.forEach((t) => {
    const d = t.due ? new Date(t.due) : null;
    if (!d || isNaN(d)) return;
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const isoWeek = String(
      Math.ceil(((d - startOfYear) / 86_400_000 + startOfYear.getDay() + 1) / 7)
    ).padStart(2, "0");
    const key = `${d.getFullYear()}-${isoWeek}-${d.getDay()}`;
    map[key] = (map[key] ?? 0) + 1;
  });
  return map;
}

// ─── Completion trend (weekly completion counts for last N weeks) ─────────────

export function getCompletionTrend(tasks = [], weeks = 8) {
  const result = [];
  const today = new Date();
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - i * 7 - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const ws = weekStart.toISOString().slice(0, 10);
    const we = weekEnd.toISOString().slice(0, 10);
    const count = tasks.filter(
      (t) => t.status === "Done" && t.due && t.due >= ws && t.due <= we
    ).length;
    result.push({
      label: `W${weeks - i}`,
      value: count,
      weekStart: ws,
    });
  }
  return result;
}

// ─── Workload stats (open/overdue/blocked per member) ─────────────────────────

export function getWorkloadStats(tasks = []) {
  const members = [...new Set(tasks.map((t) => t.assigned).filter(Boolean))];
  const today = new Date().toISOString().slice(0, 10);
  return members
    .map((name) => ({
      name,
      open: tasks.filter((t) => t.assigned === name && t.status !== "Done").length,
      overdue: tasks.filter(
        (t) => t.assigned === name && t.status !== "Done" && t.due && t.due < today
      ).length,
      blocked: tasks.filter((t) => t.assigned === name && t.status === "Blocked").length,
    }))
    .sort((a, b) => b.open - a.open);
}

// ─── Re-export so Dashboard only imports from analyticsEngine ─────────────────

export { getPipelineStats, getRevenueByService };
