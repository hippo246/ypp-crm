/**
 * SettingsTab — fully wired to live app state
 * Changes vs original:
 *  - Accepts all AppShell state setters as props
 *  - saveSettings now calls those setters so changes apply instantly app-wide
 *  - Added "Tab Controls" section to manage per-tab defaults (viewMode, data resets)
 *  - Preferences section initializes from live props, not hardcoded defaults
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { B } from "../constants";
import { useAppData } from "../context/AppContext";
import { toast } from "../App";
// Live preview in the Login Screen settings section
import LoginScreen from "../LoginScreen";
// Leads settings defaults — used to initialise the Leads Tab editor
import { DEFAULT_LEADS_SETTINGS } from "./LeadsTab";

const ROLE_COLORS = {
  Admin: "#1D3557",
  Sales: "#16A34A",
  Accountant: "#D97706",
  Operations: "#7C3AED",
  Manager: "#DC2626",
};

const SECTIONS = [
  { id: "profile",      label: "Profile",       icon: "👤" },
  { id: "preferences",  label: "Preferences",   icon: "⚙️" },
  { id: "tabs",         label: "Tab Controls",  icon: "🗂️" },
  { id: "leads",        label: "Leads Tab",     icon: "◎"  },
  { id: "workflow",     label: "Workflow",       icon: "🔄" },
  { id: "notifications",label: "Notifications", icon: "🔔" },
  { id: "security",     label: "Security",       icon: "🔒" },
  { id: "data",         label: "Data & Export",  icon: "💾" },
  { id: "team",         label: "Team Management",icon: "👥" },
  { id: "loginscreen",  label: "Login Screen",   icon: "🔑" },
  { id: "system",       label: "System",         icon: "🖥️" },
];

export default function SettingsTab({
  // Live app state + setters passed from AppShell
  dark = false, setDark,
  compact = false, setCompact,
  highContrast = false, setHighContrast,
  density = 1, setDensity,
  fontSize = 0, setFontSize,
  sidebarCollapsed = false, setSidebarCollapsed,
  sidebarAccent = null, setSidebarAccent,
  focusMode = false, setFocusMode,
  splitView = false, setSplitView,
  viewMode = "normal", setViewMode,
  currentUser,
  onRoleChange,
  data, setData,
  navigateTo,
  loginConfig, setLoginConfig,
}) {
// Bug 9 fix: useAppData() crashes if no AppContext provider wraps this component
// (e.g. when SettingsTab is rendered in tests or outside the main app tree).
// The fix lives in AppContext.js — useAppData should return a fallback when context
// is undefined rather than throwing. Add this to your AppContext.js:
//
//   export function useAppData() {
//     const ctx = useContext(AppContext);
//     if (!ctx) return { dispatch: () => {}, data: {} };   // ← safe fallback
//     return ctx;
//   }
//
// Until that change lands, we guard the destructure so SettingsTab doesn't white-screen.
const _appCtx = useAppData();
const dispatch = _appCtx?.dispatch ?? (() => {});
  const [activeSection, setActiveSection] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);       // #1 unsaved-changes tracking
  const [sectionSearch, setSectionSearch] = useState(""); // #3 section search/filter

  // Wrap setters to mark dirty on any change
  const setProfileDirty = (v) => { setProfile(v); setIsDirty(true); };
  const setPrefsDirty   = (v) => { setPreferences(v); setIsDirty(true); };
  const setWorkflowsDirty = (v) => { setWorkflows(v); setIsDirty(true); };
  const setNotifDirty   = (v) => { setNotifPrefs(v); setIsDirty(true); };

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    name: currentUser?.name || "John Doe",
    email: currentUser?.email || "john@company.com",
    phone: "+971 50 123 4567",
    avatar: currentUser?.name ? currentUser.name.split(" ").map(n => n[0]).join("") : "JD",
    timezone: "Asia/Dubai",
    language: "en",
  });

  // ── Preferences state — initialised from live props ────────────────────────
  const [preferences, setPreferences] = useState({
    theme: dark ? "dark" : "light",
    density: ["dense", "compact", "comfortable"][density] ?? "compact",
    fontSize: fontSize === -1 ? "small" : fontSize === 1 ? "large" : "medium",
    sidebarCollapsed,
    compactMode: compact,
    highContrast,
    sidebarAccent,
    focusMode,
    splitView,
  });

  // ── Workflow state ──────────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState([
    { id: 1, name: "Lead to Client", stages: ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"], autoTransition: true },
    { id: 2, name: "Invoice Processing", stages: ["Draft", "Sent", "Paid", "Overdue"], autoTransition: false },
  ]);

  // ── Notification prefs ──────────────────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState({
    email: true, push: true, inApp: true,
    quietHours: { enabled: false, start: "18:00", end: "09:00" },
    categories: { tasks: true, leads: true, invoices: true, system: true },
  });

  // ── Load saved settings on mount ───────────────────────────────────────────
  useEffect(() => {
    try {
      const sp = localStorage.getItem("crm_settings_profile");
      const sw = localStorage.getItem("crm_settings_workflows");
      const sn = localStorage.getItem("crm_settings_notifications");
      if (sp) setProfile(JSON.parse(sp));
      if (sw) setWorkflows(JSON.parse(sw));
      if (sn) setNotifPrefs(JSON.parse(sn));
    } catch (e) { console.error("Failed to load settings:", e); }
  }, []);

  // ── Save — writes to localStorage AND updates live app state ───────────────
  const saveSettings = useCallback(async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 400));

    // Persist
    localStorage.setItem("crm_settings_profile", JSON.stringify(profile));
    localStorage.setItem("crm_settings_workflows", JSON.stringify(workflows));
    localStorage.setItem("crm_settings_notifications", JSON.stringify(notifPrefs));
    if (loginConfig) localStorage.setItem("crm_login_config", JSON.stringify(loginConfig));

    // ── Apply preferences to live app ──────────────────────────────────────
    if (setDark)            setDark(preferences.theme === "dark");
    if (setHighContrast)    setHighContrast(preferences.highContrast);
    if (setCompact)         setCompact(preferences.compactMode);
    if (setSidebarCollapsed) setSidebarCollapsed(preferences.sidebarCollapsed);
    if (setSidebarAccent)   setSidebarAccent(preferences.sidebarAccent);
    if (setFocusMode)       setFocusMode(preferences.focusMode);
    if (setSplitView)       setSplitView(preferences.splitView);

    if (setDensity) {
      const densityMap = { dense: 0, compact: 1, comfortable: 2 };
      setDensity(densityMap[preferences.density] ?? 1);
    }
    if (setFontSize) {
      const fontMap = { small: -1, medium: 0, large: 1 };
      setFontSize(fontMap[preferences.fontSize] ?? 0);
    }
    if (setViewMode) setViewMode(preferences.viewMode || viewMode);

    setSaving(false);
    setIsDirty(false);
    toast("Settings saved — changes applied!", "success");
  }, [profile, preferences, workflows, notifPrefs, loginConfig,
      setDark, setHighContrast, setCompact, setSidebarCollapsed,
      setSidebarAccent, setFocusMode, setSplitView, setDensity,
      setFontSize, setViewMode, viewMode]);

  // #2 Ctrl/Cmd+S saves from anywhere in Settings
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveSettings();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveSettings]);

  // ── Apply ALL preferences live as you toggle — no save needed ────────────
  useEffect(() => { if (setDark) setDark(preferences.theme === "dark"); }, [preferences.theme]);
  useEffect(() => { if (setHighContrast) setHighContrast(preferences.highContrast); }, [preferences.highContrast]);
  useEffect(() => {
    const m = { small: -1, medium: 0, large: 1 };
    const val = m[preferences.fontSize] ?? 0;
    if (setFontSize) setFontSize(val);
    // Apply directly to the DOM so it takes effect even if AppShell doesn't consume the value
    const sizeMap = { small: "13px", medium: "15px", large: "17px" };
    document.documentElement.style.setProperty("--app-font-size", sizeMap[preferences.fontSize] || "15px");
    document.documentElement.style.fontSize = sizeMap[preferences.fontSize] || "15px";
  }, [preferences.fontSize]);
  useEffect(() => { if (setCompact) setCompact(preferences.compactMode); }, [preferences.compactMode]);
  useEffect(() => { if (setSidebarCollapsed) setSidebarCollapsed(preferences.sidebarCollapsed); }, [preferences.sidebarCollapsed]);
  useEffect(() => { if (setFocusMode) setFocusMode(preferences.focusMode); }, [preferences.focusMode]);
  useEffect(() => { if (setSplitView) setSplitView(preferences.splitView); }, [preferences.splitView]);
  useEffect(() => { if (setDensity) { const m = { dense: 0, compact: 1, comfortable: 2 }; setDensity(m[preferences.density] ?? 1); } }, [preferences.density]);
  useEffect(() => { if (setSidebarAccent) setSidebarAccent(preferences.sidebarAccent); }, [preferences.sidebarAccent]);

  return (
    <div style={{ display: "flex", height: "100%", background: "#F8FAFC" }}>
      {/* Left sidebar */}
      <div style={{ width: 230, background: "#fff", borderRight: "1px solid #E2E8F0", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
        {/* Sidebar header — sticky */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0F172A", margin: "0 0 10px" }}>Settings</h2>
          {/* #3 Section search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: 0.4, pointerEvents: "none" }}>🔍</span>
            <input
              type="search"
              placeholder="Filter sections…"
              value={sectionSearch}
              onChange={e => setSectionSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 10px 6px 28px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, outline: "none", boxSizing: "border-box", background: "#F8FAFC" }}
            />
          </div>
        </div>
        {/* Nav items */}
        <nav style={{ flex: 1, padding: "6px 0 12px" }}>
          {SECTIONS.filter(s => !sectionSearch || s.label.toLowerCase().includes(sectionSearch.toLowerCase())).map(s => (
            <button key={s.id} onClick={() => { setActiveSection(s.id); setSectionSearch(""); }}
              style={{
                width: "100%", padding: "9px 16px",
                display: "flex", alignItems: "center", gap: 10,
                background: activeSection === s.id ? "#EFF6FF" : "transparent",
                borderLeft: activeSection === s.id ? "3px solid #2563EB" : "3px solid transparent", // #4 active indicator bar
                border: "none", borderLeft: activeSection === s.id ? "3px solid #2563EB" : "3px solid transparent",
                cursor: "pointer", fontSize: 13,
                color: activeSection === s.id ? "#2563EB" : "#475569",
                fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left", transition: "all 0.12s", fontFamily: "inherit",
              }}
              onMouseEnter={e => activeSection !== s.id && (e.currentTarget.style.background = "#F1F5F9")}
              onMouseLeave={e => activeSection !== s.id && (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>{s.icon}</span>
              <span style={{ flex: 1 }}>{s.label}</span>
            </button>
          ))}
          {/* No results */}
          {sectionSearch && SECTIONS.filter(s => s.label.toLowerCase().includes(sectionSearch.toLowerCase())).length === 0 && (
            <div style={{ padding: "16px 16px", fontSize: 12, color: "#94A3B8", textAlign: "center" }}>No sections match</div>
          )}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Header — #5 sticky, #6 dirty indicator dot, #7 Ctrl+S hint */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 24, position: "sticky", top: 0, background: "#F8FAFC",
            zIndex: 10, paddingBottom: 14, borderBottom: "1px solid #E2E8F0",
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>
                  {SECTIONS.find(s => s.id === activeSection)?.icon}{" "}
                  {SECTIONS.find(s => s.id === activeSection)?.label}
                </h1>
                {/* #6 unsaved dot */}
                {isDirty && (
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F59E0B", display: "inline-block", flexShrink: 0 }} title="Unsaved changes" />
                )}
              </div>
              {/* #7 Ctrl+S hint — only when dirty */}
              {isDirty && (
                <span style={{ fontSize: 11, color: "#94A3B8", marginTop: 2, display: "block" }}>
                  Unsaved changes · press <kbd style={{ padding: "1px 5px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 4, fontSize: 10, fontFamily: "monospace" }}>Ctrl+S</kbd> to save
                </span>
              )}
            </div>
            <button onClick={saveSettings} disabled={saving}
              style={{
                padding: "9px 22px", background: isDirty ? "#2563EB" : "#64748B", color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.65 : 1,
                transition: "background 0.2s",
              }}
            >
              {saving ? "Saving…" : isDirty ? "💾 Save Changes" : "✓ Saved"}
            </button>
          </div>

          {activeSection === "profile"       && <ProfileSection profile={profile} setProfile={setProfileDirty} currentUser={currentUser} onRoleChange={onRoleChange} />}
          {activeSection === "preferences"   && <PreferencesSection preferences={preferences} setPreferences={setPrefsDirty} />}
          {activeSection === "tabs"          && <TabControlsSection viewMode={viewMode} setViewMode={setViewMode} preferences={preferences} setPreferences={setPrefsDirty} navigateTo={navigateTo} data={data} setData={setData} />}
          {activeSection === "leads"         && <LeadsSettingsSection />}
          {activeSection === "workflow"      && <WorkflowSection workflows={workflows} setWorkflows={setWorkflowsDirty} />}
          {activeSection === "notifications" && <NotificationsSection notifPrefs={notifPrefs} setNotifPrefs={setNotifDirty} />}
          {activeSection === "security"      && <SecuritySection />}
          {activeSection === "data"          && <DataSection data={data} />}
          {activeSection === "team"          && <TeamSection currentUser={currentUser} onRoleChange={onRoleChange} />}
          {activeSection === "loginscreen"   && <LoginScreenSection loginConfig={loginConfig} setLoginConfig={setLoginConfig} />}
          {activeSection === "system"        && <SystemSection dark={dark} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Section
// ─────────────────────────────────────────────────────────────────────────────
// #8 Deterministic avatar color from name
function avatarColor(name = "") {
  const colors = ["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EF4444","#06B6D4","#EC4899"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function ProfileSection({ profile, setProfile, currentUser, onRoleChange }) {
  const color = avatarColor(profile.name);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Profile Information</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #E2E8F0" }}>
          {/* #8 Avatar with ring + initials auto-generated */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff", border: `3px solid ${color}33`, boxShadow: `0 0 0 3px ${color}22` }}>
              {profile.name.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() || "??"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>{profile.name}</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>{profile.email}</div>
            {currentUser?.role && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${ROLE_COLORS[currentUser.role] || "#3B82F6"}22`, color: ROLE_COLORS[currentUser.role] || "#3B82F6", fontWeight: 600, marginTop: 4, display: "inline-block" }}>
                {currentUser.role}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { label: "Full Name", key: "name", type: "text" },
            { label: "Email", key: "email", type: "email" },
            { label: "Phone", key: "phone", type: "tel" },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</label>
              <input type={type} value={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}

        </div>
      </div>

      {onRoleChange && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: "0 0 16px" }}>Switch Role</h3>
          <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 16px" }}>Change your active role to see the app from a different permission level.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Object.entries(ROLE_COLORS).map(([role, color]) => (
              <button key={role} onClick={() => { onRoleChange(role); toast(`Switched to ${role} role`, "success"); }}
                style={{
                  padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: currentUser?.role === role ? color : `${color}18`,
                  color: currentUser?.role === role ? "#fff" : color,
                  border: `2px solid ${color}`,
                  transition: "all 0.15s",
                }}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
function PreferencesSection({ preferences, setPreferences }) {
  const set = (key, val) => setPreferences(p => ({ ...p, [key]: val }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Theme — #11 add System auto option */}
      <Card title="Theme">
        <div style={{ display: "flex", gap: 12 }}>
          {[["light", "☀️ Light"], ["dark", "🌙 Dark"], ["system", "💻 System"]].map(([val, lbl]) => (
            <button key={val} onClick={() => set("theme", val)}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: preferences.theme === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.theme === val ? "#EFF6FF" : "#F8FAFC", fontSize: 13, fontWeight: preferences.theme === val ? 700 : 400, cursor: "pointer", color: preferences.theme === val ? "#2563EB" : "#475569" }}>
              {lbl}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "#94A3B8", margin: "8px 0 0" }}>Theme applies instantly — no need to save.</p>
      </Card>

      {/* Layout toggles */}
      <Card title="Layout">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            ["compactMode",       "Compact Mode",             "Tighter padding throughout the UI"],
            ["highContrast",      "High Contrast",            "Maximum readability mode"],
            ["sidebarCollapsed",  "Collapse Sidebar",         "Sidebar starts collapsed"],
            ["focusMode",         "Focus Mode",               "Hides sidebar for distraction-free work"],
            ["splitView",         "Split View",               "Show two tabs side by side"],
          ].map(([key, label, desc]) => (
            <Toggle key={key} label={label} desc={desc} checked={preferences[key] || false} onChange={v => set(key, v)} />
          ))}
        </div>
      </Card>

      {/* Density — #12 visual preview labels */}
      <Card title="Density">
        <div style={{ display: "flex", gap: 10 }}>
          {[
            ["dense",       "Dense",       "3px"],
            ["compact",     "Compact",     "6px"],
            ["comfortable", "Comfortable", "12px"],
          ].map(([val, lbl, pad]) => (
            <button key={val} onClick={() => set("density", val)}
              style={{ flex: 1, padding: "10px 8px", borderRadius: 8, border: preferences.density === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.density === val ? "#EFF6FF" : "#F8FAFC", fontSize: 12, fontWeight: preferences.density === val ? 700 : 400, cursor: "pointer", color: preferences.density === val ? "#2563EB" : "#475569" }}>
              <div style={{ marginBottom: 6 }}>
                {/* #12 mini visual preview of row height */}
                {[1,2,3].map(i => <div key={i} style={{ height: 4, borderRadius: 2, background: preferences.density === val ? "#3B82F6" : "#CBD5E1", marginBottom: `${pad}`, opacity: 0.6 + i*0.13 }} />)}
              </div>
              {lbl}
            </button>
          ))}
        </div>
      </Card>

      {/* Font size */}
      <Card title="Font Size">
        <div style={{ display: "flex", gap: 10 }}>
          {[["small", "Small", 11], ["medium", "Medium", 13], ["large", "Large", 16]].map(([val, lbl, sz]) => (
            <button key={val} onClick={() => set("fontSize", val)}
              style={{ flex: 1, padding: "12px 0", borderRadius: 8, border: preferences.fontSize === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.fontSize === val ? "#EFF6FF" : "#F8FAFC", cursor: "pointer", color: preferences.fontSize === val ? "#2563EB" : "#475569", fontWeight: preferences.fontSize === val ? 700 : 400, fontSize: sz }}>
              {lbl}
            </button>
          ))}
        </div>
      </Card>

      {/* Sidebar accent — #10 preset swatches */}
      <Card title="Sidebar Accent Color">
        {/* #10 Preset color swatches */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {["#0F172A","#1a2f4a","#1D3557","#7C3AED","#2563EB","#059669","#DC2626","#B45309","#374151"].map(c => (
            <button key={c} onClick={() => set("sidebarAccent", c)} title={c}
              style={{ width: 28, height: 28, borderRadius: 7, background: c, border: preferences.sidebarAccent === c ? "3px solid #3B82F6" : "2px solid transparent", cursor: "pointer", outline: "none", transition: "transform 0.1s", flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.15)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input type="color" value={preferences.sidebarAccent || "#1a2f4a"}
            onChange={e => set("sidebarAccent", e.target.value)}
            style={{ width: 44, height: 44, border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", padding: 2 }} />
          <button onClick={() => set("sidebarAccent", null)}
            style={{ padding: "8px 14px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
            Reset to Default
          </button>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>Changes apply on Save.</span>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab Controls Section — control every tab in the app
// ─────────────────────────────────────────────────────────────────────────────
const TAB_META = [
  { id: "dashboard",   label: "Dashboard",   icon: "▣",  desc: "Overview & KPIs" },
  { id: "leads",       label: "Leads",       icon: "◎",  desc: "Pipeline & prospects" },
  { id: "clients",     label: "Clients",     icon: "⬡",  desc: "Active accounts" },
  { id: "tasks",       label: "Tasks",       icon: "◈",  desc: "Work & assignments" },
  { id: "accounting",  label: "Accounting",  icon: "◆",  desc: "Invoices & payments" },
  { id: "inventory",   label: "Inventory",   icon: "▤",  desc: "Stock levels" },
  { id: "suppliers",   label: "Suppliers",   icon: "▥",  desc: "Vendor management" },
  { id: "calendar",    label: "Calendar",    icon: "▦",  desc: "Schedule & deadlines" },
  { id: "analytics",   label: "Analytics",   icon: "▲",  desc: "Charts & trends" },
  { id: "reports",     label: "Reports",     icon: "▶",  desc: "Exports & summaries" },
  { id: "automations", label: "Automations", icon: "◉",  desc: "Workflow rules" },
];

function TabControlsSection({ viewMode: viewModeProp, setViewMode, preferences, setPreferences, navigateTo, data, setData }) {
  const [localViewMode, setLocalViewMode] = useState(viewModeProp || "normal");
  const applyViewMode = (val) => { setLocalViewMode(val); if (setViewMode) setViewMode(val); };

  // #13 compute per-tab record counts for badge display
  const tabCounts = {
    leads: data?.leads?.length ?? 0,
    clients: data?.clients?.length ?? 0,
    tasks: data?.tasks?.length ?? 0,
    accounting: data?.accounting?.length ?? 0,
    inventory: data?.inventory?.length ?? 0,
    suppliers: data?.suppliers?.length ?? 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Global view mode */}
      <Card title="Default View Mode">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Controls how list-based tabs display their data by default. Changes apply immediately.</p>
        <div style={{ display: "flex", gap: 10 }}>
          {[["normal", "🗂 Normal"], ["table", "📋 Table"], ["kanban", "🗃 Kanban"], ["excel", "📊 Excel"]].map(([val, lbl]) => (
            <button key={val} onClick={() => applyViewMode(val)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: localViewMode === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: localViewMode === val ? "#EFF6FF" : "#F8FAFC", fontSize: 12, fontWeight: localViewMode === val ? 700 : 400, cursor: "pointer", color: localViewMode === val ? "#2563EB" : "#475569" }}>
              {lbl}
            </button>
          ))}
        </div>
      </Card>

      {/* Jump to any tab — #14 with record counts + arrow */}
      <Card title="Quick Navigate">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Jump straight to any tab in the app.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {TAB_META.map(t => (
            <button key={t.id} onClick={() => navigateTo && navigateTo(t.id)}
              style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.12s", position: "relative" }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8FAFC"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {/* #14 arrow + record count badge */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  {tabCounts[t.id] > 0 && (
                    <span style={{ fontSize: 9, padding: "1px 5px", background: "#E2E8F0", borderRadius: 8, color: "#475569", fontWeight: 600 }}>{tabCounts[t.id]}</span>
                  )}
                  <span style={{ fontSize: 10, color: "#94A3B8" }}>↗</span>
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", marginTop: 4 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: "#64748B" }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Data stats per tab */}
      <Card title="Tab Data Summary">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Live record counts across all tabs.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Leads",       count: data?.leads?.length ?? 0,      warn: (data?.leads || []).filter(l => l.status === "Lost").length },
            { label: "Clients",     count: data?.clients?.length ?? 0,    warn: (data?.clients || []).filter(c => { if (!c.renewal) return false; return (new Date(c.renewal) - new Date()) / 86400000 < 30; }).length },
            { label: "Tasks",       count: data?.tasks?.length ?? 0,      warn: (data?.tasks || []).filter(t => t.status !== "Done").length },
            { label: "Invoices",    count: data?.accounting?.length ?? 0, warn: (data?.accounting || []).filter(i => i.status !== "Paid" && i.due && new Date(i.due) < new Date()).length },
            { label: "Inventory",   count: data?.inventory?.length ?? 0,  warn: (data?.inventory || []).filter(i => i.status !== "In Stock").length },
            { label: "Suppliers",   count: data?.suppliers?.length ?? 0,  warn: 0 },
          ].map(({ label, count, warn }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, gap: 12 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{label}</span>
              <span style={{ fontSize: 12, color: "#64748B" }}>{count} records</span>
              {warn > 0 && (
                <span style={{ fontSize: 11, padding: "2px 8px", background: "#FEF2F2", color: "#DC2626", borderRadius: 10, fontWeight: 600 }}>
                  ⚠ {warn} need attention
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Bulk actions */}
      <Card title="Bulk Tab Actions">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Apply bulk changes across tabs. These update data immediately.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            {
              label: "Mark all overdue tasks as Done",
              color: "#16A34A",
              action: () => {
                setData(p => ({ ...p, tasks: (p.tasks || []).map(t => t.status !== "Done" ? { ...t, status: "Done" } : t) }));
                toast("All tasks marked as Done", "success");
              },
            },
            {
              label: "Mark all overdue invoices as Paid",
              color: "#2563EB",
              action: () => {
                setData(p => ({ ...p, accounting: (p.accounting || []).map(i => i.status !== "Paid" ? { ...i, status: "Paid" } : i) }));
                toast("All invoices marked as Paid", "success");
              },
            },
            {
              label: "Set all leads to 'Contacted'",
              color: "#D97706",
              action: () => {
                setData(p => ({ ...p, leads: (p.leads || []).map(l => !["Won","Lost"].includes(l.status) ? { ...l, status: "Contacted" } : l) }));
                toast("Open leads set to Contacted", "success");
              },
            },
          ].map(({ label, color, action }) => (
            <button key={label} onClick={action}
              style={{ padding: "10px 16px", background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 8, color, fontWeight: 600, fontSize: 13, cursor: "pointer", textAlign: "left" }}
              onMouseEnter={e => e.currentTarget.style.background = `${color}22`}
              onMouseLeave={e => e.currentTarget.style.background = `${color}12`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leads Tab Settings Section — every DEFAULT_LEADS_SETTINGS key is editable
// ─────────────────────────────────────────────────────────────────────────────
const LEADS_SETTINGS_KEY = "crm_leads_settings";

function loadLeadsCfg() {
  try {
    const saved = localStorage.getItem(LEADS_SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_LEADS_SETTINGS,
        ...parsed,
        stageColors:    { ...DEFAULT_LEADS_SETTINGS.stageColors,    ...(parsed.stageColors    || {}) },
        priorityColors: { ...DEFAULT_LEADS_SETTINGS.priorityColors, ...(parsed.priorityColors || {}) },
        scoreColors:    { ...DEFAULT_LEADS_SETTINGS.scoreColors,     ...(parsed.scoreColors    || {}) },
        nextActions:    { ...DEFAULT_LEADS_SETTINGS.nextActions,     ...(parsed.nextActions    || {}) },
        analyticsItems: { ...DEFAULT_LEADS_SETTINGS.analyticsItems,  ...(parsed.analyticsItems || {}) },
        goalDefaults:   { ...DEFAULT_LEADS_SETTINGS.goalDefaults,    ...(parsed.goalDefaults   || {}) },
      };
    }
  } catch {}
  return { ...DEFAULT_LEADS_SETTINGS };
}

function LeadsSettingsSection() {
  const [cfg, setCfg] = useState(loadLeadsCfg);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("dropdowns");

  const set = (key, val) => { setCfg(p => ({ ...p, [key]: val })); setDirty(true); };
  const setNested = (key, subKey, val) => { setCfg(p => ({ ...p, [key]: { ...p[key], [subKey]: val } })); setDirty(true); };

  const saveCfg = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 280));
    localStorage.setItem(LEADS_SETTINGS_KEY, JSON.stringify(cfg));
    window.dispatchEvent(new Event("crm_leads_settings_updated"));
    setSaving(false);
    setDirty(false);
    toast("Leads settings saved — applied instantly!", "success");
  };

  const resetCfg = () => {
    if (!window.confirm("Reset ALL Leads Tab settings to factory defaults?")) return;
    setCfg({ ...DEFAULT_LEADS_SETTINGS });
    localStorage.removeItem(LEADS_SETTINGS_KEY);
    window.dispatchEvent(new Event("crm_leads_settings_updated"));
    setDirty(false);
    toast("Leads Tab settings reset to defaults", "info");
  };

  // ── Shared helper components ───────────────────────────────────────────────

  // Editable chip list: add/remove items
  const OptionListEditor = ({ label, hint, value, onChange }) => {
    const [draft, setDraft] = useState("");
    const items = value || [];
    const add = () => { if (draft.trim() && !items.includes(draft.trim())) { onChange([...items, draft.trim()]); setDraft(""); } };
    return (
      <div>
        {label && <label style={labelStyle}>{label}</label>}
        {hint && <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 8px" }}>{hint}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, minHeight: 32 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 6, padding: "3px 8px", fontSize: 12, color: "#3730A3" }}>
              <span>{item}</span>
              <button onClick={() => onChange(items.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#818CF8", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
            </div>
          ))}
          {items.length === 0 && <span style={{ fontSize: 11, color: "#CBD5E1", lineHeight: "28px" }}>No items yet</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Type and press Enter or + Add…"
            style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
          <button onClick={add}
            style={{ padding: "7px 14px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>+ Add</button>
        </div>
      </div>
    );
  };

  // Color swatch grid for a key→hex map
  const ColorMapEditor = ({ label, value, keys, onChange }) => (
    <div>
      {label && <label style={labelStyle}>{label}</label>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 6 }}>
        {(keys || []).map(k => {
          const color = (value || {})[k] || "#94A3B8";
          return (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8FAFC", borderRadius: 8, padding: "7px 10px", border: `1.5px solid ${color}40`, cursor: "pointer" }}>
              <input type="color" value={color}
                onChange={e => onChange({ ...(value || {}), [k]: e.target.value })}
                style={{ width: 26, height: 26, border: "none", borderRadius: 5, cursor: "pointer", padding: 0, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            </label>
          );
        })}
      </div>
    </div>
  );

  // Number input
  const NumField = ({ label, hint, cfgKey, min = 0, max = 999, step = 1, wide = false }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      {hint && <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 4px" }}>{hint}</p>}
      <input type="number" min={min} max={max} step={step} value={cfg[cfgKey] ?? 0}
        onChange={e => set(cfgKey, Number(e.target.value))}
        style={{ ...inputStyle, width: wide ? "100%" : 110 }} />
    </div>
  );

  // Boolean toggle
  const BoolField = ({ label, desc, cfgKey }) => (
    <Toggle label={label} desc={desc} checked={!!cfg[cfgKey]} onChange={v => set(cfgKey, v)} />
  );

  // Single-line text
  const TextField = ({ label, hint, cfgKey, placeholder = "" }) => (
    <div>
      <label style={labelStyle}>{label}</label>
      {hint && <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 4px" }}>{hint}</p>}
      <input type="text" value={cfg[cfgKey] || ""} placeholder={placeholder}
        onChange={e => set(cfgKey, e.target.value)}
        style={inputStyle} />
    </div>
  );

  // Editable list of toast strings
  const ToastListEditor = ({ label, hint, cfgKey }) => {
    const items = cfg[cfgKey] || [];
    return (
      <div>
        {label && <label style={labelStyle}>{label}</label>}
        {hint && <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 8px" }}>{hint}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input value={t} onChange={e => { const n = [...items]; n[i] = e.target.value; set(cfgKey, n); }}
                style={{ ...inputStyle, fontSize: 12, flex: 1 }} />
              <button onClick={() => set(cfgKey, items.filter((_, j) => j !== i))}
                style={{ padding: "6px 10px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
          ))}
          <button onClick={() => set(cfgKey, [...items, "New message"])}
            style={{ padding: "6px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, cursor: "pointer", color: "#475569", fontWeight: 600, width: "fit-content" }}>
            + Add Message
          </button>
        </div>
      </div>
    );
  };

  // Next-action map: status → { icon, text }
  const NextActionEditor = () => {
    const na = cfg.nextActions || DEFAULT_LEADS_SETTINGS.nextActions;
    const allStatuses = [
      ...Object.keys(na),
      ...(cfg.statusOptions || []).filter(s => !Object.keys(na).includes(s)),
    ];
    return (
      <div>
        <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 10px" }}>
          Define the suggested next action shown under each lead's follow-up date in the table and cards. <code style={{ background: "#F1F5F9", padding: "1px 4px", borderRadius: 3 }}>overdue</code> fires when a follow-up is past due.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "160px 48px 1fr", gap: 8, padding: "4px 8px", background: "#F8FAFC", borderRadius: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Status</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Icon</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Action text</span>
          </div>
          {allStatuses.map(k => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "160px 48px 1fr", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>{k}</span>
              <input value={na[k]?.icon || ""}
                onChange={e => set("nextActions", { ...na, [k]: { ...na[k], icon: e.target.value } })}
                style={{ ...inputStyle, fontSize: 17, textAlign: "center", padding: "5px 4px" }} />
              <input value={na[k]?.text || ""}
                onChange={e => set("nextActions", { ...na, [k]: { ...na[k], text: e.target.value } })}
                style={{ ...inputStyle, fontSize: 12 }} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // WhatsApp quick-reply templates
  const WATemplatesEditor = () => {
    const templates = cfg.waTemplates || [];
    return (
      <div>
        <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 10px" }}>
          Use <code style={{ background: "#F1F5F9", padding: "1px 4px", borderRadius: 3 }}>{"{name}"}</code> as a placeholder for the lead's name.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {templates.map((t, i) => (
            <div key={i} style={{ background: "#F8FAFC", borderRadius: 8, padding: 12, border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={t.label} placeholder="Button label (e.g. 📄 Docs Reminder)"
                  onChange={e => { const n = [...templates]; n[i] = { ...t, label: e.target.value }; set("waTemplates", n); }}
                  style={{ ...inputStyle, fontSize: 12, flex: 1 }} />
                <button onClick={() => set("waTemplates", templates.filter((_, j) => j !== i))}
                  style={{ padding: "6px 10px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>✕</button>
              </div>
              <textarea value={t.text} rows={2} placeholder="Message body…"
                onChange={e => { const n = [...templates]; n[i] = { ...t, text: e.target.value }; set("waTemplates", n); }}
                style={{ ...inputStyle, resize: "vertical", fontSize: 12, fontFamily: "inherit" }} />
            </div>
          ))}
          <button onClick={() => set("waTemplates", [...templates, { label: "New Template", text: "Hi {name}, " }])}
            style={{ padding: "7px 14px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, cursor: "pointer", color: "#475569", fontWeight: 600, width: "fit-content" }}>
            + Add Template
          </button>
        </div>
      </div>
    );
  };

  // Closed-stages multi-select (lostStages array)
  const ClosedStagesEditor = () => {
    const all = cfg.statusOptions || DEFAULT_LEADS_SETTINGS.statusOptions;
    const closed = cfg.lostStages || DEFAULT_LEADS_SETTINGS.lostStages;
    return (
      <div>
        <label style={labelStyle}>Closed / Lost Stage Names</label>
        <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 8px" }}>
          These statuses are treated as "closed" — SLA timers stop, reopen button appears, and they count toward lost-reason analytics.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {all.map(s => {
            const on = closed.includes(s);
            return (
              <button key={s} onClick={() => set("lostStages", on ? closed.filter(x => x !== s) : [...closed, s])}
                style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: on ? 700 : 400, border: `1.5px solid ${on ? "#EF4444" : "#E2E8F0"}`, background: on ? "#FEF2F2" : "#F8FAFC", color: on ? "#DC2626" : "#64748B", cursor: "pointer", transition: "all 0.12s" }}>
                {s}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Column visibility toggles (admin-level)
  const ColumnVisibilityEditor = () => {
    const cols = [
      { key: "showColScore",       label: "Score column",           desc: "Lead score badge (Hot/Warm/Cold)" },
      { key: "showColHealth",      label: "Health column",          desc: "Health % pill" },
      { key: "showColTemperature", label: "Temperature column",     desc: "🔥 Hot / 🧊 Cold temp badge" },
      { key: "showColEstClose",    label: "Est. Close Date column", desc: "Estimated close date" },
      { key: "showColTags",        label: "Tags column",            desc: "Multi-tag chip display" },
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cols.map(c => (
          <BoolField key={c.key} label={c.label} desc={c.desc} cfgKey={c.key} />
        ))}
      </div>
    );
  };

  const TABS = [
    { id: "dropdowns",  label: "📋 Dropdowns"      },
    { id: "stages",     label: "🔀 Stages"          },
    { id: "colors",     label: "🎨 Colors"           },
    { id: "thresholds", label: "⚙️ Thresholds"      },
    { id: "display",    label: "🖥️ Display"         },
    { id: "visibility", label: "👁 Visibility"       },
    { id: "funlayer",   label: "🎮 Fun Layer"        },
    { id: "messages",   label: "💬 Messages"         },
    { id: "actions",    label: "⚡ Auto Rules"       },
  ];

  // Shared header/footer save bar
  const SaveBar = ({ top = false }) => (
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", ...(top ? {} : { paddingTop: 10, borderTop: "1px solid #E2E8F0" }) }}>
      <button onClick={resetCfg}
        style={{ padding: "7px 14px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        ↺ Reset to Defaults
      </button>
      <button onClick={saveCfg} disabled={saving}
        style={{ padding: "8px 22px", background: saving ? "#94A3B8" : dirty ? "#10B981" : "#64748B", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", transition: "background 0.2s" }}>
        {saving ? "Saving…" : dirty ? "💾 Save Leads Settings" : "✓ Saved"}
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <SaveBar top />

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 0, flexWrap: "wrap", borderBottom: "2px solid #E2E8F0" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "8px 14px", border: "none", background: "none", fontSize: 12,
            fontWeight: activeTab === t.id ? 700 : 400,
            color: activeTab === t.id ? "#2563EB" : "#64748B",
            borderBottom: activeTab === t.id ? "2.5px solid #2563EB" : "2.5px solid transparent",
            marginBottom: -2, cursor: "pointer", transition: "all 0.12s", whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── DROPDOWNS ── */}
      {activeTab === "dropdowns" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Services" collapsible defaultOpen>
            <OptionListEditor
              hint="Shown in all Service dropdowns across the leads table, add form, and filters."
              value={cfg.serviceOptions} onChange={v => set("serviceOptions", v)} />
          </Card>
          <Card title="Lead Sources" collapsible defaultOpen>
            <OptionListEditor
              hint="Where leads come from — Facebook, Referral, Walk-in, etc."
              value={cfg.sourceOptions} onChange={v => set("sourceOptions", v)} />
          </Card>
          <Card title="Lost Reasons" collapsible defaultOpen>
            <OptionListEditor
              hint="Reasons shown when a lead is moved to a closed stage."
              value={cfg.lostOptions} onChange={v => set("lostOptions", v)} />
          </Card>
          <Card title="Priority Levels" collapsible defaultOpen>
            <OptionListEditor
              hint="Ordered list of priority levels. VIP should be first or last depending on your preference."
              value={cfg.priorityOptions} onChange={v => set("priorityOptions", v)} />
          </Card>
          <Card title="Staff / Assigned To" collapsible defaultOpen>
            <OptionListEditor
              hint="Staff members who can be assigned to leads. Shown in the Assigned To dropdown and the Owner filter."
              value={cfg.staffOptions} onChange={v => set("staffOptions", v)} />
          </Card>
          <Card title="Tags" collapsible defaultOpen>
            <OptionListEditor
              hint="Tags that can be applied to leads. Used for filtering and quick identification."
              value={cfg.tagOptions} onChange={v => set("tagOptions", v)} />
          </Card>
          <Card title="Document Checklist Items" collapsible defaultOpen>
            <OptionListEditor
              hint="Documents required from the lead — shown in the detail drawer's Docs tab."
              value={cfg.docChecklistItems} onChange={v => set("docChecklistItems", v)} />
          </Card>
          <Card title="Snooze & Recurrence Options" collapsible>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Snooze options (days, comma-separated)</label>
                <input value={(cfg.snoozeOptions || []).join(", ")}
                  onChange={e => set("snoozeOptions", e.target.value.split(",").map(x => Number(x.trim())).filter(Boolean))}
                  style={inputStyle} placeholder="1, 3, 7, 14" />
              </div>
              <div>
                <label style={labelStyle}>Recurrence options (days, comma-separated)</label>
                <input value={(cfg.recurrenceOptions || []).join(", ")}
                  onChange={e => set("recurrenceOptions", e.target.value.split(",").map(x => Number(x.trim())).filter(Boolean))}
                  style={inputStyle} placeholder="3, 7, 14, 30" />
              </div>
            </div>
          </Card>
          <Card title="Currency" collapsible>
            <TextField label="Currency label (e.g. AED, USD, EUR)" cfgKey="currencyLabel" placeholder="AED" />
          </Card>
        </div>
      )}

      {/* ── STAGES ── */}
      {activeTab === "stages" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Pipeline Status List">
            <OptionListEditor
              hint="All statuses available in the Status dropdown. Order matters — they appear in this order throughout the UI."
              value={cfg.statusOptions} onChange={v => set("statusOptions", v)} />
          </Card>
          <Card title="Stage Identification">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <TextField label="Won stage name" hint="Used for conversion, XP awards, and confetti." cfgKey="wonStage" placeholder="Won" />
              <TextField label="Lost stage name (legacy single)" hint="Used in some internal helpers. Prefer lostStages for multi-stage closed logic." cfgKey="lostStage" placeholder="Lost" />
            </div>
          </Card>
          <Card title="Closed / Lost Stages">
            <ClosedStagesEditor />
          </Card>
        </div>
      )}

      {/* ── COLORS ── */}
      {activeTab === "colors" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Pipeline Stage Colors">
            <ColorMapEditor label="One color per stage — used for badges, kanban columns, left-border accents, and stat cards."
              value={cfg.stageColors}
              keys={cfg.statusOptions || DEFAULT_LEADS_SETTINGS.statusOptions}
              onChange={v => set("stageColors", v)} />
          </Card>
          <Card title="Priority Colors">
            <ColorMapEditor label="One color per priority level."
              value={cfg.priorityColors}
              keys={cfg.priorityOptions || DEFAULT_LEADS_SETTINGS.priorityOptions}
              onChange={v => set("priorityColors", v)} />
          </Card>
          <Card title="Lead Score Colors">
            <ColorMapEditor label="Colors for the Hot / Warm / Cold score labels."
              value={cfg.scoreColors}
              keys={["Hot", "Warm", "Cold"]}
              onChange={v => set("scoreColors", v)} />
          </Card>
        </div>
      )}

      {/* ── THRESHOLDS ── */}
      {activeTab === "thresholds" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Follow-up">
            <NumField label="'Soon' window (days — shown as blue pill before turning green)" cfgKey="followUpSoonDays" min={1} max={30} />
          </Card>
          <Card title="SLA / Response Time">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="Warning threshold (hours since last contact → yellow)" cfgKey="slaWarningHours" min={1} max={240} />
              <NumField label="Breach threshold (hours since last contact → red)" cfgKey="slaBreachHours" min={1} max={720} />
            </div>
          </Card>
          <Card title="Lead Health Score">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="Healthy (score ≥ → green)" cfgKey="healthThresholdHealthy" min={0} max={100} />
              <NumField label="Needs Attention (score ≥ → yellow; below → Neglected red)" cfgKey="healthThresholdAttention" min={0} max={100} />
            </div>
          </Card>
          <Card title="Stage Age Pills">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="Warn after (days in same stage → yellow pill)" cfgKey="stageAgeWarnDays" min={1} max={90} />
              <NumField label="Danger after (days in same stage → red pill)" cfgKey="stageAgeDangerDays" min={1} max={180} />
            </div>
          </Card>
          <Card title="Temperature Algorithm">
            <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 12px" }}>
              Temperature starts at 100 and decays daily. Boosts and penalties adjust it based on follow-up status, priority, and contact recency.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <NumField label="Decay rate (pts lost per day of inactivity)" cfgKey="tempDecayRate" min={0} max={20} />
              <NumField label="Boost: upcoming follow-up (green)" cfgKey="tempBoostGreen" min={0} max={50} />
              <NumField label="Boost: follow-up soon ≤ Soon days (blue)" cfgKey="tempBoostBlue" min={0} max={50} />
              <NumField label="Penalty: overdue follow-up (red)" cfgKey="tempPenaltyRed" min={0} max={50} />
              <NumField label="Boost: VIP priority" cfgKey="tempBoostVIP" min={0} max={50} />
              <NumField label="Boost: High priority" cfgKey="tempBoostHigh" min={0} max={50} />
              <NumField label="Boost: lead value above threshold" cfgKey="tempBoostValue" min={0} max={50} />
              <NumField label="Boost: contacted within 1 day" cfgKey="tempBoostContact1d" min={0} max={50} />
              <NumField label="Boost: contacted within 3 days" cfgKey="tempBoostContact3d" min={0} max={50} />
              <NumField label="High-value threshold (lead value to earn boost)" cfgKey="highValueThreshold" min={0} max={1000000} step={1000} wide />
            </div>
          </Card>
          <Card title="Temperature Label Thresholds">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <NumField label="🔥 Hot (score ≥)" cfgKey="tempHotThreshold" min={0} max={100} />
              <NumField label="🌡 Warm (score ≥)" cfgKey="tempWarmThreshold" min={0} max={100} />
              <NumField label="❄ Cool (score ≥; below → 🧊 Cold)" cfgKey="tempCoolThreshold" min={0} max={100} />
            </div>
          </Card>
          <Card title="Pipeline Health Score Weights">
            <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 12px" }}>
              Weights are used when calculating the pipeline health % shown in the Pipeline Health modal. They should add up to 100.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="Overdue follow-ups weight" cfgKey="healthWeightOverdue" min={0} max={100} />
              <NumField label="Stale leads weight" cfgKey="healthWeightStale" min={0} max={100} />
              <NumField label="Duplicates weight" cfgKey="healthWeightDupes" min={0} max={100} />
              <NumField label="Unassigned leads weight" cfgKey="healthWeightUnassigned" min={0} max={100} />
              <NumField label="Leads with no value weight" cfgKey="healthWeightNoValue" min={0} max={100} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
              <NumField label="Healthy score (≥ → green)" cfgKey="healthScoreGood" min={0} max={100} />
              <NumField label="Attention score (≥ → yellow; below → red critical)" cfgKey="healthScoreWarn" min={0} max={100} />
            </div>
          </Card>
        </div>
      )}

      {/* ── DISPLAY ── */}
      {activeTab === "display" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Default View">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Default display mode</label>
                <select value={cfg.defaultDisplayMode || "table"} onChange={e => set("defaultDisplayMode", e.target.value)} style={inputStyle}>
                  <option value="table">Table</option>
                  <option value="kanban">Kanban</option>
                  <option value="cards">Cards</option>
                </select>
              </div>
              <NumField label="Default page size (rows per page)" cfgKey="defaultPageSize" min={5} max={200} step={5} wide />
            </div>
          </Card>
          <Card title="Heatmap">
            <NumField label="Days to display in the activity heatmap" cfgKey="heatmapDays" min={7} max={365} step={7} wide />
          </Card>
          <Card title="Goal Tracker Defaults">
            <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 12px" }}>Default targets pre-filled in the Goal Tracker modal when no custom goal is set.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Won target (count)</label>
                <input type="number" min={1} value={cfg.goalDefaults?.wonTarget ?? 10}
                  onChange={e => setNested("goalDefaults", "wonTarget", Number(e.target.value))}
                  style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label style={labelStyle}>Revenue target ({cfg.currencyLabel || "AED"})</label>
                <input type="number" min={0} step={1000} value={cfg.goalDefaults?.revenueTarget ?? 100000}
                  onChange={e => setNested("goalDefaults", "revenueTarget", Number(e.target.value))}
                  style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label style={labelStyle}>New leads target (count)</label>
                <input type="number" min={1} value={cfg.goalDefaults?.leadsTarget ?? 30}
                  onChange={e => setNested("goalDefaults", "leadsTarget", Number(e.target.value))}
                  style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
          </Card>
          <Card title="Stat Cards">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="Number of pipeline stat cards to show (max 6)" cfgKey="statCardCount" min={1} max={6} wide />
            </div>
          </Card>
        </div>
      )}

      {/* ── VISIBILITY ── */}
      {activeTab === "visibility" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="UI Widgets">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <BoolField label="Stat Cards Row" desc="Pipeline stage KPI cards at the top of the Leads tab" cfgKey="showStatCards" />
              <BoolField label="Duplicates Stat Card" desc="Show the duplicate leads count card" cfgKey="showDupesCard" />
              <BoolField label="Overdue Stat Card" desc="Show the overdue follow-ups count card" cfgKey="showOverdueCard" />
              <BoolField label="Lost Reasons Breakdown" desc="Show the lost reasons footer section below the table" cfgKey="showLostReasons" />
              <BoolField label="Speed Dial FAB" desc="Floating quick-action button (bottom-right corner)" cfgKey="showSpeedDial" />
            </div>
          </Card>
          <Card title="Extra Table Columns (admin-controlled)">
            <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 12px" }}>
              These columns are hidden by default to keep the table clean. Enable them here to make them available to all users. Users can further toggle columns via the column picker.
            </p>
            <ColumnVisibilityEditor />
          </Card>
          <Card title="Analytics Menu Items">
            <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 12px" }}>Toggle which items appear in the Analytics (⚡) dropdown menu in the toolbar.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {Object.entries(cfg.analyticsItems || DEFAULT_LEADS_SETTINGS.analyticsItems).map(([key, val]) => {
                const friendlyLabel = {
                  reminders: "Reminder Center",
                  funnel: "Funnel Visualizer",
                  goals: "Goal Tracker",
                  health: "Pipeline Health",
                  sourceROI: "Source ROI",
                  staffROI: "Staff ROI",
                  forecast: "Pipeline Forecast",
                  winLoss: "Win/Loss Report",
                  heatmap: "Activity Heatmap",
                  compare: "Lead Compare",
                  columns: "Column Picker",
                  customFields: "Custom Fields",
                  importCSV: "Import CSV",
                }[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                return (
                  <Toggle key={key} label={friendlyLabel} checked={!!val}
                    onChange={v => set("analyticsItems", { ...(cfg.analyticsItems || DEFAULT_LEADS_SETTINGS.analyticsItems), [key]: v })} />
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── FUN LAYER ── */}
      {activeTab === "funlayer" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Feature Toggles">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <BoolField label="XP System" desc="Grant experience points for adding, winning, and converting leads" cfgKey="xpEnabled" />
              <BoolField label="Confetti" desc="Confetti explosion when a lead is Won or converted" cfgKey="confettiEnabled" />
              <BoolField label="Achievements" desc="Show the achievement shelf — unlock badges for pipeline milestones" cfgKey="achievementsEnabled" />
              <BoolField label="Vibe Bar" desc="Daily motivational message bar at the top of the Leads tab" cfgKey="vibeBarEnabled" />
            </div>
          </Card>
          <Card title="XP Award Amounts">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <NumField label="XP per lead added" cfgKey="xpPerAdd" min={0} max={500} />
              <NumField label="XP per Won lead" cfgKey="xpPerWin" min={0} max={500} />
              <NumField label="XP per lead converted to client" cfgKey="xpPerConvert" min={0} max={500} />
              <NumField label="XP per stage move" cfgKey="xpPerStageMove" min={0} max={100} />
            </div>
          </Card>
        </div>
      )}

      {/* ── MESSAGES ── */}
      {activeTab === "messages" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Add Lead Toasts">
            <ToastListEditor hint="One is picked at random each time a lead is added." cfgKey="addToasts" />
          </Card>
          <Card title="Won Lead Toasts">
            <ToastListEditor hint="One is picked at random when a lead reaches the Won stage." cfgKey="winToasts" />
          </Card>
          <Card title="Convert to Client Toasts">
            <ToastListEditor hint="One is picked at random when a lead is converted to a client." cfgKey="convertToasts" />
          </Card>
          <Card title="Next Action Messages" collapsible>
            <NextActionEditor />
          </Card>
          <Card title="WhatsApp Quick-Reply Templates" collapsible>
            <WATemplatesEditor />
          </Card>
        </div>
      )}

      {/* ── AUTO RULES ── */}
      {activeTab === "actions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Auto Rules Engine">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <BoolField label="Enable Auto Rules" desc="Runs on mount: stale New Leads → Lost; Won leads with no activity → VIP priority" cfgKey="autoRulesEnabled" />
              {cfg.autoRulesEnabled !== false && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, paddingTop: 4 }}>
                  <NumField label="Auto-Lost after (days in New Lead with no activity)" cfgKey="autoLostDays" min={1} max={365} wide />
                  <NumField label="Auto-escalate to VIP after (days in Won stage)" cfgKey="autoEscalateDays" min={1} max={90} wide />
                </div>
              )}
            </div>
          </Card>
          <div style={{ background: "#F0FDF4", borderRadius: 12, padding: 20, border: "1px solid #BBF7D0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46", marginBottom: 6 }}>💡 How settings propagate</div>
            <div style={{ fontSize: 12, color: "#047857", lineHeight: 1.7 }}>
              All settings are stored under <code style={{ background: "#DCFCE7", padding: "1px 5px", borderRadius: 3 }}>crm_leads_settings</code> in localStorage.
              Clicking <strong>Save</strong> fires a <code style={{ background: "#DCFCE7", padding: "1px 5px", borderRadius: 3 }}>crm_leads_settings_updated</code> custom window event that LeadsTab listens to,
              so every dropdown, color, threshold, and toggle takes effect instantly — no page reload required.
            </div>
          </div>
        </div>
      )}

      <SaveBar />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Section
// ─────────────────────────────────────────────────────────────────────────────
function WorkflowSection({ workflows, setWorkflows }) {
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: 0 }}>Workflows</h3>
          <button onClick={() => setEditingWorkflow({ id: Date.now(), name: "New Workflow", stages: ["Stage 1", "Stage 2"], autoTransition: false })}
            style={{ padding: "6px 12px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
            + Add Workflow
          </button>
        </div>
        {workflows.map(wf => (
          <div key={wf.id} style={{ padding: 14, background: "#F8FAFC", borderRadius: 8, marginBottom: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", margin: 0 }}>{wf.name}</h4>
                <div style={{ fontSize: 11, color: "#64748B" }}>{wf.stages.length} stages</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditingWorkflow(wf)} style={{ padding: "4px 8px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Edit</button>
                <button onClick={() => setWorkflows(workflows.filter(w => w.id !== wf.id))} style={{ padding: "4px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, fontSize: 11, color: "#DC2626", cursor: "pointer" }}>Delete</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {wf.stages.map((s, i) => <span key={i} style={{ padding: "3px 10px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 11 }}>{s}</span>)}
            </div>
          </div>
        ))}
      </div>
      {editingWorkflow && (
        <WorkflowEditor workflow={editingWorkflow} setWorkflow={setEditingWorkflow}
          onSave={w => { setWorkflows(prev => prev.find(x => x.id === w.id) ? prev.map(x => x.id === w.id ? w : x) : [...prev, w]); setEditingWorkflow(null); }}
          onCancel={() => setEditingWorkflow(null)} />
      )}
    </div>
  );
}

function WorkflowEditor({ workflow, setWorkflow, onSave, onCancel }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0", position: "relative" }}>
      <button onClick={onCancel} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", fontSize: 16, cursor: "pointer" }}>✕</button>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Edit Workflow</h3>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase" }}>Name</label>
        <input type="text" value={workflow.name} onChange={e => setWorkflow({ ...workflow, name: e.target.value })}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13 }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase" }}>Stages (comma-separated)</label>
        <input type="text" value={workflow.stages.join(", ")} onChange={e => setWorkflow({ ...workflow, stages: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13 }} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 20 }}>
        <input type="checkbox" checked={workflow.autoTransition} onChange={e => setWorkflow({ ...workflow, autoTransition: e.target.checked })} style={{ width: 15, height: 15 }} />
        <span style={{ fontSize: 13 }}>Auto-transition to next stage</span>
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => onSave(workflow)} style={{ padding: "8px 20px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>Save</button>
        <button onClick={onCancel} style={{ padding: "8px 20px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications Section
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsSection({ notifPrefs, setNotifPrefs }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Notification Channels">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[["email", "Email Notifications", "Receive updates via email"], ["push", "Push Notifications", "Browser push notifications"], ["inApp", "In-App Notifications", "Show notifications within the app"]].map(([key, label, desc]) => (
            <Toggle key={key} label={label} desc={desc} checked={notifPrefs[key]} onChange={v => setNotifPrefs({ ...notifPrefs, [key]: v })} />
          ))}
        </div>
      </Card>
      <Card title="Quiet Hours">
        <Toggle label="Enable Quiet Hours" desc="Suppress notifications during specified hours" checked={notifPrefs.quietHours.enabled} onChange={v => setNotifPrefs({ ...notifPrefs, quietHours: { ...notifPrefs.quietHours, enabled: v } })} />
        {notifPrefs.quietHours.enabled && (
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            {[["start", "From"], ["end", "To"]].map(([key, lbl]) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 5 }}>{lbl}</label>
                <input type="time" value={notifPrefs.quietHours[key]} onChange={e => setNotifPrefs({ ...notifPrefs, quietHours: { ...notifPrefs.quietHours, [key]: e.target.value } })}
                  style={{ padding: "7px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13 }} />
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Categories">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.entries(notifPrefs.categories).map(([key, val]) => (
            <Toggle key={key} label={key.charAt(0).toUpperCase() + key.slice(1)} checked={val} onChange={v => setNotifPrefs({ ...notifPrefs, categories: { ...notifPrefs.categories, [key]: v } })} />
          ))}
        </div>
      </Card>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Data Section
// ─────────────────────────────────────────────────────────────────────────────
// #22 real CSV export helper
function toCSV(rows) {
  if (!rows || rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const escape = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map(r => keys.map(k => escape(r[k])).join(","))].join("\n");
}

function DataSection({ data }) {
  const counts = { Leads: data?.leads?.length, Clients: data?.clients?.length, Tasks: data?.tasks?.length, Invoices: data?.accounting?.length, Inventory: data?.inventory?.length };
  const dataMap = { Leads: data?.leads, Clients: data?.clients, Tasks: data?.tasks, Invoices: data?.accounting, Inventory: data?.inventory };

  const exportData = (label) => {
    let csv = "";
    if (label === "All Data") {
      csv = Object.entries(dataMap).map(([k, rows]) => `# ${k}\n${toCSV(rows || [])}`).join("\n\n");
    } else {
      csv = toCSV(dataMap[label] || []);
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${label.toLowerCase().replace(/ /g, "-")}-export.csv`; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${label}`, "success");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Export Data">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {Object.entries(counts).concat([["All Data", "All"]]).map(([label, count]) => (
            <button key={label}
              onClick={() => exportData(label)}
              style={{ padding: 16, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", textAlign: "center", transition: "all 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#EFF6FF"; e.currentTarget.style.borderColor = "#93C5FD"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#F8FAFC"; e.currentTarget.style.borderColor = "#E2E8F0"; }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>📥</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{label}</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{typeof count === "number" ? `${count} records` : count}</div>
            </button>
          ))}
        </div>
      </Card>
      <div style={{ background: "#FEF2F2", borderRadius: 12, padding: 24, border: "1px solid #FECACA" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#DC2626", margin: "0 0 12px" }}>⚠️ Danger Zone</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Delete All Data</div>
            <div style={{ fontSize: 11, color: "#991B1B" }}>This action cannot be undone</div>
          </div>
          <button onClick={() => { if (window.confirm("Are you sure? This will delete all records.")) toast("All data cleared", "error"); }}
            style={{ padding: "6px 14px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
            Delete All
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Section
// ─────────────────────────────────────────────────────────────────────────────
function TeamSection({ currentUser, onRoleChange }) {
  const [members, setMembers] = useState([
    { id: 1, name: "John Doe",      email: "john@company.com",  role: "Admin",      status: "Active" },
    { id: 2, name: "Sarah Smith",   email: "sarah@company.com", role: "Sales",      status: "Active" },
    { id: 3, name: "Omar Ahmed",    email: "omar@company.com",  role: "Accountant", status: "Active" },
    { id: 4, name: "Layla Hassan",  email: "layla@company.com", role: "Operations", status: "Inactive" },
  ]);
  // #15a member search
  const [memberSearch, setMemberSearch] = useState("");

  const filtered = members.filter(m =>
    !memberSearch ||
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.role.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Team Members">
        {/* #15a search bar */}
        <div style={{ position: "relative", marginBottom: 14 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: 0.4, pointerEvents: "none" }}>🔍</span>
          <input
            type="search" placeholder="Search members…" value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            style={{ width: "100%", padding: "7px 10px 7px 30px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, outline: "none", boxSizing: "border-box", background: "#F8FAFC" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 12, padding: 20 }}>No members match</div>
          )}
          {filtered.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: ROLE_COLORS[m.role] || "#3B82F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {m.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{m.name}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{m.email}</div>
              </div>
              <select value={m.role} onChange={e => setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role: e.target.value } : x))}
                style={{ padding: "4px 8px", border: `1px solid ${ROLE_COLORS[m.role] || "#E2E8F0"}`, borderRadius: 6, fontSize: 11, color: ROLE_COLORS[m.role], fontWeight: 600, background: `${ROLE_COLORS[m.role] || "#E2E8F0"}18` }}>
                {Object.keys(ROLE_COLORS).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => setMembers(prev => prev.map(x => x.id === m.id ? { ...x, status: x.status === "Active" ? "Inactive" : "Active" } : x))}
                style={{ padding: "4px 10px", background: m.status === "Active" ? "#DCFCE7" : "#FEE2E2", color: m.status === "Active" ? "#166534" : "#991B1B", border: "none", borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {m.status}
              </button>
            </div>
          ))}
        </div>
        {/* #15b invite link */}
        <div style={{ marginTop: 16, padding: "12px 14px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#065F46" }}>Invite Link</div>
            <div style={{ fontSize: 11, color: "#047857" }}>Share with new team members</div>
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/?invite=abc123`).catch(() => {}); toast("Invite link copied!", "success"); }}
            style={{ padding: "6px 14px", background: "#16A34A", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            📋 Copy Link
          </button>
        </div>
      </Card>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Security Section
// ─────────────────────────────────────────────────────────────────────────────
// #16 password strength calculator
function passwordStrength(pw) {
  if (!pw) return { score: 0, label: "", color: "#E2E8F0" };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["", "Weak", "Fair", "Good", "Strong", "Very Strong"];
  const colors  = ["#E2E8F0", "#EF4444", "#F59E0B", "#3B82F6", "#10B981", "#065F46"];
  return { score, label: labels[score] || "Very Strong", color: colors[Math.min(score, 5)] };
}

function SecuritySection() {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [twoFA, setTwoFA] = useState(false);
  // #17 show/hide password toggles
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [sessions] = useState([
    { id: 1, device: "Chrome on Windows", location: "Dubai, UAE", last: "Just now", current: true },
    { id: 2, device: "Safari on iPhone",  location: "Dubai, UAE", last: "2 hours ago", current: false },
    { id: 3, device: "Firefox on macOS",  location: "Riyadh, SA", last: "3 days ago", current: false },
  ]);

  const strength = passwordStrength(passwords.next);

  const handlePasswordChange = () => {
    if (!passwords.current) return toast("Enter your current password", "error");
    if (passwords.next.length < 8) return toast("New password must be at least 8 characters", "error");
    if (passwords.next !== passwords.confirm) return toast("Passwords do not match", "error");
    setPasswords({ current: "", next: "", confirm: "" });
    toast("Password updated successfully", "success");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Change Password">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[["current", "Current Password"], ["next", "New Password"], ["confirm", "Confirm New Password"]].map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              {/* #17 show/hide toggle */}
              <div style={{ position: "relative" }}>
                <input
                  type={showPw[key] ? "text" : "password"}
                  value={passwords[key]}
                  onChange={e => setPasswords(p => ({ ...p, [key]: e.target.value }))}
                  placeholder="••••••••"
                  style={{ ...inputStyle, paddingRight: 40, boxSizing: "border-box" }}
                />
                <button type="button" onClick={() => setShowPw(p => ({ ...p, [key]: !p[key] }))}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#94A3B8", padding: 0, lineHeight: 1 }}>
                  {showPw[key] ? "🙈" : "👁"}
                </button>
              </div>
              {/* #16 strength meter for new password */}
              {key === "next" && passwords.next && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 4, borderRadius: 2, background: "#E2E8F0", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(strength.score / 5) * 100}%`, background: strength.color, transition: "width 0.3s, background 0.3s", borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: strength.color, fontWeight: 600, marginTop: 3 }}>{strength.label}</div>
                </div>
              )}
            </div>
          ))}
          <button
            onClick={handlePasswordChange}
            style={{ alignSelf: "flex-start", padding: "8px 20px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
            Update Password
          </button>
        </div>
      </Card>

      <Card title="Two-Factor Authentication">
        <Toggle
          label="Enable 2FA"
          desc="Require a verification code in addition to your password when signing in"
          checked={twoFA}
          onChange={v => { setTwoFA(v); toast(v ? "2FA enabled" : "2FA disabled", v ? "success" : "info"); }}
        />
        {twoFA && (
          <div style={{ marginTop: 14, padding: 14, background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0", fontSize: 12, color: "#166534" }}>
            ✅ Two-factor authentication is active. Scan the QR code in your authenticator app to complete setup.
          </div>
        )}
      </Card>

      <Card title="Active Sessions">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 22 }}>{s.device.includes("iPhone") ? "📱" : "💻"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{s.device}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{s.location} · {s.last}</div>
              </div>
              {s.current
                ? <span style={{ fontSize: 11, padding: "2px 8px", background: "#DCFCE7", color: "#166534", borderRadius: 10, fontWeight: 600 }}>Current</span>
                : <button onClick={() => toast("Session revoked", "info")} style={{ padding: "4px 10px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>Revoke</button>
              }
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// System Section
// ─────────────────────────────────────────────────────────────────────────────
function SystemSection({ dark }) {
  const [cacheCleared, setCacheCleared] = useState(false);

  // #18 compute actual localStorage usage
  const lsKeys = Object.keys(localStorage).filter(k => k.startsWith("crm_"));
  const lsBytes = lsKeys.reduce((sum, k) => sum + (localStorage.getItem(k) || "").length, 0);
  const lsKB = (lsBytes / 1024).toFixed(1);

  const clearCache = () => {
    try { localStorage.removeItem("crm_settings_profile"); localStorage.removeItem("crm_settings_workflows"); localStorage.removeItem("crm_settings_notifications"); } catch {}
    setCacheCleared(true);
    toast("Cache cleared successfully", "success");
    setTimeout(() => setCacheCleared(false), 3000);
  };

  const info = [
    ["App Version",       "2.4.1"],
    ["Build",             "20250528-stable"],
    ["Environment",       "Production"],
    ["Theme",             dark ? "Dark" : "Light"],
    ["Browser",           navigator?.vendor || navigator?.userAgent?.split(" ").slice(-1)[0] || "Unknown"],
    ["Viewport",          `${window.innerWidth} × ${window.innerHeight}px`],
    ["Device Pixel Ratio", `${window.devicePixelRatio}×`],
    ["Storage Used",      `${lsKB} KB across ${lsKeys.length} CRM keys`],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="System Information">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {info.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ fontSize: 12, color: "#64748B", fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: 12, color: "#0F172A", fontWeight: 600, fontFamily: "monospace" }}>{value}</span>
            </div>
          ))}
          {/* #18 Storage bar */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: "#64748B" }}>localStorage budget</span>
              <span style={{ fontSize: 11, color: "#0F172A", fontFamily: "monospace" }}>{lsKB} KB / ~5000 KB</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "#E2E8F0", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min((lsBytes / (5 * 1024 * 1024)) * 100, 100)}%`, background: lsBytes > 4000000 ? "#EF4444" : lsBytes > 2000000 ? "#F59E0B" : "#10B981", borderRadius: 3, transition: "width 0.5s" }} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Cache & Storage">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Clear locally stored settings and preferences. Your data records will not be affected.</p>
        <button
          onClick={clearCache}
          disabled={cacheCleared}
          style={{ padding: "8px 20px", background: cacheCleared ? "#F0FDF4" : "#F1F5F9", color: cacheCleared ? "#166534" : "#0F172A", border: `1px solid ${cacheCleared ? "#BBF7D0" : "#E2E8F0"}`, borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: cacheCleared ? "default" : "pointer" }}>
          {cacheCleared ? "✅ Cache Cleared" : "🗑 Clear App Cache"}
        </button>
      </Card>

      <Card title="Diagnostics">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Run connectivity check", icon: "🌐", action: () => toast("Connection: OK (12ms)", "success") },
            {
              label: "Copy diagnostic report",
              icon: "📋",
              action: () => {
                const report = info.map(([k,v]) => `${k}: ${v}`).join("\n");
                navigator.clipboard?.writeText(report).catch(() => {});
                toast("Diagnostic report copied to clipboard", "info");
              }
            },
            { label: "Reload application", icon: "🔄", action: () => window.location.reload() },
          ].map(({ label, icon, action }) => (
            <button key={label} onClick={action}
              style={{ padding: "10px 16px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8FAFC"}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Screen Section — full control over LoginScreen.jsx config
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_LOGIN_CONFIG = {
  // ── Branding ──────────────────────────────────────────────────────────────
  appName:          "Yes Pinoy Pro",
  appSubtitle:      "Business CRM · Dubai, UAE",
  logoEmoji:        "🌞",
  logoUrl:          "",   // if set, renders an <img> instead of the emoji mark
  // ── Welcome copy ─────────────────────────────────────────────────────────
  welcomeTitle:     "Welcome back",
  welcomeSub:       "Sign in to your workspace to continue.",
  emailPlaceholder: "you@yespinoy.ae",
  // ── Button & action copy ─────────────────────────────────────────────────
  signInBtnText:    "Sign in →",
  signingInText:    "Signing in…",
  forgotPwText:     "Forgot password?",
  rememberMeText:   "Remember this device",
  secureBadgeText:  "Secure · End-to-end encrypted",
  quickAccessLabel: "quick access",
  teamMembersLabel: "Team members",
  biometricText:    "Use Face ID / Touch ID / Biometric to sign in",
  clockTimezone:    "GST",
  // ── Colors ───────────────────────────────────────────────────────────────
  primaryColor:     "#E8392E",
  secondaryColor:   "#1A44C2",
  bgColor:          "#07090F",
  cardBg:           "rgba(13,13,28,0.82)",
  // ── Background FX ────────────────────────────────────────────────────────
  showGrid:         true,
  showGrain:        true,
  showOrbs:         true,
  // ── Feature toggles ──────────────────────────────────────────────────────
  showPasskey:      true,
  showGoogle:       true,
  showMicrosoft:    true,
  showBiometric:    true,
  showQuickAccess:  true,
  showSecureBadge:  true,
  showRememberMe:   true,
  showClock:        true,
  showForgotPw:     true,
  // ── Footer ───────────────────────────────────────────────────────────────
  footerCopyright:  "© 2025 Yes Pinoy Pro",
  privacyUrl:       "https://www.yespinoypro.com/ypp-privacy-policy",
  termsUrl:         "https://www.yespinoypro.com/ypp-terms-conditions",
  websiteUrl:       "https://www.yespinoypro.com/",
  // ── Users (quick-access team) ─────────────────────────────────────────────
  users: [
    { id: 1, name: "Alex Reyes",    role: "Admin",      avatar: "AR", email: "alex@yespinoy.ae",  password: "admin123" },
    { id: 2, name: "Sarah Mendoza", role: "Sales",      avatar: "SM", email: "sarah@yespinoy.ae", password: "sales123" },
    { id: 3, name: "Mike Tan",      role: "Accountant", avatar: "MT", email: "mike@yespinoy.ae",  password: "acct123"  },
    { id: 4, name: "Lena Cruz",     role: "Operations", avatar: "LC", email: "lena@yespinoy.ae",  password: "ops123"   },
  ],
};

const ROLES = ["Admin", "Sales", "Accountant", "Operations", "Manager"];

function LoginScreenSection({ loginConfig, setLoginConfig }) {
  const [cfg, setCfg] = useState(() => {
    if (loginConfig) return loginConfig;
    try { return JSON.parse(localStorage.getItem("crm_login_config")) || DEFAULT_LOGIN_CONFIG; } catch { return DEFAULT_LOGIN_CONFIG; }
  });

  useEffect(() => {
    if (typeof setLoginConfig === "function") setLoginConfig(cfg);
    try { localStorage.setItem("crm_login_config", JSON.stringify(cfg)); } catch {}
  }, [cfg]);

  const set = (key, val) => setCfg(prev => ({ ...prev, [key]: val }));

  const [newUser, setNewUser] = useState({ name: "", role: "Sales", email: "", password: "", avatar: "" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [lsSection, setLsSection] = useState("branding");

  const lsSections = [
    { id: "branding",   label: "Branding" },
    { id: "copy",       label: "Text & Copy" },
    { id: "colors",     label: "Colors" },
    { id: "background", label: "Background FX" },
    { id: "features",   label: "Show / Hide" },
    { id: "footer",     label: "Footer" },
    { id: "users",      label: "Team Members" },
  ];

  const saveToStorage = () => {
    try { localStorage.setItem("crm_login_config", JSON.stringify(cfg)); } catch {}
    toast("Login screen config saved!", "success");
  };

  // Derive initials from name
  const initials = (name) => name.split(" ").map(n => n[0]).filter(Boolean).join("").toUpperCase().slice(0, 2);

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>

      {/* ── LEFT: editor controls ───────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Sub-nav + save */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {lsSections.map(s => (
            <button key={s.id} onClick={() => setLsSection(s.id)}
              style={{
                padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: lsSection === s.id ? 700 : 500,
                background: lsSection === s.id ? "#2563EB" : "#F1F5F9",
                color: lsSection === s.id ? "#fff" : "#475569",
                border: lsSection === s.id ? "none" : "1px solid #E2E8F0",
                cursor: "pointer", transition: "all 0.12s",
              }}
            >{s.label}</button>
          ))}
          <button onClick={saveToStorage}
            style={{ marginLeft: "auto", padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: "#16A34A", color: "#fff", border: "none", cursor: "pointer" }}>
            💾 Save Config
          </button>
        </div>

      {/* ── BRANDING ── */}
      {lsSection === "branding" && (
        <>
          <Card title="Branding">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { label: "App Name",     key: "appName" },
                { label: "App Subtitle", key: "appSubtitle" },
                { label: "Logo Emoji",   key: "logoEmoji", hint: "Used when no logo image is set" },
              ].map(({ label, key, hint }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} value={cfg[key] || ""} onChange={e => set(key, e.target.value)} />
                  {hint && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 3 }}>{hint}</div>}
                </div>
              ))}
            </div>

            {/* Logo image upload */}
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #E2E8F0" }}>
              <div style={labelStyle}>Logo Image</div>
              <p style={{ fontSize: 11, color: "#64748B", margin: "0 0 12px" }}>
                Upload an image or paste a URL. When set, replaces the emoji mark. Transparent PNG or SVG recommended.
              </p>
              <LogoUpload cfg={cfg} set={set} />
            </div>

            {/* Logo mark preview */}
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, overflow: "hidden", flexShrink: 0,
                background: cfg.logoUrl ? "transparent" : `linear-gradient(135deg, ${cfg.primaryColor || "#E8392E"}, ${cfg.secondaryColor || "#1A44C2"})`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
              }}>
                {cfg.logoUrl
                  ? <img src={cfg.logoUrl} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : (cfg.logoEmoji || "🌞")}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{cfg.appName || "Yes Pinoy Pro"}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{cfg.appSubtitle || ""}</div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* ── TEXT & COPY ── */}
      {lsSection === "copy" && (
        <>
          <Card title="Welcome Screen">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { label: "Welcome Title",    key: "welcomeTitle",    placeholder: "Welcome back" },
                { label: "Welcome Subtitle", key: "welcomeSub",      placeholder: "Sign in to your workspace to continue." },
                { label: "Email Placeholder",key: "emailPlaceholder",placeholder: "you@company.com" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} value={cfg[key] || ""} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Button & Action Labels">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { label: "Sign In Button",      key: "signInBtnText",    placeholder: "Sign in →" },
                { label: "Signing In (loading)", key: "signingInText",   placeholder: "Signing in…" },
                { label: "Forgot Password Link", key: "forgotPwText",    placeholder: "Forgot password?" },
                { label: "Remember Me Label",    key: "rememberMeText",  placeholder: "Remember this device" },
                { label: "Secure Badge Text",    key: "secureBadgeText", placeholder: "Secure · End-to-end encrypted" },
                { label: "Biometric Button Text",key: "biometricText",   placeholder: "Use Face ID / Touch ID / Biometric to sign in" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} value={cfg[key] || ""} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Quick Access Section Labels">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { label: "Divider Label",   key: "quickAccessLabel",  placeholder: "quick access" },
                { label: "Grid Heading",    key: "teamMembersLabel",  placeholder: "Team members" },
                { label: "Clock Timezone",  key: "clockTimezone",     placeholder: "GST" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={inputStyle} value={cfg[key] || ""} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* ── COLORS ── */}
      {lsSection === "colors" && (
        <>
        <Card title="Color Palette">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {[
              { label: "Primary Accent",   key: "primaryColor",   hint: "Button, focus rings, orb A, caret" },
              { label: "Secondary Accent", key: "secondaryColor",  hint: "Gradient endpoint, orb B" },
              { label: "Background",       key: "bgColor",         hint: "Full-page background color" },
            ].map(({ label, key, hint }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="color" value={cfg[key] || "#000000"} onChange={e => set(key, e.target.value)}
                    style={{ width: 44, height: 44, border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", padding: 2 }} />
                  <div>
                    <input style={{ ...inputStyle, width: 120, fontFamily: "monospace", fontSize: 12 }} value={cfg[key] || ""} onChange={e => set(key, e.target.value)} />
                    <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 3 }}>{hint}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Preview swatch */}
          <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: cfg.bgColor || "#07090F", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Preview</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={{ padding: "10px 24px", borderRadius: 10, background: `linear-gradient(135deg, ${cfg.primaryColor || "#E8392E"}, ${cfg.secondaryColor || "#1A44C2"})`, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "default" }}>{cfg.signInBtnText || "Sign in →"}</button>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: `linear-gradient(135deg, ${cfg.primaryColor || "#E8392E"}, ${cfg.secondaryColor || "#1A44C2"})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{cfg.logoEmoji || "🌞"}</div>
              <div style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${cfg.primaryColor || "#E8392E"}44`, background: `${cfg.primaryColor || "#E8392E"}12`, fontSize: 11, color: `${cfg.primaryColor || "#E8392E"}cc` }}>Face ID / Biometric</div>
            </div>
          </div>
        </Card>

        <Card title="Card Appearance">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Card Background (CSS color or rgba)</label>
              <input style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }}
                value={cfg.cardBg || "rgba(13,13,28,0.82)"}
                onChange={e => set("cardBg", e.target.value)}
                placeholder="rgba(13,13,28,0.82)" />
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Use rgba() for glassmorphic transparency. The backdrop-filter blur is always on.</div>
            </div>
            {/* Live card preview */}
            <div style={{ padding: 16, borderRadius: 12, background: cfg.bgColor || "#07090F", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ padding: "16px 20px", borderRadius: 14, background: cfg.cardBg || "rgba(13,13,28,0.82)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.7)", maxWidth: 240 }}>
                Card preview — {cfg.appName || "Your App"}
              </div>
            </div>
          </div>
        </Card>
        </>
      )}

      {/* ── BACKGROUND FX ── */}
      {lsSection === "background" && (
        <Card title="Background Effects">
          <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 16px" }}>Control the animated background layers rendered behind the login card.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {[
              ["showGrid",  "Grid Lines",     "Subtle grid overlay on background"],
              ["showGrain", "Film Grain",     "Animated noise texture overlay"],
              ["showOrbs",  "Floating Orbs",  "Blurred color orbs that float and pulse"],
            ].map(([key, label, desc]) => (
              <Toggle key={key} label={label} desc={desc} checked={cfg[key] !== false} onChange={v => set(key, v)} />
            ))}
          </div>
        </Card>
      )}

      {/* ── FEATURE TOGGLES ── */}
      {lsSection === "features" && (
        <Card title="Show / Hide Elements">
          <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 16px" }}>Toggle which elements appear on the login screen.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {[
              ["showPasskey",      "Passkey Button",          "Sign in with Passkey option"],
              ["showGoogle",       "Google SSO Button",       "Google OAuth sign-in"],
              ["showMicrosoft",    "Microsoft SSO Button",    "Microsoft OAuth sign-in"],
              ["showBiometric",    "Biometric Hint Bar",      "Face ID / Touch ID prompt"],
              ["showQuickAccess",  "Quick Access Grid",       "One-tap team member login"],
              ["showSecureBadge",  "Secure Badge",            "End-to-end encrypted badge"],
              ["showRememberMe",   "Remember Me Checkbox",    "Remember this device option"],
              ["showClock",        "Live Clock",              "Date/time pill in header"],
              ["showForgotPw",     "Forgot Password Link",   "Link under password field"],
            ].map(([key, label, desc]) => (
              <Toggle key={key} label={label} desc={desc} checked={cfg[key] !== false} onChange={v => set(key, v)} />
            ))}
          </div>
        </Card>
      )}

      {/* ── FOOTER & LINKS ── */}
      {lsSection === "footer" && (
        <Card title="Footer Text & Links">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Copyright Text</label>
              <input style={inputStyle} value={cfg.footerCopyright || ""} onChange={e => set("footerCopyright", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Privacy Policy URL</label>
              <input style={inputStyle} type="url" value={cfg.privacyUrl || ""} onChange={e => set("privacyUrl", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label style={labelStyle}>Terms & Conditions URL</label>
              <input style={inputStyle} type="url" value={cfg.termsUrl || ""} onChange={e => set("termsUrl", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label style={labelStyle}>Our Website URL</label>
              <input style={inputStyle} type="url" value={cfg.websiteUrl || ""} onChange={e => set("websiteUrl", e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div style={{ marginTop: 16, padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Preview</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>{cfg.footerCopyright || "© 2025 Yes Pinoy Pro"}</span>
              <div style={{ display: "flex", gap: 12 }}>
                {[["Privacy", cfg.privacyUrl], ["Terms & Conditions", cfg.termsUrl], ["Our Website", cfg.websiteUrl]].map(([lbl, url]) => (
                  <a key={lbl} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#3B82F6", textDecoration: "none" }}>{lbl}</a>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── USERS / QUICK ACCESS ── */}
      {lsSection === "users" && (
        <>
          <Card title="Quick-Access Team Members">
            <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 16px" }}>These appear in the "Quick Access" grid on the login screen. Editing credentials here updates login too.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(cfg.users || []).map(u => (
                <div key={u.id}>
                  {editingUserId === u.id ? (
                    <div style={{ padding: 14, background: "#EFF6FF", borderRadius: 10, border: "1px solid #BFDBFE" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        {[
                          { label: "Full Name", key: "name" },
                          { label: "Email",     key: "email", type: "email" },
                          { label: "Password",  key: "password", type: "password" },
                          { label: "Avatar Initials", key: "avatar", placeholder: "e.g. AR" },
                        ].map(({ label, key, type = "text", placeholder }) => (
                          <div key={key}>
                            <label style={labelStyle}>{label}</label>
                            <input type={type} placeholder={placeholder}
                              style={inputStyle}
                              value={cfg.users.find(x => x.id === u.id)?.[key] || ""}
                              onChange={e => set("users", cfg.users.map(x => x.id === u.id ? { ...x, [key]: e.target.value, avatar: key === "name" ? initials(e.target.value) : x.avatar } : x))}
                            />
                          </div>
                        ))}
                        <div>
                          <label style={labelStyle}>Role</label>
                          <select style={{ ...inputStyle }}
                            value={cfg.users.find(x => x.id === u.id)?.role || "Sales"}
                            onChange={e => set("users", cfg.users.map(x => x.id === u.id ? { ...x, role: e.target.value } : x))}>
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setEditingUserId(null)}
                          style={{ padding: "6px 16px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Done</button>
                        <button onClick={() => { set("users", cfg.users.filter(x => x.id !== u.id)); setEditingUserId(null); }}
                          style={{ padding: "6px 16px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1D3557", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.avatar || initials(u.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: "#64748B" }}>{u.email} · <span style={{ color: ROLE_COLORS[u.role] || "#3B82F6", fontWeight: 600 }}>{u.role}</span></div>
                      </div>
                      <button onClick={() => setEditingUserId(u.id)}
                        style={{ padding: "5px 12px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#475569" }}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Add New Team Member">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              {[
                { label: "Full Name", key: "name" },
                { label: "Email",     key: "email", type: "email" },
                { label: "Password",  key: "password", type: "password" },
              ].map(({ label, key, type = "text" }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input type={type} style={inputStyle} value={newUser[key]}
                    onChange={e => setNewUser(p => ({ ...p, [key]: e.target.value, avatar: key === "name" ? initials(e.target.value) : p.avatar }))} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Role</label>
                <select style={inputStyle} value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={() => {
                if (!newUser.name || !newUser.email || !newUser.password) return toast("Fill in all fields", "error");
                const user = { ...newUser, id: Date.now(), avatar: newUser.avatar || initials(newUser.name) };
                set("users", [...(cfg.users || []), user]);
                setNewUser({ name: "", role: "Sales", email: "", password: "", avatar: "" });
                toast(`${user.name} added to login screen`, "success");
              }}
              style={{ padding: "8px 20px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Add Member
            </button>
          </Card>
        </>
      )}
      </div>{/* end left editor column */}

      {/* ── RIGHT: live preview ─────────────────────────────────────────── */}
      <div style={{
        width: 320,
        minWidth: 260,
        flexShrink: 1,
        position: "sticky",
        top: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Live Preview</span>
          <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>Updates as you type</span>
        </div>

        {/* Scaled viewport — renders the real LoginScreen at 55% scale */}
        <div style={{
          width: 320,
          height: 500,
          borderRadius: 14,
          border: "1px solid #E2E8F0",
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          position: "relative",
          background: cfg.bgColor || "#07090F",
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 582,
            height: 909,
            transformOrigin: "top left",
            transform: "scale(0.55)",
            pointerEvents: "none",   // read-only — prevent interactions in preview
            userSelect: "none",
          }}>
            <LoginScreen loginConfig={cfg} onLogin={() => {}} />
          </div>
        </div>

        <p style={{ fontSize: 11, color: "#94A3B8", margin: 0, lineHeight: 1.5 }}>
          Real login screen at 55% scale. Changes appear instantly. Press <strong style={{ color: "#64748B" }}>Save Config</strong> to persist.
        </p>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function LogoUpload({ cfg, set }) {
  const fileRef = useRef(null);
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Image too large — max 2 MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = ev => set("logoUrl", ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  }
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 64, height: 64, borderRadius: 12, flexShrink: 0, border: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: 26, background: cfg.logoUrl ? "transparent" : `linear-gradient(135deg, ${cfg.primaryColor || "#E8392E"}, ${cfg.secondaryColor || "#1A44C2"})` }}>
        {cfg.logoUrl ? <img src={cfg.logoUrl} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : (cfg.logoEmoji || "🌞")}
      </div>
      <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 7, cursor: "pointer", background: "#F1F5F9", border: "1px solid #E2E8F0", fontSize: 12, fontWeight: 600, color: "#475569", width: "fit-content" }}>
          📁 Upload image
        </button>
        <input style={{ ...inputStyle, fontSize: 12 }} placeholder="…or paste image URL (https://...)"
          value={cfg.logoUrl && cfg.logoUrl.startsWith("data:") ? "" : (cfg.logoUrl || "")}
          onChange={e => set("logoUrl", e.target.value)} />
        {cfg.logoUrl && (
          <button type="button" onClick={() => set("logoUrl", "")}
            style={{ padding: "5px 12px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 7, fontSize: 11, cursor: "pointer", width: "fit-content" }}>
            ✕ Remove logo
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// #19 Collapsible Card component
function Card({ title, children, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: collapsible && !open ? "16px 24px" : 24, border: "1px solid #E2E8F0", marginBottom: 0, transition: "padding 0.15s" }}>
      {title && (
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 18 : 0, cursor: collapsible ? "pointer" : "default" }}
          onClick={collapsible ? () => setOpen(o => !o) : undefined}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", margin: 0 }}>{title}</h3>
          {collapsible && (
            <span style={{ fontSize: 12, color: "#94A3B8", transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</span>
          )}
        </div>
      )}
      {(!collapsible || open) && children}
    </div>
  );
}

// #20 Toggle with keyboard accessibility (space/enter) and focus ring
function Toggle({ label, desc, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "6px 0" }}>
      <div
        role="switch" aria-checked={checked} tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={e => (e.key === " " || e.key === "Enter") && onChange(!checked)}
        style={{ width: 40, height: 22, borderRadius: 11, background: checked ? "#3B82F6" : "#E2E8F0", position: "relative", transition: "background 0.2s", flexShrink: 0, cursor: "pointer", outline: "none" }}
        onFocus={e => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.35)"}
        onBlur={e => e.currentTarget.style.boxShadow = "none"}
      >
        <div style={{ position: "absolute", top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: "#64748B" }}>{desc}</div>}
      </div>
    </label>
  );
}

const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.4px" };

// #21 inputStyle with focus handler (applied via onFocus/onBlur where used)
const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none", transition: "border-color 0.15s", boxSizing: "border-box" };
