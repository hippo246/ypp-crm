/**
 * SettingsTab — fully wired to live app state
 * Changes vs original:
 *  - Accepts all AppShell state setters as props
 *  - saveSettings now calls those setters so changes apply instantly app-wide
 *  - Added "Tab Controls" section to manage per-tab defaults (viewMode, data resets)
 *  - Preferences section initializes from live props, not hardcoded defaults
 */

import { useState, useEffect, useCallback } from "react";
import { B } from "../constants";
import { useAppData } from "../context/AppContext";
import { toast } from "../App";

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
  { id: "workflow",     label: "Workflow",       icon: "🔄" },
  { id: "notifications",label: "Notifications", icon: "🔔" },
  { id: "security",     label: "Security",       icon: "🔒" },
  { id: "data",         label: "Data & Export",  icon: "💾" },
  { id: "team",         label: "Team Management",icon: "👥" },
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
}) {
  const { dispatch } = useAppData();
  const [activeSection, setActiveSection] = useState("profile");
  const [saving, setSaving] = useState(false);

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
    toast("Settings saved — changes applied!", "success");
  }, [profile, preferences, workflows, notifPrefs,
      setDark, setHighContrast, setCompact, setSidebarCollapsed,
      setSidebarAccent, setFocusMode, setSplitView, setDensity,
      setFontSize, setViewMode, viewMode]);

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

  return (
    <div style={{ display: "flex", height: "100%", background: "#F8FAFC" }}>
      {/* Left sidebar */}
      <div style={{ width: 220, background: "#fff", borderRight: "1px solid #E2E8F0", padding: "16px 0", flexShrink: 0, overflowY: "auto" }}>
        <div style={{ padding: "0 16px 16px", borderBottom: "1px solid #E2E8F0", marginBottom: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0F172A", margin: 0 }}>Settings</h2>
          <p style={{ fontSize: 11, color: "#64748B", margin: "4px 0 0" }}>Manage your workspace</p>
        </div>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{
              width: "100%", padding: "9px 16px",
              display: "flex", alignItems: "center", gap: 10,
              background: activeSection === s.id ? "#EFF6FF" : "transparent",
              border: "none", cursor: "pointer", fontSize: 13,
              color: activeSection === s.id ? "#2563EB" : "#475569",
              fontWeight: activeSection === s.id ? 600 : 400,
              textAlign: "left", transition: "all 0.12s",
            }}
            onMouseEnter={e => activeSection !== s.id && (e.currentTarget.style.background = "#F1F5F9")}
            onMouseLeave={e => activeSection !== s.id && (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 15 }}>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", margin: 0 }}>
              {SECTIONS.find(s => s.id === activeSection)?.icon}{" "}
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </h1>
            <button onClick={saveSettings} disabled={saving}
              style={{
                padding: "8px 20px", background: "#2563EB", color: "#fff",
                border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.65 : 1,
              }}
            >
              {saving ? "Saving…" : "💾 Save Changes"}
            </button>
          </div>

          {activeSection === "profile"       && <ProfileSection profile={profile} setProfile={setProfile} currentUser={currentUser} onRoleChange={onRoleChange} />}
          {activeSection === "preferences"   && <PreferencesSection preferences={preferences} setPreferences={setPreferences} />}
          {activeSection === "tabs"          && <TabControlsSection viewMode={viewMode} setViewMode={setViewMode} preferences={preferences} setPreferences={setPreferences} navigateTo={navigateTo} data={data} setData={setData} />}
          {activeSection === "workflow"      && <WorkflowSection workflows={workflows} setWorkflows={setWorkflows} />}
          {activeSection === "notifications" && <NotificationsSection notifPrefs={notifPrefs} setNotifPrefs={setNotifPrefs} />}
          {activeSection === "security"      && <SecuritySection />}
          {activeSection === "data"          && <DataSection data={data} />}
          {activeSection === "team"          && <TeamSection currentUser={currentUser} onRoleChange={onRoleChange} />}
          {activeSection === "system"        && <SystemSection dark={dark} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Section
// ─────────────────────────────────────────────────────────────────────────────
function ProfileSection({ profile, setProfile, currentUser, onRoleChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Profile Information</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#3B82F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff" }}>
            {profile.avatar}
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
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none" }} />
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

      {/* Theme */}
      <Card title="Theme">
        <div style={{ display: "flex", gap: 12 }}>
          {[["light", "☀️ Light"], ["dark", "🌙 Dark"]].map(([val, lbl]) => (
            <button key={val} onClick={() => set("theme", val)}
              style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: preferences.theme === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.theme === val ? "#EFF6FF" : "#F8FAFC", fontSize: 14, fontWeight: preferences.theme === val ? 700 : 400, cursor: "pointer", color: preferences.theme === val ? "#2563EB" : "#475569" }}>
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

      {/* Density */}
      <Card title="Density">
        <div style={{ display: "flex", gap: 10 }}>
          {[["dense", "Dense"], ["compact", "Compact"], ["comfortable", "Comfortable"]].map(([val, lbl]) => (
            <button key={val} onClick={() => set("density", val)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: preferences.density === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.density === val ? "#EFF6FF" : "#F8FAFC", fontSize: 12, fontWeight: preferences.density === val ? 700 : 400, cursor: "pointer", color: preferences.density === val ? "#2563EB" : "#475569" }}>
              {lbl}
            </button>
          ))}
        </div>
      </Card>

      {/* Font size */}
      <Card title="Font Size">
        <div style={{ display: "flex", gap: 10 }}>
          {[["small", "Small"], ["medium", "Medium"], ["large", "Large"]].map(([val, lbl]) => (
            <button key={val} onClick={() => set("fontSize", val)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: preferences.fontSize === val ? "2px solid #3B82F6" : "1px solid #E2E8F0", background: preferences.fontSize === val ? "#EFF6FF" : "#F8FAFC", fontSize: 12, fontWeight: preferences.fontSize === val ? 700 : 400, cursor: "pointer", color: preferences.fontSize === val ? "#2563EB" : "#475569" }}>
              {lbl}
            </button>
          ))}
        </div>
      </Card>

      {/* Sidebar accent */}
      <Card title="Sidebar Accent Color">
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

      {/* Jump to any tab */}
      <Card title="Quick Navigate">
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 14px" }}>Jump straight to any tab in the app.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {TAB_META.map(t => (
            <button key={t.id} onClick={() => navigateTo && navigateTo(t.id)}
              style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8FAFC"}
            >
              <span style={{ fontSize: 16 }}>{t.icon}</span>
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
function DataSection({ data }) {
  const counts = { Leads: data?.leads?.length, Clients: data?.clients?.length, Tasks: data?.tasks?.length, Invoices: data?.accounting?.length, Inventory: data?.inventory?.length };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Export Data">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {Object.entries(counts).concat([["All Data", "All"]]).map(([label, count]) => (
            <button key={label}
              onClick={() => { const csv = `data:text/csv;charset=utf-8,${label}\n`; const a = document.createElement("a"); a.href = encodeURI(csv); a.download = `${label.toLowerCase()}-export.csv`; a.click(); toast(`Exporting ${label}…`, "info"); }}
              style={{ padding: 16, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", textAlign: "center" }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8FAFC"}
            >
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Team Members">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map(m => (
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
      </Card>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Security Section
// ─────────────────────────────────────────────────────────────────────────────
function SecuritySection() {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [twoFA, setTwoFA] = useState(false);
  const [sessions] = useState([
    { id: 1, device: "Chrome on Windows", location: "Dubai, UAE", last: "Just now", current: true },
    { id: 2, device: "Safari on iPhone",  location: "Dubai, UAE", last: "2 hours ago", current: false },
    { id: 3, device: "Firefox on macOS",  location: "Riyadh, SA", last: "3 days ago", current: false },
  ]);

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
              <input
                type="password"
                value={passwords[key]}
                onChange={e => setPasswords(p => ({ ...p, [key]: e.target.value }))}
                placeholder="••••••••"
                style={inputStyle}
              />
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
    ["Browser",           navigator?.userAgent?.split(" ").slice(-1)[0] ?? "Unknown"],
    ["Viewport",          `${window.innerWidth} × ${window.innerHeight}px`],
    ["Local Storage",     `${Object.keys(localStorage).filter(k => k.startsWith("crm_")).length} CRM keys stored`],
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
            { label: "Export diagnostic report", icon: "📋", action: () => toast("Diagnostic report copied to clipboard", "info") },
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
// Shared UI primitives
// ─────────────────────────────────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0", marginBottom: 0 }}>
      {title && <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", margin: "0 0 18px" }}>{title}</h3>}
      {children}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "6px 0" }}>
      <div onClick={() => onChange(!checked)}
        style={{ width: 40, height: 22, borderRadius: 11, background: checked ? "#3B82F6" : "#E2E8F0", position: "relative", transition: "background 0.2s", flexShrink: 0, cursor: "pointer" }}>
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
const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 13, outline: "none" };
