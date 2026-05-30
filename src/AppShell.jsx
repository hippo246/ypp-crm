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
  { id: "dashboard",   label: "Dashboard",   icon: "🏠", short: "Home"  },
  { id: "leads",       label: "Leads",       icon: "🎯", short: "Leads" },
  { id: "clients",     label: "Clients",     icon: "👥", short: "Clients"},
  { id: "tasks",       label: "Tasks",       icon: "✅", short: "Tasks" },
  { id: "accounting",  label: "Accounting",  icon: "💰", short: "Acctg" },
  { id: "calendar",    label: "Calendar",    icon: "📅", short: "Cal"   },
  { id: "inventory",   label: "Inventory",   icon: "📦", short: "Inv"   },
  { id: "suppliers",   label: "Suppliers",   icon: "🏭", short: "Supp"  },
  { id: "analytics",   label: "Analytics",   icon: "📊", short: "Stats" },
  { id: "reports",     label: "Reports",     icon: "📋", short: "Rep"   },
  { id: "automations", label: "Automations", icon: "⚡", short: "Auto"  },
  { id: "settings",    label: "Settings",    icon: "⚙️", short: "Setup" },
];

// Mobile bottom nav shows only the 5 most used — rest accessible via "More"
const MOBILE_PRIMARY = ["dashboard","leads","tasks","accounting","clients"];

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
        /* ── Reset & base ─────────────────────────────────────── */
        *, *::before, *::after { box-sizing: border-box; }

        /* ── Shell layout ─────────────────────────────────────── */
        .app-shell {
          display: flex;
          min-height: 100dvh;
          background: #F8FAFC;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        /* ── Desktop sidebar ──────────────────────────────────── */
        .app-sidebar {
          width: 220px;
          min-width: 220px;
          background: ${sidebarBg};
          display: flex;
          flex-direction: column;
          transition: width 0.22s ease, min-width 0.22s ease;
          position: sticky;
          top: 0;
          height: 100dvh;
          overflow: hidden;
          z-index: 40;
          flex-shrink: 0;
        }
        .app-sidebar.collapsed {
          width: 56px;
          min-width: 56px;
        }
        .sidebar-logo {
          padding: 18px 16px 12px;
          font-weight: 800;
          font-size: 15px;
          color: #fff;
          letter-spacing: -0.3px;
          white-space: nowrap;
          overflow: hidden;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .sidebar-nav { flex: 1; overflow-y: auto; padding: 8px 0; scrollbar-width: none; }
        .sidebar-nav::-webkit-scrollbar { display: none; }
        .sidebar-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          cursor: pointer;
          border-radius: 0;
          font-size: 13px;
          color: rgba(255,255,255,0.62);
          font-weight: 500;
          transition: background 0.12s, color 0.12s;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          white-space: nowrap;
          overflow: hidden;
          font-family: inherit;
        }
        .sidebar-item:hover { background: rgba(255,255,255,0.07); color: #fff; }
        .sidebar-item.active { background: rgba(59,130,246,0.22); color: #fff; font-weight: 700; }
        .sidebar-item .icon { font-size: 16px; flex-shrink: 0; line-height: 1; }
        .sidebar-item .lbl { opacity: 1; transition: opacity 0.15s; }
        .collapsed .sidebar-item .lbl { opacity: 0; pointer-events: none; }

        /* ── Main content ─────────────────────────────────────── */
        .app-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .app-topbar {
          background: #fff;
          border-bottom: 1px solid #E2E8F0;
          padding: 10px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          position: sticky;
          top: 0;
          z-index: 30;
        }
        .app-topbar-title {
          font-size: 14px;
          font-weight: 700;
          color: #0F172A;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .app-search {
          flex: 1;
          max-width: 320px;
          min-width: 0;
        }
        .app-search input {
          width: 100%;
          border: 1.5px solid #E2E8F0;
          border-radius: 8px;
          padding: 7px 12px 7px 32px;
          font-size: 12px;
          font-family: inherit;
          outline: none;
          background: #F8FAFC;
          color: #0F172A;
          transition: border-color 0.15s;
        }
        .app-search input:focus { border-color: #3B82F6; background: #fff; }
        .app-search-wrap { position: relative; }
        .app-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; pointer-events: none; opacity: 0.45; }
        .view-toggle { display: flex; gap: 4px; flex-shrink: 0; }
        .view-btn {
          padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          border: 1.5px solid #E2E8F0; cursor: pointer; font-family: inherit;
          transition: all 0.12s; background: #fff; color: #64748B;
        }
        .view-btn.active { border-color: #3B82F6; background: #EFF6FF; color: #3B82F6; }

        .app-content {
          flex: 1;
          padding: 16px 20px 80px;
          overflow-x: hidden;
        }

        /* ── Mobile bottom nav ────────────────────────────────── */
        .mobile-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #fff;
          border-top: 1px solid #E2E8F0;
          z-index: 50;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .mobile-nav-inner {
          display: flex;
          align-items: stretch;
        }
        .mobile-nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 8px 2px 6px;
          gap: 3px;
          cursor: pointer;
          border: none;
          background: none;
          font-family: inherit;
          -webkit-tap-highlight-color: transparent;
          min-width: 0;
        }
        .mobile-nav-item .m-icon { font-size: 20px; line-height: 1; }
        .mobile-nav-item .m-lbl { font-size: 10px; font-weight: 500; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .mobile-nav-item.active .m-icon { transform: translateY(-1px); }
        .mobile-nav-item.active .m-lbl { color: #3B82F6; font-weight: 700; }
        .mobile-nav-dot { width: 4px; height: 4px; border-radius: 50%; background: #3B82F6; margin-top: 2px; }

        /* More sheet */
        .more-sheet-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 60;
          animation: fadeIn 0.15s ease;
        }
        .more-sheet {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: #fff;
          border-radius: 16px 16px 0 0;
          padding: 16px 12px calc(env(safe-area-inset-bottom) + 16px);
          z-index: 61;
          animation: slideUp 0.2s ease;
        }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        .more-sheet-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .more-sheet-item {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          padding: 12px 8px; border-radius: 10px; cursor: pointer;
          border: 1.5px solid transparent; background: #F8FAFC;
          font-family: inherit;
          -webkit-tap-highlight-color: transparent;
          transition: background 0.1s;
        }
        .more-sheet-item:active { background: #EFF6FF; }
        .more-sheet-item.active { border-color: #3B82F6; background: #EFF6FF; }
        .more-sheet-item .ms-icon { font-size: 22px; }
        .more-sheet-item .ms-lbl { font-size: 11px; font-weight: 600; color: #475569; }

        /* ── Responsive breakpoints ───────────────────────────── */
        @media (max-width: 768px) {
          .app-sidebar { display: none; }
          .mobile-nav  { display: flex; flex-direction: column; }
          .app-content { padding: 12px 12px 72px; }
          .app-topbar  { padding: 8px 12px; }
          .app-search  { max-width: none; }
          .view-toggle { display: none; }
        }
        @media (min-width: 769px) {
          .mobile-nav { display: none; }
        }

        /* ── Touch feedback ───────────────────────────────────── */
        @media (hover: none) {
          .sidebar-item:active { background: rgba(255,255,255,0.12); }
        }
      `}</style>

      <div className="app-shell">
        {/* ── Desktop sidebar ── */}
        <aside className={`app-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
          <div className="sidebar-logo">
            <span className="lbl" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {loginConfig?.logoUrl
                ? <img src={loginConfig.logoUrl} alt={loginConfig.appName || "logo"} style={{ width: 22, height: 22, objectFit: "contain", borderRadius: 5, flexShrink: 0 }} />
                : <span>{loginConfig?.logoEmoji || "⚡"}</span>
              }
              {!sidebarCollapsed && (loginConfig?.appName || "AppName")}
            </span>
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 14, padding: "2px 4px", flexShrink: 0 }}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "›" : "‹"}
            </button>
          </div>
          <nav className="sidebar-nav">
            {TABS.filter(t => t.id !== "settings").map(tab => (
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
            {/* Settings at bottom, separated */}
            <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "6px 0" }} />
            <button
              className={`sidebar-item${activeTab === "settings" ? " active" : ""}`}
              onClick={() => setActiveTab("settings")}
              title={sidebarCollapsed ? "Settings" : undefined}
            >
              <span className="icon">⚙️</span>
              <span className="lbl">Settings</span>
            </button>
          </nav>
          <div style={{ padding: "12px 8px", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "auto" }}>
            {/* Current user pill */}
            {!sidebarCollapsed && (
              <div style={{ padding: "8px 10px", marginBottom: 6, borderRadius: 8, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(59,130,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                  {currentUser?.name?.split(" ").map(n => n[0]).join("").slice(0,2) || "??"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser?.name || "User"}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{currentUser?.role || ""}</div>
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              style={{ width: "100%", padding: sidebarCollapsed ? "8px 0" : "8px 10px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, transition: "background 0.12s, color 0.12s", textAlign: "left", fontFamily: "inherit" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = "#f87171"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
              title={sidebarCollapsed ? "Sign out" : undefined}
            >
              <span style={{ fontSize: 14 }}>🚪</span>
              {!sidebarCollapsed && "Sign out"}
            </button>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="app-main">
          {/* Top bar */}
          <header className="app-topbar">
            <span className="app-topbar-title">{tabDef.icon} {tabDef.label}</span>
            <div className="app-search">
              <div className="app-search-wrap">
                <span className="app-search-icon">🔍</span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder={`Search ${tabDef.label}… (⌘K)`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="view-toggle">
              {["table","excel"].map(m => (
                <button key={m} className={`view-btn${viewMode === m ? " active" : ""}`}
                  onClick={() => setViewMode(m)}>
                  {m === "table" ? "☰ Table" : "⊞ Excel"}
                </button>
              ))}
            </div>
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
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#CBD5E1", margin: "0 auto 16px" }} />
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
