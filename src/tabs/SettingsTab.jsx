/**
 * SettingsTab — Comprehensive settings management for enterprise CRM
 * 
 * Features:
 * - User profile and preferences
 * - Role and permission management
 * - Workflow configuration
 * - System settings
 * - Theme and display options
 * - Notification preferences
 * - Data and export settings
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
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "preferences", label: "Preferences", icon: "⚙️" },
  { id: "workflow", label: "Workflow", icon: "🔄" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "security", label: "Security", icon: "🔒" },
  { id: "data", label: "Data & Export", icon: "💾" },
  { id: "team", label: "Team Management", icon: "👥" },
  { id: "system", label: "System", icon: "🖥️" },
];

export default function SettingsTab() {
  const { data, setData, dispatch } = useAppData();
  const [activeSection, setActiveSection] = useState("profile");
  const [saving, setSaving] = useState(false);
  
  // Profile state
  const [profile, setProfile] = useState({
    name: "John Doe",
    email: "john@company.com",
    phone: "+971 50 123 4567",
    avatar: "JD",
    timezone: "Asia/Dubai",
    language: "en",
  });

  // Preferences state
  const [preferences, setPreferences] = useState({
    theme: "light",
    density: "comfortable",
    fontSize: "medium",
    sidebarCollapsed: false,
    compactMode: false,
    highContrast: false,
    sidebarAccent: null,
  });

  // Workflow state
  const [workflows, setWorkflows] = useState([
    { id: 1, name: "Lead to Client", stages: ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"], autoTransition: true },
    { id: 2, name: "Invoice Processing", stages: ["Draft", "Sent", "Paid", "Overdue"], autoTransition: false },
  ]);

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({
    email: true,
    push: true,
    inApp: true,
    quietHours: { enabled: false, start: "18:00", end: "09:00" },
    categories: { tasks: true, leads: true, invoices: true, system: true },
  });

  const saveSettings = useCallback(async () => {
    setSaving(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Save to localStorage
    localStorage.setItem("crm_settings_profile", JSON.stringify(profile));
    localStorage.setItem("crm_settings_preferences", JSON.stringify(preferences));
    localStorage.setItem("crm_settings_workflows", JSON.stringify(workflows));
    localStorage.setItem("crm_settings_notifications", JSON.stringify(notifPrefs));
    
    setSaving(false);
    toast("Settings saved successfully", "success");
  }, [profile, preferences, workflows, notifPrefs]);

  useEffect(() => {
    // Load saved settings
    try {
      const savedProfile = localStorage.getItem("crm_settings_profile");
      const savedPrefs = localStorage.getItem("crm_settings_preferences");
      const savedWorkflows = localStorage.getItem("crm_settings_workflows");
      const savedNotifs = localStorage.getItem("crm_settings_notifications");
      
      if (savedProfile) setProfile(JSON.parse(savedProfile));
      if (savedPrefs) setPreferences(JSON.parse(savedPrefs));
      if (savedWorkflows) setWorkflows(JSON.parse(savedWorkflows));
      if (savedNotifs) setNotifPrefs(JSON.parse(savedNotifs));
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", background: "#F8FAFC" }}>
      {/* Sidebar */}
      <div style={{ width: 240, background: "#fff", borderRight: "1px solid #E2E8F0", padding: "16px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 16px 16px", borderBottom: "1px solid #E2E8F0", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", margin: 0 }}>Settings</h2>
          <p style={{ fontSize: 12, color: "#64748B", margin: "4px 0 0" }}>Manage your workspace</p>
        </div>
        {SECTIONS.map(section => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            style={{
              width: "100%",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: activeSection === section.id ? "#EFF6FF" : "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: activeSection === section.id ? "#2563EB" : "#475569",
              fontWeight: activeSection === section.id ? 600 : 400,
              transition: "all 0.15s",
              textAlign: "left",
            }}
            onMouseEnter={e => activeSection !== section.id && (e.currentTarget.style.background = "#F1F5F9")}
            onMouseLeave={e => activeSection !== section.id && (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 16 }}>{section.icon}</span>
            {section.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", margin: 0 }}>
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </h1>
            <button
              onClick={saveSettings}
              disabled={saving}
              style={{
                padding: "8px 20px",
                background: "#2563EB",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
                transition: "all 0.15s",
              }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>

          {activeSection === "profile" && <ProfileSection profile={profile} setProfile={setProfile} />}
          {activeSection === "preferences" && <PreferencesSection preferences={preferences} setPreferences={setPreferences} />}
          {activeSection === "workflow" && <WorkflowSection workflows={workflows} setWorkflows={setWorkflows} />}
          {activeSection === "notifications" && <NotificationsSection notifPrefs={notifPrefs} setNotifPrefs={setNotifPrefs} />}
          {activeSection === "security" && <SecuritySection />}
          {activeSection === "data" && <DataSection />}
          {activeSection === "team" && <TeamSection />}
          {activeSection === "system" && <SystemSection />}
        </div>
      </div>
    </div>
  );
}

// Profile Section
function ProfileSection({ profile, setProfile }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Profile Information</h3>
      
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#3B82F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: "#fff" }}>
          {profile.avatar}
        </div>
        <div>
          <button style={{ padding: "6px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, cursor: "pointer", marginRight: 8 }}>
            Change Photo
          </button>
          <button style={{ padding: "6px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, fontSize: 12, color: "#DC2626", cursor: "pointer" }}>
            Remove
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Full Name</label>
          <input
            type="text"
            value={profile.name}
            onChange={e => setProfile({ ...profile, name: e.target.value })}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Email</label>
          <input
            type="email"
            value={profile.email}
            onChange={e => setProfile({ ...profile, email: e.target.value })}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Phone</label>
          <input
            type="tel"
            value={profile.phone}
            onChange={e => setProfile({ ...profile, phone: e.target.value })}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Timezone</label>
          <select
            value={profile.timezone}
            onChange={e => setProfile({ ...profile, timezone: e.target.value })}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          >
            <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
            <option value="Asia/Kolkata">Asia/Kolkata (GMT+5:30)</option>
            <option value="Europe/London">Europe/London (GMT+0)</option>
            <option value="America/New_York">America/New_York (GMT-5)</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// Preferences Section
function PreferencesSection({ preferences, setPreferences }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Appearance</h3>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Theme</label>
          <div style={{ display: "flex", gap: 12 }}>
            {["light", "dark", "auto"].map(theme => (
              <button
                key={theme}
                onClick={() => setPreferences({ ...preferences, theme })}
                style={{
                  padding: "10px 20px",
                  background: preferences.theme === theme ? "#EFF6FF" : "#F8FAFC",
                  border: preferences.theme === theme ? "2px solid #3B82F6" : "1px solid #E2E8F0",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: preferences.theme === theme ? 600 : 400,
                  textTransform: "capitalize",
                }}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Density</label>
          <select
            value={preferences.density}
            onChange={e => setPreferences({ ...preferences, density: e.target.value })}
            style={{ padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          >
            <option value="dense">Dense</option>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Font Size</label>
          <select
            value={preferences.fontSize}
            onChange={e => setPreferences({ ...preferences, fontSize: e.target.value })}
            style={{ padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={preferences.compactMode}
              onChange={e => setPreferences({ ...preferences, compactMode: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13 }}>Compact Mode</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={preferences.highContrast}
              onChange={e => setPreferences({ ...preferences, highContrast: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13 }}>High Contrast</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={preferences.sidebarCollapsed}
              onChange={e => setPreferences({ ...preferences, sidebarCollapsed: e.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13 }}>Collapse Sidebar by Default</span>
          </label>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>Sidebar Accent</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            type="color"
            value={preferences.sidebarAccent || "#1a2f4a"}
            onChange={e => setPreferences({ ...preferences, sidebarAccent: e.target.value })}
            style={{ width: 40, height: 40, border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer" }}
          />
          <button
            onClick={() => setPreferences({ ...preferences, sidebarAccent: null })}
            style={{ padding: "6px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}

// Workflow Section
function WorkflowSection({ workflows, setWorkflows }) {
  const [editingWorkflow, setEditingWorkflow] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: 0 }}>Workflows</h3>
          <button
            onClick={() => setEditingWorkflow({ id: Date.now(), name: "New Workflow", stages: ["Stage 1", "Stage 2"], autoTransition: false })}
            style={{ padding: "6px 12px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
          >
            + Add Workflow
          </button>
        </div>

        {workflows.map(workflow => (
          <div key={workflow.id} style={{ padding: 16, background: "#F8FAFC", borderRadius: 8, marginBottom: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", margin: "0 0 4px" }}>{workflow.name}</h4>
                <div style={{ fontSize: 11, color: "#64748B" }}>{workflow.stages.length} stages</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setEditingWorkflow(workflow)}
                  style={{ padding: "4px 8px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setWorkflows(workflows.filter(w => w.id !== workflow.id))}
                  style={{ padding: "4px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, fontSize: 11, color: "#DC2626", cursor: "pointer" }}
                >
                  Delete
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {workflow.stages.map((stage, idx) => (
                <div key={idx} style={{ padding: "4px 10px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, fontSize: 11 }}>
                  {stage}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editingWorkflow && (
        <WorkflowEditor workflow={editingWorkflow} setWorkflow={setEditingWorkflow} onSave={(w) => {
          if (workflows.find(wf => wf.id === w.id)) {
            setWorkflows(workflows.map(wf => wf.id === w.id ? w : wf));
          } else {
            setWorkflows([...workflows, w]);
          }
          setEditingWorkflow(null);
        }} onCancel={() => setEditingWorkflow(null)} />
      )}
    </div>
  );
}

function WorkflowEditor({ workflow, setWorkflow, onSave, onCancel }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0", position: "relative" }}>
      <button
        onClick={onCancel}
        style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", fontSize: 16, cursor: "pointer" }}
      >
        ✕
      </button>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px" }}>{workflow.id ? "Edit Workflow" : "New Workflow"}</h3>
      
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Workflow Name</label>
        <input
          type="text"
          value={workflow.name}
          onChange={e => setWorkflow({ ...workflow, name: e.target.value })}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Stages (comma-separated)</label>
        <input
          type="text"
          value={workflow.stages.join(", ")}
          onChange={e => setWorkflow({ ...workflow, stages: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 20 }}>
        <input
          type="checkbox"
          checked={workflow.autoTransition}
          onChange={e => setWorkflow({ ...workflow, autoTransition: e.target.checked })}
          style={{ width: 16, height: 16 }}
        />
        <span style={{ fontSize: 13 }}>Auto-transition to next stage</span>
      </label>

      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={() => onSave(workflow)}
          style={{ padding: "8px 20px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
        >
          Save Workflow
        </button>
        <button
          onClick={onCancel}
          style={{ padding: "8px 20px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Notifications Section
function NotificationsSection({ notifPrefs, setNotifPrefs }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Notification Channels</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={notifPrefs.email}
              onChange={e => setNotifPrefs({ ...notifPrefs, email: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Email Notifications</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>Receive updates via email</div>
            </div>
          </label>
          
          <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={notifPrefs.push}
              onChange={e => setNotifPrefs({ ...notifPrefs, push: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Push Notifications</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>Browser push notifications</div>
            </div>
          </label>
          
          <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={notifPrefs.inApp}
              onChange={e => setNotifPrefs({ ...notifPrefs, inApp: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>In-App Notifications</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>Show notifications within the app</div>
            </div>
          </label>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Quiet Hours</h3>
        
        <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={notifPrefs.quietHours.enabled}
            onChange={e => setNotifPrefs({ ...notifPrefs, quietHours: { ...notifPrefs.quietHours, enabled: e.target.checked } })}
            style={{ width: 18, height: 18 }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Enable Quiet Hours</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Suppress notifications during specified hours</div>
          </div>
        </label>

        {notifPrefs.quietHours.enabled && (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>From</label>
              <input
                type="time"
                value={notifPrefs.quietHours.start}
                onChange={e => setNotifPrefs({ ...notifPrefs, quietHours: { ...notifPrefs.quietHours, start: e.target.value } })}
                style={{ padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>To</label>
              <input
                type="time"
                value={notifPrefs.quietHours.end}
                onChange={e => setNotifPrefs({ ...notifPrefs, quietHours: { ...notifPrefs.quietHours, end: e.target.value } })}
                style={{ padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Notification Categories</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(notifPrefs.categories).map(([key, value]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={value}
                onChange={e => setNotifPrefs({ ...notifPrefs, categories: { ...notifPrefs.categories, [key]: e.target.checked } })}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: 13, textTransform: "capitalize" }}>{key}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// Security Section
function SecuritySection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Password</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Current Password</label>
            <input type="password" style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>New Password</label>
            <input type="password" style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 13 }} />
          </div>
        </div>
        
        <button style={{ padding: "8px 20px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
          Update Password
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Two-Factor Authentication</h3>
        
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Enable 2FA</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Add an extra layer of security</div>
          </div>
          <button style={{ padding: "6px 12px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
            Enable
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Active Sessions</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { device: "Chrome on Windows", location: "Dubai, UAE", time: "Current session" },
            { device: "Safari on iPhone", location: "Dubai, UAE", time: "2 hours ago" },
          ].map((session, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#F8FAFC", borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{session.device}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{session.location} • {session.time}</div>
              </div>
              {idx > 0 && (
                <button style={{ padding: "4px 8px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 4, fontSize: 11, color: "#DC2626", cursor: "pointer" }}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Data Section
function DataSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Export Data</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[
            { label: "Leads", icon: "◎", count: 156 },
            { label: "Clients", icon: "⬡", count: 89 },
            { label: "Tasks", icon: "◈", count: 234 },
            { label: "Invoices", icon: "◆", count: 67 },
            { label: "Inventory", icon: "▤", count: 445 },
            { label: "All Data", icon: "📦", count: "All" },
          ].map(item => (
            <button
              key={item.label}
              style={{ padding: 16, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#EFF6FF"}
              onMouseLeave={e => e.currentTarget.style.background = "#F8FAFC"}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{item.label}</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{typeof item.count === "number" ? `${item.count} records` : item.count}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Import Data</h3>
        
        <div style={{ padding: 32, border: "2px dashed #E2E8F0", borderRadius: 8, textAlign: "center", cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#3B82F6"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#E2E8F0"}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#0F172A", marginBottom: 4 }}>Drop files here or click to upload</div>
          <div style={{ fontSize: 12, color: "#64748B" }}>Supports CSV, Excel (max 10MB)</div>
        </div>
      </div>

      <div style={{ background: "#FEF2F2", borderRadius: 12, padding: 24, border: "1px solid #FECACA" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#DC2626", margin: "0 0 12px"">Danger Zone</h3>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Delete All Data</div>
            <div style={{ fontSize: 11, color: "#991B1B"">This action cannot be undone</div>
          </div>
          <button style={{ padding: "6px 12px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
            Delete All
          </button>
        </div>
      </div>
    </div>
  );
}

// Team Section
function TeamSection() {
  const [members] = useState([
    { id: 1, name: "John Doe", email: "john@company.com", role: "Admin", status: "Active" },
    { id: 2, name: "Sarah Smith", email: "sarah@company.com", role: "Sales", status: "Active" },
    { id: 3, name: "Omar Ahmed", email: "omar@company.com", role: "Accountant", status: "Active" },
    { id: 4, name: "Layla Hassan", email: "layla@company.com", role: "Operations", status: "Inactive" },
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: 0 }}>Team Members</h3>
          <button style={{ padding: "6px 12px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
            + Invite Member
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {members.map(member => (
            <div key={member.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: ROLE_COLORS[member.role], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>
                {member.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>{member.name}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{member.email}</div>
              </div>
              <span style={{ padding: "4px 10px", background: `${ROLE_COLORS[member.role]}22`, color: ROLE_COLORS[member.role], borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                {member.role}
              </span>
              <span style={{ padding: "4px 10px", background: member.status === "Active" ? "#DCFCE7" : "#FEE2E2", color: member.status === "Active" ? "#166534" : "#991B1B", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                {member.status}
              </span>
              <button style={{ padding: "4px 8px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                ⋯
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Role Permissions</h3>
        
        {Object.entries(ROLE_COLORS).map(([role, color]) => (
          <div key={role} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#F8FAFC", borderRadius: 8, marginBottom: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: color }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{role}</span>
            <button style={{ padding: "4px 8px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
              Configure
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// System Section
function SystemSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">System Information</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>Version</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>2.4.1</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>Last Updated</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>May 30, 2026</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>Database Status</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#16A34A" }}>● Connected</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>Storage Used</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>2.4 GB / 10 GB</div>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Performance</h3>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#64748B"">API Response Time</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>120ms</span>
            </div>
            <div style={{ height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: "24%", height: "100%", background: "#3B82F6", borderRadius: 3 }} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#64748B"">Database Queries</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>45ms avg</span>
            </div>
            <div style={{ height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: "15%", height: "100%", background: "#16A34A", borderRadius: 3 }} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#64748B"">Memory Usage</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>512 MB</span>
            </div>
            <div style={{ height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: "51%", height: "100%", background: "#F59E0B", borderRadius: 3 }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0F172A", margin: "0 0 20px"">Logs & Debug</h3>
        
        <button style={{ padding: "8px 16px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12, cursor: "pointer", marginBottom: 12 }}>
          Download System Logs
        </button>
        
        <div style={{ padding: 12, background: "#1E1E1E", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#D4D4D4", maxHeight: 200, overflowY: "auto" }}>
          <div>[2026-05-30 10:23:45] INFO: User login successful</div>
          <div>[2026-05-30 10:23:46] INFO: Dashboard loaded</div>
          <div>[2026-05-30 10:24:12] INFO: Lead created #1234</div>
          <div>[2026-05-30 10:25:33] WARN: API response time exceeded threshold</div>
          <div>[2026-05-30 10:26:01] INFO: Settings updated</div>
        </div>
      </div>
    </div>
  );
}
