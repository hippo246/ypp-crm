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

import { useState, useEffect, useRef } from "react";
import { B, INIT } from "./constants";
import { AppProvider, useAppData } from "./context/AppContext";
import { can, getVisibleModules } from "./services/permissions";
import LoginScreen from "./LoginScreen";
import "./mobile.css"; // ← NEW: global mobile responsiveness patch

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
];

const ROLE_COLORS = {
  Admin:       "#1D3557",
  Sales:       "#16A34A",
  Accountant:  "#D97706",
  Operations:  "#7C3AED",
};

const ROLES = ["Admin", "Sales", "Accountant", "Operations"];

// ── Theme tokens (light / dark) ────────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg: "#0f1117", surface: "#1a1d27", border: "#2a2d3a", text: "#e8eaf0",
    muted: "#6b7280", accent: "#5b9bd5", sidebar: "linear-gradient(180deg,#0d1520 0%,#0a1018 100%)",
    topbar: "#13161f", card: "#1e2130", input: "#252836", hover: "#252836",
  } : {
    bg: B.bg, surface: B.white, border: B.border, text: B.text,
    muted: B.muted, accent: B.accent, sidebar: "linear-gradient(180deg,#1a2f4a 0%,#152539 100%)",
    topbar: B.white, card: B.white, input: B.light, hover: B.light,
  };
}

// ── Command palette ────────────────────────────────────────────────────────────
function CommandPalette({ navItems, onNavigate, onClose, dark }) {
  const T = getTheme(dark);
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const NAV_CMDS = navItems.map(n => ({ label: n.label, icon: n.icon, action: () => onNavigate(n.id), group: "Navigate" }));
  const ALL_CMDS = [
    ...NAV_CMDS,
    { label: "Toggle dark mode", icon: "🌙", action: () => { onClose(); }, group: "Settings" },
    { label: "Toggle compact mode", icon: "⚡", action: () => { onClose(); }, group: "Settings" },
    { label: "Toggle focus mode", icon: "◎", action: () => { onClose(); }, group: "Settings" },
    { label: "Add Task", icon: "✚", action: () => { onNavigate("tasks"); onClose(); }, group: "Quick Add" },
    { label: "Add Lead", icon: "✚", action: () => { onNavigate("leads"); onClose(); }, group: "Quick Add" },
    { label: "Add Client", icon: "✚", action: () => { onNavigate("clients"); onClose(); }, group: "Quick Add" },
    { label: "Add Invoice", icon: "✚", action: () => { onNavigate("accounting"); onClose(); }, group: "Quick Add" },
  ];
  const filtered = q ? ALL_CMDS.filter(c => c.label.toLowerCase().includes(q.toLowerCase())) : ALL_CMDS;
  const groups = [...new Set(filtered.map(c => c.group))];

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px) saturate(150%)", WebkitBackdropFilter: "blur(8px) saturate(150%)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: 560, background: dark ? "rgba(26,29,39,0.95)" : "rgba(255,255,255,0.96)", borderRadius: 16, boxShadow: "0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)", overflow: "hidden", border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, animation: "slideDown 0.15s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 16, color: T.muted }}>⌕</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleKey}
            placeholder="Type a command or search…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", color: T.text, fontFamily: "inherit" }} />
          <kbd style={{ fontSize: 10, color: T.muted, background: T.input, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 6px" }}>esc</kbd>
        </div>
        <div style={{ maxHeight: 380, overflowY: "auto", padding: "6px 0" }}>
          {groups.map(group => (
            <div key={group}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", color: T.muted, padding: "8px 16px 4px", textTransform: "uppercase" }}>{group}</div>
              {filtered.filter(c => c.group === group).map((c, i) => (
                <div key={i} onClick={() => { c.action(); onClose(); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", cursor: "pointer", color: T.text, fontSize: 13, transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.hover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 14, width: 20, textAlign: "center", opacity: 0.7 }}>{c.icon}</span>
                  {c.label}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: "24px 16px", textAlign: "center", color: T.muted, fontSize: 13 }}>No results for "{q}"</div>}
        </div>
      </div>
    </div>
  );
}

// ── Hover preview card ─────────────────────────────────────────────────────────
function NavHoverCard({ n, badges, T }) {
  const TIPS = { dashboard: "Overview & KPIs", leads: "Pipeline & prospects", clients: "Active accounts", tasks: "Work & assignments", accounting: "Invoices & payments", inventory: "Stock levels", suppliers: "Vendor management", calendar: "Schedule & deadlines", analytics: "Charts & trends", reports: "Exports & summaries", automations: "Workflow rules" };
  return (
    <div style={{ position: "absolute", left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 200, whiteSpace: "nowrap", pointerEvents: "none", minWidth: 160 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: T.text, marginBottom: 2 }}>{n.label}</div>
      <div style={{ fontSize: 11, color: T.muted }}>{TIPS[n.id] || ""}</div>
      {badges?.[n.id] > 0 && <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: B.orange }}>{badges[n.id]} pending</div>}
    </div>
  );
}

// ── Notification panel ────────────────────────────────────────────────────────
function NotifPanel({ notifications, onClose, onMarkRead, onMarkAll, dark }) {
  const T = getTheme(dark);
  const SCOLOR = { high: B.red, medium: B.orange, low: B.muted };
  return (
    <div style={{
      position: "absolute", top: 50, right: 0, width: 360, maxHeight: 480,
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      boxShadow: "0 12px 40px rgba(0,0,0,0.18)", zIndex: 1000,
      display: "flex", flexDirection: "column", overflow: "hidden",
      animation: "fadeIn 0.15s ease",
    }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>Notifications</span>
          {notifications.filter(n => !n.read).length > 0 && <span style={{ marginLeft: 8, fontSize: 10, background: B.red, color: "#fff", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>{notifications.filter(n => !n.read).length}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={onMarkAll} style={{ fontSize: 11, color: B.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Mark all read</button>
          <button onClick={onClose} style={{ fontSize: 16, color: T.muted, background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {notifications.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: T.muted, fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
            All clear! No notifications.
          </div>
        )}
        {notifications.map((n) => (
          <div key={n.id} onClick={() => onMarkRead(n.id)}
            style={{
              padding: "11px 16px", borderBottom: `1px solid ${T.border}`,
              background: n.read ? "transparent" : (dark ? "rgba(93,130,200,0.08)" : "#F0F7FF"),
              cursor: "pointer", transition: "background 0.12s", display: "flex", gap: 10, alignItems: "flex-start",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = T.hover}
            onMouseLeave={(e) => e.currentTarget.style.background = n.read ? "transparent" : (dark ? "rgba(93,130,200,0.08)" : "#F0F7FF")}
          >
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: SCOLOR[n.severity], flexShrink: 0, marginTop: 4 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2 }}>{n.title}</div>
              <div style={{ fontSize: 11, color: T.muted }}>{n.body}</div>
              {n.timestamp && (
                <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>
                  {new Date(n.timestamp).toLocaleString()}
                </div>
              )}
            </div>
            {!n.read && <div style={{ width: 6, height: 6, borderRadius: "50%", background: B.accent, flexShrink: 0, marginTop: 4 }} />}
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
  return { leads: openLeads, tasks: pendingTasks, accounting: overdueInvoices, inventory: lowStock, clients: expiringClients };
}

// ── Sidebar nav item ──────────────────────────────────────────────────────────
function SideNavItem({ n, active, collapsed, badge, onClick, onContextMenu, dark = false }) {
  const T = getTheme(dark);
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={onClick} onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? n.label : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: collapsed ? "9px 0" : "7px 14px",
        justifyContent: collapsed ? "center" : "flex-start",
        cursor: "pointer",
        color: active ? "#fff" : hovered ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.50)",
        background: active ? "rgba(255,255,255,0.10)" : hovered ? "rgba(255,255,255,0.05)" : "transparent",
        borderLeft: collapsed ? "none" : `2px solid ${active ? B.yellow : "transparent"}`,
        fontSize: 12, fontWeight: active ? 600 : 400,
        transition: "all 0.12s",
        position: "relative",
      }}>
      <span style={{ fontSize: 13, flexShrink: 0, opacity: active ? 1 : 0.72 }}>{n.icon}</span>
      {!collapsed && <span style={{ flex: 1, letterSpacing: "0.1px" }}>{n.label}</span>}
      {!collapsed && badge > 0 && (
        <span style={{ fontSize: 9, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8, background: n.id === "accounting" ? "#ef4444" : B.yellow, color: n.id === "accounting" ? "#fff" : "#1a2f4a", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", flexShrink: 0 }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {collapsed && badge > 0 && (
        <span style={{ position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: "50%", background: n.id === "accounting" ? "#ef4444" : B.yellow }} />
      )}
      {collapsed && hovered && <NavHoverCard n={n} badges={{ [n.id]: badge }} T={T} />}
    </div>
  );
}

// ── Main app shell (inside provider) ─────────────────────────────────────────
function AppShell({ currentUser, onLogout, onRoleChange }) {
  const { data, setData, dispatch, notifications, unreadCount, presence, autoSaveStatus } = useAppData();

  // ← now uses the extracted hook (no inline duplicate)
  const { activeTab: tab, setActiveTab: setTab } = useTabSync("dashboard");

  const [viewMode, setViewMode] = useState("normal");
  const [search, setSearch] = useState("");
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [splitView, setSplitView] = useState(false);

  const T = getTheme(dark);
  const badges = useSidebarBadges(data);

  const role = currentUser.role;
  const visibleModules = getVisibleModules(role);
  const navItems = ALL_NAV.filter((n) => n.id === "dashboard" || visibleModules.includes(n.id));
  const activeTab = navItems.find((n) => n.id === tab) ? tab : "dashboard";

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowPalette(p => !p); }
      if (e.key === "Escape") { setShowPalette(false); setContextMenu(null); setShowNotifs(false); }
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

  useEffect(() => {
    document.body.style.background = T.bg;
    document.body.style.colorScheme = dark ? "dark" : "light";
  }, [dark, T.bg]);

  const titles = {
    dashboard: "Dashboard", leads: "Leads", clients: "Ongoing Clients",
    tasks: "Tasks", accounting: "Accounting", inventory: "Inventory",
    suppliers: "Suppliers", calendar: "Calendar", analytics: "Analytics",
    reports: "Reports", automations: "Automations",
  };

  const legacyProps = { data, setData, viewMode, search };

  const handleNavContextMenu = (e, n) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items: [
      { label: `▸  Open ${n.label}`, action: () => setTab(n.id), kbd: "↵" },
      { label: "◎  Open in focus mode", action: () => { setTab(n.id); setFocusMode(true); }, kbd: "⌘⇧F" },
      { label: "⧉  Open in split view", action: () => { setTab(n.id); setSplitView(true); }, kbd: "⌘⇧S" },
      { label: "─", disabled: true },
      { label: badges[n.id] ? `⚠  ${badges[n.id]} pending items` : "✓  No pending items", disabled: true },
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
    switch (activeTab) {
      case "dashboard":   return <Dashboard />;
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
      default:            return null;
    }
  };

  function markRead(id) { dispatch({ type: "MARK_NOTIF_READ", id }); }
  function markAll() { dispatch({ type: "MARK_ALL_READ", ids: notifications.map((n) => n.id) }); }

  return (
    <div
      style={{ display: "flex", height: "100vh", width: "100%", overflow: "hidden", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: compact ? 12 : 13, color: T.text, background: T.bg, transition: "background 0.2s, color 0.2s" }}>

      {/* Command palette */}
      {showPalette && <CommandPalette navItems={navItems} onNavigate={(id) => { setTab(id); setShowPalette(false); }} onClose={() => setShowPalette(false)} dark={dark} />}

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
          width: sidebarCollapsed ? 54 : 216,
          background: T.sidebar,
          display: "flex", flexDirection: "column", flexShrink: 0,
          transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
          overflow: "hidden",
          boxShadow: "2px 0 16px rgba(0,0,0,0.15)",
        }}>
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

          {/* Nav items */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "6px 0 4px", scrollbarWidth: "none" }}>
            {navItems.filter(n => n.group === null).map(n => (
              <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} dark={dark}
                onClick={() => { setTab(n.id); setDrawerOpen(false); }}
                onContextMenu={(e) => handleNavContextMenu(e, n)} />
            ))}
            {["CRM", "Finance", "Ops"].map(group => {
              const items = navItems.filter(n => n.group === group);
              if (!items.length) return null;
              return (
                <div key={group}>
                  {!sidebarCollapsed && (
                    <div style={{ padding: "12px 14px 3px", fontSize: 8.5, fontWeight: 700, letterSpacing: "1.2px", color: "rgba(255,255,255,0.22)", textTransform: "uppercase" }}>{group}</div>
                  )}
                  {sidebarCollapsed && <div style={{ height: 8, borderTop: "1px solid rgba(255,255,255,0.06)", margin: "3px 8px" }} />}
                  {items.map(n => (
                    <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} dark={dark}
                      onClick={() => { setTab(n.id); setDrawerOpen(false); }}
                      onContextMenu={(e) => handleNavContextMenu(e, n)} />
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
                    <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 1 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />
                      <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{role}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                  {[["🌙", dark, () => setDark(d => !d), "Dark"], ["⚡", compact, () => setCompact(c => !c), "Compact"], ["◎", focusMode, () => setFocusMode(f => !f), "Focus"], ["⊞", viewMode === "excel", () => setViewMode(v => v === "excel" ? "normal" : "excel"), "Excel"], ["⧉", splitView, () => setSplitView(s => !s), "Split"]].map(([icon, on, fn, tip]) => (
                    <button key={tip} onClick={fn} title={tip}
                      style={{ flex: 1, padding: "5px 0", fontSize: 12, background: on ? "rgba(255,200,0,0.18)" : "rgba(255,255,255,0.06)", border: `1px solid ${on ? "rgba(255,200,0,0.35)" : "rgba(255,255,255,0.09)"}`, borderRadius: 6, color: on ? B.yellow : "rgba(255,255,255,0.4)", cursor: "pointer", transition: "all 0.15s" }}>
                      {icon}
                    </button>
                  ))}
                </div>

                <button onClick={onLogout}
                  style={{ width: "100%", padding: "5px 8px", fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 6, color: "rgba(255,255,255,0.38)", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px", transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,60,60,0.15)"; e.currentTarget.style.color = "#fca5a5"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}>
                  ⎋ Sign out
                </button>
              </div>
            )}

            <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{ width: "100%", padding: compact ? "6px 0" : "7px 0", fontSize: 11, background: "rgba(0,0,0,0.15)", border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; e.currentTarget.style.background = "rgba(0,0,0,0.28)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.28)"; e.currentTarget.style.background = "rgba(0,0,0,0.15)"; }}>
              {sidebarCollapsed ? "▶" : "◀"}
            </button>
          </div>
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

          {focusMode && (
            <button onClick={() => setFocusMode(false)} title="Exit focus mode"
              style={{ padding: "4px 10px", fontSize: 11, border: `1px solid ${T.border}`, background: T.input, borderRadius: 6, cursor: "pointer", color: T.muted, fontFamily: "inherit" }}>
              ◀ Exit focus
            </button>
          )}

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: compact ? 12 : 13, color: T.text, lineHeight: 1.2, whiteSpace: "nowrap" }}>{titles[activeTab]}</div>
            {!compact && <div style={{ fontSize: 9.5, color: T.muted, letterSpacing: "0.2px" }}>{navItems.find(n => n.id === activeTab)?.group ? `${navItems.find(n => n.id === activeTab).group} · ` : ""}{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>}
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
                    style={{ position: "relative", width: 26, height: 26, borderRadius: "50%", background: p.color || "#457B9D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", border: `2px solid ${T.topbar}`, marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i, cursor: "default", animation: `presence-pop 0.3s ease ${i * 0.06}s both` }}
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
                  <div key={r} onClick={() => { onRoleChange(r); setShowRolePicker(false); }}
                    style={{ padding: "8px 14px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: r === role ? T.hover : "transparent", fontWeight: r === role ? 600 : 400, color: T.text, transition: "background 0.1s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = T.hover}
                    onMouseLeave={(e) => e.currentTarget.style.background = r === role ? T.hover : "transparent"}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_COLORS[r] }} />{r}
                  </div>
                ))}
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
            {showNotifs && <NotifPanel notifications={notifications} onClose={() => setShowNotifs(false)} onMarkRead={markRead} onMarkAll={markAll} dark={dark} />}
          </div>

          {/* Avatar */}
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
            {currentUser.avatar}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <div className="main-content-area page-pad" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: activeTab === "leads" || activeTab === "clients" ? "hidden" : "auto", padding: viewMode === "excel" ? 0 : compact ? 10 : 16, background: T.bg, transition: "background 0.2s" }}>
            {renderTab()}
          </div>
          {splitView && (
            <div className="split-panel" style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${T.border}`, background: T.surface, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Quick Panel</span>
                <button onClick={() => setSplitView(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
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
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.6px", textTransform: "uppercase", marginBottom: 8 }}>Recent Leads</div>
                  {(data.leads || []).slice(-5).reverse().map(l => (
                    <div key={l.id} onClick={() => setTab("leads")} style={{ padding: "7px 10px", marginBottom: 4, background: T.hover, borderRadius: 7, cursor: "pointer" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{l.name}</div>
                      <div style={{ fontSize: 10, color: T.muted }}>{l.status} · {l.value ? `AED ${l.value.toLocaleString()}` : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {!focusMode && <MobileBottomNav navItems={navItems} activeTab={activeTab} onTabChange={(id) => setTab(id)} />}
      </div>

      {/* Close dropdowns on outside click */}
      {(showNotifs || showRolePicker) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 998 }}
          onClick={() => { setShowNotifs(false); setShowRolePicker(false); }} />
      )}

      {/* CSS animations */}
      <style>{`
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
    <AppProvider initialData={INIT}>
      <AppShell
        currentUser={currentUser}
        onLogout={handleLogout}
        onRoleChange={handleRoleChange}
      />
    </AppProvider>
  );
}
