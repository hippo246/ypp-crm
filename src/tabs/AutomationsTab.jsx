import { useState, useMemo, useCallback } from "react";

// ─── Inlined engine constants (mirrors automationEngine.js exports) ────────────
const TRIGGERS = {
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

const TRIGGER_LABELS = {
  invoice_overdue:    "Invoice becomes overdue",
  invoice_created:    "Invoice is created",
  lead_status_change: "Lead status changes",
  client_renewal_due: "Client renewal is due",
  task_overdue:       "Task becomes overdue",
  low_stock:          "Low on stock",
  payment_received:   "Payment received",
  status_change:      "Any status changes",
  due_date_alert:     "Due date approaching",
  scheduled:          "Scheduled (recurring)",
  approval_required:  "Approval required",
  task_created:       "Task created",
  lead_created:       "Lead created",
  high_value_deal:    "High-value deal",
};

const ACTIONS = {
  CREATE_TASK:       "create_task",
  SEND_NOTIFICATION: "send_notification",
  UPDATE_STATUS:     "update_status",
  MARK_OVERDUE:      "mark_overdue",
  LOG_AUDIT:         "log_audit",
  AUTO_ASSIGN:       "auto_assign",
  CHANGE_STATUS:     "change_status",
  SEND_REPORT:       "send_report",
  APPROVE_REJECT:    "approve_reject",
  BULK_ACTION:       "bulk_action",
};

const ACTION_LABELS = {
  create_task:       "Create task",
  send_notification: "Send notification",
  update_status:     "Update status",
  mark_overdue:      "Mark as overdue",
  log_audit:         "Log to audit",
  auto_assign:       "Auto-assign",
  change_status:     "Change status",
  send_report:       "Generate report",
  approve_reject:    "Approve / Reject",
  bulk_action:       "Bulk update records",
};

const CONDITION_FIELDS = {
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

const CONDITION_OPS = ["greater_than", "less_than", "equals", "contains", "not_equals"];
const CONDITION_FIELD_LABELS = {
  days_overdue: "Days overdue",
  days_until:   "Days until",
  amount:       "Amount ($)",
  qty:          "Quantity",
  client:       "Client",
  status:       "Status",
  new_status:   "New status",
  old_status:   "Old status",
  priority:     "Priority",
  assigned:     "Assigned to",
  source:       "Source",
  service:      "Service",
  category:     "Category",
  module:       "Module",
  title:        "Title",
  value:        "Value ($)",
};
const OP_LABELS = {
  greater_than: ">",
  less_than: "<",
  equals: "=",
  not_equals: "≠",
  contains: "contains",
};

const CATEGORIES = ["Finance", "Clients", "Inventory", "Sales", "Tasks", "Reporting", "General"];

const AUTOMATION_TEMPLATES = [
  { id: "TPL001", name: "Invoice follow-up", description: "Create a task when an invoice is overdue by more than 3 days", category: "Finance", trigger: TRIGGERS.INVOICE_OVERDUE, conditions: [{ field: "days_overdue", op: "greater_than", value: "3" }], action: { type: ACTIONS.CREATE_TASK, config: { title: "Follow up: {{client}}", priority: "High" } } },
  { id: "TPL002", name: "Renewal reminder", description: "Notify when client renewal is within 7 days", category: "Clients", trigger: TRIGGERS.CLIENT_RENEWAL_DUE, conditions: [{ field: "days_until", op: "less_than", value: "8" }], action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "{{name}} renewal in {{days_until}} days!" } } },
  { id: "TPL003", name: "Critical stock reorder", description: "Auto-assign reorder task when stock hits Critical", category: "Inventory", trigger: TRIGGERS.LOW_STOCK, conditions: [{ field: "status", op: "equals", value: "Critical" }], action: { type: ACTIONS.AUTO_ASSIGN, config: { title: "Reorder {{name}} urgently", priority: "High" } } },
  { id: "TPL004", name: "High-value deal escalation", description: "Escalate to manager when deal exceeds $50k", category: "Sales", trigger: TRIGGERS.HIGH_VALUE_DEAL, conditions: [{ field: "amount", op: "greater_than", value: "50000" }], action: { type: ACTIONS.APPROVE_REJECT, config: { message: "High-value deal requires approval: {{client}}" } } },
  { id: "TPL005", name: "Weekly sales report", description: "Generate and send a sales report every Monday", category: "Reporting", trigger: TRIGGERS.SCHEDULED, schedule: { frequency: "weekly", dayOfWeek: 1 }, conditions: [], action: { type: ACTIONS.SEND_REPORT, config: { module: "leads", title: "Weekly Sales Report" } } },
  { id: "TPL006", name: "Task due-date alert", description: "Notify assignee when task is due within 2 days", category: "Tasks", trigger: TRIGGERS.DUE_DATE_ALERT, conditions: [{ field: "days_until", op: "less_than", value: "3" }], action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "Task '{{title}}' due in {{days_until}} days" } } },
  { id: "TPL007", name: "New lead auto-assign", description: "Auto-assign every new lead to a sales rep", category: "Sales", trigger: TRIGGERS.LEAD_CREATED, conditions: [], action: { type: ACTIONS.AUTO_ASSIGN, config: { assigned: "Sales Team" } } },
  { id: "TPL008", name: "Payment received log", description: "Log every received payment to audit trail", category: "Finance", trigger: TRIGGERS.PAYMENT_RECEIVED, conditions: [], action: { type: ACTIONS.LOG_AUDIT, config: { note: "Payment received from {{client}}: {{amount}}" } } },
];

const SEED_AUTOMATIONS = [
  { id: "AUTO001", name: "Overdue invoice → follow-up task", active: true, category: "Finance", tags: ["invoices", "tasks"], trigger: TRIGGERS.INVOICE_OVERDUE, conditions: [{ field: "days_overdue", op: "greater_than", value: "3" }], action: { type: ACTIONS.CREATE_TASK, config: { title: "Follow up on overdue invoice: {{client}}", priority: "High", assigned: "Anna" } }, runs: 14, lastRun: "2026-05-25" },
  { id: "AUTO002", name: "Renewal within 7 days → notify team", active: true, category: "Clients", tags: ["renewals", "notifications"], trigger: TRIGGERS.CLIENT_RENEWAL_DUE, conditions: [{ field: "days_until", op: "less_than", value: "8" }], action: { type: ACTIONS.SEND_NOTIFICATION, config: { message: "{{name}} renewal in {{days_until}} days!" } }, runs: 8, lastRun: "2026-05-26" },
  { id: "AUTO003", name: "Critical stock → urgent task", active: false, category: "Inventory", tags: ["stock", "tasks"], trigger: TRIGGERS.LOW_STOCK, conditions: [{ field: "status", op: "equals", value: "Critical" }], action: { type: ACTIONS.CREATE_TASK, config: { title: "Reorder {{name}} urgently", priority: "High", assigned: "Mark" } }, runs: 3, lastRun: "2026-05-20" },
  { id: "AUTO004", name: "Weekly sales report (Monday)", active: true, category: "Reporting", tags: ["scheduled", "reports"], trigger: TRIGGERS.SCHEDULED, schedule: { frequency: "weekly", dayOfWeek: 1 }, conditions: [], action: { type: ACTIONS.SEND_REPORT, config: { module: "leads", title: "Weekly Sales Report" } }, runs: 6, lastRun: "2026-05-19" },
  { id: "AUTO005", name: "High-value deal → approval", active: true, category: "Sales", tags: ["approvals", "deals"], trigger: TRIGGERS.HIGH_VALUE_DEAL, conditions: [{ field: "amount", op: "greater_than", value: "50000" }], action: { type: ACTIONS.APPROVE_REJECT, config: { chain: ["Manager", "Director"] } }, runs: 2, lastRun: "2026-05-24" },
];

const SEED_RUN_LOG = [
  { key: "AUTO001-INV-042-2026-05-25", ruleId: "AUTO001", ruleName: "Overdue invoice → follow-up task", action: { type: ACTIONS.CREATE_TASK }, module: "accounting", entityId: "INV-042", timestamp: "2026-05-25T09:14:00Z", status: "success" },
  { key: "AUTO002-CLI-017-2026-05-26", ruleId: "AUTO002", ruleName: "Renewal within 7 days → notify team", action: { type: ACTIONS.SEND_NOTIFICATION }, module: "clients", entityId: "CLI-017", timestamp: "2026-05-26T08:00:00Z", status: "success" },
  { key: "AUTO004-SCHED-2026-05-19", ruleId: "AUTO004", ruleName: "Weekly sales report (Monday)", action: { type: ACTIONS.SEND_REPORT }, module: "general", entityId: "SCHED-2026-05-19", timestamp: "2026-05-19T07:00:00Z", status: "success" },
  { key: "AUTO005-LEAD-031-2026-05-24", ruleId: "AUTO005", ruleName: "High-value deal → approval", action: { type: ACTIONS.APPROVE_REJECT }, module: "leads", entityId: "LEAD-031", timestamp: "2026-05-24T14:32:00Z", status: "success" },
  { key: "AUTO001-INV-038-2026-05-22", ruleId: "AUTO001", ruleName: "Overdue invoice → follow-up task", action: { type: ACTIONS.CREATE_TASK }, module: "accounting", entityId: "INV-038", timestamp: "2026-05-22T09:14:00Z", status: "success" },
];

const SEED_APPROVALS = [
  { id: "APR001", title: "Deal: Nexus Corp — $78,000", requestedBy: "Sarah K.", requestedAt: "2026-05-25", chain: ["Manager", "Director"], currentStep: 0, status: "pending", amount: 78000 },
  { id: "APR002", title: "Invoice write-off — $12,400", requestedBy: "Tom B.", requestedAt: "2026-05-24", chain: ["Manager"], currentStep: 0, status: "pending", amount: 12400 },
  { id: "APR003", title: "Deal: Vertex Ltd — $55,000", requestedBy: "Maria L.", requestedAt: "2026-05-23", chain: ["Manager", "Director"], currentStep: 1, status: "pending", amount: 55000 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nextRunDate(schedule) {
  if (!schedule?.frequency) return null;
  const d = new Date();
  if (schedule.frequency === "daily") { d.setDate(d.getDate() + 1); }
  else if (schedule.frequency === "weekly") {
    const target = schedule.dayOfWeek ?? 1;
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
  } else if (schedule.frequency === "monthly") {
    d.setMonth(d.getMonth() + 1);
    d.setDate(schedule.dayOfMonth ?? 1);
  }
  return d.toISOString().slice(0, 10);
}

function uid() { return "AUTO" + Math.random().toString(36).slice(2, 7).toUpperCase(); }

const TRIGGER_ICONS = {
  invoice_overdue: "⚠", invoice_created: "📄", lead_status_change: "🔄",
  client_renewal_due: "🔁", task_overdue: "⏰", low_stock: "📦",
  payment_received: "💳", status_change: "🔀", due_date_alert: "📅",
  scheduled: "🕐", approval_required: "✅", task_created: "✚",
  lead_created: "⭐", high_value_deal: "💰",
};

const CAT_COLORS = {
  Finance: "#f59e0b", Clients: "#3b82f6", Inventory: "#10b981",
  Sales: "#ec4899", Tasks: "#8b5cf6", Reporting: "#06b6d4", General: "#6b7280",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", padding: "2px 7px", borderRadius: 3,
      background: color + "22", color, border: `1px solid ${color}44`,
    }}>{label}</span>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
      background: checked ? "#22c55e" : "#374151", position: "relative",
      transition: "background 0.2s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 3, left: checked ? 19 : 3,
        width: 14, height: 14, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s",
      }} />
    </button>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "#111827", border: "1px solid #1f2937",
      borderTop: `2px solid ${accent}`, borderRadius: 8,
      padding: "14px 18px", minWidth: 130,
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: "'DM Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function RuleCard({ rule, selected, onSelect, onToggle, onEdit, onDelete, onRun }) {
  const catColor = CAT_COLORS[rule.category] ?? "#6b7280";
  return (
    <div style={{
      background: selected ? "#1a2235" : "#0f172a",
      border: `1px solid ${selected ? "#3b82f6" : "#1f2937"}`,
      borderLeft: `3px solid ${rule.active ? catColor : "#374151"}`,
      borderRadius: 8, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 12,
      transition: "all 0.15s", cursor: "default",
    }}>
      <input type="checkbox" checked={selected} onChange={onSelect}
        style={{ accentColor: "#3b82f6", width: 15, height: 15, flexShrink: 0 }} />

      <div style={{ fontSize: 20, width: 28, textAlign: "center", flexShrink: 0 }}>
        {TRIGGER_ICONS[rule.trigger] ?? "⚡"}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif" }}>
            {rule.name}
          </span>
          <Badge label={rule.category ?? "General"} color={catColor} />
          {rule.tags?.map(t => (
            <span key={t} style={{ fontSize: 10, color: "#6b7280", background: "#1f2937", padding: "1px 6px", borderRadius: 3 }}>#{t}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            <span style={{ color: "#475569" }}>trigger:</span> {TRIGGER_LABELS[rule.trigger]}
          </span>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            <span style={{ color: "#475569" }}>action:</span> {ACTION_LABELS[rule.action?.type]}
          </span>
          {rule.schedule && (
            <span style={{ fontSize: 11, color: "#06b6d4" }}>
              🕐 next: {nextRunDate(rule.schedule)}
            </span>
          )}
          {rule.runs != null && (
            <span style={{ fontSize: 11, color: "#374151" }}>{rule.runs} runs · last {rule.lastRun ?? "never"}</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button onClick={onRun} title="Run now" style={{
          background: "transparent", border: "1px solid #22c55e33",
          color: "#22c55e", borderRadius: 5, width: 28, height: 28, cursor: "pointer",
          fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
        }}>▶</button>
        <Toggle checked={rule.active} onChange={onToggle} />
        <button onClick={onEdit} style={iconBtn("#3b82f6")}>✎</button>
        <button onClick={onDelete} style={iconBtn("#ef4444")}>✕</button>
      </div>
    </div>
  );
}

function iconBtn(color) {
  return {
    background: "transparent", border: `1px solid ${color}33`,
    color, borderRadius: 5, width: 28, height: 28, cursor: "pointer",
    fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  };
}

// ─── Approval Queue ───────────────────────────────────────────────────────────
function ApprovalQueue({ approvals, onDecide }) {
  if (!approvals.length) return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "#4b5563", fontSize: 13 }}>
      No pending approvals
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {approvals.map(a => (
        <div key={a.id} style={{
          background: "#0f172a", border: "1px solid #1f2937", borderLeft: "3px solid #f59e0b",
          borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{a.title}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
              Requested by <span style={{ color: "#94a3b8" }}>{a.requestedBy}</span> · {a.requestedAt}
              &nbsp;·&nbsp; Step {a.currentStep + 1}/{a.chain.length}: <span style={{ color: "#fbbf24" }}>{a.chain[a.currentStep]}</span>
            </div>
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#10b981", fontFamily: "monospace" }}>
            ${a.amount.toLocaleString()}
          </span>
          <button onClick={() => onDecide(a.id, "approve")} style={{
            background: "#052e16", border: "1px solid #16a34a", color: "#22c55e",
            borderRadius: 5, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Approve</button>
          <button onClick={() => onDecide(a.id, "reject")} style={{
            background: "#1c0a0a", border: "1px solid #991b1b", color: "#ef4444",
            borderRadius: 5, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Reject</button>
        </div>
      ))}
    </div>
  );
}

// ─── Template Picker Modal ────────────────────────────────────────────────────
function TemplatePicker({ onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const filtered = AUTOMATION_TEMPLATES.filter(t =>
    (cat === "All" || t.category === cat) &&
    (t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()))
  );
  const cats = ["All", ...new Set(AUTOMATION_TEMPLATES.map(t => t.category))];

  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 620, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <ModalHeader title="Workflow Templates" onClose={onClose} />
        <div style={{ padding: "0 20px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…" style={inputStyle} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cats.map(c => (
              <button key={c} onClick={() => setCat(c)} style={{
                ...pillBtn, background: cat === c ? "#3b82f6" : "#1f2937",
                color: cat === c ? "#fff" : "#9ca3af",
                border: `1px solid ${cat === c ? "#3b82f6" : "#374151"}`,
              }}>{c}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(tpl => (
            <div key={tpl.id} style={{
              background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
              cursor: "pointer", transition: "border-color 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#3b82f6"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#1f2937"}
              onClick={() => onSelect(tpl)}
            >
              <div style={{ fontSize: 22 }}>{TRIGGER_ICONS[tpl.trigger] ?? "⚡"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{tpl.name}</span>
                  <Badge label={tpl.category} color={CAT_COLORS[tpl.category] ?? "#6b7280"} />
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{tpl.description}</div>
              </div>
              <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>Use →</span>
            </div>
          ))}
          {!filtered.length && <div style={{ textAlign: "center", color: "#4b5563", padding: 32, fontSize: 13 }}>No templates match</div>}
        </div>
      </div>
    </Overlay>
  );
}

// ─── Rule Edit Modal ──────────────────────────────────────────────────────────
function RuleModal({ rule, onSave, onClose }) {
  const isNew = !rule.id;
  const [form, setForm] = useState({
    id: rule.id ?? uid(),
    name: rule.name ?? "",
    active: rule.active ?? true,
    category: rule.category ?? "General",
    tags: (rule.tags ?? []).join(", "),
    trigger: rule.trigger ?? TRIGGERS.INVOICE_OVERDUE,
    conditions: rule.conditions ?? [],
    action: rule.action ?? { type: ACTIONS.CREATE_TASK, config: {} },
    schedule: rule.schedule ?? null,
    approvalChain: (rule.action?.config?.chain ?? []).join(", "),
  });

  const fields = CONDITION_FIELDS[form.trigger] ?? [];

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setActionType(t) { setField("action", { type: t, config: {} }); }
  function setActionConfig(k, v) { setField("action", { ...form.action, config: { ...form.action.config, [k]: v } }); }

  function addCondition() {
    setField("conditions", [...form.conditions, { field: fields[0] ?? "amount", op: "greater_than", value: "" }]);
  }
  function removeCondition(i) { setField("conditions", form.conditions.filter((_, idx) => idx !== i)); }
  function updateCondition(i, k, v) {
    const next = [...form.conditions];
    next[i] = { ...next[i], [k]: v };
    setField("conditions", next);
  }

  function handleSave() {
    const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
    const chain = form.approvalChain.split(",").map(t => t.trim()).filter(Boolean);
    const action = form.action.type === ACTIONS.APPROVE_REJECT
      ? { ...form.action, config: { ...form.action.config, chain } }
      : form.action;
    onSave({ ...form, tags, action, schedule: form.trigger === TRIGGERS.SCHEDULED ? form.schedule : null });
  }

  const isScheduled = form.trigger === TRIGGERS.SCHEDULED;
  const isApproval = form.action.type === ACTIONS.APPROVE_REJECT;

  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <ModalHeader title={isNew ? "New Automation" : "Edit Automation"} onClose={onClose} />
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Name + Category */}
          <Row label="Name">
            <input value={form.name} onChange={e => setField("name", e.target.value)}
              placeholder="Rule name…" style={{ ...inputStyle, flex: 1 }} />
          </Row>
          <Row label="Category">
            <select value={form.category} onChange={e => setField("category", e.target.value)} style={selectStyle}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="Tags">
            <input value={form.tags} onChange={e => setField("tags", e.target.value)}
              placeholder="invoices, tasks, …" style={{ ...inputStyle, flex: 1 }} />
          </Row>

          <Divider label="TRIGGER" />
          <Row label="When">
            <select value={form.trigger} onChange={e => setField("trigger", e.target.value)} style={selectStyle}>
              {Object.entries(TRIGGERS).map(([k, v]) => (
                <option key={k} value={v}>{TRIGGER_ICONS[v]} {TRIGGER_LABELS[v]}</option>
              ))}
            </select>
          </Row>

          {/* Schedule config */}
          {isScheduled && (
            <div style={{ background: "#0a1120", border: "1px solid #1e3a5f", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700, marginBottom: 10, letterSpacing: "0.08em" }}>SCHEDULE CONFIG</div>
              <div style={{ display: "flex", gap: 10 }}>
                <select value={form.schedule?.frequency ?? "daily"}
                  onChange={e => setField("schedule", { ...(form.schedule ?? {}), frequency: e.target.value })}
                  style={{ ...selectStyle, flex: 1 }}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                {form.schedule?.frequency === "weekly" && (
                  <select value={form.schedule?.dayOfWeek ?? 1}
                    onChange={e => setField("schedule", { ...form.schedule, dayOfWeek: +e.target.value })}
                    style={{ ...selectStyle, flex: 1 }}>
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                )}
                {form.schedule?.frequency === "monthly" && (
                  <input type="number" min={1} max={31} value={form.schedule?.dayOfMonth ?? 1}
                    onChange={e => setField("schedule", { ...form.schedule, dayOfMonth: +e.target.value })}
                    style={{ ...inputStyle, width: 80 }} />
                )}
              </div>
              {form.schedule?.frequency && (
                <div style={{ fontSize: 11, color: "#06b6d4", marginTop: 8 }}>
                  Next run: {nextRunDate(form.schedule) ?? "—"}
                </div>
              )}
            </div>
          )}

          <Divider label="CONDITIONS" />
          {form.conditions.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={c.field} onChange={e => updateCondition(i, "field", e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                {fields.map(f => <option key={f} value={f}>{CONDITION_FIELD_LABELS[f] ?? f}</option>)}
              </select>
              <select value={c.op} onChange={e => updateCondition(i, "op", e.target.value)} style={{ ...selectStyle, width: 90 }}>
                {CONDITION_OPS.map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
              </select>
              <input value={c.value} onChange={e => updateCondition(i, "value", e.target.value)}
                placeholder="value" style={{ ...inputStyle, width: 100 }} />
              <button onClick={() => removeCondition(i)} style={{ ...iconBtn("#ef4444"), flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <button onClick={addCondition} style={ghostBtn}>+ Add condition</button>

          <Divider label="ACTION" />
          <Row label="Action">
            <select value={form.action.type} onChange={e => setActionType(e.target.value)} style={selectStyle}>
              {Object.entries(ACTIONS).map(([k, v]) => (
                <option key={k} value={v}>{ACTION_LABELS[v]}</option>
              ))}
            </select>
          </Row>

          {/* Action-specific config */}
          {(form.action.type === ACTIONS.CREATE_TASK || form.action.type === ACTIONS.AUTO_ASSIGN) && (
            <>
              <Row label="Title template">
                <input value={form.action.config.title ?? ""} onChange={e => setActionConfig("title", e.target.value)}
                  placeholder="Task: {{client}}" style={{ ...inputStyle, flex: 1 }} />
              </Row>
              <Row label="Priority">
                <select value={form.action.config.priority ?? "Medium"} onChange={e => setActionConfig("priority", e.target.value)} style={selectStyle}>
                  {["Low","Medium","High","Urgent"].map(p => <option key={p}>{p}</option>)}
                </select>
              </Row>
              <Row label="Assign to">
                <input value={form.action.config.assigned ?? ""} onChange={e => setActionConfig("assigned", e.target.value)}
                  placeholder="Team member…" style={{ ...inputStyle, flex: 1 }} />
              </Row>
            </>
          )}
          {form.action.type === ACTIONS.SEND_NOTIFICATION && (
            <Row label="Message">
              <input value={form.action.config.message ?? ""} onChange={e => setActionConfig("message", e.target.value)}
                placeholder="{{name}} has {{days_until}} days…" style={{ ...inputStyle, flex: 1 }} />
            </Row>
          )}
          {form.action.type === ACTIONS.SEND_REPORT && (
            <>
              <Row label="Report title">
                <input value={form.action.config.title ?? ""} onChange={e => setActionConfig("title", e.target.value)}
                  placeholder="Weekly Sales Report" style={{ ...inputStyle, flex: 1 }} />
              </Row>
              <Row label="Module">
                <select value={form.action.config.module ?? "leads"} onChange={e => setActionConfig("module", e.target.value)} style={selectStyle}>
                  {["leads","tasks","accounting","inventory","clients"].map(m => <option key={m}>{m}</option>)}
                </select>
              </Row>
            </>
          )}
          {isApproval && (
            <Row label="Approval chain">
              <input value={form.approvalChain} onChange={e => setField("approvalChain", e.target.value)}
                placeholder="Manager, Director, CFO" style={{ ...inputStyle, flex: 1 }} />
            </Row>
          )}
          {form.action.type === ACTIONS.CHANGE_STATUS && (
            <Row label="New status">
              <input value={form.action.config.newStatus ?? ""} onChange={e => setActionConfig("newStatus", e.target.value)}
                placeholder="In Review" style={{ ...inputStyle, flex: 1 }} />
            </Row>
          )}

          <div style={{ display: "flex", gap: 10, paddingTop: 6 }}>
            <button onClick={handleSave} style={primaryBtn}>
              {isNew ? "Create Automation" : "Save Changes"}
            </button>
            <button onClick={onClose} style={secondaryBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────
function Overlay({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(2px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#111827", border: "1px solid #1f2937",
        borderRadius: 12, overflow: "hidden", boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={{
      padding: "16px 20px", borderBottom: "1px solid #1f2937",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      background: "#0d1117",
    }}>
      <span style={{ fontWeight: 800, fontSize: 15, color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>{title}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 18, cursor: "pointer" }}>✕</button>
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: "#1f2937" }} />
      <span style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, letterSpacing: "0.1em" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#1f2937" }} />
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <label style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, width: 110, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: "#0d1117", border: "1px solid #1f2937", borderRadius: 6,
  color: "#e2e8f0", padding: "7px 10px", fontSize: 12, outline: "none",
  fontFamily: "'DM Mono', monospace",
};
const selectStyle = {
  ...inputStyle, cursor: "pointer", flex: 1,
};
const primaryBtn = {
  background: "#2563eb", border: "none", color: "#fff",
  borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
};
const secondaryBtn = {
  background: "#1f2937", border: "1px solid #374151", color: "#9ca3af",
  borderRadius: 6, padding: "9px 18px", fontSize: 13, cursor: "pointer",
};
const ghostBtn = {
  background: "transparent", border: "1px dashed #374151", color: "#6b7280",
  borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer", width: "100%",
  fontFamily: "'DM Mono', monospace",
};
const pillBtn = {
  borderRadius: 20, padding: "4px 12px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", letterSpacing: "0.04em",
};

// ─── Main AutomationsTab ──────────────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg: "#080e1a", surface: "#0f172a", surface2: "#111827", border: "#1f2937",
    border2: "#374151", text: "#f1f5f9", textMuted: "#94a3b8", textDim: "#64748b",
    textFaint: "#4b5563", input: "#0d1117", hover: "#1a2235", bulkBg: "#1e3a5f",
    bulkBorder: "#1d4ed8", bulkText: "#93c5fd", logRowEven: "#0a0f1a", logRowOdd: "#0d1220",
    resolvedBg: "#0a0f1a", resolvedBorder: "#1f2937",
  } : {
    bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9", border: "#e2e8f0",
    border2: "#cbd5e1", text: "#0f172a", textMuted: "#475569", textDim: "#64748b",
    textFaint: "#94a3b8", input: "#f8fafc", hover: "#f1f5f9", bulkBg: "#eff6ff",
    bulkBorder: "#93c5fd", bulkText: "#1d4ed8", logRowEven: "#f8fafc", logRowOdd: "#f1f5f9",
    resolvedBg: "#f8fafc", resolvedBorder: "#e2e8f0",
  };
}

export default function AutomationsTab({ dark = false }) {
  const [rules, setRules] = useState(SEED_AUTOMATIONS);
  const [approvals, setApprovals] = useState(SEED_APPROVALS);
  const [runLog, setRunLog] = useState(SEED_RUN_LOG);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const [filterTrigger, setFilterTrigger] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [activeTab, setActiveTab] = useState("rules"); // rules | scheduled | approvals | log
  const [editingRule, setEditingRule] = useState(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState(new Set());
  const [notification, setNotification] = useState(null);

  const T = getTheme(dark);

  function notify(msg, color = "#22c55e") {
    setNotification({ msg, color });
    setTimeout(() => setNotification(null), 2500);
  }

  // ── Derived ──
  const filtered = useMemo(() => rules.filter(r => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterTrigger !== "all" && r.trigger !== filterTrigger) return false;
    if (filterStatus === "active" && !r.active) return false;
    if (filterStatus === "inactive" && r.active) return false;
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    return true;
  }), [rules, search, filterTrigger, filterStatus, filterCategory]);

  const scheduledRules = useMemo(() => rules.filter(r => r.trigger === TRIGGERS.SCHEDULED), [rules]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(r => {
      const cat = r.category ?? "General";
      if (!g[cat]) g[cat] = [];
      g[cat].push(r);
    });
    return g;
  }, [filtered]);

  const stats = useMemo(() => ({
    total: rules.length,
    active: rules.filter(r => r.active).length,
    runsToday: rules.reduce((s, r) => s + (r.lastRun === "2026-05-26" ? 1 : 0), 0),
    pendingApprovals: approvals.filter(a => a.status === "pending").length,
    totalRuns: runLog.length,
  }), [rules, approvals, runLog]);

  // ── Actions ──
  function toggleRule(id) {
    setRules(rs => rs.map(r => r.id === id ? { ...r, active: !r.active } : r));
  }
  function deleteRule(id) {
    setRules(rs => rs.filter(r => r.id !== id));
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
    notify("Rule deleted", "#ef4444");
  }
  function saveRule(rule) {
    setRules(rs => rs.some(r => r.id === rule.id) ? rs.map(r => r.id === rule.id ? rule : r) : [...rs, { ...rule, runs: 0, lastRun: null }]);
    setEditingRule(null);
    notify(rule.id ? "Rule saved" : "Rule created");
  }
  function newFromTemplate(tpl) {
    setShowTemplatePicker(false);
    setEditingRule({ ...tpl, id: uid(), name: tpl.name + " (copy)" });
  }
  function bulkToggle(active) {
    setRules(rs => rs.map(r => selected.has(r.id) ? { ...r, active } : r));
    notify(`${selected.size} rules ${active ? "enabled" : "disabled"}`);
    setSelected(new Set());
  }
  function bulkDelete() {
    setRules(rs => rs.filter(r => !selected.has(r.id)));
    notify(`${selected.size} rules deleted`, "#ef4444");
    setSelected(new Set());
  }
  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(r => r.id)));
  }
  function toggleCat(cat) {
    setCollapsedCats(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
  }
  function decideApproval(id, decision) {
    setApprovals(as => as.map(a => {
      if (a.id !== id) return a;
      if (decision === "reject") return { ...a, status: "rejected" };
      if (a.currentStep + 1 >= a.chain.length) return { ...a, status: "approved" };
      return { ...a, currentStep: a.currentStep + 1 };
    }));
    notify(decision === "approve" ? "Approved ✓" : "Rejected ✗", decision === "approve" ? "#22c55e" : "#ef4444");
  }

  function runNow(rule) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const logEntry = {
      key: `${rule.id}-MANUAL-${Date.now()}`,
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      module: rule.trigger,
      entityId: "MANUAL",
      timestamp: new Date().toISOString(),
      status: "success",
      manual: true,
    };
    setRunLog(log => [logEntry, ...log]);
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, runs: (r.runs ?? 0) + 1, lastRun: todayStr } : r));
    notify(`▶ "${rule.name}" triggered`);
  }

  const TABS = [
    { id: "rules", label: "All Rules", count: rules.length },
    { id: "scheduled", label: "Scheduled", count: scheduledRules.length },
    { id: "approvals", label: "Approvals", count: stats.pendingApprovals },
    { id: "log", label: "Run Log", count: runLog.length },
  ];

  return (
    <div style={{
      fontFamily: "'DM Sans', 'DM Mono', sans-serif",
      background: T.bg, minHeight: "100vh", color: T.text, padding: "24px",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Toast */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, background: T.surface2,
          border: `1px solid ${notification.color}`, borderLeft: `4px solid ${notification.color}`,
          color: "#f1f5f9", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
          zIndex: 2000, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>{notification.msg}</div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: T.text }}>
              Automations
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: T.textDim }}>
              Trigger-based workflows, scheduled jobs & approval chains
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowTemplatePicker(true)} style={secondaryBtn}>
              📋 Templates
            </button>
            <button onClick={() => setEditingRule({})} style={primaryBtn}>
              + New Rule
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <StatCard label="Total rules" value={stats.total} accent="#3b82f6" T={T} />
          <StatCard label="Active" value={stats.active} sub={`${stats.total - stats.active} inactive`} accent="#22c55e" T={T} />
          <StatCard label="Runs today" value={stats.runsToday} accent="#06b6d4" T={T} />
          <StatCard label="Pending approvals" value={stats.pendingApprovals} accent="#f59e0b" T={T} />
          <StatCard label="Log entries" value={stats.totalRuns} accent="#8b5cf6" T={T} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${T.border}`, marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 16px", fontSize: 13, fontWeight: 600,
            color: activeTab === t.id ? T.text : T.textFaint,
            borderBottom: `2px solid ${activeTab === t.id ? "#3b82f6" : "transparent"}`,
            marginBottom: -1, transition: "all 0.15s",
          }}>
            {t.label}
            <span style={{
              marginLeft: 6, fontSize: 11, background: activeTab === t.id ? "#1d4ed8" : T.border,
              color: activeTab === t.id ? "#93c5fd" : T.textFaint,
              padding: "1px 6px", borderRadius: 10,
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── RULES TAB ── */}
      {activeTab === "rules" && (
        <>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍  Search rules…" style={{ ...inputStyle, width: 200 }} />
            <select value={filterTrigger} onChange={e => setFilterTrigger(e.target.value)} style={{ ...selectStyle, width: 170 }}>
              <option value="all">All triggers</option>
              {Object.entries(TRIGGERS).map(([k, v]) => (
                <option key={k} value={v}>{TRIGGER_LABELS[v]}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...selectStyle, width: 120 }}>
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ ...selectStyle, width: 130 }}>
              <option value="all">All categories</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Bulk toolbar */}
          {selected.size > 0 && (
            <div style={{
              background: T.bulkBg, border: `1px solid ${T.bulkBorder}`, borderRadius: 8,
              padding: "9px 14px", marginBottom: 12,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.bulkText }}>{selected.size} selected</span>
              <button onClick={() => bulkToggle(true)} style={{ ...ghostBtn, width: "auto", padding: "4px 12px", borderStyle: "solid", borderColor: "#22c55e", color: "#22c55e" }}>Enable all</button>
              <button onClick={() => bulkToggle(false)} style={{ ...ghostBtn, width: "auto", padding: "4px 12px", borderStyle: "solid", borderColor: "#6b7280", color: "#6b7280" }}>Disable all</button>
              <button onClick={bulkDelete} style={{ ...ghostBtn, width: "auto", padding: "4px 12px", borderStyle: "solid", borderColor: "#ef4444", color: "#ef4444" }}>Delete all</button>
              <button onClick={() => setSelected(new Set())} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
          )}

          {/* Select all */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll}
              style={{ accentColor: "#3b82f6", width: 15, height: 15 }} />
            <span style={{ fontSize: 11, color: T.textFaint }}>Select all ({filtered.length})</span>
          </div>

          {/* Grouped rules */}
          {Object.entries(grouped).map(([cat, catRules]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <button onClick={() => toggleCat(cat)} style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, padding: "4px 0", marginBottom: 8, width: "100%",
              }}>
                <span style={{ fontSize: 12, transform: collapsedCats.has(cat) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s", color: T.textFaint }}>▾</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: CAT_COLORS[cat] ?? "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>{cat}</span>
                <span style={{ fontSize: 11, color: T.textFaint }}>({catRules.length})</span>
                <div style={{ flex: 1, height: 1, background: T.border, marginLeft: 6 }} />
              </button>
              {!collapsedCats.has(cat) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {catRules.map(r => (
                    <RuleCard key={r.id} rule={r}
                      selected={selected.has(r.id)}
                      onSelect={() => toggleSelect(r.id)}
                      onToggle={() => toggleRule(r.id)}
                      onEdit={() => setEditingRule(r)}
                      onDelete={() => deleteRule(r.id)}
                      onRun={() => runNow(r)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {!filtered.length && (
            <div style={{ textAlign: "center", padding: "48px 0", color: T.textFaint }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⚡</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No rules match your filters</div>
              <button onClick={() => setEditingRule({})} style={{ ...primaryBtn, marginTop: 16 }}>Create your first rule</button>
            </div>
          )}
        </>
      )}

      {/* ── SCHEDULED TAB ── */}
      {activeTab === "scheduled" && (
        <div>
          <div style={{ fontSize: 12, color: T.textDim, marginBottom: 16 }}>
            Recurring automations that fire on a set schedule. Next run dates calculated from today.
          </div>
          {scheduledRules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: T.textFaint }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🕐</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No scheduled rules yet</div>
              <button onClick={() => setShowTemplatePicker(true)} style={{ ...primaryBtn, marginTop: 16 }}>Browse templates</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scheduledRules.map(r => {
                const next = nextRunDate(r.schedule);
                const freq = r.schedule?.frequency ?? "—";
                return (
                  <div key={r.id} style={{
                    background: T.surface, border: `1px solid ${T.border}`,
                    borderLeft: `3px solid ${r.active ? "#06b6d4" : "#374151"}`,
                    borderRadius: 8, padding: "14px 16px",
                    display: "flex", alignItems: "center", gap: 14,
                  }}>
                    <div style={{ fontSize: 22 }}>🕐</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: T.textDim, marginTop: 4, display: "flex", gap: 14 }}>
                        <span>Frequency: <span style={{ color: "#06b6d4", textTransform: "capitalize" }}>{freq}</span></span>
                        {r.schedule?.dayOfWeek != null && <span>Day: <span style={{ color: "#94a3b8" }}>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][r.schedule.dayOfWeek]}</span></span>}
                        {r.schedule?.dayOfMonth != null && <span>Day of month: <span style={{ color: "#94a3b8" }}>{r.schedule.dayOfMonth}</span></span>}
                        <span>Next run: <span style={{ color: "#22c55e" }}>{next ?? "—"}</span></span>
                        <span>Action: <span style={{ color: "#94a3b8" }}>{ACTION_LABELS[r.action?.type]}</span></span>
                      </div>
                    </div>
                    <Toggle checked={r.active} onChange={() => toggleRule(r.id)} />
                    <button onClick={() => runNow(r)} title="Run now" style={{
                      background: "transparent", border: "1px solid #22c55e33",
                      color: "#22c55e", borderRadius: 5, width: 28, height: 28, cursor: "pointer",
                      fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>▶</button>
                    <button onClick={() => setEditingRule(r)} style={iconBtn("#3b82f6")}>✎</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── APPROVALS TAB ── */}
      {activeTab === "approvals" && (
        <div>
          <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 16 }}>
            Pending items triggered by automation rules that require human approval.
          </div>
          <ApprovalQueue approvals={approvals.filter(a => a.status === "pending")} onDecide={decideApproval} />
          {approvals.filter(a => a.status !== "pending").length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Resolved</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {approvals.filter(a => a.status !== "pending").map(a => (
                  <div key={a.id} style={{
                    background: T.resolvedBg, border: `1px solid ${T.resolvedBorder}`,
                    borderLeft: `3px solid ${a.status === "approved" ? "#22c55e" : "#ef4444"}`,
                    borderRadius: 8, padding: "10px 16px",
                    display: "flex", alignItems: "center", gap: 12, opacity: 0.6,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#94a3b8" }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>
                        {a.requestedBy} · {a.requestedAt}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: a.status === "approved" ? "#22c55e" : "#ef4444", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LOG TAB ── */}
      {activeTab === "log" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.textFaint }}>
              Full execution history — manual runs, scheduled jobs, and trigger-based firings.
            </div>
            {runLog.length > 0 && (
              <button onClick={() => setRunLog([])} style={{ ...ghostBtn, width: "auto", padding: "4px 12px", borderStyle: "solid", borderColor: "#374151", fontSize: 11 }}>
                Clear log
              </button>
            )}
          </div>
          {runLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: T.textFaint }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No runs logged yet</div>
              <div style={{ fontSize: 12, color: "#4b5563", marginTop: 6 }}>Hit ▶ on any rule to fire it manually</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {/* Header */}
              <div style={{
                display: "grid", gridTemplateColumns: "140px 1fr 120px 90px 70px",
                gap: 12, padding: "6px 14px",
                fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                <span>Timestamp</span>
                <span>Rule</span>
                <span>Action</span>
                <span>Entity</span>
                <span>Status</span>
              </div>
              {runLog.map((entry, i) => (
                <div key={entry.key} style={{
                  display: "grid", gridTemplateColumns: "140px 1fr 120px 90px 70px",
                  gap: 12, padding: "9px 14px",
                  background: i % 2 === 0 ? T.logRowEven : T.logRowOdd,
                  borderRadius: 4,
                  alignItems: "center",
                }}>
                  <span style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Mono', monospace" }}>
                    {new Date(entry.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div>
                    <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{entry.ruleName}</span>
                    {entry.manual && <span style={{ marginLeft: 6, fontSize: 10, color: "#f59e0b", background: "#1c1200", border: "1px solid #713f12", padding: "1px 5px", borderRadius: 3 }}>MANUAL</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{ACTION_LABELS[entry.action?.type] ?? "—"}</span>
                  <span style={{ fontSize: 11, color: "#374151", fontFamily: "'DM Mono', monospace" }}>{entry.entityId}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: entry.status === "success" ? "#22c55e" : "#ef4444",
                    background: entry.status === "success" ? "#052e16" : "#1c0a0a",
                    padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.06em",
                    display: "inline-block",
                  }}>{entry.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showTemplatePicker && (
        <TemplatePicker onSelect={newFromTemplate} onClose={() => setShowTemplatePicker(false)} />
      )}
      {editingRule && (
        <RuleModal rule={editingRule} onSave={saveRule} onClose={() => setEditingRule(null)} />
      )}
    </div>
  );
}
