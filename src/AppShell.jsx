/**
 * AppShell — top-level shell that:
 *  1. Owns tab navigation (desktop sidebar + mobile bottom nav)
 *  2. Uses useTabSync for persistence + cross-tab sync
 *  3. Lazy-mounts tabs (React.memo + display:none trick) so state is never lost
 *  4. Mobile-first: bottom nav on ≤768px, left sidebar on desktop
 *  5. Global search bar + view-mode toggle passed down to each tab
 *  6. Touch swipe support for mobile tab switching
 *
 * Drop-in usage (replace whatever wraps your tabs today):
 *
 *   import AppShell from "./AppShell";
 *   <AppShell />
 *
 * Requires: AppContext wrapping above it (provides data/setData).
 */

import { useState, useRef, useCallback, useEffect, memo, Suspense, lazy } from "react";
import { B } from "../constants";
import { useTabSync } from "../hooks/useTabSync";
// Bug 1 note: LoginScreen lives in the same directory as AppShell (both are components/).
// The import below is correct for that structure. If you move either file, update this path.
import LoginScreen from "./LoginScreen";
import SettingsTab, { DEFAULT_LOGIN_CONFIG } from "../tabs/SettingsTab";

// ── Lazy tab imports (code-split for perf) ────────────────────────────────────
const Dashboard      = lazy(() => import("../tabs/Dashboard"));
const LeadsTab       = lazy(() => import("../tabs/LeadsTab"));
const ClientsTab     = lazy(() => import("../tabs/ClientsTab"));
const TasksTab       = lazy(() => import("../tabs/TasksTab"));
const AccountingTab  = lazy(() => import("../tabs/AccountingTab"));
const CalendarTab    = lazy(() => import("../tabs/CalendarTab"));
const InventoryTab   = lazy(() => import("../tabs/InventoryTab"));
const SuppliersTab   = lazy(() => import("../tabs/SuppliersTab"));
const AnalyticsTab   = lazy(() => import("../tabs/AnalyticsTab"));
const ReportsTab     = lazy(() => import("../tabs/ReportsTab"));
const AutomationsTab = lazy(() => import("../tabs/AutomationsTab"));

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",   label: "Dashboard",   icon: "▪",  short: "Home",     group: null },
  { id: "leads",       label: "Leads",       icon: "◈",  short: "Leads",    group: "CRM" },
  { id: "clients",     label: "Clients",     icon: "◻",  short: "Clients",  group: "CRM" },
  { id: "tasks",       label: "Tasks",       icon: "◇",  short: "Tasks",    group: "CRM" },
  { id: "accounting",  label: "Accounting",  icon: "◆",  short: "Acctg",    group: "Finance" },
  { id: "inventory",   label: "Inventory",   icon: "▤",  short: "Inv",      group: "Finance" },
  { id: "suppliers",   label: "Suppliers",   icon: "▥",  short: "Supp",     group: "Finance" },
  { id: "calendar",    label: "Calendar",    icon: "▦",  short: "Cal",      group: "Ops" },
  { id: "analytics",   label: "Analytics",   icon: "▲",  short: "Stats",    group: "Ops" },
  { id: "reports",     label: "Reports",     icon: "▶",  short: "Reports",  group: "Ops" },
  { id: "automations", label: "Automations", icon: "◎",  short: "Auto",     group: "Ops" },
  { id: "settings",    label: "Settings",    icon: "◉",  short: "Settings", group: null },
];

// Mobile bottom nav shows only the 4 most used — rest accessible via "More"
const MOBILE_PRIMARY = ["dashboard","leads","tasks","calendar"];

// ── Memoized tab content (avoids re-rendering inactive tabs) ──────────────────
const TabContent = memo(function TabContent({
  tabId, active, search, viewMode,
  // Settings-specific props
  dark, setDark, compact, setCompact, highContrast, setHighContrast,
  density, setDensity, fontSize, setFontSize,
  sidebarCollapsed, setSidebarCollapsed, sidebarAccent, setSidebarAccent,
  focusMode, setFocusMode, splitView, setSplitView, setViewMode,
  currentUser, onRoleChange, data, setData, navigateTo,
  loginConfig, setLoginConfig,
}) {
  const style = active ? {} : { display: "none" };

  const inner = (() => {
    switch (tabId) {
      case "dashboard":   return <Dashboard />;
      case "leads":       return <LeadsTab viewMode={viewMode} search={search} />;
      case "clients":     return <ClientsTab viewMode={viewMode} search={search} />;
      case "tasks":       return <TasksTab viewMode={viewMode} search={search} />;
      case "accounting":  return <AccountingTab viewMode={viewMode} search={search} />;
      case "calendar":    return <CalendarTab />;
      case "inventory":   return <InventoryTab viewMode={viewMode} search={search} />;
      case "suppliers":   return <SuppliersTab viewMode={viewMode} search={search} />;
      case "analytics":   return <AnalyticsTab />;
      case "reports":     return <ReportsTab />;
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
          currentUser={currentUser} onRoleChange={onRoleChange}
          data={data} setData={setData}
          navigateTo={navigateTo}
          loginConfig={loginConfig} setLoginConfig={setLoginConfig}
        />
      );
      default: return null;
    }
  })();

  return <div style={style}>{inner}</div>;
});

// ── Skeleton shown while lazy chunk loads ─────────────────────────────────────
function TabSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
      {[80, 60, 90, 50].map((w, i) => (
        <div key={i} style={{
          height: 14, borderRadius: 6,
          background: `linear-gradient(90deg, ${B.border} 25%, #f1f5f9 50%, ${B.border} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.4s infinite",
          width: `${w}%`,
          opacity: 0.6,
        }} />
      ))}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

// ── Main AppShell ──────────────────────────────────────────────────────────────
export default function AppShell() {
  // ── Auth / Login ─────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("yp_current_user")) || null; } catch { return null; }
  });

  // ── Login Screen Config ───────────────────────────────────────────────────────
  const [loginConfig, setLoginConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem("crm_login_config")) || DEFAULT_LOGIN_CONFIG; } catch { return DEFAULT_LOGIN_CONFIG; }
  });

  // Persist loginConfig whenever it changes
  useEffect(() => {
    try { localStorage.setItem("crm_login_config", JSON.stringify(loginConfig)); } catch {}
  }, [loginConfig]);

  // Persist sidebarAccent
  useEffect(() => {
    try {
      if (sidebarAccent) localStorage.setItem("crm_sidebar_accent", sidebarAccent);
      else localStorage.removeItem("crm_sidebar_accent");
    } catch {}
  }, [sidebarAccent]);

  // ── Preferences ───────────────────────────────────────────────────────────────
  const [dark,             setDark]             = useState(false);
  const [compact,          setCompact]          = useState(false);
  const [highContrast,     setHighContrast]     = useState(false);
  const [density,          setDensity]          = useState(1);
  const [fontSize,         setFontSize]         = useState(0);
  const [sidebarAccent,    setSidebarAccent]    = useState(() => {
    try { return localStorage.getItem("crm_sidebar_accent") || null; } catch { return null; }
  });
  const [focusMode,        setFocusMode]        = useState(false);
  const [splitView,        setSplitView]        = useState(false);

  // ── Navigation & UI ───────────────────────────────────────────────────────────
  const { activeTab, setActiveTab } = useTabSync("dashboard");
  const [search, setSearch]         = useState("");
  const [viewMode, setViewMode]     = useState("table");
  const [moreOpen, setMoreOpen]     = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mounted, setMounted]       = useState(new Set(["dashboard", "settings"]));
  const touchStartX = useRef(null);
  const searchRef   = useRef(null);

  // ── Data (stub — replace with useAppData if wired) ───────────────────────────
  const [data, setData] = useState({ leads: [], clients: [], tasks: [], accounting: [], inventory: [], suppliers: [] });

  const handleLogin  = (user) => { setCurrentUser(user); try { localStorage.setItem("yp_current_user", JSON.stringify(user)); } catch {} };
  const handleLogout     = ()     => { setCurrentUser(null); try { localStorage.removeItem("yp_current_user"); } catch {} };
  // Bug 8 fix: useCallback so TabContent (which is memo'd) doesn't re-render on every AppShell render
  const handleRoleChange = useCallback((role) => setCurrentUser(u => ({ ...u, role })), []);
  const navigateTo = useCallback((tabId) => setActiveTab(tabId), [setActiveTab]);

  // ── Sidebar background: sidebarAccent from settings ──────────────────────────
  const sidebarBg = sidebarAccent || "#0F172A";

  // Mark tab as mounted when first visited
  useEffect(() => {
    setMounted(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
    // Clear search on tab change
    setSearch("");
  }, [activeTab]);

  // Keyboard shortcut: Cmd/Ctrl+K focuses search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Touch swipe for mobile tab switching
  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 60) return; // ignore small swipes
    // Bug 6 fix: exclude "settings" from swipe navigation — it's an overlay destination,
    // not part of the main tab sequence users swipe through.
    const swipeableIds = TABS.filter(t => t.id !== "settings").map(t => t.id);
    const cur = swipeableIds.indexOf(activeTab);
    if (cur === -1) return; // currently on settings — don't swipe away
    if (dx < 0 && cur < swipeableIds.length - 1) setActiveTab(swipeableIds[cur + 1]);
    if (dx > 0 && cur > 0) setActiveTab(swipeableIds[cur - 1]);
  }, [activeTab, setActiveTab]);

  const tabDef = TABS.find(t => t.id === activeTab) || TABS[0];

  // ── Show login screen if not authenticated ───────────────────────────────────
  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} loginConfig={loginConfig} />;
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .app-shell {
          display: flex;
          min-height: 100dvh;
          background: #F1F5F9;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* ── Sidebar ─────────────────────────────────────────────── */
        .app-sidebar {
          width: 228px; min-width: 228px;
          background: ${sidebarBg};
          display: flex; flex-direction: column;
          transition: width 0.2s cubic-bezier(.4,0,.2,1), min-width 0.2s cubic-bezier(.4,0,.2,1);
          position: sticky; top: 0; height: 100dvh;
          overflow: hidden; z-index: 40; flex-shrink: 0;
          border-right: 1px solid rgba(0,0,0,0.12);
        }
        .app-sidebar.collapsed { width: 58px; min-width: 58px; }

        /* Logo row */
        .sidebar-logo {
          height: 54px; padding: 0 10px 0 14px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0; overflow: hidden;
        }
        .sidebar-logo-inner { display: flex; align-items: center; gap: 10px; min-width: 0; overflow: hidden; }
        .sidebar-logo-icon {
          width: 28px; height: 28px; border-radius: 7px;
          background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.16);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; overflow: hidden;
        }
        .sidebar-logo-icon img { width: 16px; height: 16px; object-fit: contain; border-radius: 2px; }
        .sidebar-logo-icon span { font-size: 14px; line-height: 1; }
        .sidebar-logo-text { display: flex; flex-direction: column; min-width: 0; }
        .sidebar-logo-name {
          font-size: 12.5px; font-weight: 600; color: #fff; letter-spacing: -0.1px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;
        }
        .sidebar-logo-tagline {
          font-size: 9.5px; color: rgba(255,255,255,0.32); letter-spacing: 0.2px; line-height: 1.3;
        }
        .sidebar-collapse-btn {
          width: 26px; height: 26px; border-radius: 6px; border: none;
          background: none; cursor: pointer; flex-shrink: 0;
          color: rgba(255,255,255,0.3); font-size: 11px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.12s, color 0.12s;
        }
        .sidebar-collapse-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }

        /* Nav */
        .sidebar-nav { flex: 1; overflow-y: auto; padding: 8px 0 4px; scrollbar-width: none; }
        .sidebar-nav::-webkit-scrollbar { display: none; }

        .sidebar-group-label {
          padding: 8px 14px 3px;
          font-size: 9px; font-weight: 700; letter-spacing: 1px; color: rgba(255,255,255,0.25);
          text-transform: uppercase; white-space: nowrap; overflow: hidden;
        }
        .collapsed .sidebar-group-label { opacity: 0; height: 0; padding: 0; overflow: hidden; }
        .sidebar-group-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 5px 10px; }

        .sidebar-item {
          display: flex; align-items: center; gap: 9px;
          padding: 7px 12px 7px 12px;
          margin: 1px 6px;
          cursor: pointer; border-radius: 6px;
          font-size: 12.5px; color: rgba(255,255,255,0.52); font-weight: 500;
          transition: background 0.1s, color 0.1s;
          border: none; background: none;
          width: calc(100% - 12px); text-align: left;
          white-space: nowrap; overflow: hidden; font-family: inherit;
          position: relative;
        }
        .app-sidebar.collapsed .sidebar-item {
          margin: 1px 5px; width: calc(100% - 10px);
          padding: 8px 0; justify-content: center;
        }
        .sidebar-item:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.88); }
        .sidebar-item.active { background: rgba(255,255,255,0.12); color: #fff; font-weight: 600; }
        .sidebar-item.active::before {
          content: ''; position: absolute; left: -6px; top: 22%; bottom: 22%;
          width: 2.5px; border-radius: 0 2px 2px 0;
          background: #fff; opacity: 0.85;
        }
        .app-sidebar.collapsed .sidebar-item.active::before { left: -5px; }
        .sidebar-item .icon {
          font-size: 13px; flex-shrink: 0; width: 18px; text-align: center; line-height: 1;
          opacity: 0.7;
        }
        .sidebar-item.active .icon { opacity: 1; }
        .sidebar-item .lbl { transition: opacity 0.15s; font-size: 12.5px; }
        .collapsed .sidebar-item .lbl { opacity: 0; width: 0; overflow: hidden; }

        /* ── Main ─────────────────────────────────────────────────── */
        .app-main {
          flex: 1; min-width: 0; min-height: 0;
          display: flex; flex-direction: column;
          height: 100dvh; overflow: hidden;
        }

        .app-topbar {
          background: #fff;
          border-bottom: 1px solid #E2E8F0;
          padding: 0 20px; height: 54px;
          display: flex; align-items: center; gap: 10px;
          position: sticky; top: 0; z-index: 30; flex-shrink: 0;
        }
        .app-topbar-title {
          display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
        }
        .topbar-page-icon {
          width: 28px; height: 28px; border-radius: 7px;
          background: #F1F5F9; border: 1px solid #E8EDF2;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; flex-shrink: 0; color: #475569;
          font-weight: 700; letter-spacing: -0.5px;
        }
        .topbar-page-name {
          font-size: 14px; font-weight: 600; color: #0F172A; letter-spacing: -0.2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* Search */
        .app-search { flex: 1; max-width: 280px; min-width: 0; }
        .app-search input {
          width: 100%; border: 1px solid #E2E8F0; border-radius: 7px;
          padding: 6px 42px 6px 32px; font-size: 12.5px; font-family: inherit;
          outline: none; background: #F8FAFC; color: #0F172A;
          transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
        }
        .app-search input:focus { border-color: #94A3B8; background: #fff; box-shadow: 0 0 0 3px rgba(148,163,184,0.12); }
        .app-search input::placeholder { color: #94A3B8; }
        .app-search-wrap { position: relative; }
        .app-search-icon {
          position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
          pointer-events: none; color: #94A3B8; display: flex; align-items: center;
        }
        .search-shortcut {
          position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
          font-size: 10px; color: #CBD5E1; background: #F1F5F9;
          border: 1px solid #E2E8F0; border-radius: 4px; padding: 1px 5px;
          font-family: ui-monospace, monospace; pointer-events: none;
        }

        /* View toggle */
        .view-toggle {
          display: flex; gap: 2px; flex-shrink: 0;
          background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 7px; padding: 3px;
        }
        .view-btn {
          padding: 4px 11px; border-radius: 5px; font-size: 11px; font-weight: 600;
          border: none; cursor: pointer; font-family: inherit;
          transition: all 0.1s; background: transparent; color: #94A3B8; white-space: nowrap;
          letter-spacing: 0.1px;
        }
        .view-btn.active { background: #fff; color: #1E293B; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .view-btn:hover:not(.active) { color: #475569; }

        .topbar-divider { width: 1px; height: 18px; background: #E2E8F0; flex-shrink: 0; }

        /* User button */
        .topbar-user-btn {
          display: flex; align-items: center; gap: 7px;
          padding: 4px 8px 4px 4px; border-radius: 7px;
          background: none; border: 1px solid transparent;
          cursor: pointer; font-family: inherit; flex-shrink: 0;
          transition: background 0.12s, border-color 0.12s;
        }
        .topbar-user-btn:hover { background: #F8FAFC; border-color: #E2E8F0; }
        .topbar-avatar {
          width: 26px; height: 26px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
          letter-spacing: 0.3px;
        }
        .topbar-user-name {
          font-size: 12px; font-weight: 600; color: #1E293B;
          max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .topbar-user-role { font-size: 10px; color: #94A3B8; }

        /* Content */
        .app-content {
          flex: 1; min-height: 0; height: 0;
          padding: 20px 24px 80px;
          overflow-x: hidden; overflow-y: auto;
        }
        .app-content::-webkit-scrollbar { width: 4px; }
        .app-content::-webkit-scrollbar-track { background: transparent; }
        .app-content::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.25); border-radius: 4px; }
        .app-content::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,0.45); }

        /* Sidebar footer */
        .sidebar-footer { padding: 8px 6px 10px; border-top: 1px solid rgba(255,255,255,0.07); flex-shrink: 0; }
        .sidebar-user-pill {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 8px; border-radius: 7px;
          background: rgba(255,255,255,0.05); margin-bottom: 3px;
        }
        .sidebar-user-avatar {
          width: 26px; height: 26px; border-radius: 6px;
          background: rgba(255,255,255,0.15);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
          border: 1px solid rgba(255,255,255,0.12);
        }
        .sidebar-user-info { min-width: 0; overflow: hidden; }
        .sidebar-user-name { font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,0.88); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar-user-role { font-size: 9.5px; color: rgba(255,255,255,0.32); margin-top: 0.5px; }
        .sidebar-signout-btn {
          width: 100%; padding: 6px 8px;
          background: none; border: none; border-radius: 6px;
          cursor: pointer; color: rgba(255,255,255,0.3);
          font-size: 11.5px; font-weight: 500;
          display: flex; align-items: center; gap: 7px;
          transition: background 0.1s, color 0.1s;
          text-align: left; font-family: inherit;
        }
        .sidebar-signout-btn svg { opacity: 0.6; flex-shrink: 0; }
        .sidebar-signout-btn:hover { background: rgba(220,38,38,0.12); color: #fca5a5; }
        .sidebar-signout-btn:hover svg { opacity: 1; }
        .collapsed .sidebar-user-pill { display: none; }
        .collapsed .sidebar-signout-btn { justify-content: center; padding: 7px 0; }
        .collapsed .sidebar-signout-btn .signout-label { display: none; }

        /* ── Mobile bottom nav ─────────────────────────────────── */
        .mobile-nav {
          display: none; position: fixed; bottom: 0; left: 0; right: 0;
          background: #fff; border-top: 1px solid #E2E8F0;
          z-index: 50; padding-bottom: env(safe-area-inset-bottom);
        }
        .mobile-nav-inner { display: flex; align-items: stretch; height: 56px; }
        .mobile-nav-item {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 5px 2px 4px; gap: 3px;
          cursor: pointer; border: none; background: none;
          font-family: inherit; -webkit-tap-highlight-color: transparent;
          min-width: 0; position: relative;
        }
        .mobile-nav-item .m-icon { font-size: 16px; line-height: 1; color: #94A3B8; transition: color 0.12s; }
        .mobile-nav-item .m-lbl { font-size: 10px; font-weight: 500; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .mobile-nav-item.active .m-icon { color: #1D4ED8; }
        .mobile-nav-item.active .m-lbl { color: #1D4ED8; font-weight: 600; }
        .mobile-nav-item.active::before {
          content: ''; position: absolute; top: 0; left: 24%; right: 24%;
          height: 2px; border-radius: 0 0 3px 3px; background: #1D4ED8;
        }
        .mobile-nav-dot { display: none; }

        /* More sheet */
        .more-sheet-backdrop {
          position: fixed; inset: 0; background: rgba(15,23,42,0.4); z-index: 60;
          animation: sheetFadeIn 0.15s ease; backdrop-filter: blur(3px);
        }
        .more-sheet {
          position: fixed; bottom: 0; left: 0; right: 0; background: #fff;
          border-radius: 16px 16px 0 0;
          padding: 6px 16px calc(env(safe-area-inset-bottom) + 20px);
          z-index: 61; animation: sheetSlideUp 0.2s cubic-bezier(.25,.46,.45,.94);
          box-shadow: 0 -4px 24px rgba(0,0,0,0.12);
        }
        .more-sheet-handle { width: 32px; height: 3px; border-radius: 2px; background: #CBD5E1; margin: 6px auto 14px; }
        .more-sheet-title { font-size: 10.5px; font-weight: 700; color: #94A3B8; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 10px; padding: 0 2px; }
        @keyframes sheetSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes sheetFadeIn  { from { opacity: 0; } to { opacity: 1; } }
        .more-sheet-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
        .more-sheet-item {
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          padding: 13px 6px 11px; border-radius: 10px; cursor: pointer;
          border: 1px solid #E8EDF2; background: #F8FAFC;
          font-family: inherit; -webkit-tap-highlight-color: transparent;
          transition: background 0.1s, border-color 0.1s;
        }
        .more-sheet-item:active { background: #EFF6FF; }
        .more-sheet-item.active { border-color: #1D4ED8; background: #EFF6FF; }
        .more-sheet-item .ms-icon { font-size: 15px; color: #475569; }
        .more-sheet-item.active .ms-icon { color: #1D4ED8; }
        .more-sheet-item .ms-lbl { font-size: 10px; font-weight: 600; color: #475569; text-align: center; }
        .more-sheet-item.active .ms-lbl { color: #1D4ED8; }

        /* ── Responsive ─────────────────────────────────────────── */
        @media (max-width: 768px) {
          .app-sidebar { display: none; }
          .mobile-nav  { display: flex; flex-direction: column; }
          .app-content { padding: 12px 12px calc(68px + env(safe-area-inset-bottom, 0px)); }
          .app-topbar  { padding: 0 14px; height: 48px; gap: 8px; }
          .app-search  { display: none; }
          .view-toggle { display: none; }
          .topbar-divider { display: none; }
          .topbar-user-name, .topbar-user-role { display: none; }
          .topbar-user-btn { padding: 3px; }
        }
        @media (min-width: 769px) { .mobile-nav { display: none; } }
        @media (min-width: 769px) and (max-width: 1100px) {
          .app-sidebar { width: 196px; min-width: 196px; }
          .app-sidebar.collapsed { width: 58px; min-width: 58px; }
        }
        @media (hover: none) { .sidebar-item:active { background: rgba(255,255,255,0.1); } }

        .sidebar-item:focus-visible, .sidebar-collapse-btn:focus-visible,
        .sidebar-signout-btn:focus-visible, .topbar-user-btn:focus-visible {
          outline: 2px solid rgba(255,255,255,0.5); outline-offset: 1px;
        }
        .app-search input:focus-visible { outline: none; }
      `}</style>

      <div className="app-shell">
        {/* ── Desktop sidebar ── */}
        <aside className={`app-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
          {/* Logo / wordmark */}
          <div className="sidebar-logo">
            <div className="sidebar-logo-inner">
              <div className="sidebar-logo-icon">
                {loginConfig?.logoUrl
                  ? <img src={loginConfig.logoUrl} alt="" style={{ width: 18, height: 18, objectFit: "contain", borderRadius: 3 }} />
                  : <span style={{ fontSize: 16 }}>{loginConfig?.logoEmoji || "⚡"}</span>
                }
              </div>
              {!sidebarCollapsed && (
                <div className="sidebar-logo-text">
                  <span className="sidebar-logo-name">{loginConfig?.appName || "AppName"}</span>
                  <span className="sidebar-logo-tagline">Business Suite</span>
                </div>
              )}
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "›" : "‹"}
            </button>
          </div>

          {/* Navigation */}
          <nav className="sidebar-nav">
            {/* Ungrouped items first (dashboard) */}
            {TABS.filter(t => t.id !== "settings" && !t.group).map(tab => (
              <button
                key={tab.id}
                className={`sidebar-item${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                title={sidebarCollapsed ? tab.label : undefined}
              >
                <span className="icon">{tab.icon}</span>
                <span className="lbl">{tab.label}</span>
              </button>
            ))}

            {/* Grouped sections */}
            {["CRM","Finance","Ops"].map(group => {
              const groupTabs = TABS.filter(t => t.group === group && t.id !== "settings");
              if (!groupTabs.length) return null;
              const groupLabels = { CRM: "CRM", Finance: "Finance", Ops: "Operations" };
              return (
                <div key={group}>
                  <div className="sidebar-group-divider" />
                  <div className="sidebar-group-label">{groupLabels[group]}</div>
                  {groupTabs.map(tab => (
                    <button
                      key={tab.id}
                      className={`sidebar-item${activeTab === tab.id ? " active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                      title={sidebarCollapsed ? tab.label : undefined}
                    >
                      <span className="icon">{tab.icon}</span>
                      <span className="lbl">{tab.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}

            {/* Settings at bottom */}
            <div className="sidebar-group-divider" style={{ marginTop: "auto" }} />
            <button
              className={`sidebar-item${activeTab === "settings" ? " active" : ""}`}
              onClick={() => setActiveTab("settings")}
              title={sidebarCollapsed ? "Settings" : undefined}
            >
              <span className="icon">⚙️</span>
              <span className="lbl">Settings</span>
            </button>
          </nav>

          {/* User footer */}
          <div className="sidebar-footer">
            {!sidebarCollapsed && (
              <div className="sidebar-user-pill">
                <div className="sidebar-user-avatar">
                  {currentUser?.name?.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() || "??"}
                </div>
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name">{currentUser?.name || "User"}</div>
                  <div className="sidebar-user-role">{currentUser?.role || "Member"}</div>
                </div>
              </div>
            )}
            <button
              className="sidebar-signout-btn"
              onClick={handleLogout}
              title={sidebarCollapsed ? "Sign out" : undefined}
            >
              <span style={{ fontSize: 14 }}>🚪</span>
              {!sidebarCollapsed && <span>Sign out</span>}
            </button>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="app-main">
          {/* Top bar */}
          <header className="app-topbar">
            {/* Page identity */}
            <div className="app-topbar-title">
              <div className="topbar-page-icon">{tabDef.icon}</div>
              <div>
                <div className="topbar-page-name">{tabDef.label}</div>
              </div>
            </div>

            {/* Global search */}
            <div className="app-search">
              <div className="app-search-wrap">
                <span className="app-search-icon">🔍</span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder={`Search ${tabDef.label}…`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {!search && <span className="search-shortcut">⌘K</span>}
              </div>
            </div>

            {/* View mode toggle */}
            <div className="view-toggle">
              {["table","excel"].map(m => (
                <button key={m} className={`view-btn${viewMode === m ? " active" : ""}`}
                  onClick={() => setViewMode(m)}>
                  {m === "table" ? "☰ Table" : "⊞ Grid"}
                </button>
              ))}
            </div>

            <div className="topbar-divider" />

            {/* User avatar */}
            <button className="topbar-user-btn" title="Account" onClick={() => setActiveTab("settings")}>
              <div className="topbar-avatar" style={{ background: "#1E3A5F" }}>
                {currentUser?.name?.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() || "??"}
              </div>
              <div style={{ textAlign: "left" }}>
                <div className="topbar-user-name">{currentUser?.name || "User"}</div>
                <div className="topbar-user-role">{currentUser?.role || "Member"}</div>
              </div>
            </button>
          </header>

          {/* Tab content */}
          <main
            className="app-content"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <Suspense fallback={<TabSkeleton />}>
              {TABS.map(tab => (
                // Only render a tab once it has been visited (lazy mount)
                mounted.has(tab.id) && (
                  <TabContent
                    key={tab.id}
                    tabId={tab.id}
                    active={tab.id === activeTab}
                    search={search}
                    viewMode={viewMode}
                    // Settings props
                    dark={dark} setDark={setDark}
                    compact={compact} setCompact={setCompact}
                    highContrast={highContrast} setHighContrast={setHighContrast}
                    density={density} setDensity={setDensity}
                    fontSize={fontSize} setFontSize={setFontSize}
                    sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed}
                    sidebarAccent={sidebarAccent} setSidebarAccent={setSidebarAccent}
                    focusMode={focusMode} setFocusMode={setFocusMode}
                    splitView={splitView} setSplitView={setSplitView}
                    setViewMode={setViewMode}
                    currentUser={currentUser} onRoleChange={handleRoleChange}
                    data={data} setData={setData}
                    navigateTo={navigateTo}
                    loginConfig={loginConfig} setLoginConfig={setLoginConfig}
                  />
                )
              ))}
            </Suspense>
          </main>
        </div>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          {MOBILE_PRIMARY.map(id => {
            const tab = TABS.find(t => t.id === id);
            if (!tab) return null;
            const isActive = activeTab === id;
            return (
              <button key={id} className={`mobile-nav-item${isActive ? " active" : ""}`}
                onClick={() => setActiveTab(id)}>
                <span className="m-icon">{tab.icon}</span>
                <span className="m-lbl">{tab.short}</span>
                {isActive && <span className="mobile-nav-dot" />}
              </button>
            );
          })}
          {/* More button */}
          <button className={`mobile-nav-item${!MOBILE_PRIMARY.includes(activeTab) ? " active" : ""}`}
            onClick={() => setMoreOpen(true)}>
            <span className="m-icon">⋯</span>
            <span className="m-lbl">More</span>
            {!MOBILE_PRIMARY.includes(activeTab) && <span className="mobile-nav-dot" />}
          </button>
        </div>
      </nav>

      {/* ── More sheet (mobile) ── */}
      {moreOpen && (
        <>
          <div className="more-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet">
            <div className="more-sheet-handle" />
            <div className="more-sheet-title">All Modules</div>
            <div className="more-sheet-grid">
              {TABS.filter(t => !MOBILE_PRIMARY.includes(t.id)).map(tab => (
                <button key={tab.id}
                  className={`more-sheet-item${activeTab === tab.id ? " active" : ""}`}
                  onClick={() => { setActiveTab(tab.id); setMoreOpen(false); }}>
                  <span className="ms-icon">{tab.icon}</span>
                  <span className="ms-lbl">{tab.short || tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
