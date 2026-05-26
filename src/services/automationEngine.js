/**
 * automationEngine.js
 * Evaluates automation rules against current data state.
 * Rules shape: { id, name, active, trigger, conditions, actions }
 */

export const TRIGGERS = {
  INVOICE_OVERDUE:    "invoice_overdue",
  INVOICE_CREATED:    "invoice_created",
  LEAD_STATUS_CHANGE: "lead_status_change",
  CLIENT_RENEWAL_DUE: "client_renewal_due",
  TASK_OVERDUE:       "task_overdue",
  LOW_STOCK:          "low_stock",
  PAYMENT_RECEIVED:   "payment_received",
  STATUS_CHANGE:      "status_change",
  DUE_DATE_ALERT:     "due_date_alert",
  SCHEDULED:          "scheduled",
  APPROVAL_REQUIRED:  "approval_required",
  TASK_CREATED:       "task_created",
  LEAD_CREATED:       "lead_created",
  HIGH_VALUE_DEAL:    "high_value_deal",
};

export const CONDITION_FIELDS = {
  invoice_overdue:    ["days_overdue", "amount", "client"],
  invoice_created:    ["amount", "client", "status"],
  lead_status_change: ["new_status", "value", "source"],
  client_renewal_due: ["days_until", "service", "value"],
  task_overdue:       ["priority", "assigned", "days_overdue"],
  low_stock:          ["qty", "status", "category"],
  payment_received:   ["amount", "client"],
  status_change:      ["new_status", "old_status", "module"],
  due_date_alert:     ["days_until", "priority", "assigned"],
  scheduled:          ["module", "status", "assigned"],
  approval_required:  ["amount", "priority", "assigned"],
  task_created:       ["priority", "assigned", "title"],
  lead_created:       ["value", "source", "status"],
  high_value_deal:    ["amount", "client", "status"],
};

export const CONDITION_OPS = ["greater_than", "less_than", "equals", "contains", "not_equals"];

export const ACTIONS = {
  CREATE_TASK:      "create_task",
  SEND_NOTIFICATION:"send_notification",
  UPDATE_STATUS:    "update_status",
  MARK_OVERDUE:     "mark_overdue",
  LOG_AUDIT:          "log_audit",
  AUTO_ASSIGN:        "auto_assign",
  CHANGE_STATUS:      "change_status",
  SEND_REPORT:        "send_report",
  APPROVE_REJECT:     "approve_reject",
  BULK_ACTION:        "bulk_action",
};

export const ACTION_LABELS = {
  create_task:       "Create task",
  send_notification: "Send notification",
  update_status:     "Update status",
  mark_overdue:      "Mark as overdue",
  log_audit:          "Log to audit",
  auto_assign:        "Auto-assign",
  change_status:      "Change status",
  send_report:        "Generate & send report",
  approve_reject:     "Approve / Reject",
  bulk_action:        "Bulk update records",
};

export const TRIGGER_LABELS = {
  invoice_overdue:    "Invoice becomes overdue",
  invoice_created:    "Invoice is created",
  lead_status_change: "Lead status changes",
  client_renewal_due: "Client renewal is due",
  task_overdue:       "Task becomes overdue",
  low_stock:          "Item is low on stock",
  payment_received:   "Payment is received",
  status_change:      "Any status changes",
  due_date_alert:     "Due date approaching",
  scheduled:          "Scheduled (recurring)",
  approval_required:  "Approval is required",
  task_created:       "Task is created",
  lead_created:       "Lead is created",
  high_value_deal:    "High-value deal detected",
};

/**
 * Evaluate a single condition against an entity
 */
function evalCondition(condition, entity, context) {
  const { field, op, value } = condition;
  const today = new Date();

  let actual;
  switch (field) {
    case "days_overdue": {
      const due = new Date(entity.due);
      actual = Math.floor((today - due) / 86_400_000);
      break;
    }
    case "days_until": {
      const renewal = new Date(entity.renewal);
      actual = Math.floor((renewal - today) / 86_400_000);
      break;
    }
    case "amount":   actual = entity.amount ?? entity.value ?? 0; break;
    case "qty":      actual = entity.qty ?? 0; break;
    case "client":   actual = entity.client ?? entity.name ?? ""; break;
    case "status":   actual = entity.status ?? ""; break;
    case "new_status": actual = context?.newStatus ?? entity.status ?? ""; break;
    case "priority": actual = entity.priority ?? ""; break;
    case "assigned": actual = entity.assigned ?? ""; break;
    case "source":   actual = entity.source ?? ""; break;
    case "service":  actual = entity.service ?? ""; break;
    case "category": actual = entity.category ?? ""; break;
    case "old_status": actual = context?.oldStatus ?? ""; break;
    case "module":   actual = context?.module ?? entity.module ?? ""; break;
    case "title":    actual = entity.title ?? entity.name ?? ""; break;
    case "value":    actual = entity.value ?? entity.amount ?? 0; break;
    default:         actual = entity[field] ?? "";
  }

  const numVal = parseFloat(value);
  switch (op) {
    case "greater_than": return parseFloat(actual) > numVal;
    case "less_than":    return parseFloat(actual) < numVal;
    case "equals":       return String(actual).toLowerCase() === String(value).toLowerCase();
    case "not_equals":   return String(actual).toLowerCase() !== String(value).toLowerCase();
    case "contains":     return String(actual).toLowerCase().includes(String(value).toLowerCase());
    default:             return false;
  }
}

/**
 * Run all active automations against current data.
 * Returns array of { ruleId, ruleName, action, entity, payload } to execute.
 */
export function runAutomations(rules = [], data = {}, executedLog = []) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const results = [];

  const alreadyRan = new Set(executedLog.map((e) => e.key));

  rules.filter((r) => r.active).forEach((rule) => {
    let candidates = [];

    switch (rule.trigger) {
      case TRIGGERS.INVOICE_OVERDUE:
        candidates = (data.accounting ?? []).filter(
          (inv) => inv.status !== "Paid" && inv.due && inv.due < todayStr
        );
        break;
      case TRIGGERS.CLIENT_RENEWAL_DUE:
        candidates = (data.clients ?? []).filter((c) => {
          if (!c.renewal) return false;
          const diff = Math.floor((new Date(c.renewal) - today) / 86_400_000);
          return diff >= 0 && diff <= 30;
        });
        break;
      case TRIGGERS.TASK_OVERDUE:
        candidates = (data.tasks ?? []).filter(
          (t) => t.status !== "Done" && t.due && t.due < todayStr
        );
        break;
      case TRIGGERS.LOW_STOCK:
        candidates = (data.inventory ?? []).filter(
          (i) => i.status === "Low Stock" || i.status === "Critical"
        );
        break;
      case TRIGGERS.DUE_DATE_ALERT:
        candidates = (data.tasks ?? []).filter((t) => {
          if (t.status === "Done" || !t.due) return false;
          const diff = Math.floor((new Date(t.due) - today) / 86_400_000);
          return diff >= 0 && diff <= 7;
        });
        break;
      case TRIGGERS.HIGH_VALUE_DEAL:
        candidates = (data.leads ?? []).filter((l) => (l.value ?? 0) > 0);
        break;
      case TRIGGERS.TASK_CREATED:
        candidates = (data.tasks ?? []).filter((t) => {
          const created = t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : null;
          return created === todayStr;
        });
        break;
      case TRIGGERS.LEAD_CREATED:
        candidates = (data.leads ?? []).filter((l) => {
          const created = l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : null;
          return created === todayStr;
        });
        break;
      case TRIGGERS.APPROVAL_REQUIRED:
        candidates = (data.approvals ?? []).filter((a) => a.status === "pending");
        break;
      case TRIGGERS.SCHEDULED:
        candidates = [{ id: `SCHED-${todayStr}`, date: todayStr, module: rule.schedule?.module ?? "general" }];
        break;
      default:
        candidates = [];
    }

    candidates.forEach((entity) => {
      const runKey = `${rule.id}-${entity.id}-${todayStr}`;
      if (alreadyRan.has(runKey)) return;

      const conditionsMet = (rule.conditions ?? []).every((c) => evalCondition(c, entity, {}));
      if (!conditionsMet) return;

      results.push({
        ruleId:   rule.id,
        ruleName: rule.name,
        entityId: entity.id,
        module:   getModuleForTrigger(rule.trigger),
        action:   rule.action,
        entity,
        key:      runKey,
        timestamp: new Date().toISOString(),
      });
    });
  });

  return results;
}

function getModuleForTrigger(trigger) {
  const map = {
    invoice_overdue:    "accounting",
    invoice_created:    "accounting",
    payment_received:   "accounting",
    lead_status_change: "leads",
    lead_created:       "leads",
    high_value_deal:    "leads",
    client_renewal_due: "clients",
    task_overdue:       "tasks",
    task_created:       "tasks",
    due_date_alert:     "tasks",
    low_stock:          "inventory",
    approval_required:  "approvals",
    status_change:      "general",
    scheduled:          "general",
  };
  return map[trigger] ?? "general";
}

/**
 * Compute the next run date for a scheduled rule.
 * schedule: { frequency: "daily"|"weekly"|"monthly", dayOfWeek?: 0-6, dayOfMonth?: 1-31 }
 */
export function nextRunDate(schedule, from = new Date()) {
  const d = new Date(from);
  switch (schedule?.frequency) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly": {
      const target = schedule.dayOfWeek ?? 1;
      const diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      break;
    }
    case "monthly": {
      const target = schedule.dayOfMonth ?? 1;
      d.setMonth(d.getMonth() + 1);
      d.setDate(target);
      break;
    }
    default:
      return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Advance an approval chain to the next step, or resolve it.
 * Returns updated approval object.
 */
export function advanceApproval(approval, decision, decidedBy) {
  const steps = approval.chain ?? [];
  const current = approval.currentStep ?? 0;
  if (decision === "reject") {
    return { ...approval, status: "rejected", resolvedAt: new Date().toISOString(), resolvedBy: decidedBy };
  }
  if (current + 1 >= steps.length) {
    return { ...approval, status: "approved", currentStep: current + 1, resolvedAt: new Date().toISOString(), resolvedBy: decidedBy };
  }
  return { ...approval, currentStep: current + 1, lastDecidedBy: decidedBy, lastDecidedAt: new Date().toISOString() };
}

/** Workflow template library */
export const AUTOMATION_TEMPLATES = [
  {
    id: "TPL001",
    name: "Invoice follow-up",
    description: "Create a task when an invoice is overdue by more than 3 days",
    category: "Finance",
    trigger: TRIGGERS.INVOICE_OVERDUE,
    conditions: [{ field: "days_overdue", op: "greater_than", value: "3" }],
    action: { type: ACTIONS.CREATE_TASK, config: { title: "Follow up on overdue invoice: {{client}}", priority: "High" } },
  },
  {
    id: "TPL002",
    name: "Renewal reminder",
    description: "Notify the team when a client renewal is within 7 days",
    category: "Clients",
    trigger: TRIGGERS.CLIENT_RENEWAL_DUE,
    conditions: [{ field: "days_until", op: "less_than", value: "8" }],
    action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "{{name}} renewal in {{days_until}} days!" } },
  },
  {
    id: "TPL003",
    name: "Critical stock reorder",
    description: "Auto-assign a reorder task when stock hits Critical",
    category: "Inventory",
    trigger: TRIGGERS.LOW_STOCK,
    conditions: [{ field: "status", op: "equals", value: "Critical" }],
    action: { type: ACTIONS.AUTO_ASSIGN, config: { title: "Reorder {{name}} urgently", priority: "High" } },
  },
  {
    id: "TPL004",
    name: "High-value deal escalation",
    description: "Escalate to manager when a deal exceeds $50k",
    category: "Sales",
    trigger: TRIGGERS.HIGH_VALUE_DEAL,
    conditions: [{ field: "amount", op: "greater_than", value: "50000" }],
    action: { type: ACTIONS.APPROVE_REJECT, config: { message: "High-value deal requires approval: {{client}}" } },
  },
  {
    id: "TPL005",
    name: "Weekly sales report",
    description: "Generate and send a sales report every Monday",
    category: "Reporting",
    trigger: TRIGGERS.SCHEDULED,
    schedule: { frequency: "weekly", dayOfWeek: 1 },
    conditions: [],
    action: { type: ACTIONS.SEND_REPORT, config: { module: "leads", title: "Weekly Sales Report" } },
  },
  {
    id: "TPL006",
    name: "Task due-date alert",
    description: "Notify assignee when a task is due within 2 days",
    category: "Tasks",
    trigger: TRIGGERS.DUE_DATE_ALERT,
    conditions: [{ field: "days_until", op: "less_than", value: "3" }],
    action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "Task '{{title}}' is due in {{days_until}} days" } },
  },
];

/** Default automation rules to seed the app */
export const DEFAULT_AUTOMATIONS = [
  {
    id: "AUTO001",
    name: "Overdue invoice → create follow-up task",
    active: true,
    category: "Finance",
    tags: ["invoices", "tasks"],
    trigger: TRIGGERS.INVOICE_OVERDUE,
    conditions: [{ field: "days_overdue", op: "greater_than", value: "3" }],
    action: { type: ACTIONS.CREATE_TASK, config: { title: "Follow up on overdue invoice: {{client}}", priority: "High", assigned: "Anna" } },
  },
  {
    id: "AUTO002",
    name: "Renewal within 7 days → notify team",
    active: true,
    category: "Clients",
    tags: ["renewals", "notifications"],
    trigger: TRIGGERS.CLIENT_RENEWAL_DUE,
    conditions: [{ field: "days_until", op: "less_than", value: "8" }],
    action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "{{name}} renewal in {{days_until}} days!" } },
  },
  {
    id: "AUTO003",
    name: "Critical stock → urgent task",
    active: false,
    category: "Inventory",
    tags: ["stock", "tasks"],
    trigger: TRIGGERS.LOW_STOCK,
    conditions: [{ field: "status", op: "equals", value: "Critical" }],
    action: { type: ACTIONS.CREATE_TASK, config: { title: "Reorder {{name}} urgently", priority: "High", assigned: "Mark" } },
  },
  {
    id: "AUTO004",
    name: "Weekly sales report (Monday)",
    active: true,
    category: "Reporting",
    tags: ["scheduled", "reports"],
    trigger: TRIGGERS.SCHEDULED,
    schedule: { frequency: "weekly", dayOfWeek: 1 },
    conditions: [],
    action: { type: ACTIONS.SEND_REPORT, config: { module: "leads", title: "Weekly Sales Report" } },
  },
];
