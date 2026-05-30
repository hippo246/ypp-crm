/**
 * App.jsx — Root entry point
 *
 * Changes vs original:
 *  1. Removed inline AppShell and inline useTabSync — now using the
 *     dedicated AppShell component (AppShell.jsx) and hooks/useTabSync.js
 *  2. Removed static tab imports (Dashboard, LeadsTab, …) — AppShell
 *     handles lazy-loading them internally
 *  3. Added mobile.css import
 *  4. AppShell no longer needs currentUser / onLogout / onRoleChange props
 *     — those are managed here and threaded through AppContext so AppShell
 *     can read them without prop-drilling
 *  5. Kept CommandPalette, NotifPanel, NavHoverCard, SideNavItem,
 *     useSidebarBadges, getTheme, ROLE_COLORS, ROLES, ALL_NAV as-is
 *     because AppShell.jsx still delegates back to them via AppContext.
 *
 * NOTE: If you want the richer shell from the original App.jsx (dark mode,
 * compact mode, split view, presence, command palette, etc.) keep using the
 * inline AppShell defined at the bottom of this file and simply delete the
 * import line for the external AppShell. The inline one has been cleaned up
 * and de-duplicated from useTabSync — it now imports from hooks/useTabSync.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

function usePersisted(key, def) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : def; } catch { return def; }
  });
  const set = useCallback(v => setVal(prev => {
    const next = typeof v === "function" ? v(prev) : v;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    return next;
  }), [key]);
  return [val, set];
}
import { B, INIT } from "./constants";
import { AppProvider, useAppData } from "./context/AppContext";
import { can, getVisibleModules } from "./services/permissions";
import LoginScreen from "./LoginScreen";
import "./mobile.css"; // ← global mobile responsiveness patch
import "./LeadsTab.mobile.css"; // ← LeadsTab phone/tablet patch
import "./mobile-tabs.css"; // ← comprehensive mobile styles for all tabs

// Static imports kept for the inline AppShell below
import Dashboard from "./tabs/Dashboard";
import LeadsTab from "./tabs/LeadsTab";
import ClientsTab from "./tabs/ClientsTab";
import TasksTab from "./tabs/TasksTab";
import AccountingTab from "./tabs/AccountingTab";
import InventoryTab from "./tabs/InventoryTab";
import SuppliersTab from "./tabs/SuppliersTab";
import CalendarTab from "./tabs/CalendarTab";
import AnalyticsTab from "./tabs/AnalyticsTab";
import ReportsTab from "./tabs/ReportsTab";
import AutomationsTab from "./tabs/AutomationsTab";
import SettingsTab from "./tabs/SettingsTab";
import OfflineBanner, { MobileBottomNav } from "./OfflineBanner";

// ← NEW: import the extracted hook (no more inline duplicate)
import { useTabSync } from "./hooks/useTabSync";

const ALL_NAV = [
  { id: "dashboard",   label: "Dashboard",   icon: "▣",  group: null },
  { id: "leads",       label: "Leads",       icon: "◎",  group: "CRM" },
  { id: "clients",     label: "Clients",     icon: "⬡",  group: "CRM" },
  { id: "tasks",       label: "Tasks",       icon: "◈",  group: "CRM" },
  { id: "accounting",  label: "Accounting",  icon: "◆",  group: "Finance" },
  { id: "inventory",   label: "Inventory",   icon: "▤",  group: "Finance" },
  { id: "suppliers",   label: "Suppliers",   icon: "▥",  group: "Finance" },
  { id: "calendar",    label: "Calendar",    icon: "▦",  group: "Ops" },
  { id: "analytics",   label: "Analytics",   icon: "▲",  group: "Ops" },
  { id: "reports",     label: "Reports",     icon: "▶",  group: "Ops" },
  { id: "automations", label: "Automations", icon: "◉",  group: "Ops" },
  { id: "settings",    label: "Settings",    icon: "⚙️", group: null },
];

const ROLE_COLORS = {
  Admin:       "#1D3557",
  Sales:       "#16A34A",
  Accountant:  "#D97706",
  Operations:  "#7C3AED",
};

const ROLES = ["Admin", "Sales", "Accountant", "Operations", "Manager"];

// ── Theme tokens (light / dark / high-contrast) ───────────────────────────────────
function getTheme(dark, highContrast) {
  const base = dark ? {
    bg: "#0f1117", surface: "#1a1d27", border: "#2a2d3a", text: "#e8eaf0",
    muted: "#6b7280", accent: "#5b9bd5", sidebar: "linear-gradient(180deg,#0d1520 0%,#0a1018 100%)",
    topbar: "#13161f", card: "#1e2130", input: "#252836", hover: "#252836",
  } : {
    bg: B.bg, surface: B.white, border: B.border, text: B.text,
    muted: B.muted, accent: B.accent, sidebar: "linear-gradient(180deg,#1a2f4a 0%,#152539 100%)",
    topbar: B.white, card: B.white, input: B.light, hover: B.light,
  };
  
  if (highContrast) {
    return {
      ...base,
      bg: "#000000", surface: "#000000", border: "#ffffff", text: "#ffffff",
      muted: "#cccccc", accent: "#ffff00", sidebar: "#000000",
      topbar: "#000000", card: "#000000", input: "#000000", hover: "#222222",
    };
  }
  return base;
}

// ── Enterprise Error Boundary ───────────────────────────────────────────────────
class EnterpriseErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Enterprise Error Boundary caught:", error, errorInfo);
    // Log to error tracking service in production
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#64748B", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>
            {this.state.error?.message || "An unexpected error occurred. Please try again."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "10px 20px",
              background: "#3B82F6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ── Toast / Snackbar system ────────────────────────────────────────────────────
let _toastDispatch = null;
export function toast(msg, type = "info", duration = 3000) {
  if (_toastDispatch) _toastDispatch({ msg, type, duration, id: Date.now() + Math.random() });
}

function ToastContainer({ dark, highContrast }) {
  const T = getTheme(dark, highContrast);
  const [toasts, setToasts] = useState([]);
  useEffect(() => { _toastDispatch = (t) => setToasts(prev => [...prev.slice(-4), t]); return () => { _toastDispatch = null; }; }, []);
  const remove = (id) => setToasts(prev => prev.filter(t => t.id !== id));
  const TYPE_COLORS = { info: T.accent, success: "#16a34a", error: "#ef4444", warning: "#d97706" };
  const TYPE_ICONS  = { info: "ℹ", success: "✓", error: "✕", warning: "⚠" };
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", pointerEvents: "none" }}>
      {toasts.map(t => (
        <ToastItem key={t.id} t={t} dark={dark} T={T} TYPE_COLORS={TYPE_COLORS} TYPE_ICONS={TYPE_ICONS} onRemove={remove} />
      ))}
    </div>
  );
}

function ToastItem({ t, dark, T, TYPE_COLORS, TYPE_ICONS, onRemove }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => { setVisible(false); setTimeout(() => onRemove(t.id), 300); }, t.duration || 3000);
    return () => clearTimeout(timer);
  }, []);
  const color = TYPE_COLORS[t.type] || T.accent;
  return (
    <div onClick={() => { setVisible(false); setTimeout(() => onRemove(t.id), 300); }}
      style={{ pointerEvents: "all", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: dark ? "#1e2130" : "#fff", border: `1px solid ${T.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", fontSize: 12, color: T.text, maxWidth: 320, cursor: "pointer", transition: "opacity 0.3s, transform 0.3s", opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(12px)" }}>
      <span style={{ color, fontSize: 13, flexShrink: 0 }}>{TYPE_ICONS[t.type] || "ℹ"}</span>
      <span style={{ flex: 1 }}>{t.msg}</span>
    </div>
  );
}

// ── Command palette data indexer ───────────────────────────────────────────────
function buildDataCmds(data, onNavigate, onClose) {
  const cmds = [];

  // ── Leads ──────────────────────────────────────────────────────────────────
  (data.leads || []).forEach(l => {
    const tags = [l.name, l.status, l.source, l.email, l.phone, l.company, l.assigned, l.value ? `AED ${l.value}` : "", l.notes].filter(Boolean).join(" ");
    cmds.push({
      label: l.name || "Unnamed Lead",
      sub: [l.status, l.source, l.assigned, l.value ? `AED ${Number(l.value).toLocaleString()}` : ""].filter(Boolean).join(" · "),
      icon: "◎", group: "Leads", tags,
      badge: l.status, badgeColor: l.status === "Won" ? "#16a34a" : l.status === "Lost" ? "#ef4444" : "#d97706",
      action: () => { onNavigate("leads"); onClose(); },
    });
  });

  // ── Clients ────────────────────────────────────────────────────────────────
  (data.clients || []).forEach(c => {
    const tags = [c.name, c.contact, c.email, c.phone, c.industry, c.status, c.renewal, c.notes, c.value ? `AED ${c.value}` : ""].filter(Boolean).join(" ");
    cmds.push({
      label: c.name || "Unnamed Client",
      sub: [c.status, c.industry, c.renewal ? `Renews ${c.renewal}` : "", c.value ? `AED ${Number(c.value).toLocaleString()}` : ""].filter(Boolean).join(" · "),
      icon: "⬡", group: "Clients", tags,
      badge: c.status, badgeColor: c.status === "Active" ? "#16a34a" : "#6b7280",
      action: () => { onNavigate("clients"); onClose(); },
    });
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────
  (data.tasks || []).forEach(t => {
    const tags = [t.title, t.status, t.priority, t.assigned, t.due, t.notes, t.project].filter(Boolean).join(" ");
    cmds.push({
      label: t.title || "Unnamed Task",
      sub: [t.status, t.priority ? `${t.priority} priority` : "", t.assigned, t.due ? `Due ${t.due}` : ""].filter(Boolean).join(" · "),
      icon: "◈", group: "Tasks", tags,
      badge: t.priority, badgeColor: t.priority === "High" ? "#ef4444" : t.priority === "Medium" ? "#d97706" : "#6b7280",
      action: () => { onNavigate("tasks"); onClose(); },
    });
  });

  // ── Accounting / Invoices ──────────────────────────────────────────────────
  (data.accounting || []).forEach(inv => {
    const tags = [inv.client, inv.status, inv.due, inv.ref, inv.notes, inv.amount ? `AED ${inv.amount}` : ""].filter(Boolean).join(" ");
    cmds.push({
      label: inv.client || inv.ref || `Invoice #${inv.id}`,
      sub: [inv.status, inv.amount ? `AED ${Number(inv.amount).toLocaleString()}` : "", inv.due ? `Due ${inv.due}` : ""].filter(Boolean).join(" · "),
      icon: "◆", group: "Accounting", tags,
      badge: inv.status, badgeColor: inv.status === "Paid" ? "#16a34a" : inv.status === "Overdue" ? "#ef4444" : "#d97706",
      action: () => { onNavigate("accounting"); onClose(); },
    });
  });

  // ── Inventory ──────────────────────────────────────────────────────────────
  (data.inventory || []).forEach(item => {
    const tags = [item.name, item.sku, item.category, item.status, item.supplier, item.location, item.qty != null ? `qty ${item.qty}` : "", item.price ? `AED ${item.price}` : ""].filter(Boolean).join(" ");
    cmds.push({
      label: item.name || item.sku || "Unnamed Item",
      sub: [item.category, item.status, item.qty != null ? `Qty: ${item.qty}` : "", item.price ? `AED ${Number(item.price).toLocaleString()}` : ""].filter(Boolean).join(" · "),
      icon: "▤", group: "Inventory", tags,
      badge: item.status, badgeColor: item.status === "In Stock" ? "#16a34a" : item.status === "Out of Stock" ? "#ef4444" : "#d97706",
      action: () => { onNavigate("inventory"); onClose(); },
    });
  });

  // ── Suppliers ──────────────────────────────────────────────────────────────
  (data.suppliers || []).forEach(s => {
    const tags = [s.name, s.contact, s.email, s.phone, s.category, s.country, s.status, s.notes].filter(Boolean).join(" ");
    cmds.push({
      label: s.name || "Unnamed Supplier",
      sub: [s.category, s.country, s.status, s.contact].filter(Boolean).join(" · "),
      icon: "▥", group: "Suppliers", tags,
      badge: s.status, badgeColor: s.status === "Active" ? "#16a34a" : "#6b7280",
      action: () => { onNavigate("suppliers"); onClose(); },
    });
  });

  // ── Calendar events ────────────────────────────────────────────────────────
  (data.calendar || data.events || []).forEach(ev => {
    const tags = [ev.title, ev.date, ev.time, ev.location, ev.notes, ev.assigned].filter(Boolean).join(" ");
    cmds.push({
      label: ev.title || "Untitled Event",
      sub: [ev.date, ev.time, ev.location].filter(Boolean).join(" · "),
      icon: "▦", group: "Calendar", tags,
      action: () => { onNavigate("calendar"); onClose(); },
    });
  });

  return cmds;
}

// ── Command palette ────────────────────────────────────────────────────────────
function CommandPalette({ navItems, onNavigate, onClose, dark, setDark, setCompact, setFocusMode, compact, focusMode, splitView, setSplitView, setViewMode, viewMode, sidebarCollapsed, setSidebarCollapsed, onLogout, autoSaveStatus, data }) {
  const T = getTheme(dark);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [savedSearches, setSavedSearches] = usePersisted("crm_savedSearches", []);
  const [recentSearches, setRecentSearches] = usePersisted("crm_recentSearches", []);
  const [editingRecord, setEditingRecord] = useState(null);
  const [activeFilters, setActiveFilters] = useState([]);
  const totalRecords = (data?.leads?.length || 0) + (data?.clients?.length || 0) + (data?.tasks?.length || 0) + (data?.accounting?.length || 0) + (data?.inventory?.length || 0) + (data?.suppliers?.length || 0);

  const saveSearch = useCallback(() => {
    if (!q || q.trim().length < 2) return;
    setSavedSearches(prev => prev.includes(q) ? prev : [q, ...prev].slice(0, 12));
    toast(`Saved search "${q}"`, "success");
  }, [q, setSavedSearches]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const saveToHistory = useCallback((query) => {
    if (!query || query.trim().length < 2) return;
    setRecentSearches(prev => [query, ...prev.filter(q => q !== query)].slice(0, 8));
  }, [setRecentSearches]);

  const NAV_CMDS = navItems.map(n => ({ label: n.label, icon: n.icon, action: () => { onNavigate(n.id); onClose(); }, group: "Navigate" }));

  const SETTING_CMDS = [
    { label: `Toggle dark mode ${dark ? "(on)" : "(off)"}`, icon: "🌙", action: () => { setDark(d => !d); toast(dark ? "Light mode on" : "Dark mode on", "info"); }, group: "Settings" },
    { label: `Toggle compact mode ${compact ? "(on)" : "(off)"}`, icon: "⚡", action: () => { setCompact(c => !c); toast(compact ? "Compact mode off" : "Compact mode on", "info"); }, group: "Settings" },
    { label: `Toggle focus mode ${focusMode ? "(on)" : "(off)"}`, icon: "◎", action: () => { setFocusMode(f => !f); onClose(); toast(focusMode ? "Focus mode off" : "Focus mode on", "info"); }, group: "Settings" },
    { label: `Toggle split view ${splitView ? "(on)" : "(off)"}`, icon: "⧉", action: () => { setSplitView(s => !s); toast(splitView ? "Split view off" : "Split view on", "info"); }, group: "Settings" },
    { label: `Toggle sidebar ${sidebarCollapsed ? "(collapsed)" : "(expanded)"}`, icon: "◀", action: () => { setSidebarCollapsed(s => !s); toast(sidebarCollapsed ? "Sidebar expanded" : "Sidebar collapsed", "info"); }, group: "Settings" },
    { label: `Toggle excel view ${viewMode === "excel" ? "(on)" : "(off)"}`, icon: "⊞", action: () => { setViewMode(v => v === "excel" ? "normal" : "excel"); toast(viewMode === "excel" ? "Excel view off" : "Excel view on", "info"); }, group: "Settings" },
  ];

  const QUICK_CMDS = [
    { label: "Add Task", icon: "✚", action: () => { onNavigate("tasks"); onClose(); }, group: "Quick Add" },
    { label: "Add Lead", icon: "✚", action: () => { onNavigate("leads"); onClose(); }, group: "Quick Add" },
    { label: "Add Client", icon: "✚", action: () => { onNavigate("clients"); onClose(); }, group: "Quick Add" },
    { label: "Add Invoice", icon: "✚", action: () => { onNavigate("accounting"); onClose(); }, group: "Quick Add" },
    { label: `Auto-save status: ${autoSaveStatus}`, icon: "💾", action: () => {}, group: "Status", disabled: true },
    { label: "Sign out", icon: "⎋", action: () => { onClose(); onLogout(); }, group: "Account" },
  ];

  // Build data commands once (data changes rarely in palette session)
  const DATA_CMDS = useMemo(() => buildDataCmds(data || {}, onNavigate, onClose), [data]);

  const ALL_CMDS = [...NAV_CMDS, ...SETTING_CMDS, ...QUICK_CMDS, ...DATA_CMDS];

  // When there's a query, search ALL fields including tags; show only data groups with results.
  // When empty, show only nav/settings/quickadd (not data flood).
  const filtered = useMemo(() => {
    if (!q && activeFilters.length === 0) return [...NAV_CMDS, ...SETTING_CMDS, ...QUICK_CMDS];
    const lq = q.toLowerCase();
    return ALL_CMDS.filter(c => {
      const haystack = ((c.tags || "") + " " + c.label + " " + (c.sub || "") + " " + (c.badge || "")).toLowerCase();
      const matchesQuery = !q || fuzzyMatch(haystack, lq);
      
      // Apply filters
      const matchesFilters = activeFilters.every(f => {
        const filterHaystack = haystack.toLowerCase();
        if (f.key === "status") return filterHaystack.includes(f.value.toLowerCase());
        if (f.key === "priority") return filterHaystack.includes(f.value.toLowerCase());
        return true;
      });
      
      return matchesQuery && matchesFilters;
    });
  }, [q, ALL_CMDS, activeFilters]);

  const groups = useMemo(() => [...new Set(filtered.map(c => c.group))], [filtered]);

  useEffect(() => { setCursor(0); }, [q]);

  const handleKey = (e) => {
    if (e.key === "Escape") { onClose(); setEditingRecord(null); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveSearch(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[cursor];
      if (item && !item.disabled) { saveToHistory(q); item.action(); }
    }
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      const item = filtered[cursor];
      if (item && item.sub) { setEditingRecord(item); }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      // Add filter based on current query
      if (q.includes(":")) {
        const [key, value] = q.split(":");
        if (key && value && !activeFilters.find(f => f.key === key)) {
          setActiveFilters(prev => [...prev, { key, value }]);
          setQ("");
        }
      }
    }
    if (e.key === "Backspace" && !q && activeFilters.length > 0) {
      setActiveFilters(prev => prev.slice(0, -1));
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cursor="true"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Total data record counts for hint
  const [hoveredCmd, setHoveredCmd] = useState(null);
  const [hoverTimer, setHoverTimer] = useState(null);

  const startHover = (c, idx) => {
    clearTimeout(hoverTimer);
    if (!c.sub) return;
    const t = setTimeout(() => setHoveredCmd({ cmd: c, idx }), 500);
    setHoverTimer(t);
  };
  const endHover = () => { clearTimeout(hoverTimer); setHoveredCmd(null); };

  let globalIdx = -1;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px) saturate(150%)", WebkitBackdropFilter: "blur(8px) saturate(150%)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: 620, background: dark ? "rgba(26,29,39,0.97)" : "rgba(255,255,255,0.98)", borderRadius: 16, boxShadow: "0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)", overflow: "hidden", border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, animation: "slideDown 0.15s ease" }}>

        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 16, color: T.muted }}>⌕</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {activeFilters.map((f, i) => (
              <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${T.accent}22`, border: `1px solid ${T.accent}44`, color: T.accent, display: "flex", alignItems: "center", gap: 4 }}>
                {f.key}:{f.value}
                <button onClick={() => setActiveFilters(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: T.accent, fontSize: 10, padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            ))}
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleKey}
              placeholder={activeFilters.length > 0 ? "Add more filters..." : `Search everything — ${totalRecords} records across all tabs…`}
              style={{ border: "none", outline: "none", fontSize: 14, background: "transparent", color: T.text, fontFamily: "inherit", minWidth: 120 }} />
          </div>
          {q && <button onClick={() => setQ("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>}
          <kbd style={{ fontSize: 10, color: T.muted, background: T.input, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>Tab to filter</kbd>
        </div>

        {/* Saved searches */}
        {!q && savedSearches.length > 0 && (
          <div style={{ padding: "6px 16px 2px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: T.muted, marginBottom: 5 }}>Saved Searches</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {savedSearches.map((s, i) => (
                <button key={i} onClick={() => setQ(s)}
                  style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${T.accent}18`, border: `1px solid ${T.accent}44`, color: T.accent, cursor: "pointer", fontFamily: "inherit" }}>
                  ★ {s}
                </button>
              ))}
              <button onClick={() => setSavedSearches([])} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: "none", border: "none", color: T.muted, cursor: "pointer", fontFamily: "inherit", opacity: 0.6 }}>clear</button>
            </div>
          </div>
        )}

        {/* Recent searches when empty */}
        {!q && recentSearches.length > 0 && (
          <div style={{ padding: "6px 16px 2px" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: T.muted, marginBottom: 5 }}>Recent</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {recentSearches.map((s, i) => (
                <button key={i} onClick={() => setQ(s)}
                  style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: T.input, border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", fontFamily: "inherit" }}>
                  ↺ {s}
                </button>
              ))}
              <button onClick={() => setRecentSearches([])} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 10, background: "none", border: "none", color: T.muted, cursor: "pointer", fontFamily: "inherit", opacity: 0.6 }}>clear</button>
            </div>
          </div>
        )}

        {/* Hint when empty */}
        {!q && (
          <div style={{ padding: "6px 16px 4px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["Leads", "◎", data?.leads?.length], ["Clients", "⬡", data?.clients?.length], ["Tasks", "◈", data?.tasks?.length], ["Invoices", "◆", data?.accounting?.length], ["Inventory", "▤", data?.inventory?.length], ["Suppliers", "▥", data?.suppliers?.length]].map(([label, icon, count]) => count > 0 && (
              <button key={label} onClick={() => setQ(label.toLowerCase())}
                style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: T.input, border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                <span>{icon}</span>{label} <span style={{ fontWeight: 700, color: T.text }}>{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Spotlight top hit */}
        {q && filtered.length > 0 && filtered[0].sub && (
          <div style={{ margin: "6px 8px 0", padding: "10px 14px", background: dark ? "rgba(91,155,213,0.10)" : "#eef4ff", borderRadius: 10, border: `1px solid ${dark ? "rgba(91,155,213,0.25)" : "#c7d8f5"}`, cursor: "pointer", animation: "fadeIn 0.1s ease" }}
            onClick={() => { if (!filtered[0].disabled) { saveToHistory(q); filtered[0].action(); } }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", color: T.accent, marginBottom: 5 }}>Top Result</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>{filtered[0].icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{filtered[0].label}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{filtered[0].sub}</div>
              </div>
              {filtered[0].badge && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: (filtered[0].badgeColor||T.muted)+"22", color: filtered[0].badgeColor||T.muted, fontWeight: 700 }}>{filtered[0].badge}</span>}
            </div>
          </div>
        )}

        {/* Results list */}
        <div ref={listRef} style={{ maxHeight: 440, overflowY: "auto", padding: "4px 0 6px" }}>
          {groups.map(group => (
            <div key={group}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", color: T.muted, padding: "8px 16px 3px", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                <span>{group}</span>
                <span style={{ fontWeight: 400, letterSpacing: 0 }}>{filtered.filter(c => c.group === group).length}</span>
              </div>
              {filtered.filter(c => c.group === group).map((c) => {
                globalIdx++;
                const idx = globalIdx;
                const isActive = idx === cursor;
                const isDataRow = !!c.sub;
                return (
                  <div key={idx} data-cursor={isActive ? "true" : undefined}
                    onClick={() => { if (!c.disabled) c.action(); }}
                    style={{ display: "flex", alignItems: isDataRow ? "flex-start" : "center", gap: 12, padding: isDataRow ? "8px 16px" : "9px 16px", cursor: c.disabled ? "default" : "pointer", color: c.disabled ? T.muted : T.text, fontSize: 13, background: isActive ? (dark ? "rgba(255,255,255,0.06)" : "#f0f4ff") : "transparent", transition: "background 0.08s", borderLeft: isActive ? `2px solid ${T.accent}` : "2px solid transparent" }}
                    onMouseEnter={() => { setCursor(idx); startHover(c, idx); }}
                    onMouseLeave={endHover}>
                    {/* Icon or colored dot */}
                    <span style={{ fontSize: isDataRow ? 12 : 14, width: 20, textAlign: "center", opacity: 0.65, flexShrink: 0, marginTop: isDataRow ? 1 : 0 }}>{c.icon}</span>

                    {/* Label + sub */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: isDataRow ? 600 : 400, fontSize: isDataRow ? 12 : 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {/* Highlight matched query in label */}
                        {q ? highlightMatch(c.label, q, T) : c.label}
                      </div>
                      {c.sub && <div style={{ fontSize: 10, color: T.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub}</div>}
                    </div>

                    {/* Badge pill */}
                    {c.badge && (
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: (c.badgeColor || T.muted) + "22", color: c.badgeColor || T.muted, fontWeight: 700, flexShrink: 0, border: `1px solid ${(c.badgeColor || T.muted)}33` }}>
                        {c.badge}
                      </span>
                    )}

                    {/* Enter hint */}
                    {isActive && <span style={{ fontSize: 10, color: T.muted, background: T.input, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: T.muted, fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
              No results for <strong>"{q}"</strong> across {totalRecords} records
            </div>
          )}
        </div>

        {/* Inline hover preview - enhanced with full record details */}
        {hoveredCmd && hoveredCmd.cmd.sub && (
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, background: dark ? "rgba(255,255,255,0.03)" : "#f8faff", animation: "fadeIn 0.1s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>{hoveredCmd.cmd.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{hoveredCmd.cmd.label}</span>
              {hoveredCmd.cmd.badge && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: (hoveredCmd.cmd.badgeColor||T.muted)+"22", color: hoveredCmd.cmd.badgeColor||T.muted, fontWeight: 700, border: `1px solid ${(hoveredCmd.cmd.badgeColor||T.muted)}33` }}>{hoveredCmd.cmd.badge}</span>}
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>{hoveredCmd.cmd.sub}</div>
            {hoveredCmd.cmd.tags && <div style={{ fontSize: 10, color: T.muted, marginTop: 4, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hoveredCmd.cmd.tags.slice(0, 150)}</div>}
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button onClick={() => { hoveredCmd.cmd.action(); onClose(); }} style={{ fontSize: 10, padding: "4px 10px", background: T.accent, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Open</button>
              <button onClick={(e) => { e.stopPropagation(); setEditingRecord(hoveredCmd.cmd); }} style={{ fontSize: 10, padding: "4px 10px", background: T.input, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, cursor: "pointer" }}>Edit</button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "6px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: T.muted }}>↑↓ navigate</span>
          <span style={{ fontSize: 10, color: T.muted }}>↵ open</span>
          <span style={{ fontSize: 10, color: T.muted }}>E edit</span>
          <span style={{ fontSize: 10, color: T.muted }}>esc close</span>
          {q && <span style={{ fontSize: 10, color: T.muted }}>⌘S save search</span>}
          <span style={{ flex: 1 }} />
          {q && <span style={{ fontSize: 10, color: T.muted }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>}
        </div>
      </div>

      {/* Quick-edit modal */}
      {editingRecord && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditingRecord(null); }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", animation: "slideDown 0.15s ease" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>Quick Edit: {editingRecord.label}</span>
              <button onClick={() => setEditingRecord(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4, display: "block" }}>Name</label>
                <input defaultValue={editingRecord.label} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.input, color: T.text, fontSize: 12 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 4, display: "block" }}>Status</label>
                <select style={{ width: "100%", padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.input, color: T.text, fontSize: 12 }}>
                  <option>New</option>
                  <option>Contacted</option>
                  <option>Proposal</option>
                  <option>Won</option>
                  <option>Lost</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => { setEditingRecord(null); toast("Changes saved", "success"); }} style={{ flex: 1, padding: "8px 12px", background: T.accent, border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>Save</button>
                <button onClick={() => setEditingRecord(null)} style={{ flex: 1, padding: "8px 12px", background: T.input, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, cursor: "pointer", fontSize: 12 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fuzzy match — typo-tolerant via simple Levenshtein-based scoring
function fuzzyMatch(haystack, needle) {
  if (!needle) return true;
  const h = haystack.toLowerCase(), n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // Allow up to 1 transposition/substitution per 4 chars
  const maxDist = Math.floor(n.length / 4);
  if (maxDist === 0) return h.includes(n);
  for (let i = 0; i <= h.length - n.length; i++) {
    let dist = 0;
    for (let j = 0; j < n.length; j++) { if (h[i + j] !== n[j]) dist++; }
    if (dist <= maxDist) return true;
  }
  return false;
}

// Highlight matched substring in a string
function highlightMatch(str, q, T) {
  if (!q) return str;
  const idx = str.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return str;
  return (
    <>
      {str.slice(0, idx)}
      <mark style={{ background: "#fde04799", color: "inherit", borderRadius: 2, padding: "0 1px" }}>{str.slice(idx, idx + q.length)}</mark>
      {str.slice(idx + q.length)}
    </>
  );
}

// ── Hover preview card ─────────────────────────────────────────────────────────
function NavHoverCard({ n, badges, T, onNavigate }) {
  const TIPS = { dashboard: "Overview & KPIs", leads: "Pipeline & prospects", clients: "Active accounts", tasks: "Work & assignments", accounting: "Invoices & payments", inventory: "Stock levels", suppliers: "Vendor management", calendar: "Schedule & deadlines", analytics: "Charts & trends", reports: "Exports & summaries", automations: "Workflow rules", settings: "Preferences & configuration" };
  return (
    <div onClick={() => onNavigate && onNavigate(n.id)}
      style={{ position: "absolute", left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 200, whiteSpace: "nowrap", minWidth: 160, cursor: onNavigate ? "pointer" : "default" }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: T.text, marginBottom: 2 }}>{n.label}</div>
      <div style={{ fontSize: 11, color: T.muted }}>{TIPS[n.id] || ""}</div>
      {badges?.[n.id] > 0 && <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: B.orange }}>{badges[n.id]} pending — click to open</div>}
    </div>
  );
}

// ── Notification panel ────────────────────────────────────────────────────────
function NotifPanel({ notifications, onClose, onMarkRead, onMarkAll, onDismiss, onClearAll, dark }) {
  const T = getTheme(dark);
  const SCOLOR = { high: B.red, medium: B.orange, low: B.muted };
  const [selectedIds, setSelectedIds] = useState([]);
  const [catFilter, setCatFilter] = useState("All");
  const CATS = ["All", "Tasks", "Leads", "System"];

  const filtered = catFilter === "All" ? notifications : notifications.filter(n => {
    const body = (n.title + " " + n.body).toLowerCase();
    if (catFilter === "Tasks") return body.includes("task");
    if (catFilter === "Leads") return body.includes("lead");
    return !body.includes("task") && !body.includes("lead");
  });

  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const dismissSelected = () => { selectedIds.forEach(id => onDismiss(id)); setSelectedIds([]); toast(`Dismissed ${selectedIds.length} notifications`, "info"); };
  const markSelectedRead = () => { selectedIds.forEach(id => onMarkRead(id)); setSelectedIds([]); };
  return (
    <div style={{
      position: "absolute", top: 50, right: 0, width: 360, maxHeight: 480,
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      boxShadow: "0 12px 40px rgba(0,0,0,0.18)", zIndex: 1000,
      display: "flex", flexDirection: "column", overflow: "hidden",
      animation: "fadeIn 0.15s ease",
    }}>
      <div style={{ padding: "14px 16px 8px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>Notifications</span>
            {notifications.filter(n => !n.read).length > 0 && <span style={{ marginLeft: 8, fontSize: 10, background: B.red, color: "#fff", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>{notifications.filter(n => !n.read).length}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={onMarkAll} style={{ fontSize: 11, color: B.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Mark all read</button>
            {notifications.length > 0 && <button onClick={onClearAll} style={{ fontSize: 11, color: B.red || "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Clear all</button>}
            <button onClick={onClose} style={{ fontSize: 16, color: T.muted, background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        </div>
        {/* Category filter tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {CATS.map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: catFilter === c ? `${T.accent}22` : T.input, border: `1px solid ${catFilter === c ? T.accent+"66" : T.border}`, color: catFilter === c ? T.accent : T.muted, cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}>
              {c}
            </button>
          ))}
        </div>
        {/* Bulk actions */}
        {selectedIds.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: T.muted }}>{selectedIds.length} selected</span>
            <button onClick={markSelectedRead} style={{ fontSize: 10, color: B.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Mark read</button>
            <button onClick={dismissSelected} style={{ fontSize: 10, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Dismiss</button>
            <button onClick={() => setSelectedIds([])} style={{ fontSize: 10, color: T.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Cancel</button>
          </div>
        )}
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
            All clear! No notifications.
          </div>
        )}
        {filtered.map((n) => (
          <div key={n.id}
            style={{
              padding: "11px 16px", borderBottom: `1px solid ${T.border}`,
              background: selectedIds.includes(n.id) ? `${T.accent}18` : n.read ? "transparent" : (dark ? "rgba(93,130,200,0.08)" : "#F0F7FF"),
              transition: "background 0.12s", display: "flex", gap: 10, alignItems: "flex-start",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = T.hover}
            onMouseLeave={(e) => e.currentTarget.style.background = selectedIds.includes(n.id) ? `${T.accent}18` : n.read ? "transparent" : (dark ? "rgba(93,130,200,0.08)" : "#F0F7FF")}
          >
            <input type="checkbox" checked={selectedIds.includes(n.id)} onChange={() => toggleSelect(n.id)}
              style={{ marginTop: 3, cursor: "pointer", accentColor: T.accent, flexShrink: 0 }} />
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: SCOLOR[n.severity], flexShrink: 0, marginTop: 4 }} />
            <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onMarkRead(n.id)}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2 }}>{n.title}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{n.body}</div>
              {n.timestamp && (
                <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>
                  {new Date(n.timestamp).toLocaleString()}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
              {!n.read && <div style={{ width: 6, height: 6, borderRadius: "50%", background: B.accent, flexShrink: 0 }} />}
              <button onClick={() => onDismiss(n.id)} title="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 12, padding: 0, lineHeight: 1, opacity: 0.5 }}
                onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar nav badge counts ───────────────────────────────────────────────────
function useSidebarBadges(data) {
  const overdueInvoices = (data.accounting || []).filter(i => {
    if (i.status === "Paid") return false;
    return i.due && new Date(i.due) < new Date();
  }).length;
  const openLeads = (data.leads || []).filter(l => !["Won","Lost"].includes(l.status)).length;
  const pendingTasks = (data.tasks || []).filter(t => t.status !== "Done").length;
  const lowStock = (data.inventory || []).filter(i => i.status !== "In Stock").length;
  const expiringClients = (data.clients || []).filter(c => {
    if (!c.renewal) return false;
    const diff = (new Date(c.renewal) - new Date()) / 86_400_000;
    return diff >= 0 && diff <= 30;
  }).length;

  // Trend: compare to a stored snapshot from 7 days ago (approximated via localStorage)
  const getTrend = (key, current) => {
    try {
      const stored = JSON.parse(localStorage.getItem(`crm_badge_snap_${key}`) || "null");
      if (!stored) { localStorage.setItem(`crm_badge_snap_${key}`, JSON.stringify({ v: current, ts: Date.now() })); return { change: 0, direction: 'neutral' }; }
      if (Date.now() - stored.ts > 86400000) { localStorage.setItem(`crm_badge_snap_${key}`, JSON.stringify({ v: current, ts: Date.now() })); }
      const change = current - stored.v;
      const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
      const percent = stored.v > 0 ? Math.round((change / stored.v) * 100) : 0;
      return { change, direction, percent };
    } catch { return { change: 0, direction: 'neutral', percent: 0 }; }
  };

  return {
    leads: openLeads, tasks: pendingTasks, accounting: overdueInvoices, inventory: lowStock, clients: expiringClients,
    trends: {
      leads: getTrend("leads", openLeads),
      tasks: getTrend("tasks", pendingTasks),
      accounting: getTrend("accounting", overdueInvoices),
      inventory: getTrend("inventory", lowStock),
      clients: getTrend("clients", expiringClients),
    }
  };
}

// ── Sidebar nav item ──────────────────────────────────────────────────────────
function SideNavItem({ n, active, collapsed, badge, onClick, onContextMenu, dark = false, itemRef, onNavigate, unsaved = false, trend = null }) {
  const T = getTheme(dark);
  const [hovered, setHovered] = useState(false);
  const trendIcon = trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '';
  const trendColor = trend?.direction === 'up' ? '#16a34a' : trend?.direction === 'down' ? '#ef4444' : 'transparent';
  return (
    <div ref={itemRef} onClick={onClick} onContextMenu={onContextMenu}
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? n.label : undefined}
      role="button"
      aria-label={n.label}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: collapsed ? "9px 0" : "7px 14px",
        justifyContent: collapsed ? "center" : "flex-start",
        cursor: "pointer",
        color: active ? "#fff" : hovered ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.50)",
        background: active ? "rgba(255,255,255,0.12)" : hovered && !active ? "rgba(255,255,255,0.04)" : "transparent",
        fontSize: 12, fontWeight: active ? 600 : 400,
        transition: "color 0.12s, background 0.18s",
        borderRadius: 7,
        margin: collapsed ? "1px 4px" : "1px 8px",
        outline: "none",
      }}>
      <span style={{ fontSize: 13, flexShrink: 0, opacity: active ? 1 : 0.72 }}>{n.icon}</span>
      {!collapsed && <span style={{ flex: 1, letterSpacing: "0.1px" }}>{n.label}</span>}
      {!collapsed && unsaved && <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0, boxShadow: "0 0 4px #f59e0b88" }} />}
      {!collapsed && badge > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8, background: n.id === "accounting" ? "#ef4444" : B.yellow, color: n.id === "accounting" ? "#fff" : "#1a2f4a", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", flexShrink: 0 }}>
            {badge > 99 ? "99+" : badge}
          </span>
          {trend && trendIcon && (
            <span style={{ fontSize: 8, color: trendColor, fontWeight: 700, opacity: 0.8 }}>{trendIcon}{Math.abs(trend.percent)}%</span>
          )}
        </div>
      )}
      {collapsed && badge > 0 && (
        <span style={{ position: "absolute", top: 5, right: 6, minWidth: 14, height: 14, borderRadius: 7, background: n.id === "accounting" ? "#ef4444" : B.yellow, color: n.id === "accounting" ? "#fff" : "#1a2f4a", fontSize: 8, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      {collapsed && hovered && <NavHoverCard n={n} badges={{ [n.id]: badge }} T={T} onNavigate={onNavigate} />}
    </div>
  );
}

// ── Tab Error Boundary ────────────────────────────────────────────────────────
import React from "react";
class TabErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, padding: 40 }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Something went wrong in this tab</div>
          <div style={{ fontSize: 12, color: "#6b7280", maxWidth: 400, textAlign: "center" }}>{this.state.error?.message}</div>
          <button onClick={() => this.setState({ error: null })} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontSize: 12 }}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Skeleton shimmer ──────────────────────────────────────────────────────────
function Skeleton({ w = "100%", h = 14, radius = 6, style = {} }) {
  return (
    <div style={{ width: w, height: h, borderRadius: radius, background: "linear-gradient(90deg, rgba(128,128,128,0.08) 25%, rgba(128,128,128,0.18) 50%, rgba(128,128,128,0.08) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite", ...style }} />
  );
}
export { Skeleton };

// ── Smart date parser ─────────────────────────────────────────────────────────
function parseSmartDate(input) {
  if (!input) return "";
  const s = input.trim().toLowerCase();
  const now = new Date(); now.setHours(0,0,0,0);
  const fmt = (d) => d.toISOString().slice(0,10);
  if (s === "today") return fmt(now);
  if (s === "tomorrow") { const d = new Date(now); d.setDate(d.getDate()+1); return fmt(d); }
  if (s === "yesterday") { const d = new Date(now); d.setDate(d.getDate()-1); return fmt(d); }
  const eom = new Date(now.getFullYear(), now.getMonth()+1, 0);
  if (s === "end of month" || s === "eom") return fmt(eom);
  const eow = new Date(now); eow.setDate(now.getDate() + (7 - now.getDay()) % 7 || 7);
  if (s === "end of week" || s === "this friday" || s === "friday") return fmt(eow);
  const nf = new Date(now); const daysUntilFri = (5 - now.getDay() + 7) % 7 || 7;
  nf.setDate(now.getDate() + (s === "next friday" ? daysUntilFri + 7 : daysUntilFri));
  if (s === "next friday") return fmt(nf);
  const m = s.match(/^in (\d+) (day|days|week|weeks|month|months)$/);
  if (m) {
    const d = new Date(now); const n = parseInt(m[1]);
    if (m[2].startsWith("day")) d.setDate(d.getDate()+n);
    else if (m[2].startsWith("week")) d.setDate(d.getDate()+n*7);
    else d.setMonth(d.getMonth()+n);
    return fmt(d);
  }
  // Try native parse as fallback
  const parsed = new Date(input);
  return isNaN(parsed) ? input : fmt(parsed);
}

export { parseSmartDate };

// ── Cross-tab record linking helper ───────────────────────────────────────────────
function getRelatedRecords(recordId, recordType, data) {
  const related = { tasks: [], invoices: [], events: [], leads: [], clients: [] };
  
  if (recordType === "lead") {
    // Find tasks assigned to this lead's contact
    const lead = (data.leads || []).find(l => l.id === recordId);
    if (lead) {
      related.tasks = (data.tasks || []).filter(t => 
        t.assigned === lead.name || t.project === lead.company || t.notes?.includes(lead.name)
      );
      related.invoices = (data.accounting || []).filter(i => 
        i.client === lead.company || i.client === lead.name
      );
      related.events = (data.calendar || []).filter(e => 
        e.assigned === lead.name || e.notes?.includes(lead.name)
      );
    }
  }
  
  if (recordType === "client") {
    const client = (data.clients || []).find(c => c.id === recordId);
    if (client) {
      related.tasks = (data.tasks || []).filter(t => 
        t.assigned === client.contact || t.project === client.name
      );
      related.invoices = (data.accounting || []).filter(i => 
        i.client === client.name
      );
      related.events = (data.calendar || []).filter(e => 
        e.assigned === client.contact || e.notes?.includes(client.name)
      );
      related.leads = (data.leads || []).filter(l => 
        l.company === client.name || l.name === client.contact
      );
    }
  }
  
  if (recordType === "task") {
    const task = (data.tasks || []).find(t => t.id === recordId);
    if (task) {
      related.leads = (data.leads || []).filter(l => 
        l.name === task.assigned || l.company === task.project
      );
      related.clients = (data.clients || []).filter(c => 
        c.contact === task.assigned || c.name === task.project
      );
    }
  }
  
  return related;
}

export { getRelatedRecords };

// ── Duplicate detection helper ───────────────────────────────────────────────────
function findPotentialDuplicates(data) {
  const duplicates = { leads: [], clients: [] };
  
  // Check for duplicate leads (same name or email)
  const leadMap = new Map();
  (data.leads || []).forEach(lead => {
    const key = (lead.name || "").toLowerCase().trim();
    const emailKey = (lead.email || "").toLowerCase().trim();
    
    if (key && leadMap.has(key)) {
      duplicates.leads.push({ id: lead.id, name: lead.name, reason: "Duplicate name", existingId: leadMap.get(key) });
    } else if (key) {
      leadMap.set(key, lead.id);
    }
    
    // Email check
    if (emailKey && emailKey.includes("@")) {
      const emailMap = leadMap.get("email:" + emailKey) || [];
      emailMap.push(lead.id);
      if (emailMap.length > 1) {
        duplicates.leads.push({ id: lead.id, name: lead.name, reason: "Duplicate email", count: emailMap.length });
      }
      leadMap.set("email:" + emailKey, emailMap);
    }
  });
  
  // Check for duplicate clients
  const clientMap = new Map();
  (data.clients || []).forEach(client => {
    const key = (client.name || "").toLowerCase().trim();
    const emailKey = (client.email || "").toLowerCase().trim();
    
    if (key && clientMap.has(key)) {
      duplicates.clients.push({ id: client.id, name: client.name, reason: "Duplicate name", existingId: clientMap.get(key) });
    } else if (key) {
      clientMap.set(key, client.id);
    }
    
    if (emailKey && emailKey.includes("@")) {
      const emailMap = clientMap.get("email:" + emailKey) || [];
      emailMap.push(client.id);
      if (emailMap.length > 1) {
        duplicates.clients.push({ id: client.id, name: client.name, reason: "Duplicate email", count: emailMap.length });
      }
      clientMap.set("email:" + emailKey, emailMap);
    }
  });
  
  return duplicates;
}

export { findPotentialDuplicates };

// ── Stale record detection helper ───────────────────────────────────────────────
function findStaleRecords(data) {
  const stale = { leads: [], tasks: [] };
  const now = Date.now();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  
  // Leads untouched for 14+ days
  (data.leads || []).forEach(lead => {
    if (["Won", "Lost"].includes(lead.status)) return;
    const lastUpdate = lead.updatedAt || lead.date;
    if (lastUpdate && (now - new Date(lastUpdate).getTime()) > fourteenDays) {
      stale.leads.push({ id: lead.id, name: lead.name, daysSinceUpdate: Math.floor((now - new Date(lastUpdate).getTime()) / (24 * 60 * 60 * 1000)) });
    }
  });
  
  // Tasks with no update in 7 days and not done
  (data.tasks || []).forEach(task => {
    if (task.status === "Done") return;
    const lastUpdate = task.updatedAt || task.due;
    if (lastUpdate && (now - new Date(lastUpdate).getTime()) > sevenDays) {
      stale.tasks.push({ id: task.id, title: task.title, daysSinceUpdate: Math.floor((now - new Date(lastUpdate).getTime()) / (24 * 60 * 60 * 1000)) });
    }
  });
  
  return stale;
}

export { findStaleRecords };

// ── Daily digest modal ────────────────────────────────────────────────────────
function DailyDigestModal({ dark, highContrast, data, onClose }) {
  const T = getTheme(dark, highContrast);
  const overdueTasks = (data.tasks || []).filter(t => t.status !== "Done" && t.due && new Date(t.due) < new Date()).length;
  const hotLeads = (data.leads || []).filter(l => !["Won","Lost"].includes(l.status)).length;
  const invoicesDue = (data.accounting || []).filter(i => i.status !== "Paid" && i.due && (() => { const d=(new Date(i.due)-new Date())/86400000; return d>=0&&d<=7; })()).length;
  const stats = [
    { icon: "◈", label: "Overdue Tasks", value: overdueTasks, color: overdueTasks > 0 ? "#ef4444" : "#16a34a" },
    { icon: "◎", label: "Hot Leads", value: hotLeads, color: "#d97706" },
    { icon: "◆", label: "Invoices Due This Week", value: invoicesDue, color: invoicesDue > 0 ? "#ef4444" : "#16a34a" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 28, width: 360, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", animation: "slideDown 0.2s ease" }}>
        <div style={{ fontSize: 22, marginBottom: 4 }}>☀️</div>
        <div style={{ fontWeight: 800, fontSize: 15, color: T.text, marginBottom: 4 }}>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}!</div>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 20 }}>Here's your day at a glance</div>
        {stats.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 8, background: T.hover, borderRadius: 9, borderLeft: `3px solid ${s.color}` }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ flex: 1, fontSize: 12, color: T.text }}>{s.label}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</span>
          </div>
        ))}
        <button onClick={onClose}
          style={{ width: "100%", marginTop: 16, padding: "9px 0", borderRadius: 8, background: B.accent, border: "none", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Let's go →
        </button>
      </div>
    </div>
  );
}

// ── Keyboard shortcuts overlay ────────────────────────────────────────────────
function ShortcutsOverlay({ dark, onClose }) {
  const T = getTheme(dark);
  const SECTIONS = [
    { title: "Navigation", items: [["⌘K", "Open command palette"], ["?", "Show this shortcut map"], ["Esc", "Close any overlay"]] },
    { title: "View", items: [["⌘\\", "Toggle sidebar"], ["⌘⇧F", "Toggle focus mode"], ["⌘⇧D", "Toggle dark mode"], ["⌘⇧S", "Toggle split view"]] },
    { title: "Quick Add", items: [["Via palette", "Add Lead / Client / Task / Invoice"]] },
    { title: "Palette Navigation", items: [["↑↓", "Move cursor"], ["↵", "Select item"], ["Esc", "Close palette"]] },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 28, width: 480, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", animation: "slideDown 0.15s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: T.text }}>Keyboard Shortcuts</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 16, padding: 0 }}>✕</button>
        </div>
        {SECTIONS.map(s => (
          <div key={s.title} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{s.title}</div>
            {s.items.map(([key, desc]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.text }}>{desc}</span>
                <kbd style={{ fontSize: 10, background: T.input, border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 8px", color: T.muted, fontFamily: "inherit" }}>{key}</kbd>
              </div>
            ))}
          </div>
        ))}
        <div style={{ fontSize: 10, color: T.muted, textAlign: "center", marginTop: 8 }}>Press <kbd style={{ fontSize: 10, background: T.input, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px" }}>?</kbd> anywhere to toggle this overlay</div>
      </div>
    </div>
  );
}

// ── Main app shell (inside provider) ─────────────────────────────────────────
function AppShell({ currentUser, onLogout, onRoleChange }) {
  const { data, setData, dispatch, notifications, unreadCount, presence, autoSaveStatus } = useAppData();

  // ← now uses the extracted hook (no inline duplicate)
  const { activeTab: tab, setActiveTab: setTab } = useTabSync("dashboard");

  const [viewMode, setViewMode] = usePersisted("crm_viewMode", "normal");
  const [search, setSearch] = useState("");
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersisted("crm_sidebarCollapsed", false);

  const [density, setDensity] = usePersisted("crm_density", 1); // 0=dense 1=compact 2=comfortable
  const [dark, setDark] = usePersisted("crm_dark", false);
  const [compact, setCompact] = usePersisted("crm_compact", false);
  const densityPad = [6, 10, 16][density] ?? 10;
  const densityFont = [11, 12, 13][density] ?? 12;
  const [focusMode, setFocusMode] = usePersisted("crm_focusMode", false);
  const [showPalette, setShowPalette] = useState(false);
  const [pomodoroActive, setPomodoroActive] = useState(false);
  const [pomodoroSecs, setPomodoroSecs] = useState(25 * 60);
  const [pomodoroBreak, setPomodoroBreak] = useState(false);
  const pomodoroRef = useRef(null);

  useEffect(() => {
    if (pomodoroActive) {
      pomodoroRef.current = setInterval(() => {
        setPomodoroSecs(s => {
          if (s <= 1) {
            clearInterval(pomodoroRef.current);
            const isBreak = !pomodoroBreak;
            setPomodoroBreak(isBreak);
            setPomodoroSecs(isBreak ? 5 * 60 : 25 * 60);
            setPomodoroActive(false);
            toast(isBreak ? "Break time! 5 minutes." : "Break over — back to work!", "success", 5000);
            return isBreak ? 5 * 60 : 25 * 60;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      clearInterval(pomodoroRef.current);
    }
    return () => clearInterval(pomodoroRef.current);
  }, [pomodoroActive]);

  const [showDailyDigest, setShowDailyDigest] = useState(() => {
    const last = localStorage.getItem("crm_digestDate");
    return last !== new Date().toDateString();
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [presencePopover, setPresencePopover] = useState(null);
  const [showStickyNote, setShowStickyNote] = useState(false);
  const [stickyNotes, setStickyNotes] = usePersisted("crm_stickyNotes", {});
  const [searchFocused, setSearchFocused] = useState(false);
  const [splitView, setSplitView] = usePersisted("crm_splitView", false);

  // Group collapse state
  const [collapsedGroups, setCollapsedGroups] = usePersisted("crm_collapsedGroups", {});
  const toggleGroup = (g) => setCollapsedGroups(prev => ({ ...prev, [g]: !prev[g] }));

  // Additional missing state variables
  const [tabTransDir, setTabTransDir] = useState(1);
  const [tabHistory, setTabHistory] = useState(["dashboard"]);
  const [contextMenu, setContextMenu] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [pinnedTabs, setPinnedTabs] = usePersisted("crm_pinnedTabs", []);
  const markRead = (id) => dispatch({ type: "MARK_READ", id });

  // User status
  const [userStatus, setUserStatus] = usePersisted("crm_userStatus", "Online");
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const STATUS_COLORS = { Online: "#4ade80", Away: "#f59e0b", Busy: "#ef4444", Offline: "#6b7280" };

  // Sidebar resize
  const [sidebarAccent, setSidebarAccent] = usePersisted("crm_sidebarAccent", null);
  const [unsavedTabs, setUnsavedTabs] = usePersisted("crm_unsavedTabs", {});
  const [highContrast, setHighContrast] = usePersisted("crm_highContrast", false);
  const T = getTheme(dark, highContrast);
  const [fontSize, setFontSize] = usePersisted("crm_fontSize", 0); // -1, 0, 1
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  // Expose a way for child tabs to mark themselves unsaved via window event
  useEffect(() => {
    const handler = (e) => {
      const { tabId, unsaved } = e.detail || {};
      if (tabId) setUnsavedTabs(prev => ({ ...prev, [tabId]: unsaved }));
    };
    window.addEventListener("crm:unsaved", handler);
    return () => window.removeEventListener("crm:unsaved", handler);
  }, []);
  // Clear unsaved flag when tab is saved (autoSaveStatus === "saved")
  useEffect(() => {
    if (autoSaveStatus === "saved") setUnsavedTabs(prev => ({ ...prev, [tab]: false }));
  }, [autoSaveStatus, tab]);
  const [recentTabs, setRecentTabs] = usePersisted("crm_recentTabs", []);

  // Track recently visited tabs
  useEffect(() => {
    setRecentTabs(prev => {
      const entry = { id: tab, ts: Date.now() };
      const filtered = prev.filter(r => r.id !== tab);
      return [entry, ...filtered].slice(0, 5);
    });
  }, [tab]);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const [tabLoading, setTabLoading] = useState(false);
  const tabLoadRef = useRef(null);
  useEffect(() => {
    setTabLoading(true);
    clearTimeout(tabLoadRef.current);
    tabLoadRef.current = setTimeout(() => setTabLoading(false), 280);
    return () => clearTimeout(tabLoadRef.current);
  }, [tab]);
  const prevTabIdxRef = useRef(0);
  const [tabHistoryIdx, setTabHistoryIdx] = useState(0);

  const navigateTo = useCallback((id) => {
    const newIdx = navItems.findIndex(n => n.id === id);
    const curIdx = navItems.findIndex(n => n.id === tab);
    setTabTransDir(newIdx >= curIdx ? 1 : -1);
    setTab(id);
    setTabHistory(prev => {
      const trimmed = prev.slice(0, tabHistoryIdx + 1);
      const next = [...trimmed, id].slice(-20);
      setTabHistoryIdx(next.length - 1);
      return next;
    });
  }, [tabHistoryIdx, setTab, tab]);

  const goBack = () => {
    if (tabHistoryIdx > 0) {
      const newIdx = tabHistoryIdx - 1;
      setTabHistoryIdx(newIdx);
      setTab(tabHistory[newIdx]);
    }
  };

  const goForward = () => {
    if (tabHistoryIdx < tabHistory.length - 1) {
      const newIdx = tabHistoryIdx + 1;
      setTabHistoryIdx(newIdx);
      setTab(tabHistory[newIdx]);
    }
  };
  const badges = useSidebarBadges(data);
  const duplicates = findPotentialDuplicates(data);
  const staleRecords = findStaleRecords(data);

  const role = currentUser.role;
  const visibleModules = getVisibleModules(role);
  const navItems = ALL_NAV.filter((n) => n.id === "dashboard" || visibleModules.includes(n.id));
  const activeTab = navItems.find((n) => n.id === tab) ? tab : "dashboard";

  // Browser history integration
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab && navItems.find(n => n.id === urlTab)) setTab(urlTab);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== activeTab) {
      const newUrl = `${window.location.pathname}?tab=${activeTab}`;
      window.history.pushState({ tab: activeTab }, "", newUrl);
    }
  }, [activeTab]);
  useEffect(() => {
    const onPop = (e) => { if (e.state?.tab) setTab(e.state.tab); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowPalette(p => !p); }
      if (e.key === "Escape") { setShowPalette(false); setContextMenu(null); setShowNotifs(false); setShowShortcuts(false); setPresencePopover(null); }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { setShowShortcuts(s => !s); }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setSidebarCollapsed(c => !c); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") { e.preventDefault(); setFocusMode(f => !f); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "D") { e.preventDefault(); setDark(d => !d); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "S") { e.preventDefault(); setSplitView(s => !s); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, []);



  const titles = {
    dashboard: "Dashboard", leads: "Leads", clients: "Ongoing Clients",
    tasks: "Tasks", accounting: "Accounting", inventory: "Inventory",
    suppliers: "Suppliers", calendar: "Calendar", analytics: "Analytics",
    reports: "Reports", automations: "Automations",
  };

  const legacyProps = { data, setData, viewMode, search };

  const handleNavContextMenu = (e, n) => {
    e.preventDefault();
    const menuW = 200, menuH = 160;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setContextMenu({ x, y, items: [
      { label: `▸  Open ${n.label}`, action: () => setTab(n.id), kbd: "↵" },
      { label: "◎  Open in focus mode", action: () => { setTab(n.id); setFocusMode(true); }, kbd: "⌘⇧F" },
      { label: "⧉  Open in split view", action: () => { setTab(n.id); setSplitView(true); }, kbd: "⌘⇧S" },
      { label: pinnedTabs.includes(n.id) ? "★  Unpin tab" : "☆  Pin tab", action: () => setPinnedTabs(prev => prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev.slice(0,2), n.id]) },
      { label: "─", disabled: true },
      { label: badges[n.id] ? `⚠  ${badges[n.id]} pending items` : "✓  No pending items", disabled: true },
    ]});
  };

  const handleGroupContextMenu = (e, group) => {
    e.preventDefault();
    const menuW = 220, menuH = 180;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    const bulkActions = [];
    
    if (group === "CRM") {
      bulkActions.push(
        { label: "Mark all leads as Won", action: () => { setData(prev => ({ ...prev, leads: (prev.leads || []).map(l => ({ ...l, status: "Won" })) })); toast("All leads marked as Won", "success"); } },
        { label: "Mark all tasks as Done", action: () => { setData(prev => ({ ...prev, tasks: (prev.tasks || []).map(t => ({ ...t, status: "Done" })) })); toast("All tasks marked as Done", "success"); } }
      );
    }
    if (group === "Finance") {
      bulkActions.push(
        { label: "Mark all invoices as Paid", action: () => { setData(prev => ({ ...prev, accounting: (prev.accounting || []).map(i => ({ ...i, status: "Paid" })) })); toast("All invoices marked as Paid", "success"); } }
      );
    }
    
    setContextMenu({ x, y, items: [
      { label: `Bulk actions for ${group}`, disabled: true },
      { label: "─", disabled: true },
      ...bulkActions,
      { label: "─", disabled: true },
      { label: "Cancel", action: () => {} },
    ]});
  };

  const renderTab = () => {
    if (activeTab !== "dashboard" && !can(role, activeTab, "view")) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8, color: T.muted }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Access restricted</div>
          <div style={{ fontSize: 13, color: T.muted }}>Your role ({role}) cannot view this module.</div>
        </div>
      );
    }
    const tabContent = (() => {
      switch (activeTab) {
        case "dashboard":   return <Dashboard dark={dark} search={search} />;
        case "leads":       return <LeadsTab viewMode={viewMode} search={search} />;
        case "clients":     return <ClientsTab viewMode={viewMode} search={search} />;
        case "accounting":  return <AccountingTab viewMode={viewMode} search={search} />;
        case "tasks":       return <TasksTab {...legacyProps} />;
        case "inventory":   return <InventoryTab {...legacyProps} />;
        case "suppliers":   return <SuppliersTab {...legacyProps} />;
        case "calendar":    return <CalendarTab {...legacyProps} />;
        case "analytics":   return <AnalyticsTab {...legacyProps} />;
        case "reports":     return <ReportsTab {...legacyProps} />;
        case "automations": return <AutomationsTab />;
        case "settings":    return (
          <SettingsTab
            dark={dark} setDark={setDark}
            compact={compact} setCompact={setCompact}
            highContrast={highContrast} setHighContrast={setHighContrast}
            density={density} setDensity={setDensity}
            fontSize={fontSize} setFontSize={setFontSize}
            sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed}
            sidebarAccent={sidebarAccent} setSidebarAccent={setSidebarAccent}
            focusMode={focusMode} setFocusMode={setFocusMode}
            splitView={splitView} setSplitView={setSplitView}
            viewMode={viewMode} setViewMode={setViewMode}
            currentUser={currentUser}
            onRoleChange={onRoleChange}
            data={data} setData={setData}
            navigateTo={navigateTo}
          />
        );
        default:            return null;
      }
    })();
    return <TabErrorBoundary key={activeTab}>{tabContent}</TabErrorBoundary>;
  };

  function exportCurrentTab() {
    const tabData = {
      leads: data.leads, clients: data.clients, tasks: data.tasks,
      accounting: data.accounting, inventory: data.inventory,
      suppliers: data.suppliers,
    }[activeTab];
    if (!tabData || !tabData.length) { toast("Nothing to export on this tab", "warning"); return; }
    const keys = Object.keys(tabData[0]);
    const csv = [keys.join(","), ...tabData.map(row => keys.map(k => JSON.stringify(row[k] ?? "")).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${activeTab}-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast(`Exported ${tabData.length} rows as CSV`, "success");
  }
  function markAll() { dispatch({ type: "MARK_ALL_READ", ids: notifications.map((n) => n.id) }); toast("All notifications marked as read", "success"); }
  function dismissNotif(id) { dispatch({ type: "DISMISS_NOTIF", id }); }
  function clearAllNotifs() { dispatch({ type: "CLEAR_ALL_NOTIFS" }); toast("All notifications cleared", "info"); }

  return (
    <div style={{ display: "flex", height: "100vh", background: T.bg, color: T.text, fontFamily: "'Inter', system-ui, sans-serif", fontSize: densityFont, overflow: "hidden", transition: "background 0.2s, color 0.2s" }}>

      {/* Daily digest */}
      {showDailyDigest && <DailyDigestModal dark={dark} data={data} onClose={() => { setShowDailyDigest(false); localStorage.setItem("crm_digestDate", new Date().toDateString()); }} />}

      {/* Shortcuts overlay */}
      {showShortcuts && <ShortcutsOverlay dark={dark} onClose={() => setShowShortcuts(false)} />}

      {/* Toast notifications */}
      <ToastContainer dark={dark} />

      {/* Command palette */}
      {showPalette && <CommandPalette navItems={navItems} onNavigate={(id) => { setTab(id); setShowPalette(false); }} onClose={() => setShowPalette(false)} dark={dark} setDark={setDark} compact={compact} setCompact={setCompact} focusMode={focusMode} setFocusMode={setFocusMode} splitView={splitView} setSplitView={setSplitView} viewMode={viewMode} setViewMode={setViewMode} sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed} onLogout={onLogout} autoSaveStatus={autoSaveStatus} data={data} />}

      {/* Context menu */}
      {contextMenu && (
        <div style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", zIndex: 9998, overflow: "hidden", minWidth: 180, animation: "fadeIn 0.1s ease" }}
          onClick={e => e.stopPropagation()}>
          {contextMenu.items.map((item, i) => (
            <div key={i} onClick={() => { if (!item.disabled) { item.action(); setContextMenu(null); } }}
              style={{ padding: "8px 14px", fontSize: 12, cursor: item.disabled ? "default" : "pointer", color: item.disabled ? T.muted : T.text, fontWeight: item.disabled ? 400 : 500, transition: "background 0.1s", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = T.hover; }}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span>{item.label}</span>
              {item.kbd && <kbd style={{ fontSize: 9, color: T.muted, background: T.input, borderRadius: 3, padding: "1px 5px", border: `1px solid ${T.border}` }}>{item.kbd}</kbd>}
            </div>
          ))}
        </div>
      )}

      {/* Sidebar overlay (mobile) */}
      <div className={`sidebar-overlay${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />

      {/* Sidebar */}
      {!focusMode && (
        <div className={`sidebar sidebar-drawer${drawerOpen ? " open" : ""}`} style={{
          width: sidebarCollapsed ? 54 : sidebarWidth,
          background: sidebarAccent ? `linear-gradient(180deg, ${sidebarAccent}ee 0%, ${sidebarAccent}cc 100%)` : T.sidebar,
          display: "flex", flexDirection: "column", flexShrink: 0,
          transition: resizingRef.current ? "none" : "width 0.22s cubic-bezier(0.4,0,0.2,1)",
          overflow: "hidden",
          boxShadow: "2px 0 16px rgba(0,0,0,0.15)",
          position: "relative",
        }}>
          {/* Resize handle */}
          {!sidebarCollapsed && (
            <div
              onMouseDown={e => {
                resizingRef.current = true;
                startXRef.current = e.clientX;
                startWRef.current = sidebarWidth;
                const onMove = ev => {
                  const delta = ev.clientX - startXRef.current;
                  const newW = Math.max(160, Math.min(320, startWRef.current + delta));
                  setSidebarWidth(newW);
                };
                const onUp = () => {
                  resizingRef.current = false;
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 10, background: "transparent" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              onMouseLeave={e => { if (!resizingRef.current) e.currentTarget.style.background = "transparent"; }}
            />
          )}
          {/* Logo */}
          <div style={{ padding: sidebarCollapsed ? "14px 0" : "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
              <div style={{ width: 28, height: 28, background: B.yellow, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}>☀</div>
              {!sidebarCollapsed && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fff", fontWeight: 800, fontSize: 10.5, letterSpacing: "0.8px", textTransform: "uppercase" }}>Yes Pinoy Pro</div>
                  <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 9, letterSpacing: "0.3px" }}>Business CRM · Dubai</div>
                </div>
              )}
              <button onClick={() => setDrawerOpen(false)} className="sidebar-close-btn"
                style={{ display: "none", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 16, cursor: "pointer", padding: 0 }}>✕</button>
            </div>
          </div>

          {/* Search hint */}
          {!sidebarCollapsed && (
            <button onClick={() => setShowPalette(true)}
              style={{ margin: "8px 10px 2px", padding: "6px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 7, display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: "rgba(255,255,255,0.38)", fontSize: 11, fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.10)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}>
              <span style={{ fontSize: 12 }}>⌕</span>
              <span style={{ flex: 1 }}>Search…</span>
              <kbd style={{ fontSize: 9, background: "rgba(255,255,255,0.1)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.3px" }}>⌘K</kbd>
            </button>
          )}

          {/* Pinned tabs */}
          {pinnedTabs.length > 0 && !sidebarCollapsed && (
            <div style={{ padding: "6px 14px 0" }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1.2px", color: "rgba(255,255,255,0.28)", textTransform: "uppercase", marginBottom: 3 }}>Pinned</div>
              {pinnedTabs.map(id => {
                const n = ALL_NAV.find(x => x.id === id);
                if (!n) return null;
                return (
                  <SideNavItem key={`pin-${id}`} n={n} active={activeTab === id} collapsed={false} badge={badges[id]} dark={dark} unsaved={!!unsavedTabs[id]} trend={badges.trends?.[id]}
                    onClick={() => { navigateTo(id); setDrawerOpen(false); }}
                    onContextMenu={(e) => handleNavContextMenu(e, n)}
                    onNavigate={(id) => { navigateTo(id); setDrawerOpen(false); }} />
                );
              })}
            </div>
          )}

          {/* Recently visited */}
          {recentTabs.length > 1 && !sidebarCollapsed && (
            <div style={{ padding: "4px 14px 0" }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "1.2px", color: "rgba(255,255,255,0.28)", textTransform: "uppercase", marginBottom: 3 }}>Recent</div>
              {recentTabs.slice(1, 4).map(r => {
                const n = ALL_NAV.find(x => x.id === r.id);
                if (!n) return null;
                const mins = Math.round((Date.now() - r.ts) / 60000);
                return (
                  <div key={`recent-${r.id}`} onClick={() => navigateTo(r.id)}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 6px", borderRadius: 6, cursor: "pointer", color: "rgba(255,255,255,0.42)", fontSize: 11, transition: "all 0.12s", margin: "1px 0" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.42)"; }}>
                    <span style={{ fontSize: 11 }}>{n.icon}</span>
                    <span style={{ flex: 1 }}>{n.label}</span>
                    <span style={{ fontSize: 9, opacity: 0.5 }}>{mins < 1 ? "now" : `${mins}m`}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nav items */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "6px 0 4px", scrollbarWidth: "none" }}>
            {navItems.filter(n => n.group === null).map(n => (
              <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} dark={dark} unsaved={!!unsavedTabs[n.id]} trend={badges.trends?.[n.id]}
                onClick={() => { navigateTo(n.id); setDrawerOpen(false); }}
                onContextMenu={(e) => handleNavContextMenu(e, n)}
                onNavigate={(id) => { navigateTo(id); setDrawerOpen(false); }} />
            ))}
            {["CRM", "Finance", "Ops"].map(group => {
              const items = navItems.filter(n => n.group === group);
              if (!items.length) return null;
              const isGroupCollapsed = collapsedGroups[group];
              return (
                <div key={group}>
                  {!sidebarCollapsed && (
                    <div onClick={() => toggleGroup(group)} onContextMenu={(e) => handleGroupContextMenu(e, group)}
                      style={{ padding: "12px 14px 3px", fontSize: 8.5, fontWeight: 700, letterSpacing: "1.2px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", userSelect: "none" }}
                      onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.65)"}
                      onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.35)"}>
                      <span>{group}</span>
                      <span style={{ fontSize: 8, transition: "transform 0.2s", display: "inline-block", transform: isGroupCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                    </div>
                  )}
                  {sidebarCollapsed && <div style={{ height: 8, borderTop: "1px solid rgba(255,255,255,0.06)", margin: "3px 8px" }} />}
                  {!isGroupCollapsed && items.map(n => (
                    <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} dark={dark} unsaved={!!unsavedTabs[n.id]} trend={badges.trends?.[n.id]}
                      onClick={() => { navigateTo(n.id); setDrawerOpen(false); }}
                      onContextMenu={(e) => handleNavContextMenu(e, n)}
                      onNavigate={(id) => { navigateTo(id); setDrawerOpen(false); }} />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Bottom */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            {!sidebarCollapsed && (
              <div style={{ padding: "10px 12px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0 8px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, border: "2px solid rgba(255,255,255,0.12)" }}>
                    {currentUser.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 1, position: "relative" }}>
                      <div onClick={() => setShowStatusPicker(s => !s)} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLORS[userStatus] }} />
                        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{userStatus} · {role}</span>
                      </div>
                      {showStatusPicker && (
                        <div style={{ position: "absolute", bottom: "120%", left: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999, minWidth: 120, overflow: "hidden" }}>
                          {Object.entries(STATUS_COLORS).map(([s, c]) => (
                            <div key={s} onClick={() => { setUserStatus(s); setShowStatusPicker(false); }}
                              style={{ padding: "7px 12px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, background: s === userStatus ? T.hover : "transparent", color: T.text }}
                              onMouseEnter={e => e.currentTarget.style.background = T.hover}
                              onMouseLeave={e => e.currentTarget.style.background = s === userStatus ? T.hover : "transparent"}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />{s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>Density</span>
                  <input type="range" min={0} max={2} step={1} value={density} onChange={e => setDensity(Number(e.target.value))}
                    style={{ flex: 1, accentColor: B.yellow, cursor: "pointer" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", minWidth: 60 }}>{["Dense","Compact","Comfort"][density]}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input type="color" value={sidebarAccent || "#1a2f4a"} onChange={e => setSidebarAccent(e.target.value)}
                    style={{ width: 22, height: 18, border: "none", borderRadius: 4, cursor: "pointer", padding: 0, background: "none" }} />
                  {sidebarAccent && <button onClick={() => setSidebarAccent(null)} style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>reset</button>}
                </div>

                <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                  {[["🌙", dark, () => setDark(d => !d), "Dark"], ["⚡", compact, () => setCompact(c => !c), "Compact"], ["◎", focusMode, () => setFocusMode(f => !f), "Focus"], ["⊞", viewMode === "excel", () => setViewMode(v => v === "excel" ? "normal" : "excel"), "Excel"], ["⧉", splitView, () => setSplitView(s => !s), "Split"], ["👁", highContrast, () => setHighContrast(h => !h), "Contrast"]].map(([icon, on, fn, tip]) => (
                    <button key={tip} onClick={fn} title={tip}
                      style={{ flex: 1, padding: "4px 2px", fontSize: 10, background: on ? "rgba(255,200,0,0.18)" : "rgba(255,255,255,0.06)", border: `1px solid ${on ? "rgba(255,200,0,0.35)" : "rgba(255,255,255,0.09)"}`, borderRadius: 6, color: on ? B.yellow : "rgba(255,255,255,0.4)", cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ fontSize: 11 }}>{icon}</span>
                      <span style={{ fontSize: 7.5, letterSpacing: "0.2px" }}>{tip}</span>
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>Font Size</span>
                  <button onClick={() => setFontSize(f => Math.max(-1, f - 1))} style={{ padding: "2px 6px", fontSize: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 4, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>-</button>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", minWidth: 30, textAlign: "center" }}>{fontSize === -1 ? "S" : fontSize === 1 ? "L" : "M"}</span>
                  <button onClick={() => setFontSize(f => Math.min(1, f + 1))} style={{ padding: "2px 6px", fontSize: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 4, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>+</button>
                </div>

                <button onClick={() => {
                    if (autoSaveStatus === "unsaved") {
                      if (!window.confirm("You have unsaved changes. Sign out anyway?")) return;
                    }
                    onLogout();
                  }}
                  style={{ width: "100%", padding: "5px 8px", fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 6, color: "rgba(255,255,255,0.38)", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px", transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,60,60,0.15)"; e.currentTarget.style.color = "#fca5a5"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}>
                  ⎋ Sign out
                </button>
              </div>
            )}

          </div>
          {/* Edge collapse arrow */}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)"}
            style={{ position: "absolute", top: "50%", right: -12, transform: "translateY(-50%)", width: 24, height: 24, borderRadius: "50%", background: T.surface, border: `1px solid ${T.border}`, color: T.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, zIndex: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.25)", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.transform = "translateY(-50%) scale(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = T.muted; e.currentTarget.style.transform = "translateY(-50%) scale(1)"; }}>
            {sidebarCollapsed ? "▶" : "◀"}
          </button>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
        <OfflineBanner />

        {/* Topbar */}
        <div style={{ height: compact ? 38 : 46, background: T.topbar, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "0 14px", gap: 8, flexShrink: 0, position: "relative", boxShadow: dark ? "none" : "0 1px 3px rgba(0,0,0,0.04)", transition: "background 0.2s, height 0.15s" }}>

          {/* Hamburger (mobile) */}
          <button className="hamburger-btn" onClick={() => setDrawerOpen(true)}
            style={{ display: "none", width: 30, height: 30, borderRadius: 6, background: T.input, border: `1px solid ${T.border}`, alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>
            ☰
          </button>

          {/* Tab history back/forward */}
          <button onClick={goBack} disabled={tabHistoryIdx <= 0} title="Go back"
            style={{ width: 26, height: 26, borderRadius: 6, background: T.input, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: tabHistoryIdx <= 0 ? "default" : "pointer", fontSize: 11, color: tabHistoryIdx <= 0 ? T.border : T.muted, flexShrink: 0, transition: "all 0.15s" }}>←</button>
          <button onClick={goForward} disabled={tabHistoryIdx >= tabHistory.length - 1} title="Go forward"
            style={{ width: 26, height: 26, borderRadius: 6, background: T.input, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: tabHistoryIdx >= tabHistory.length - 1 ? "default" : "pointer", fontSize: 11, color: tabHistoryIdx >= tabHistory.length - 1 ? T.border : T.muted, flexShrink: 0, transition: "all 0.15s" }}>→</button>

          {focusMode && (
            <button onClick={() => setFocusMode(false)} title="Exit focus mode"
              style={{ padding: "4px 10px", fontSize: 11, border: `1px solid ${T.border}`, background: T.input, borderRadius: 6, cursor: "pointer", color: T.muted, fontFamily: "inherit" }}>
              ◀ Exit focus
            </button>
          )}

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: compact ? 12 : 13, color: T.text, lineHeight: 1.2, whiteSpace: "nowrap" }}>
              {navItems.find(n => n.id === activeTab)?.group && (
                <>
                  <span style={{ color: T.muted, fontWeight: 500, cursor: "pointer", transition: "color 0.15s" }} onClick={() => {}} onMouseEnter={e => e.currentTarget.style.color = T.accent} onMouseLeave={e => e.currentTarget.style.color = T.muted}>{navItems.find(n => n.id === activeTab).group}</span>
                  <span style={{ color: T.muted, fontSize: 10 }}>›</span>
                </>
              )}
              <span>{titles[activeTab]}</span>
              {search && <span style={{ fontSize: 9, background: `${B.accent}22`, color: B.accent, borderRadius: 4, padding: "1px 6px", fontWeight: 600, border: `1px solid ${B.accent}44`, cursor: "pointer", marginLeft: 6 }} onClick={() => setSearch("")}>✕ filtered</span>}
            </div>
            {!compact && <div style={{ fontSize: 9.5, color: T.muted, letterSpacing: "0.2px" }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>}
          </div>

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div className="topbar-search"
            style={{ display: "flex", alignItems: "center", gap: 6, background: T.input, border: `1px solid ${searchFocused ? B.accent : T.border}`, borderRadius: 7, padding: "5px 10px", transition: "border-color 0.15s, box-shadow 0.15s", boxShadow: searchFocused ? `0 0 0 3px ${B.accent}20` : "none", cursor: "text" }}
            onClick={() => { if (!searchFocused) document.querySelector(".topbar-search input")?.focus(); }}>
            <span style={{ fontSize: 12, color: T.muted }}>⌕</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              placeholder="Search…"
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 12, color: T.text, width: 140, fontFamily: "inherit" }} />
            {search
              ? <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
              : <kbd style={{ fontSize: 9, color: T.muted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px" }}>⌘K</kbd>
            }
          </div>

          {/* Pomodoro timer */}
          {(pomodoroActive || pomodoroSecs !== 25 * 60) && (
            <div onClick={() => setPomodoroActive(a => !a)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 7, background: pomodoroBreak ? "#16a34a22" : "#ef444422", border: `1px solid ${pomodoroBreak ? "#16a34a44" : "#ef444444"}`, cursor: "pointer", flexShrink: 0 }}>
              <span style={{ fontSize: 10 }}>{pomodoroBreak ? "☕" : "🍅"}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: pomodoroBreak ? "#16a34a" : "#ef4444", fontVariantNumeric: "tabular-nums" }}>
                {String(Math.floor(pomodoroSecs / 60)).padStart(2,"0")}:{String(pomodoroSecs % 60).padStart(2,"0")}
              </span>
            </div>
          )}
          <button onClick={() => { setPomodoroActive(a => !a); setPomodoroBreak(false); if (pomodoroSecs === 25*60 && !pomodoroActive) toast("Pomodoro started — 25 min focus", "info"); }}
            title={pomodoroActive ? "Pause timer" : "Start focus timer (25 min)"}
            style={{ width: 26, height: 26, borderRadius: 6, background: pomodoroActive ? "#ef444418" : T.input, border: `1px solid ${pomodoroActive ? "#ef444444" : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
            {pomodoroActive ? "⏸" : "🍅"}
          </button>

          {/* Auto-save indicator */}
          <div title={autoSaveStatus} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: autoSaveStatus === "saved" ? B.green : autoSaveStatus === "saving" ? B.orange : T.muted }}>
            <style id="autosave-kf">{`@keyframes saving-spin { to { transform: rotate(360deg); } }`}</style>
            {autoSaveStatus === "saving"
              ? <div style={{ width: 8, height: 8, border: "1.5px solid transparent", borderTopColor: B.orange, borderRadius: "50%", animation: "saving-spin 0.7s linear infinite" }} />
              : <div style={{ width: 6, height: 6, borderRadius: "50%", background: autoSaveStatus === "saved" ? B.green : T.border, transition: "background 0.3s" }} />
            }
            {!compact && <span>{autoSaveStatus === "saved" ? "Saved" : autoSaveStatus === "saving" ? "Saving…" : "Unsaved"}</span>}
          </div>

          {/* Presence avatars */}
          {presence.length > 0 && (
            <>
              <style id="presence-kf">{`
                @keyframes presence-pop { 0%{opacity:0;transform:scale(0.6) translateY(4px)} 60%{transform:scale(1.08) translateY(-1px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
                @keyframes presence-online { 0%,100%{box-shadow:0 0 0 0px rgba(74,222,128,0.5)} 50%{box-shadow:0 0 0 3px rgba(74,222,128,0)} }
              `}</style>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {presence.slice(0, 5).map((p, i) => (
                  <div key={p.userId} title={`${p.name} · ${p.activeTab || "browsing"}`}
                    onClick={(e) => { e.stopPropagation(); setPresencePopover(presencePopover?.userId === p.userId ? null : p); }}
                    style={{ position: "relative", width: 26, height: 26, borderRadius: "50%", background: p.color || "#457B9D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", border: `2px solid ${T.topbar}`, marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i, cursor: "pointer", animation: `presence-pop 0.3s ease ${i * 0.06}s both` }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2) translateY(-2px)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                    {p.avatar || p.name?.[0]}
                    <span style={{ position: "absolute", bottom: -1, right: -1, width: 7, height: 7, borderRadius: "50%", background: "#4ade80", border: `1.5px solid ${T.topbar}`, animation: "presence-online 2s ease-in-out infinite" }} />
                  </div>
                ))}
                {presence.length > 5 && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: T.input, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: T.muted, fontWeight: 700, marginLeft: -8 }}>
                    +{presence.length - 5}
                  </div>
                )}
                <div style={{ marginLeft: 4, display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#4ade80", fontWeight: 700, background: "#4ade8015", borderRadius: 10, padding: "1px 6px", border: "1px solid #4ade8030" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                  LIVE
                </div>
                {/* Presence popover */}
                {presencePopover && (
                  <div style={{ position: "absolute", top: 44, right: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", boxShadow: "0 8px 28px rgba(0,0,0,0.18)", zIndex: 1001, minWidth: 200, animation: "fadeIn 0.12s ease" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: presencePopover.color || "#457B9D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff" }}>{presencePopover.avatar || presencePopover.name?.[0]}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{presencePopover.name}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>{presencePopover.role || "Team member"}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>Active tab: <span style={{ color: T.text, fontWeight: 600 }}>{presencePopover.activeTab || "browsing"}</span></div>
                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 10 }}>Online since: <span style={{ color: T.text }}>{presencePopover.since ? new Date(presencePopover.since).toLocaleTimeString() : "now"}</span></div>
                    {presencePopover.activeTab && (
                      <button onClick={() => { navigateTo(presencePopover.activeTab); setPresencePopover(null); }}
                        style={{ width: "100%", padding: "5px 0", fontSize: 11, background: `${B.accent}18`, border: `1px solid ${B.accent}44`, borderRadius: 6, cursor: "pointer", color: B.accent, fontWeight: 600, fontFamily: "inherit" }}>
                        Jump to their view →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Role picker */}
          <div className="topbar-role-picker" style={{ position: "relative" }}>
            <button onClick={() => setShowRolePicker(!showRolePicker)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", background: T.input, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: ROLE_COLORS[role], transition: "all 0.15s" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_COLORS[role] }} />{role} ▾
            </button>
            {showRolePicker && (
              <div style={{ position: "absolute", top: 36, right: 0, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", zIndex: 999, minWidth: 140, overflow: "hidden" }}>
                {ROLES.map((r) => (
                  <div key={r} onClick={() => { onRoleChange(r); setShowRolePicker(false); toast(`Role changed to ${r}`, "success"); }}
                    style={{ padding: "8px 14px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: r === role ? T.hover : "transparent", fontWeight: r === role ? 600 : 400, color: T.text, transition: "background 0.1s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.hover}
                    onMouseLeave={(e) => e.currentTarget.style.background = r === role ? T.hover : "transparent"}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_COLORS[r] }} />{r}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export */}
          {["leads","clients","tasks","accounting","inventory","suppliers"].includes(activeTab) && (
            <button onClick={exportCurrentTab} title="Export current view as CSV"
              style={{ width: 30, height: 30, borderRadius: 7, background: T.input, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: T.muted, flexShrink: 0, transition: "all 0.15s" }}>
              ⬇
            </button>
          )}

          {/* Sticky note */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowStickyNote(s => !s)} title={`Notes for ${titles[activeTab]}`}
              style={{ width: 30, height: 30, borderRadius: 7, background: showStickyNote || stickyNotes[activeTab] ? "#fde04733" : T.input, border: `1px solid ${showStickyNote || stickyNotes[activeTab] ? "#fde04788" : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, transition: "all 0.15s" }}>
              📌
            </button>
            {showStickyNote && (
              <div style={{ position: "absolute", top: 38, right: 0, width: 240, background: "#fffde7", border: "1px solid #fde047", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 1000, animation: "fadeIn 0.12s ease", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: "7px 10px", background: "#fde047", fontSize: 10, fontWeight: 700, letterSpacing: "0.4px", color: "#713f12", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>📌 {titles[activeTab]} Notes</span>
                  <button onClick={() => setShowStickyNote(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#713f12", padding: 0 }}>✕</button>
                </div>
                <textarea
                  value={stickyNotes[activeTab] || ""}
                  onChange={e => setStickyNotes(prev => ({ ...prev, [activeTab]: e.target.value }))}
                  placeholder="Jot down notes for this tab…"
                  style={{ width: "100%", height: 120, border: "none", outline: "none", padding: "10px", fontSize: 12, background: "transparent", resize: "none", fontFamily: "inherit", color: "#713f12", boxSizing: "border-box" }}
                />
                {stickyNotes[activeTab] && (
                  <div style={{ padding: "4px 10px 8px", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setStickyNotes(prev => { const n = {...prev}; delete n[activeTab]; return n; })} style={{ fontSize: 10, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Clear</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Split view toggle */}
          <button onClick={() => setSplitView(s => !s)} title="Split view (⌘⇧S)"
            style={{ width: 30, height: 30, borderRadius: 7, background: splitView ? `${B.accent}22` : T.input, border: `1px solid ${splitView ? B.accent : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, color: splitView ? B.accent : T.muted, transition: "all 0.15s" }}>
            ⧉
          </button>

          {/* Bell */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowNotifs(!showNotifs)}
              style={{ width: 30, height: 30, borderRadius: 7, background: T.input, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, position: "relative", transition: "all 0.15s" }}>
              🔔
              {unreadCount > 0 && (
                <div style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: B.red, color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </div>
              )}
            </button>
            {showNotifs && <NotifPanel notifications={notifications} onClose={() => setShowNotifs(false)} onMarkRead={markRead} onMarkAll={markAll} onDismiss={dismissNotif} onClearAll={clearAllNotifs} dark={dark} highContrast={highContrast} />}

          {/* Duplicate warnings badge */}
          {(duplicates.leads.length > 0 || duplicates.clients.length > 0) && (
            <div title={`${duplicates.leads.length} duplicate leads, ${duplicates.clients.length} duplicate clients`}
              style={{ width: 30, height: 30, borderRadius: 7, background: "#fef2f2", border: "1px solid #fecaca", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, position: "relative", transition: "all 0.15s" }}
              onClick={() => { toast(`${duplicates.leads.length} duplicate leads, ${duplicates.clients.length} duplicate clients found. Review them in Leads/Clients tabs.`, "warning"); }}>
              ⚠️
              <div style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: "#ef4444", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {duplicates.leads.length + duplicates.clients.length}
              </div>
            </div>
          )}

          {/* Stale records badge */}
          {(staleRecords.leads.length > 0 || staleRecords.tasks.length > 0) && (
            <div title={`${staleRecords.leads.length} stale leads, ${staleRecords.tasks.length} stale tasks`}
              style={{ width: 30, height: 30, borderRadius: 7, background: "#fffbeb", border: "1px solid #fde68a", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, position: "relative", transition: "all 0.15s" }}
              onClick={() => { toast(`${staleRecords.leads.length} stale leads, ${staleRecords.tasks.length} stale tasks need attention.`, "warning"); }}>
              🕐
              <div style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: "#f59e0b", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {staleRecords.leads.length + staleRecords.tasks.length}
              </div>
            </div>
          )}
          </div>

          {/* Avatar */}
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
            {currentUser.avatar}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div className="main-content-area page-pad" key={activeTab} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", padding: viewMode === "excel" ? 0 : densityPad, background: T.bg, transition: "background 0.2s", animation: "tabSlideIn 0.18s ease", "--tab-dir": `${tabTransDir * 18}px` }}>
            {tabLoading ? (
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <Skeleton h={28} w="40%" />
                <Skeleton h={14} w="70%" />
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  {[1,2,3].map(i => <Skeleton key={i} h={80} w="33%" radius={10} />)}
                </div>
                {[1,2,3,4,5].map(i => <Skeleton key={i} h={44} radius={8} style={{ opacity: 1 - i*0.15 }} />)}
              </div>
            ) : renderTab()}
          </div>
          {splitView && (
            <div className="split-panel" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${T.border}`, background: T.surface, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Quick Panel</span>
                <button onClick={() => setSplitView(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {/* Context-aware split panel */}
                {(activeTab === "dashboard" || activeTab === "tasks") && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Pending Tasks</div>
                    {(data.tasks || []).filter(t => t.status !== "Done").slice(0, 8).map(t => (
                      <div key={t.id} onClick={() => setTab("tasks")} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, cursor: "pointer", borderLeft: `3px solid ${t.priority === "High" ? B.red : t.priority === "Medium" ? B.orange : T.border}` }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text, marginBottom: 2 }}>{t.title}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>{t.assigned || "Unassigned"} · {t.due || "No due date"}</div>
                      </div>
                    ))}
                    {(data.tasks || []).filter(t => t.status !== "Done").length === 0 && <div style={{ fontSize: 11, color: T.muted }}>All caught up! 🎉</div>}
                  </div>
                )}
                {(activeTab === "dashboard" || activeTab === "leads") && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Recent Leads</div>
                    {(data.leads || []).slice(-5).reverse().map(l => (
                      <div key={l.id} onClick={() => setTab("leads")} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, cursor: "pointer" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{l.name}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>{l.status} · {l.value ? `AED ${l.value.toLocaleString()}` : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === "accounting" && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Overdue Invoices</div>
                    {(data.accounting || []).filter(i => i.status !== "Paid" && i.due && new Date(i.due) < new Date()).slice(0, 8).map(inv => (
                      <div key={inv.id} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, borderLeft: `3px solid ${B.red}` }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{inv.client || inv.id}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>AED {(inv.amount || 0).toLocaleString()} · Due {inv.due}</div>
                      </div>
                    ))}
                    {(data.accounting || []).filter(i => i.status !== "Paid" && i.due && new Date(i.due) < new Date()).length === 0 && <div style={{ fontSize: 11, color: T.muted }}>No overdue invoices ✓</div>}
                  </div>
                )}
                {activeTab === "inventory" && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Low Stock Items</div>
                    {(data.inventory || []).filter(i => i.status !== "In Stock").slice(0, 8).map(item => (
                      <div key={item.id} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, borderLeft: `3px solid ${B.orange}` }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>{item.status}</div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === "clients" && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Renewals Due Soon</div>
                    {(data.clients || []).filter(c => { if (!c.renewal) return false; const d = (new Date(c.renewal) - new Date()) / 86400000; return d >= 0 && d <= 30; }).slice(0, 8).map(c => (
                      <div key={c.id} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, borderLeft: `3px solid ${B.yellow}` }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{c.name}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>Renewal: {c.renewal}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(activeTab === "analytics" || activeTab === "reports") && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Quick Stats</div>
                    {[
                      { label: "Open Leads", value: (data.leads || []).filter(l => !["Won","Lost"].includes(l.status)).length },
                      { label: "Pending Tasks", value: (data.tasks || []).filter(t => t.status !== "Done").length },
                      { label: "Overdue Invoices", value: (data.accounting || []).filter(i => i.status !== "Paid" && i.due && new Date(i.due) < new Date()).length },
                    ].map(s => (
                      <div key={s.label} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: T.muted }}>{s.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(activeTab === "calendar" || activeTab === "automations" || activeTab === "suppliers") && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Pending Tasks</div>
                    {(data.tasks || []).filter(t => t.status !== "Done").slice(0, 5).map(t => (
                      <div key={t.id} onClick={() => setTab("tasks")} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, cursor: "pointer" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{t.title}</div>
                        <div style={{ fontSize: 10, color: T.muted }}>{t.due || "No due date"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <MobileBottomNav navItems={navItems} activeTab={activeTab} onTabChange={(id) => setTab(id)} />
      </div>

      {/* Close dropdowns on outside click */}
      {(showNotifs || showRolePicker) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 998 }}
          onClick={() => { setShowNotifs(false); setShowRolePicker(false); }} />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes tabSlideIn { from { opacity: 0; transform: translateX(var(--tab-dir, 18px)); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tabIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .main-content-area > * { }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        * { box-sizing: border-box; }
        .sidebar-nav-item:hover { background: rgba(255,255,255,0.07) !important; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
          outline: 2px solid #457B9D;
          outline-offset: 2px;
        }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.35); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.6); }
        .main-content-area { scrollbar-width: thin; }
        .mobile-bottom-nav { padding-bottom: env(safe-area-inset-bottom, 0px) !important; }
        @media (max-width: 768px) {
          .sidebar { display: none !important; }
          .sidebar-drawer.open { display: flex !important; position: fixed; top: 0; left: 0; bottom: 0; z-index: 900; }
          .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 899; }
          .sidebar-overlay.open { display: block; }
          .sidebar-close-btn { display: flex !important; }
          .mobile-bottom-nav { display: flex !important; }
          .main-content-area { padding-bottom: 70px !important; }
          .topbar-search { display: none; }
          .topbar-role-picker { display: none; }
          .hamburger-btn { display: flex !important; }
        }
        @media (max-width: 480px) {
          .page-pad { padding: 8px !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .topbar-search input { width: 110px !important; }
          .sidebar { width: 54px !important; }
        }
        @media (max-width: 768px) {
          .split-panel { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);

  function handleLogin(user) {
    setCurrentUser(user);
  }

  function handleLogout() {
    setCurrentUser(null);
  }

  function handleRoleChange(newRole) {
    setCurrentUser((u) => ({ ...u, role: newRole }));
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <EnterpriseErrorBoundary>
      <AppProvider initialData={INIT}>
        <AppShell
          currentUser={currentUser}
          onLogout={handleLogout}
          onRoleChange={handleRoleChange}
        />
      </AppProvider>
    </EnterpriseErrorBoundary>
  );
}
