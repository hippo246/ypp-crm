import { useState } from "react";
import { B, INIT } from "./constants";
import { AppProvider, useAppData } from "./context/AppContext";
import { can, getVisibleModules } from "./services/permissions";
import LoginScreen from "./LoginScreen";

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

// ── Notification panel ────────────────────────────────────────────────────────
function NotifPanel({ notifications, onClose, onMarkRead, onMarkAll }) {
  const SCOLOR = { high: B.red, medium: B.orange, low: B.muted };
  return (
    <div style={{
      position: "absolute", top: 50, right: 10, width: 340, maxHeight: 460,
      background: B.white, border: `1px solid ${B.border}`, borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 1000,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Notifications</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={onMarkAll} style={{ fontSize: 11, color: B.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Mark all read</button>
          <button onClick={onClose} style={{ fontSize: 16, color: B.muted, background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {notifications.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: B.muted, fontSize: 13 }}>All clear! No notifications.</div>
        )}
        {notifications.map((n) => (
          <div key={n.id} onClick={() => onMarkRead(n.id)}
            style={{
              padding: "10px 14px", borderBottom: `1px solid ${B.border}`,
              background: n.read ? "transparent" : "#F0F7FF",
              cursor: "pointer", transition: "background 0.1s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#F8FAFC"}
            onMouseLeave={(e) => e.currentTarget.style.background = n.read ? "transparent" : "#F0F7FF"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: SCOLOR[n.severity], flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: B.text, flex: 1 }}>{n.title}</span>
              {!n.read && <div style={{ width: 6, height: 6, borderRadius: "50%", background: B.accent, flexShrink: 0 }} />}
            </div>
            <div style={{ fontSize: 11, color: B.muted, paddingLeft: 12 }}>{n.body}</div>
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
function SideNavItem({ n, active, collapsed, badge, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? n.label : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: collapsed ? "9px 0" : "8px 14px",
        justifyContent: collapsed ? "center" : "flex-start",
        cursor: "pointer",
        color: active ? "#fff" : hovered ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.52)",
        background: active ? "rgba(255,255,255,0.11)" : hovered ? "rgba(255,255,255,0.055)" : "transparent",
        borderLeft: collapsed ? "none" : `3px solid ${active ? B.yellow : "transparent"}`,
        borderRight: collapsed ? `3px solid ${active ? B.yellow : "transparent"}` : "none",
        fontSize: 12, fontWeight: active ? 700 : 400,
        transition: "all 0.13s",
        position: "relative",
      }}>
      <span style={{ fontSize: 13, flexShrink: 0, opacity: active ? 1 : 0.75 }}>{n.icon}</span>
      {!collapsed && <span style={{ flex: 1, letterSpacing: "0.1px" }}>{n.label}</span>}
      {!collapsed && badge > 0 && (
        <span style={{ fontSize: 9, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8, background: n.id === "accounting" ? "#ef4444" : B.yellow, color: n.id === "accounting" ? "#fff" : "#1a2f4a", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", flexShrink: 0 }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {collapsed && badge > 0 && (
        <span style={{ position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: "50%", background: n.id === "accounting" ? "#ef4444" : B.yellow }} />
      )}
    </div>
  );
}

// ── Main app (inside provider) ────────────────────────────────────────────────
function AppShell({ currentUser, onLogout, onRoleChange }) {
  const { data, setData, dispatch, notifications, unreadCount, presence, autoSaveStatus, versionHistory } = useAppData();
  const [tab, setTab] = useState("dashboard");
  const [viewMode, setViewMode] = useState("normal");
  const [search, setSearch] = useState("");
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const badges = useSidebarBadges(data);

  const role = currentUser.role;
  const visibleModules = getVisibleModules(role);
  const navItems = ALL_NAV.filter((n) => n.id === "dashboard" || visibleModules.includes(n.id));

  // If current tab got hidden by role change, reset to dashboard
  const activeTab = navItems.find((n) => n.id === tab) ? tab : "dashboard";

  const titles = {
    dashboard: "Dashboard", leads: "Leads", clients: "Ongoing Clients",
    tasks: "Tasks", accounting: "Accounting", inventory: "Inventory",
    suppliers: "Suppliers", calendar: "Calendar", analytics: "Analytics", reports: "Reports",
    automations: "Automations",
  };

  const legacyProps = { data, setData, viewMode, search };

  const renderTab = () => {
    if (activeTab !== "dashboard" && !can(role, activeTab, "view")) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8, color: B.muted }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: B.text }}>Access restricted</div>
          <div style={{ fontSize: 13 }}>Your role ({role}) cannot view this module.</div>
        </div>
      );
    }
    switch (activeTab) {
      case "dashboard":  return <Dashboard />;
      case "leads":      return <LeadsTab viewMode={viewMode} search={search} />;
      case "clients":    return <ClientsTab viewMode={viewMode} search={search} />;
      case "accounting": return <AccountingTab viewMode={viewMode} search={search} />;
      case "tasks":      return <TasksTab {...legacyProps} />;
      case "inventory":  return <InventoryTab {...legacyProps} />;
      case "suppliers":  return <SuppliersTab {...legacyProps} />;
      case "calendar":   return <CalendarTab {...legacyProps} />;
      case "analytics":  return <AnalyticsTab {...legacyProps} />;
      case "reports":    return <ReportsTab {...legacyProps} />;
      case "automations": return <AutomationsTab />;
      default:           return null;
    }
  };

  function markRead(id) {
    dispatch({ type: "MARK_NOTIF_READ", id });
  }

  function markAll() {
    dispatch({ type: "MARK_ALL_READ", ids: notifications.map((n) => n.id) });
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", overflow: "hidden", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 13, color: B.text, background: B.bg }}>
      {/* Mobile overlay */}
      <div className={`sidebar-overlay${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />

      {/* Sidebar — desktop: static, mobile: drawer */}
      <div className={`sidebar sidebar-drawer${drawerOpen ? " open" : ""}`} style={{
        width: sidebarCollapsed ? 56 : 220,
        background: "linear-gradient(180deg, #1a2f4a 0%, #152539 100%)",
        display: "flex", flexDirection: "column", flexShrink: 0,
        transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
        overflow: "hidden",
        boxShadow: "2px 0 12px rgba(0,0,0,0.18)",
      }}>
        {/* Logo row */}
        <div style={{ padding: sidebarCollapsed ? "14px 0" : "14px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: sidebarCollapsed ? "center" : "flex-start" }}>
            <div style={{ width: 30, height: 30, background: B.yellow, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}>☀</div>
            {!sidebarCollapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 11, letterSpacing: "0.8px", textTransform: "uppercase" }}>Yes Pinoy Pro</div>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 9.5, letterSpacing: "0.3px" }}>Business CRM · Dubai</div>
              </div>
            )}
            {!sidebarCollapsed && (
              <button onClick={() => setDrawerOpen(false)} style={{ display: "none", background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", padding: 0 }} className="sidebar-close-btn">✕</button>
            )}
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "10px 0", scrollbarWidth: "none" }}>
          {/* Dashboard (ungrouped) */}
          {navItems.filter(n => n.group === null).map(n => (
            <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} onClick={() => { setTab(n.id); setDrawerOpen(false); }} />
          ))}

          {/* Grouped sections */}
          {["CRM", "Finance", "Ops"].map(group => {
            const items = navItems.filter(n => n.group === group);
            if (!items.length) return null;
            return (
              <div key={group}>
                {!sidebarCollapsed && (
                  <div style={{ padding: "14px 14px 4px", fontSize: 9, fontWeight: 700, letterSpacing: "1.2px", color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>
                    {group}
                  </div>
                )}
                {sidebarCollapsed && <div style={{ height: 10, borderTop: "1px solid rgba(255,255,255,0.07)", margin: "4px 8px" }} />}
                {items.map(n => (
                  <SideNavItem key={n.id} n={n} active={activeTab === n.id} collapsed={sidebarCollapsed} badge={badges[n.id]} onClick={() => { setTab(n.id); setDrawerOpen(false); }} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Bottom section */}
        {!sidebarCollapsed && (
          <div style={{ padding: "10px 12px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {/* User card */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0 10px" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, border: "2px solid rgba(255,255,255,0.15)" }}>
                {currentUser.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />
                  <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 9.5 }}>{role}</span>
                </div>
              </div>
            </div>
            {/* View mode toggle */}
            <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: 7, padding: 2, gap: 2, marginBottom: 8 }}>
              {[["normal","▣ Cards"],["excel","⊞ Excel"]].map(([m, lbl]) => (
                <button key={m} onClick={() => setViewMode(m)} style={{ flex: 1, padding: "5px 4px", fontSize: 10, fontWeight: 700, border: "none", borderRadius: 5, cursor: "pointer", fontFamily: "inherit", background: viewMode === m ? B.yellow : "transparent", color: viewMode === m ? "#1a2f4a" : "rgba(255,255,255,0.45)", transition: "all 0.15s", letterSpacing: "0.2px" }}>
                  {lbl}
                </button>
              ))}
            </div>
            <button onClick={onLogout} style={{ width: "100%", padding: "6px 8px", fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "rgba(255,255,255,0.45)", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px", marginBottom: 10, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}>
              ⎋ Sign out
            </button>
          </div>
        )}

        {/* Collapse toggle */}
        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{ width: "100%", padding: "8px 0", fontSize: 12, background: "rgba(0,0,0,0.2)", border: "none", borderTop: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; e.currentTarget.style.background = "rgba(0,0,0,0.35)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.35)"; e.currentTarget.style.background = "rgba(0,0,0,0.2)"; }}>
          {sidebarCollapsed ? "▶" : "◀"}
        </button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
        <OfflineBanner />
        {/* Topbar */}
        <div style={{ height: 48, background: B.white, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 10, flexShrink: 0, position: "relative", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          {/* Hamburger — mobile only */}
          <button className="hamburger-btn" onClick={() => setDrawerOpen(true)}
            style={{ display: "none", width: 32, height: 32, borderRadius: 6, background: B.light, border: `1px solid ${B.border}`, alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
            ☰
          </button>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: B.text, lineHeight: 1.2 }}>{titles[activeTab]}</div>
            <div style={{ fontSize: 10, color: B.muted, letterSpacing: "0.2px" }}>
              {navItems.find(n => n.id === activeTab)?.group ? `${navItems.find(n => n.id === activeTab).group} · ` : ""}{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </div>
          </div>

          {/* Search */}
          <div className="topbar-search" style={{ display: "flex", alignItems: "center", gap: 6, background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, padding: "5px 10px", transition: "border-color 0.15s" }}
            onFocus={() => {}} >
            <span style={{ fontSize: 12, color: B.muted }}>⌕</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search anything…"
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 12, color: B.text, width: 160, fontFamily: "inherit" }} />
            {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>}
          </div>

          {/* Role switcher (dev tool) */}
          <div className="topbar-role-picker" style={{ position: "relative" }}>
            <button onClick={() => setShowRolePicker(!showRolePicker)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: ROLE_COLORS[role] }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS[role] }} />
              {role} ▾
            </button>
            {showRolePicker && (
              <div style={{ position: "absolute", top: 34, right: 0, background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 999, minWidth: 130, overflow: "hidden" }}>
                {ROLES.map((r) => (
                  <div key={r} onClick={() => { onRoleChange(r); setShowRolePicker(false); }}
                    style={{ padding: "8px 14px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: r === role ? B.light : "transparent", fontWeight: r === role ? 600 : 400 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = B.light}
                    onMouseLeave={(e) => e.currentTarget.style.background = r === role ? B.light : "transparent"}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS[r] }} />
                    {r}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Auto-save status */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: autoSaveStatus === "saved" ? B.green : autoSaveStatus === "saving" ? B.orange : B.muted }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: autoSaveStatus === "saved" ? B.green : autoSaveStatus === "saving" ? B.orange : B.border }} />
            {autoSaveStatus === "saved" ? "Saved" : autoSaveStatus === "saving" ? "Saving…" : "Unsaved"}
          </div>

          {/* Presence indicators */}
          {presence.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: -4 }}>
              {presence.slice(0, 4).map((p, i) => (
                <div key={p.userId} title={`${p.name} · ${p.activeTab || "browsing"}`}
                  style={{ width: 24, height: 24, borderRadius: "50%", background: p.color || B.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", border: "2px solid #fff", marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i, position: "relative", cursor: "default" }}>
                  {p.avatar || p.name?.[0]}
                </div>
              ))}
              {presence.length > 4 && <div style={{ width: 24, height: 24, borderRadius: "50%", background: B.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", border: "2px solid #fff", marginLeft: -6 }}>+{presence.length - 4}</div>}
            </div>
          )}

          {/* Bell */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowNotifs(!showNotifs)}
              style={{ width: 32, height: 32, borderRadius: 6, background: B.light, border: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, position: "relative" }}>
              🔔
              {unreadCount > 0 && (
                <div style={{ position: "absolute", top: 3, right: 3, width: 14, height: 14, borderRadius: "50%", background: B.red, color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </div>
              )}
            </button>
            {showNotifs && (
              <NotifPanel
                notifications={notifications}
                onClose={() => setShowNotifs(false)}
                onMarkRead={markRead}
                onMarkAll={markAll}
              />
            )}
          </div>

          {/* Avatar */}
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {currentUser.avatar}
          </div>
        </div>

        {/* Content */}
        <div className="main-content-area page-pad" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: viewMode === "excel" ? "hidden" : "auto", padding: viewMode === "excel" ? 0 : 16 }}>
          {renderTab()}
        </div>
        <MobileBottomNav navItems={navItems} activeTab={activeTab} onTabChange={(id) => setTab(id)} />
      </div>

      {/* Close dropdowns on outside click */}
      {(showNotifs || showRolePicker) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 998 }}
          onClick={() => { setShowNotifs(false); setShowRolePicker(false); }} />
      )}
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
