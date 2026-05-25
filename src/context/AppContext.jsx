import { createContext, useContext, useReducer, useCallback, useMemo } from "react";
import { createAuditEntry, AUDIT_ACTIONS } from "../services/auditEngine";
import { buildNotifications } from "../services/notificationEngine";

const AppContext = createContext(null);

const INITIAL_META = {
  currentUser: null,   // { id, name, role, avatar, email }
  auditLog: [],
  notifReadIds: [],    // ids of notifications the user has dismissed/read
  presence: [],        // [{ userId, name, avatar, color, activeTab, lastSeen }]
  autoSaveStatus: "saved", // "saved" | "saving" | "unsaved"
  versionHistory: [],  // [{ id, timestamp, user, snapshot, label }]
};

function reducer(state, action) {
  const user = state.currentUser?.name ?? "System";

  switch (action.type) {

    // ── Auth ────────────────────────────────────────────────────────────────
    case "LOGIN":
      return { ...state, currentUser: action.payload };
    case "LOGOUT":
      return { ...state, currentUser: null };

    // ── Generic ─────────────────────────────────────────────────────────────
    case "SET_DATA":
      return { ...state, ...action.payload };

    // ── Auto-save status ─────────────────────────────────────────────────────
    case "SET_AUTOSAVE_STATUS":
      return { ...state, autoSaveStatus: action.status };

    // ── Presence ─────────────────────────────────────────────────────────────
    case "UPDATE_PRESENCE": {
      const existing = state.presence.filter(p => p.userId !== action.payload.userId);
      return { ...state, presence: [...existing, { ...action.payload, lastSeen: Date.now() }] };
    }
    case "REMOVE_PRESENCE":
      return { ...state, presence: state.presence.filter(p => p.userId !== action.userId) };

    // ── Version history ───────────────────────────────────────────────────────
    case "SAVE_VERSION": {
      const snap = { id: `V${Date.now()}`, timestamp: new Date().toISOString(), user, label: action.label || "Manual save", snapshot: { tasks: state.tasks, leads: state.leads, clients: state.clients, accounting: state.accounting } };
      return { ...state, versionHistory: [snap, ...state.versionHistory].slice(0, 50) };
    }
    case "RESTORE_VERSION": {
      const ver = state.versionHistory.find(v => v.id === action.id);
      if (!ver) return state;
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "system", null, `Restored snapshot: ${ver.label} (${ver.timestamp})`, user);
      return { ...state, ...ver.snapshot, auditLog: [entry, ...state.auditLog] };
    }

    // ── Notifications ────────────────────────────────────────────────────────
    case "MARK_NOTIF_READ": {
      const ids = [...new Set([...state.notifReadIds, action.id])];
      return { ...state, notifReadIds: ids };
    }
    case "MARK_ALL_READ": {
      const ids = [...new Set([...state.notifReadIds, ...action.ids])];
      return { ...state, notifReadIds: ids };
    }

    // ── Invoices ─────────────────────────────────────────────────────────────
    case "ADD_INVOICE": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "accounting", action.payload.id, `Created invoice ${action.payload.id} for ${action.payload.client}`, user);
      return { ...state, accounting: [...state.accounting, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_INVOICE": {
      const accounting = [...state.accounting];
      const before = accounting[action.index];
      accounting[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "accounting", before.id, `Updated invoice ${before.id}`, user, { before, after: accounting[action.index] });
      return { ...state, accounting, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_INVOICE": {
      const accounting = [...state.accounting];
      const [removed] = accounting.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "accounting", removed.id, `Deleted invoice ${removed.id} (${removed.client})`, user);
      return { ...state, accounting, auditLog: [entry, ...state.auditLog] };
    }
    case "RECORD_PAYMENT": {
      const accounting = [...state.accounting];
      const before = accounting[action.index];
      accounting[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.PAYMENT, "accounting", before.id, `Payment recorded on ${before.id} — AED ${action.payload.paid}`, user, { before, after: accounting[action.index] });
      return { ...state, accounting, auditLog: [entry, ...state.auditLog] };
    }

    // ── Clients ──────────────────────────────────────────────────────────────
    case "ADD_CLIENT": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "clients", action.payload.id, `Added client ${action.payload.name}`, user);
      return { ...state, clients: [...state.clients, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_CLIENT": {
      const clients = [...state.clients];
      const before = clients[action.index];
      clients[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "clients", before.id, `Updated client ${before.name}`, user, { before, after: clients[action.index] });
      return { ...state, clients, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_CLIENT": {
      const clients = [...state.clients];
      const [removed] = clients.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "clients", removed.id, `Deleted client ${removed.name}`, user);
      return { ...state, clients, auditLog: [entry, ...state.auditLog] };
    }

    // ── Leads ────────────────────────────────────────────────────────────────
    case "ADD_LEAD": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "leads", action.payload.id, `New lead: ${action.payload.name} (${action.payload.service})`, user);
      return { ...state, leads: [...state.leads, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_LEAD": {
      const leads = [...state.leads];
      const before = leads[action.index];
      leads[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "leads", before.id, `Updated lead ${before.name}`, user, { before, after: leads[action.index] });
      return { ...state, leads, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_LEAD": {
      const leads = [...state.leads];
      const [removed] = leads.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "leads", removed.id, `Deleted lead ${removed.name}`, user);
      return { ...state, leads, auditLog: [entry, ...state.auditLog] };
    }

    // ── Tasks ────────────────────────────────────────────────────────────────
    case "ADD_TASK": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "tasks", action.payload.id, `Created task: ${action.payload.title}`, user);
      return { ...state, tasks: [...state.tasks, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_TASK": {
      const tasks = [...state.tasks];
      const before = tasks[action.index];
      tasks[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "tasks", before.id, `Updated task: ${before.title}`, user, { before, after: tasks[action.index] });
      return { ...state, tasks, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_TASK": {
      const tasks = [...state.tasks];
      const [removed] = tasks.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "tasks", removed.id, `Deleted task: ${removed.title}`, user);
      return { ...state, tasks, auditLog: [entry, ...state.auditLog] };
    }
    case "ADD_TASK_COMMENT": {
      const tasks = [...state.tasks];
      const t = tasks[action.taskIndex];
      const comment = { id: `CM${Date.now()}`, author: user, text: action.text, time: new Date().toISOString(), mentions: action.mentions || [] };
      tasks[action.taskIndex] = { ...t, comments: [...(t.comments || []), comment], activityLog: [...(t.activityLog || []), { type: "comment", user, time: comment.time, text: `Commented: "${action.text.slice(0, 40)}"` }] };
      return { ...state, tasks };
    }
    case "TOGGLE_SUBTASK": {
      const tasks = [...state.tasks];
      const t = { ...tasks[action.taskIndex] };
      t.subtasks = (t.subtasks || []).map(s => s.id === action.subtaskId ? { ...s, done: !s.done } : s);
      const done = t.subtasks.filter(s => s.done).length;
      t.progress = t.subtasks.length ? Math.round((done / t.subtasks.length) * 100) : t.progress;
      tasks[action.taskIndex] = t;
      return { ...state, tasks };
    }
    case "SET_APPROVAL": {
      const tasks = [...state.tasks];
      const t = tasks[action.taskIndex];
      tasks[action.taskIndex] = { ...t, approvalStatus: action.status, activityLog: [...(t.activityLog || []), { type: "approval", user, time: new Date().toISOString(), text: `Approval ${action.status}` }] };
      return { ...state, tasks };
    }

    // ── Inventory ─────────────────────────────────────────────────────────────
    case "ADD_INVENTORY": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "inventory", action.payload.id, `Added inventory item: ${action.payload.name}`, user);
      return { ...state, inventory: [...state.inventory, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_INVENTORY": {
      const inventory = [...state.inventory];
      const before = inventory[action.index];
      inventory[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "inventory", before.id, `Updated inventory: ${before.name}`, user, { before, after: inventory[action.index] });
      return { ...state, inventory, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_INVENTORY": {
      const inventory = [...state.inventory];
      const [removed] = inventory.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "inventory", removed.id, `Deleted inventory item: ${removed.name}`, user);
      return { ...state, inventory, auditLog: [entry, ...state.auditLog] };
    }

    // ── Suppliers ─────────────────────────────────────────────────────────────
    case "ADD_SUPPLIER": {
      const entry = createAuditEntry(AUDIT_ACTIONS.CREATE, "suppliers", action.payload.id, `Added supplier: ${action.payload.name}`, user);
      return { ...state, suppliers: [...state.suppliers, action.payload], auditLog: [entry, ...state.auditLog] };
    }
    case "UPDATE_SUPPLIER": {
      const suppliers = [...state.suppliers];
      const before = suppliers[action.index];
      suppliers[action.index] = { ...before, ...action.payload };
      const entry = createAuditEntry(AUDIT_ACTIONS.UPDATE, "suppliers", before.id, `Updated supplier: ${before.name}`, user, { before, after: suppliers[action.index] });
      return { ...state, suppliers, auditLog: [entry, ...state.auditLog] };
    }
    case "DELETE_SUPPLIER": {
      const suppliers = [...state.suppliers];
      const [removed] = suppliers.splice(action.index, 1);
      const entry = createAuditEntry(AUDIT_ACTIONS.DELETE, "suppliers", removed.id, `Deleted supplier: ${removed.name}`, user);
      return { ...state, suppliers, auditLog: [entry, ...state.auditLog] };
    }

    // ── Export audit ──────────────────────────────────────────────────────────
    case "LOG_EXPORT": {
      const entry = createAuditEntry(AUDIT_ACTIONS.EXPORT, action.module, null, `Exported ${action.module} data as ${action.format}`, user);
      return { ...state, auditLog: [entry, ...state.auditLog] };
    }

    default:
      return state;
  }
}

export function AppProvider({ children, initialData }) {
  const [state, dispatch] = useReducer(reducer, { ...initialData, ...INITIAL_META });

  // Derived notifications — recomputed whenever data changes
  const notifications = useMemo(() => {
    const all = buildNotifications(state);
    return all.map((n) => ({ ...n, read: state.notifReadIds.includes(n.id) }));
  }, [state]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  // Backward compat
  const setData = useCallback((newData) => dispatch({ type: "SET_DATA", payload: newData }), []);

  return (
    <AppContext.Provider value={{ data: state, setData, dispatch, notifications, unreadCount, presence: state.presence, autoSaveStatus: state.autoSaveStatus, versionHistory: state.versionHistory }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppData must be used inside AppProvider");
  return ctx;
}
