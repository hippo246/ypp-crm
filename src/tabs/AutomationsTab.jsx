import { useState } from "react";
import { useAppData } from "../context/AppContext";
import { can } from "../services/permissions";
import {
  TRIGGERS, TRIGGER_LABELS, CONDITION_FIELDS, CONDITION_OPS,
  ACTIONS, ACTION_LABELS, DEFAULT_AUTOMATIONS, runAutomations,
} from "../services/automationEngine";
import { B } from "../constants";

const EMPTY_RULE = {
  id: "", name: "", active: true,
  trigger: TRIGGERS.INVOICE_OVERDUE,
  conditions: [],
  action: { type: ACTIONS.CREATE_TASK, config: { title: "", priority: "High", assigned: "" } },
};

function Badge({ color, children }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: color + "22", color }}>
      {children}
    </span>
  );
}

function RuleCard({ rule, onToggle, onEdit, onDelete, onRun, canEdit, canDelete }) {
  const actionLabel = ACTION_LABELS[rule.action?.type] ?? rule.action?.type;
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: B.text, marginBottom: 4 }}>{rule.name}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Badge color={B.accent}>WHEN {TRIGGER_LABELS[rule.trigger] ?? rule.trigger}</Badge>
            {rule.conditions.map((c, i) => (
              <Badge key={i} color={B.orange}>IF {c.field} {c.op.replace(/_/g, " ")} {c.value}</Badge>
            ))}
            <Badge color={B.green}>THEN {actionLabel}</Badge>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {canEdit && (
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={rule.active} onChange={() => onToggle(rule.id)}
                style={{ accentColor: B.green }} />
              <span style={{ fontSize: 11, color: rule.active ? B.green : B.muted }}>{rule.active ? "On" : "Off"}</span>
            </label>
          )}
          {canEdit && (
            <button onClick={() => onEdit(rule)}
              style={{ padding: "4px 10px", fontSize: 11, background: B.light, border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
              Edit
            </button>
          )}
          {canDelete && (
            <button onClick={() => onDelete(rule.id)}
              style={{ padding: "4px 10px", fontSize: 11, background: "#FEF2F2", border: `1px solid #FECACA`, borderRadius: 5, cursor: "pointer", color: B.red, fontFamily: "inherit" }}>
              Delete
            </button>
          )}
          {canEdit && (
            <button onClick={() => onRun(rule)}
              style={{ padding: "4px 10px", fontSize: 11, background: "#F0FDF4", border: `1px solid #BBF7D0`, borderRadius: 5, cursor: "pointer", color: B.green, fontFamily: "inherit" }}>
              ▶ Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleModal({ rule, onSave, onClose }) {
  const [form, setForm] = useState(rule ? { ...rule } : { ...EMPTY_RULE, id: `AUTO${Date.now()}` });
  const [conditions, setConditions] = useState(rule?.conditions ?? []);
  const [actionConfig, setActionConfig] = useState(rule?.action?.config ?? {});
  const [actionType, setActionType] = useState(rule?.action?.type ?? ACTIONS.CREATE_TASK);

  const fields = CONDITION_FIELDS[form.trigger] ?? [];

  function addCondition() {
    setConditions([...conditions, { field: fields[0] ?? "amount", op: "greater_than", value: "" }]);
  }

  function updateCondition(i, key, val) {
    const updated = [...conditions];
    updated[i] = { ...updated[i], [key]: val };
    setConditions(updated);
  }

  function removeCondition(i) {
    setConditions(conditions.filter((_, idx) => idx !== i));
  }

  function handleSave() {
    if (!form.name.trim()) return;
    onSave({ ...form, conditions, action: { type: actionType, config: actionConfig } });
  }

  const inp = (style = {}) => ({
    padding: "7px 10px", border: `1px solid ${B.border}`, borderRadius: 6,
    fontSize: 12, fontFamily: "inherit", color: B.text, background: B.white,
    outline: "none", ...style,
  });

  const lbl = { fontSize: 11, fontWeight: 600, color: B.text, display: "block", marginBottom: 4 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: B.white, borderRadius: 10, width: 540, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${B.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{rule ? "Edit automation" : "New automation"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: B.muted }}>✕</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div>
            <label style={lbl}>Rule name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Overdue invoice reminder" style={{ ...inp(), width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Trigger */}
          <div>
            <label style={lbl}>Trigger — WHEN this happens</label>
            <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              style={{ ...inp(), width: "100%" }}>
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Conditions */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Conditions — IF (optional)</label>
              <button onClick={addCondition}
                style={{ fontSize: 11, padding: "3px 10px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
                + Add
              </button>
            </div>
            {conditions.length === 0 && <div style={{ fontSize: 12, color: B.muted, fontStyle: "italic" }}>No conditions — rule runs on all matching records</div>}
            {conditions.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <select value={c.field} onChange={(e) => updateCondition(i, "field", e.target.value)} style={inp()}>
                  {fields.map((f) => <option key={f} value={f}>{f.replace(/_/g, " ")}</option>)}
                </select>
                <select value={c.op} onChange={(e) => updateCondition(i, "op", e.target.value)} style={inp()}>
                  {CONDITION_OPS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
                <input value={c.value} onChange={(e) => updateCondition(i, "value", e.target.value)}
                  placeholder="value" style={{ ...inp(), width: 80 }} />
                <button onClick={() => removeCondition(i)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: B.red, fontSize: 16, padding: 0 }}>✕</button>
              </div>
            ))}
          </div>

          {/* Action */}
          <div>
            <label style={lbl}>Action — THEN do this</label>
            <select value={actionType} onChange={(e) => { setActionType(e.target.value); setActionConfig({}); }}
              style={{ ...inp(), width: "100%", marginBottom: 8 }}>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            {actionType === ACTIONS.CREATE_TASK && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input value={actionConfig.title ?? ""} onChange={(e) => setActionConfig({ ...actionConfig, title: e.target.value })}
                  placeholder="Task title (use {{client}}, {{id}} etc.)" style={{ ...inp(), width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={actionConfig.priority ?? "High"} onChange={(e) => setActionConfig({ ...actionConfig, priority: e.target.value })} style={inp()}>
                    {["High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <input value={actionConfig.assigned ?? ""} onChange={(e) => setActionConfig({ ...actionConfig, assigned: e.target.value })}
                    placeholder="Assign to..." style={{ ...inp(), flex: 1 }} />
                </div>
              </div>
            )}

            {actionType === ACTIONS.SEND_NOTIFICATION && (
              <input value={actionConfig.message ?? ""} onChange={(e) => setActionConfig({ ...actionConfig, message: e.target.value })}
                placeholder="Notification message (use {{client}}, {{id}} etc.)" style={{ ...inp(), width: "100%", boxSizing: "border-box" }} />
            )}

            {actionType === ACTIONS.UPDATE_STATUS && (
              <input value={actionConfig.status ?? ""} onChange={(e) => setActionConfig({ ...actionConfig, status: e.target.value })}
                placeholder="New status value" style={{ ...inp(), width: "100%", boxSizing: "border-box" }} />
            )}
          </div>

          {/* Active */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}
              style={{ accentColor: B.green, width: 14, height: 14 }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Active (runs automatically)</span>
          </label>
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${B.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", fontSize: 12, background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: "8px 16px", fontSize: 12, background: B.blue, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Save rule</button>
        </div>
      </div>
    </div>
  );
}

export default function AutomationsTab({ viewMode }) {
  const { data, dispatch } = useAppData();
  const role = data.currentUser?.role ?? "Admin";
  const canEdit = can(role, "automations", "edit");
  const canDelete = can(role, "automations", "delete");

  const [rules, setRules] = useState(data.automations ?? DEFAULT_AUTOMATIONS);
  const [modal, setModal] = useState(null);
  const [runLog, setRunLog] = useState([]);
  const [lastRunResults, setLastRunResults] = useState([]);

  function handleToggle(id) {
    if (!canEdit) return;
    setRules(rules.map((r) => r.id === id ? { ...r, active: !r.active } : r));
  }

  function handleDelete(id) {
    if (!canDelete) return;
    setRules(rules.filter((r) => r.id !== id));
  }

  function handleSave(rule) {
    const exists = rules.find((r) => r.id === rule.id);
    setRules(exists ? rules.map((r) => r.id === rule.id ? rule : r) : [...rules, rule]);
    setModal(null);
  }

  function handleRun(rule) {
    const results = runAutomations([rule], data, runLog);
    setLastRunResults(results);
    if (results.length > 0) {
      setRunLog([...runLog, ...results]);
      results.forEach((res) => {
        if (res.action?.type === "create_task") {
          const title = (res.action.config?.title ?? "Auto task")
            .replace("{{client}}", res.entity.client ?? res.entity.name ?? "")
            .replace("{{id}}", res.entity.id ?? "");
          dispatch({
            type: "ADD_TASK",
            payload: {
              id: `T-AUTO-${Date.now()}`,
              title,
              assigned: res.action.config?.assigned ?? "System",
              priority: res.action.config?.priority ?? "Medium",
              status: "Pending",
              due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
              ref: res.entityId,
            },
          });
        }
        dispatch({ type: "LOG_EXPORT", module: "automations", format: `rule:${rule.name}` });
      });
    }
  }

  function handleRunAll() {
    const results = runAutomations(rules, data, runLog);
    setLastRunResults(results);
    if (results.length > 0) {
      setRunLog([...runLog, ...results]);
    }
  }

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Automation rules</div>
          <div style={{ fontSize: 12, color: B.muted }}>{activeCount} of {rules.length} active</div>
        </div>
        <button onClick={handleRunAll}
          style={{ padding: "7px 14px", fontSize: 12, background: "#F0FDF4", border: `1px solid #BBF7D0`, borderRadius: 6, cursor: "pointer", color: B.green, fontFamily: "inherit", fontWeight: 600 }}>
          ▶ Run all active
        </button>
        {canEdit && (
          <button onClick={() => setModal({})}
            style={{ padding: "7px 14px", fontSize: 12, background: B.blue, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
            + New rule
          </button>
        )}
      </div>

      {/* Last run results */}
      {lastRunResults.length > 0 && (
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: B.green, marginBottom: 6 }}>✓ Last run — {lastRunResults.length} action{lastRunResults.length !== 1 ? "s" : ""} triggered</div>
          {lastRunResults.map((r) => (
            <div key={r.key} style={{ fontSize: 11, color: B.text, padding: "2px 0" }}>
              · <strong>{r.ruleName}</strong> → {ACTION_LABELS[r.action?.type]} on {r.entityId}
            </div>
          ))}
        </div>
      )}

      {lastRunResults.length === 0 && runLog.length > 0 && (
        <div style={{ fontSize: 12, color: B.muted, fontStyle: "italic" }}>All automations up to date — no new actions needed.</div>
      )}

      {/* Rules */}
      {rules.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: B.muted, fontSize: 13 }}>
          No automation rules yet.{canEdit ? " Click '+ New rule' to create one." : ""}
        </div>
      )}
      {rules.map((rule) => (
        <RuleCard key={rule.id} rule={rule}
          onToggle={handleToggle} onEdit={(r) => setModal(r)}
          onDelete={handleDelete} onRun={handleRun}
          canEdit={canEdit} canDelete={canDelete}
        />
      ))}

      {/* Run history */}
      {runLog.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: B.muted }}>Run history ({runLog.length})</div>
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, overflow: "hidden" }}>
            {[...runLog].reverse().slice(0, 20).map((entry, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${B.border}`, fontSize: 11 }}>
                <span style={{ color: B.muted, flexShrink: 0 }}>{new Date(entry.timestamp).toLocaleString()}</span>
                <span style={{ fontWeight: 600 }}>{entry.ruleName}</span>
                <span style={{ color: B.muted }}>→ {entry.entityId}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal !== null && (
        <RuleModal rule={Object.keys(modal).length ? modal : null} onSave={handleSave} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
