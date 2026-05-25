/**
 * notificationEngine.js
 * Derives in-app notifications from data state.
 * Call buildNotifications(data) on each render / data change.
 */

export const NOTIF_TYPES = {
  OVERDUE_INVOICE: "overdue_invoice",
  RENEWAL_DUE:     "renewal_due",
  LOW_STOCK:       "low_stock",
  STALE_LEAD:      "stale_lead",
  TASK_DUE:        "task_due",
  AUTOMATION:      "automation",
};

const SEVERITY = { high: 0, medium: 1, low: 2 };

export function buildNotifications(data) {
  const notifs = [];
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // ── Overdue invoices ────────────────────────────────────────────────────────
  (data.accounting ?? []).forEach((inv) => {
    if (inv.status !== "Paid" && inv.due && inv.due < todayStr) {
      const days = Math.floor((today - new Date(inv.due)) / 86_400_000);
      notifs.push({
        id: `notif-ov-${inv.id}`,
        type: NOTIF_TYPES.OVERDUE_INVOICE,
        severity: days > 14 ? "high" : "medium",
        title: `Overdue invoice: ${inv.client}`,
        body: `${inv.id} was due ${inv.due} — ${days} day${days !== 1 ? "s" : ""} overdue`,
        entityId: inv.id,
        module: "accounting",
        timestamp: new Date().toISOString(),
        read: false,
      });
    }
  });

  // ── Client renewals ─────────────────────────────────────────────────────────
  (data.clients ?? []).forEach((c) => {
    if (!c.renewal) return;
    const diff = Math.floor((new Date(c.renewal) - today) / 86_400_000);
    if (diff >= 0 && diff <= 30) {
      notifs.push({
        id: `notif-ren-${c.id}`,
        type: NOTIF_TYPES.RENEWAL_DUE,
        severity: diff <= 7 ? "high" : "medium",
        title: `Renewal due: ${c.name}`,
        body: `${c.service} renewal on ${c.renewal} — ${diff} day${diff !== 1 ? "s" : ""} away`,
        entityId: c.id,
        module: "clients",
        timestamp: new Date().toISOString(),
        read: false,
      });
    }
  });

  // ── Low / critical stock ────────────────────────────────────────────────────
  (data.inventory ?? []).forEach((item) => {
    if (item.status === "Low Stock" || item.status === "Critical") {
      notifs.push({
        id: `notif-stk-${item.id}`,
        type: NOTIF_TYPES.LOW_STOCK,
        severity: item.status === "Critical" ? "high" : "medium",
        title: `${item.status}: ${item.name}`,
        body: `Only ${item.qty} ${item.unit} remaining (reorder at ${item.reorder})`,
        entityId: item.id,
        module: "inventory",
        timestamp: new Date().toISOString(),
        read: false,
      });
    }
  });

  // ── Tasks due today or overdue ──────────────────────────────────────────────
  (data.tasks ?? []).forEach((t) => {
    if (t.status === "Done") return;
    if (!t.due || t.due > todayStr) return;
    const overdue = t.due < todayStr;
    notifs.push({
      id: `notif-tsk-${t.id}`,
      type: NOTIF_TYPES.TASK_DUE,
      severity: t.priority === "High" ? "high" : "medium",
      title: `Task ${overdue ? "overdue" : "due today"}: ${t.title}`,
      body: `Assigned to ${t.assigned} — due ${t.due}`,
      entityId: t.id,
      module: "tasks",
      timestamp: new Date().toISOString(),
      read: false,
    });
  });

  // Sort: high → medium → low, then by timestamp desc
  return notifs.sort((a, b) => {
    const sd = SEVERITY[a.severity] - SEVERITY[b.severity];
    return sd !== 0 ? sd : b.timestamp.localeCompare(a.timestamp);
  });
}

export function countUnread(notifs = []) {
  return notifs.filter((n) => !n.read).length;
}
