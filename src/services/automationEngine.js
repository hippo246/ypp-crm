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
};

export const CONDITION_FIELDS = {
  invoice_overdue:    ["days_overdue", "amount", "client"],
  invoice_created:    ["amount", "client", "status"],
  lead_status_change: ["new_status", "value", "source"],
  client_renewal_due: ["days_until", "service", "value"],
  task_overdue:       ["priority", "assigned", "days_overdue"],
  low_stock:          ["qty", "status", "category"],
  payment_received:   ["amount", "client"],
};

export const CONDITION_OPS = ["greater_than", "less_than", "equals", "contains", "not_equals"];

export const ACTIONS = {
  CREATE_TASK:      "create_task",
  SEND_NOTIFICATION:"send_notification",
  UPDATE_STATUS:    "update_status",
  MARK_OVERDUE:     "mark_overdue",
  LOG_AUDIT:        "log_audit",
};

export const ACTION_LABELS = {
  create_task:       "Create task",
  send_notification: "Send notification",
  update_status:     "Update status",
  mark_overdue:      "Mark as overdue",
  log_audit:         "Log to audit",
};

export const TRIGGER_LABELS = {
  invoice_overdue:    "Invoice becomes overdue",
  invoice_created:    "Invoice is created",
  lead_status_change: "Lead status changes",
  client_renewal_due: "Client renewal is due",
  task_overdue:       "Task becomes overdue",
  low_stock:          "Item is low on stock",
  payment_received:   "Payment is received",
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
    client_renewal_due: "clients",
    task_overdue:       "tasks",
    low_stock:          "inventory",
  };
  return map[trigger] ?? "general";
}

/** Default automation rules to seed the app */
export const DEFAULT_AUTOMATIONS = [
  {
    id: "AUTO001",
    name: "Overdue invoice → create follow-up task",
    active: true,
    trigger: TRIGGERS.INVOICE_OVERDUE,
    conditions: [{ field: "days_overdue", op: "greater_than", value: "3" }],
    action: { type: ACTIONS.CREATE_TASK, config: { title: "Follow up on overdue invoice: {{client}}", priority: "High", assigned: "Anna" } },
  },
  {
    id: "AUTO002",
    name: "Renewal within 7 days → notify team",
    active: true,
    trigger: TRIGGERS.CLIENT_RENEWAL_DUE,
    conditions: [{ field: "days_until", op: "less_than", value: "8" }],
    action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "{{name}} renewal in {{days_until}} days!" } },
  },
  {
    id: "AUTO003",
    name: "Critical stock → urgent task",
    active: false,
    trigger: TRIGGERS.LOW_STOCK,
    conditions: [{ field: "status", op: "equals", value: "Critical" }],
    action: { type: ACTIONS.CREATE_TASK, config: { title: "Reorder {{name}} urgently", priority: "High", assigned: "Mark" } },
  },
];
