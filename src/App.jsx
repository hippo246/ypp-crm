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
  { id: "dashboard",  label: "Dashboard",  icon: "🏠" },
  { id: "leads",      label: "Leads",       icon: "🎯" },
  { id: "clients",    label: "Clients",     icon: "🏢" },
  { id: "tasks",      label: "Tasks",       icon: "✅" },
  { id: "accounting", label: "Accounting",  icon: "💰" },
  { id: "inventory",  label: "Inventory",   icon: "📦" },
  { id: "suppliers",  label: "Suppliers",   icon: "🏭" },
  { id: "calendar",   label: "Calendar",    icon: "📅" },
  { id: "analytics",  label: "Analytics",   icon: "📊" },
  { id: "reports",    label: "Reports",     icon: "📄" },
  { id: "automations", label: "Automations", icon: "⚡" },
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

// ── Main app (inside provider) ────────────────────────────────────────────────
function AppShell({ currentUser, onLogout, onRoleChange }) {
  const { data, setData, dispatch, notifications, unreadCount } = useAppData();
  const [tab, setTab] = useState("dashboard");
  const [viewMode, setViewMode] = useState("normal");
  const [search, setSearch] = useState("");
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      <div className={`sidebar sidebar-drawer${drawerOpen ? " open" : ""}`} style={{ width: 200, background: B.blue, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, background: B.yellow, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🌞</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 12, lineHeight: 1.2 }}>YES PINOY PRO</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>Business CRM</div>
            </div>
            <button onClick={() => setDrawerOpen(false)} style={{ display: "none", background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }} className="sidebar-close-btn">✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {navItems.map((n) => (
            <div key={n.id} onClick={() => { setTab(n.id); setDrawerOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", cursor: "pointer", color: activeTab === n.id ? "#fff" : "rgba(255,255,255,0.6)", background: activeTab === n.id ? "rgba(255,255,255,0.12)" : "transparent", borderLeft: `2px solid ${activeTab === n.id ? B.yellow : "transparent"}`, fontSize: 12, transition: "all 0.1s" }}
              onMouseEnter={(e) => { if (activeTab !== n.id) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
              onMouseLeave={(e) => { if (activeTab !== n.id) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 14 }}>{n.icon}</span>
              {n.label}
            </div>
          ))}
        </div>

        {/* User card at bottom */}
        <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: ROLE_COLORS[role], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {currentUser.avatar}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>{role}</div>
            </div>
          </div>
          <button onClick={onLogout}
            style={{ width: "100%", padding: "5px 8px", fontSize: 11, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color: "rgba(255,255,255,0.6)", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
            Sign out
          </button>
        </div>

        {/* View mode */}
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: 2, gap: 2 }}>
            {["normal", "excel"].map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                style={{ flex: 1, padding: "5px 4px", fontSize: 11, border: "none", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", background: viewMode === m ? B.yellow : "transparent", color: viewMode === m ? B.blue : "rgba(255,255,255,0.55)", fontWeight: viewMode === m ? 700 : 400, transition: "all 0.15s" }}>
                {m === "normal" ? "🃏 Cards" : "📊 Excel"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
        <OfflineBanner />
        {/* Topbar */}
        <div style={{ height: 46, background: B.white, borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 10, flexShrink: 0, position: "relative" }}>
          {/* Hamburger — mobile only */}
          <button className="hamburger-btn" onClick={() => setDrawerOpen(true)}
            style={{ display: "none", width: 32, height: 32, borderRadius: 6, background: B.light, border: `1px solid ${B.border}`, alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
            ☰
          </button>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{titles[activeTab]}</div>

          {/* Search */}
          <div className="topbar-search" style={{ display: "flex", alignItems: "center", gap: 6, background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, padding: "5px 10px" }}>
            <span style={{ fontSize: 13, color: B.muted }}>🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 12, color: B.text, width: 160, fontFamily: "inherit" }} />
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
