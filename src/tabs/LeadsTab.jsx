import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId, parseOperatorQuery } from "../helpers";
import { useTableFilterV2, useSortedData, usePagination, useSearchSuggestions } from "../hooks";
import { useAppData } from "../context/AppContext";
import {
  scoreLead,
  scoreLabel,
  findDuplicates,
  getPipelineStats,
  getStaleLeads,
  getLostReasons,
} from "../services/crmEngine";
import workflowEngine from "../services/workflowEngine";
import { useMultiUserSync } from "../hooks/useMultiUserSync";
import { toast } from "../App";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import { EnterpriseLoader, TableSkeleton, CardSkeleton } from "../components/EnterpriseLoader";

// ─── Pipeline definition (overrides crmEngine) ────────────────────────────────
// Kanban columns — merged orientation stages for cleaner board
// "Orientation Payment Pending" and "Orientation Scheduled" are statuses only (not columns)
const PIPELINE_STAGES = [
  "New Lead",
  "Contacted",
  "Orientation Invited",
  "Orientation Paid",
  "Orientation Attended",
  "Follow-Up",
  "Interested",
  "Reserved",
  "Won",
];

// Full status list (all stages + sub-statuses) — used in dropdowns
const ALL_STATUS_STAGES = [
  "New Lead",
  "Contacted",
  "Orientation Invited",
  "Orientation Payment Pending",
  "Orientation Paid",
  "Orientation Scheduled",
  "Orientation Attended",
  "Follow-Up",
  "Interested",
  "Reservation Pending",
  "Reserved",
  "Won",
];
const CLOSED_STAGES = ["Not Interested", "Lost", "No Response", "Duplicate"];
const ALL_PIPELINE_STAGES = [...ALL_STATUS_STAGES, ...CLOSED_STAGES];
// FormModal intentionally removed — Add Lead now uses the 3-step AddLeadModal

// ─── Window width hook ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    let raf;
    const handler = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWidth(window.innerWidth)); };
    window.addEventListener("resize", handler);
    return () => { window.removeEventListener("resize", handler); cancelAnimationFrame(raf); };
  }, []);
  return width;
}

// ─── Tab view cache (persists display mode across tab switches) ────────────────
const VIEW_CACHE_KEY = "leadsTab_displayMode";
function getCachedView() {
  try { return sessionStorage.getItem(VIEW_CACHE_KEY) || "table"; } catch { return "table"; }
}
function setCachedView(v) {
  try { sessionStorage.setItem(VIEW_CACHE_KEY, v); } catch {}
}

// ─── Master Leads Settings Config — every configurable inch ───────────────────
// Exported so SettingsTab can import it for its editor defaults.
export const DEFAULT_LEADS_SETTINGS = {
  // ── Dropdown options ─────────────────────────────────────────────────────────
  serviceOptions:  ["Self Sponsored Visa", "Business License", "Divorce", "Online Wedding", "OFW Loan", "Family Visa", "Visit Visa", "A2A Visa Change", "B2B Visa Change"],
  statusOptions:   ["New Lead", "Contacted", "Orientation Invited", "Orientation Payment Pending", "Orientation Paid", "Orientation Scheduled", "Orientation Attended", "Follow-Up", "Interested", "Reservation Pending", "Reserved", "Won", "Not Interested", "Lost", "No Response", "Duplicate"],
  sourceOptions:   ["Facebook", "Google", "Referral", "Instagram", "Walk-in", "Other"],
  lostOptions:     ["Price", "Competitor", "No response", "Changed mind", "Other"],
  priorityOptions: ["Low", "Medium", "High", "VIP"],
  staffOptions:    ["Ahmed", "Sarah", "Omar", "Layla"],
  tagOptions:      ["VIP", "Urgent", "Arabic speaker", "Needs callback", "Cold lead", "Government", "Returning"],

  // ── Stage identification ──────────────────────────────────────────────────────
  wonStage:  "Won",
  lostStages: ["Not Interested", "Lost", "No Response", "Duplicate"],
  lostStage: "Lost",  // legacy — use lostStages[] for multi-stage closed checks

  // ── Colors ───────────────────────────────────────────────────────────────────
  stageColors:    { "New Lead": "#6366f1", "Contacted": "#f59e0b", "Orientation Invited": "#3b82f6", "Orientation Payment Pending": "#f97316", "Orientation Paid": "#06b6d4", "Orientation Scheduled": "#8b5cf6", "Orientation Attended": "#ec4899", "Follow-Up": "#eab308", "Interested": "#14b8a6", "Reservation Pending": "#f97316", "Reserved": "#6366f1", "Won": "#10b981", "Not Interested": "#94a3b8", "Lost": "#ef4444", "No Response": "#64748b", "Duplicate": "#a855f7" },
  priorityColors: { VIP: "#7c3aed", High: "#ef4444", Medium: "#f59e0b", Low: "#64748b" },
  scoreColors:    { Hot: "#ef4444", Warm: "#f59e0b", Cold: "#3b82f6" },

  // ── Follow-up thresholds ─────────────────────────────────────────────────────
  followUpSoonDays: 3,        // days ahead = blue "In Xd"; beyond = green

  // ── SLA thresholds ───────────────────────────────────────────────────────────
  slaWarningHours: 24,        // hours since last contact → yellow warning
  slaBreachHours:  48,        // hours since last contact → red SLA breach

  // ── Health score thresholds ───────────────────────────────────────────────────
  healthThresholdHealthy:   80,  // score >= → "Healthy"
  healthThresholdAttention: 40,  // score >= → "Needs Attention"; below → "Neglected"

  // ── Stage age thresholds ─────────────────────────────────────────────────────
  stageAgeWarnDays:   7,   // days in stage → yellow pill
  stageAgeDangerDays: 14,  // days in stage → red pill

  // ── Temperature algorithm ────────────────────────────────────────────────────
  tempDecayRate:      2,     // score points lost per day of inactivity
  tempBoostGreen:     15,    // boost: follow-up is upcoming (green)
  tempBoostBlue:      8,     // boost: follow-up is soon (blue/3d)
  tempPenaltyRed:     20,    // penalty: follow-up is overdue (red)
  tempBoostVIP:       20,    // boost: VIP priority
  tempBoostHigh:      10,    // boost: High priority
  tempBoostValue:     10,    // boost: lead value > highValueThreshold
  tempBoostContact1d: 15,    // boost: contacted within 1 day
  tempBoostContact3d: 8,     // boost: contacted within 3 days
  highValueThreshold: 10000, // AED value needed for tempBoostValue to apply

  // ── Temperature label thresholds ─────────────────────────────────────────────
  tempHotThreshold:  75,  // score >= → "🔥 Hot"
  tempWarmThreshold: 45,  // score >= → "🌡 Warm"
  tempCoolThreshold: 20,  // score >= → "❄ Cool"; below → "🧊 Cold"

  // ── Auto-rules ───────────────────────────────────────────────────────────────
  autoRulesEnabled: true,
  autoLostDays:     30,   // days in "New" with no activity → auto-move to Lost
  autoEscalateDays: 7,    // days in "Won" → auto-escalate priority to VIP

  // ── Pipeline health score weights (must add up to 100) ───────────────────────
  healthWeightOverdue:    30,
  healthWeightStale:      20,
  healthWeightDupes:      15,
  healthWeightUnassigned: 20,
  healthWeightNoValue:    15,
  healthScoreGood:        75,  // score >= → "healthy" (green)
  healthScoreWarn:        50,  // score >= → "needs attention" (yellow); below → "critical" (red)

  // ── Display defaults ─────────────────────────────────────────────────────────
  defaultDisplayMode: "table",   // "table" | "kanban" | "cards"
  defaultPageSize:    25,

  // ── Fun layer toggles ─────────────────────────────────────────────────────────
  xpEnabled:           false,
  confettiEnabled:     false,
  achievementsEnabled: false,
  vibeBarEnabled:      false,
  xpPerAdd:            10,
  xpPerWin:            25,
  xpPerConvert:        40,
  xpPerStageMove:      5,

  // ── UI element visibility ─────────────────────────────────────────────────────
  showStatCards:   true,
  showDupesCard:   true,
  showOverdueCard: true,
  showLostReasons: true,
  showSpeedDial:   true,

  // ── Column visibility (admin-controlled) ──────────────────────────────────
  // Disabled by default to keep the table clean; enable in Settings → Leads
  showColScore:         false,  // Lead score badge
  showColHealth:        false,  // Health % pill
  showColTemperature:   false,  // 🔥 Hot / Cold temp
  showColEstClose:      false,  // Estimated close date
  showColTags:          false,  // Tags multi-select
  statCardCount:   5,   // how many pipeline-stage stat cards to show (max 6)

  // ── Analytics menu items (each toggleable) ────────────────────────────────────
  analyticsItems: {
    reminders:    true,
    funnel:       true,
    goals:        true,
    health:       true,
    sourceROI:    true,
    staffROI:     true,
    forecast:     true,
    winLoss:      true,
    heatmap:      true,
    compare:      true,
    columns:      true,
    customFields: true,
    importCSV:    true,
  },

  // ── Goal Tracker defaults ─────────────────────────────────────────────────────
  goalDefaults: { wonTarget: 10, revenueTarget: 100000, leadsTarget: 30 },

  // ── Detail Drawer ─────────────────────────────────────────────────────────────
  docChecklistItems: ["Emirates ID", "Passport", "Visa Copy", "Trade License", "MOA", "Proof of Address", "Bank Statement", "NOC Letter"],
  snoozeOptions:     [1, 3, 7, 14],
  recurrenceOptions: [3, 7, 14, 30],

  // ── Heatmap ───────────────────────────────────────────────────────────────────
  heatmapDays: 63,

  // ── Currency ─────────────────────────────────────────────────────────────────
  currencyLabel: "AED",

  // ── Next action messages (icon + text per status) ─────────────────────────────
  nextActions: {
    "overdue":  { icon: "📞", text: "Call — overdue follow-up" },
    "New Lead":  { icon: "📞", text: "Call & assign salesman" },
    "Contacted":  { icon: "📝", text: "Add call notes" },
    "Orientation Invited":  { icon: "💳", text: "Send payment link" },
    "Orientation Payment Pending":  { icon: "⏳", text: "Chase orientation fee" },
    "Orientation Paid":  { icon: "📅", text: "Schedule orientation" },
    "Orientation Scheduled":  { icon: "🔔", text: "Send reminder" },
    "Orientation Attended":  { icon: "📞", text: "Follow up within 24h" },
    "Follow-Up":  { icon: "💬", text: "Answer questions & close" },
    "Interested":  { icon: "📄", text: "Generate quotation" },
    "Reservation Pending":  { icon: "⏳", text: "Chase reservation payment" },
    "Reserved":  { icon: "📋", text: "Explain requirements" },
    "Won":  { icon: "🪪", text: "Create client & case" },
    "Not Interested":  { icon: "💬", text: "Re-engage in 30 days" },
    "Lost":  { icon: "💬", text: "Re-engage in 30 days" },
    "No Response":  { icon: "📞", text: "Try again tomorrow" },
    "Duplicate":  { icon: "🔍", text: "Merge with original" },
  },

  // ── Toast messages ────────────────────────────────────────────────────────────
  addToasts:     ["Lead added to pipeline.", "New lead created.", "Lead registered successfully.", "Added to pipeline."],
  winToasts:     ["Lead marked as Won.", "Deal closed successfully.", "Won — ready for handover.", "Closed and won."],
  convertToasts: ["Lead converted to client.", "Client record created.", "Conversion complete."],

  // ── WhatsApp quick-reply templates ───────────────────────────────────────────
  waTemplates: [
    { label: "📄 Docs Reminder", text: "Hi {name}, please send us your Emirates ID copy." },
    { label: "📅 Appt Reminder", text: "Hi {name}, just a reminder for your appointment tomorrow." },
  ],
};

// ─── Field definitions — always derived from settings at runtime ───────────────
// These module-level constants are kept as FALLBACK defaults only.
// All components that render dropdowns now receive cfg and read cfg.xxxOptions.
const SERVICE_OPTIONS  = DEFAULT_LEADS_SETTINGS.serviceOptions;
const STATUS_OPTIONS   = DEFAULT_LEADS_SETTINGS.statusOptions;
const SOURCE_OPTIONS   = DEFAULT_LEADS_SETTINGS.sourceOptions;
const LOST_OPTIONS     = ["", ...DEFAULT_LEADS_SETTINGS.lostOptions];
const PRIORITY_OPTIONS = ["", ...DEFAULT_LEADS_SETTINGS.priorityOptions];
const STAFF_OPTIONS    = ["", ...DEFAULT_LEADS_SETTINGS.staffOptions];
const TAG_OPTIONS_DEFAULT = DEFAULT_LEADS_SETTINGS.tagOptions;

// ─── Leads Settings — load from localStorage, merged with defaults ─────────────
const LEADS_SETTINGS_KEY = "crm_leads_settings";

function loadLeadsSettings() {
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
  return DEFAULT_LEADS_SETTINGS;
}

// Hook: returns live settings and a refresh trigger so components re-read on change
function useLeadsSettings() {
  const [cfg, setCfg] = useState(() => loadLeadsSettings());
  useEffect(() => {
    // Re-read settings whenever the storage key changes (e.g. SettingsTab saved)
    const handler = (e) => {
      if (e.key === LEADS_SETTINGS_KEY || !e.key) setCfg(loadLeadsSettings());
    };
    window.addEventListener("storage", handler);
    // Also expose a custom event for same-tab updates
    const localHandler = () => setCfg(loadLeadsSettings());
    window.addEventListener("crm_leads_settings_updated", localHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("crm_leads_settings_updated", localHandler);
    };
  }, []);
  return cfg;
}


// ─── Follow-up status helper ───────────────────────────────────────────────────
function getFollowUpStatus(followUpDate, cfg) {
  if (!followUpDate) return null;
  const soonDays = cfg?.followUpSoonDays ?? 3;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(followUpDate + "T00:00:00"); due.setHours(0, 0, 0, 0);
  const diff  = (due - today) / 86_400_000;
  if (diff < 0)          return { label: `Overdue ${Math.abs(Math.round(diff))}d`, color: "#ef4444", bg: "#fef2f2", icon: "🔴" };
  if (diff === 0)        return { label: "Today",   color: "#f59e0b", bg: "#fffbeb", icon: "🟡" };
  if (diff <= soonDays)  return { label: `In ${Math.round(diff)}d`, color: "#3b82f6", bg: "#eff6ff", icon: "🔵" };
  return { label: followUpDate, color: "#10b981", bg: "#f0fdf4", icon: "🟢" };
}

// ─── Lead health score ─────────────────────────────────────────────────────────
function getHealthScore(lead, cfg) {
  let score = 0;
  if (lead.followUpDate) score += 20;
  if (lead.notes && lead.notes.length > 10) score += 20;
  if (lead.email || lead.phone) score += 20;
  if (lead.assignedTo) score += 20;
  const fu = getFollowUpStatus(lead.followUpDate, cfg);
  if (!fu || fu.color !== "#ef4444") score += 20; // no overdue
  return score;
}
function getHealthLabel(score, cfg) {
  const healthy   = cfg?.healthThresholdHealthy   ?? 80;
  const attention = cfg?.healthThresholdAttention ?? 40;
  if (score >= healthy)   return { label: "Healthy",         color: "#10b981" };
  if (score >= attention) return { label: "Needs Attention", color: "#f59e0b" };
  return { label: "Neglected", color: "#ef4444" };
}

// ─── Stage age helper ──────────────────────────────────────────────────────────
function getDaysInStage(lead) {
  // Prefer stageEnteredAt (set by workflowEngine on transitions) so routine
  // field edits (value, notes, assignee) don't reset the stage-age clock.
  const ref = lead.stageEnteredAt || lead.updatedAt || lead.date;
  if (!ref) return 0;
  const ts = new Date(ref).getTime();
  if (isNaN(ts)) return 0;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

// ─── Next action suggestions ───────────────────────────────────────────────────
function getNextAction(lead, cfg) {
  const na = cfg?.nextActions || DEFAULT_LEADS_SETTINGS.nextActions;
  const fu = getFollowUpStatus(lead.followUpDate, cfg);
  if (fu && fu.color === "#ef4444") return na.overdue || { icon: "📞", text: "Call — overdue follow-up" };
  return na[lead.status] || null;
}

// ─── Temperature auto-decay ────────────────────────────────────────────────────
function getTemperature(lead, cfg) {
  const c = cfg || DEFAULT_LEADS_SETTINGS;
  const days = getDaysInStage(lead);
  const fu = getFollowUpStatus(lead.followUpDate, cfg);
  let temp = 100;
  temp -= Math.min(50, days * (c.tempDecayRate ?? 2));
  if (fu && fu.color === "#10b981") temp += (c.tempBoostGreen ?? 15);
  if (fu && fu.color === "#3b82f6") temp += (c.tempBoostBlue ?? 8);
  if (fu && fu.color === "#ef4444") temp -= (c.tempPenaltyRed ?? 20);
  if (lead.priority === "VIP")  temp += (c.tempBoostVIP  ?? 20);
  if (lead.priority === "High") temp += (c.tempBoostHigh ?? 10);
  if ((lead.value || 0) > (c.highValueThreshold ?? 10000)) temp += (c.tempBoostValue ?? 10);
  if (lead.lastContactedAt || lead.lastContacted) {
    const ts = new Date(lead.lastContactedAt || lead.lastContacted).getTime();
    if (!isNaN(ts)) {
      const d = Math.floor((Date.now() - ts) / 86400000);
      if (d <= 1) temp += (c.tempBoostContact1d ?? 15);
      else if (d <= 3) temp += (c.tempBoostContact3d ?? 8);
      else temp -= d;
    }
  }
  return Math.max(0, Math.min(100, Math.round(temp)));
}
function getTempLabel(t, cfg) {
  const c = cfg || DEFAULT_LEADS_SETTINGS;
  if (t >= (c.tempHotThreshold  ?? 75)) return { label: "🔥 Hot",  color: "#ef4444", bg: "#fef2f2" };
  if (t >= (c.tempWarmThreshold ?? 45)) return { label: "🌡 Warm", color: "#f59e0b", bg: "#fffbeb" };
  if (t >= (c.tempCoolThreshold ?? 20)) return { label: "❄ Cool",  color: "#3b82f6", bg: "#eff6ff" };
  return                                        { label: "🧊 Cold", color: "#94a3b8", bg: "#f8fafc" };
}

// ─── SLA / Response Timer ──────────────────────────────────────────────────────
function getSLAStatus(lead, cfg) {
  const c = cfg || DEFAULT_LEADS_SETTINGS;
  const warnH  = c.slaWarningHours ?? 24;
  const breachH = c.slaBreachHours ?? 48;
  const wonStage  = c.wonStage  || "Won";
  const closedStages = ["Not Interested","Lost","No Response","Duplicate"];
  const ref = lead.lastContactedAt || lead.lastContacted || lead.date;
  if (!ref) return null;
  const refTs = new Date(ref).getTime();
  if (isNaN(refTs)) return null;
  const hours = Math.floor((Date.now() - refTs) / 3600000);
  if (lead.status === wonStage || closedStages.includes(lead.status)) return null;
  if (hours < warnH)  return { label: `${hours}h ago`,                  color: "#10b981", bg: "#f0fdf4", urgent: false };
  if (hours < breachH) return { label: `${Math.floor(hours/24)}d ago`,  color: "#f59e0b", bg: "#fffbeb", urgent: false };
  return { label: `${Math.floor(hours/24)}d — SLA breach`,              color: "#ef4444", bg: "#fef2f2", urgent: true };
}

// ─── Fun layer: vibes, XP, achievements, confetti, toasts ────────────────────

const LEAD_VIBES = [
  { hour: [6,11],  emoji: "☀️", msg: "Morning pipeline check. Let's fill that funnel." },
  { hour: [11,14], emoji: "🔥", msg: "Midday grind. Those leads won't chase themselves." },
  { hour: [14,17], emoji: "⚡", msg: "Afternoon push. Close something today." },
  { hour: [17,20], emoji: "🌆", msg: "Golden hour. One more Win before EOD?" },
  { hour: [20,24], emoji: "🌙", msg: "Night mode. Dedication level: unmatched." },
  { hour: [0,6],   emoji: "🦉", msg: "Can't sleep? Your pipeline is restless too." },
];



const LEAD_ACHIEVEMENTS = [
  { id: "first_lead",   icon: "🌱", title: "First Blood",       desc: "Added your first lead",                        check: (ls) => ls.length >= 1 },
  { id: "ten_leads",    icon: "📊", title: "Pipeline Builder",  desc: "10+ leads in the system",                      check: (ls) => ls.length >= 10 },
  { id: "first_win",    icon: "🏆", title: "First Win",         desc: "Closed your first Won lead",                   check: (ls) => ls.some(l => l.status === "Won") },
  { id: "five_wins",    icon: "🔥", title: "On Fire",           desc: "5+ Won leads",                                 check: (ls) => ls.filter(l => l.status === "Won").length >= 5 },
  { id: "vip_lead",     icon: "👑", title: "VIP Whisperer",     desc: "A VIP priority lead in the pipeline",          check: (ls) => ls.some(l => l.priority === "VIP") },
  { id: "clean_pipe",   icon: "✨", title: "Clean Pipeline",    desc: "Zero overdue follow-ups",                      check: (ls) => ls.length > 0 && ls.filter(l => { const fu = getFollowUpStatus(l.followUpDate); return fu && fu.color === "#ef4444"; }).length === 0 },
  { id: "delegator",    icon: "🤝", title: "Delegation King",   desc: "Leads assigned to 3+ different staff members", check: (ls) => new Set(ls.map(l => l.assignedTo).filter(Boolean)).size >= 3 },
  { id: "big_deal",     icon: "💎", title: "Big Deal Energy",   desc: "A single lead worth AED 50,000+",              check: (ls) => ls.some(l => (l.value || 0) >= 50000) },
];

function spawnConfetti(x, y) {
  const colors = ["#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#ec4899","#06b6d4"];
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden`;
  document.body.appendChild(container);
  for (let i = 0; i < 60; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size  = 6 + Math.random() * 8;
    const angle = Math.random() * 360;
    const vx    = (Math.random() - 0.5) * 400;
    const vy    = -200 - Math.random() * 300;
    el.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${color};
      left:${x}px;top:${y}px;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};
      transform:rotate(${angle}deg);opacity:1;transition:none`;
    container.appendChild(el);
    const start = performance.now();
    const dur   = 900 + Math.random() * 600;
    const spin  = (Math.random() - 0.5) * 720;
    const animate = (now) => {
      const t = Math.min((now - start) / dur, 1);
      el.style.left    = `${x + vx * t}px`;
      el.style.top     = `${y + (vy * t + 300 * t * t)}px`;
      el.style.opacity = String(1 - t);
      el.style.transform = `rotate(${angle + spin * t}deg)`;
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  setTimeout(() => { if (document.body.contains(container)) document.body.removeChild(container); }, 1600);
}

let _toastCounter = 0;
function useLeadToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, icon = "🎯", type = "lead", title = null) => {
    const id = ++_toastCounter;
    setToasts(t => [...t.slice(-4), { id, msg, icon, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);
  return { toasts, push };
}

function LeadToastStack({ toasts }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99998, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "achievement" ? "linear-gradient(135deg,#1e293b,#0f172a)" : "#1e293b",
          color: "#fff", padding: "12px 18px", borderRadius: 12,
          fontSize: 13, fontWeight: 600, maxWidth: 320,
          boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          borderLeft: t.type === "achievement" ? "4px solid #f59e0b" : "4px solid #10b981",
          animation: "leadSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1)",
          display: "flex", alignItems: "center", gap: 10,
          pointerEvents: "all",
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{t.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {t.title && <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{t.title}</div>}
            <div style={{ lineHeight: 1.4, wordBreak: "break-word" }}>{t.msg}</div>
          </div>
        </div>
      ))}
      <style>{`@keyframes leadSlideIn{from{transform:translateX(120%) scale(0.9);opacity:0}to{transform:translateX(0) scale(1);opacity:1}}`}</style>
    </div>
  );
}

function LeadXPBar({ xp }) {
  const level   = Math.floor(xp / 100) + 1;
  const pct     = xp % 100;
  const titles  = ["Intern","Junior","Analyst","Senior","Manager","Director","VP","C-Suite","Legend","GOD MODE"];
  const title   = titles[Math.min(level - 1, titles.length - 1)];
  const colors  = ["#94a3b8","#60a5fa","#34d399","#a78bfa","#f59e0b","#f97316","#ef4444","#ec4899","#06b6d4","#fbbf24"];
  const color   = colors[Math.min(level - 1, colors.length - 1)];
  const xpToNext = 100 - pct;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 14px", transition: "box-shadow 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: `${color}18`, border: `2px solid ${color}40`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 15, lineHeight: 1 }}>⚡</div>
        <div style={{ fontSize: 8, fontWeight: 900, color, letterSpacing: 0.3, textTransform: "uppercase", marginTop: 1 }}>{level}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color }}>{title}</span>
          <span style={{ fontSize: 10, color: "#94a3b8", background: "#f8fafc", borderRadius: 4, padding: "1px 5px" }}>{xp.toLocaleString()} XP</span>
        </div>
        <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${color}99,${color})`, borderRadius: 99, transition: "width 0.8s cubic-bezier(0.34,1.2,0.64,1)", boxShadow: `0 0 6px ${color}60` }} />
        </div>
        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{xpToNext} XP to Lv.{level + 1}</div>
      </div>
    </div>
  );
}

function LeadAchievementShelf({ leads, newlyUnlocked }) {
  const unlocked = LEAD_ACHIEVEMENTS.filter(a => a.check(leads));
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🏆 Achievements</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {LEAD_ACHIEVEMENTS.map(a => {
          const done  = a.check(leads);
          const isNew = newlyUnlocked.includes(a.id);
          return (
            <div key={a.id} title={`${a.title}: ${a.desc}`} style={{
              width: 38, height: 38, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, cursor: "default",
              background: done ? (isNew ? "#fef9c3" : "#f8fafc") : "#f8fafc",
              border: `1px solid ${done ? (isNew ? "#f59e0b" : "#e2e8f0") : "#e2e8f0"}`,
              opacity: done ? 1 : 0.3,
              filter: done ? "none" : "grayscale(1)",
              transform: isNew ? "scale(1.15)" : "scale(1)",
              transition: "all 0.3s ease",
              boxShadow: isNew ? "0 0 0 3px #f59e0b40" : "none",
            }}>
              {a.icon}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>
        <span style={{ color: unlocked.length === LEAD_ACHIEVEMENTS.length ? "#10b981" : "#94a3b8", fontWeight: unlocked.length === LEAD_ACHIEVEMENTS.length ? 700 : 400 }}>
          {unlocked.length}/{LEAD_ACHIEVEMENTS.length} unlocked
        </span>
        {" "}— hover for details
      </div>
    </div>
  );
}

function LeadDailyVibeBar() {
  const h    = new Date().getHours();
  const vibe = LEAD_VIBES.find(v => h >= v.hour[0] && h < v.hour[1]) || LEAD_VIBES[0];
  const day  = new Date().toLocaleDateString("en", { weekday: "long" });
  const isMonday = new Date().getDay() === 1;
  const isFriday = new Date().getDay() === 5;
  const bonus = isMonday ? " Monday? More like money day." : isFriday ? " Friday! Close at least one before you clock out." : "";
  return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, border: "1px solid #334155" }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{vibe.emoji}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", lineHeight: 1.4 }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{day} · Your boss has no idea how hard you're working right now.</div>
      </div>
    </div>
  );
}

// ─── Quick follow-up date helper ──────────────────────────────────────────────
function _dateOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

// ─── Service-specific hints ────────────────────────────────────────────────────
const SERVICE_HINTS = {
  "Divorce":             "Marital status is required for this service.",
  "Online Wedding":      "Marital status + partner details recommended.",
  "OFW Loan":            "Monthly income & employer important for approval.",
  "Business License":    "Trade License and MOA documents likely needed.",
  "Family Visa":         "Passport & Emirates ID for all family members required.",
  "Self Sponsored Visa": "Visa status & passport are required.",
  "A2A Visa Change":     "Current visa copy and passport required.",
  "B2B Visa Change":     "Current visa copy and passport required.",
};

// ─── Duplicate detection banner ────────────────────────────────────────────────
function DupeBanner({ leads, phone, email }) {
  const dupes = (leads || []).filter(l => {
    const lp = (l.phone || "").replace(/\s/g, "");
    const le = (l.email || "").toLowerCase();
    const cp = (phone || "").replace(/\s/g, "");
    const ce = (email || "").toLowerCase();
    return (cp && lp && lp === cp) || (ce && le && le === ce);
  });
  if (!dupes.length) return null;
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, fontSize: 12 }}>
      <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
      <div>
        <div style={{ fontWeight: 700, color: "#c2410c" }}>{dupes.length} existing lead{dupes.length > 1 ? "s" : ""} match this phone/email</div>
        <div style={{ color: "#9a3412", marginTop: 2 }}>{dupes.map(d => `${d.name} (${d.status})`).join(" · ")}</div>
      </div>
    </div>
  );
}

// ─── 3-Step Add Lead Modal ────────────────────────────────────────────────────

function AddLeadModal({ onSave, onClose, cfg: cfgProp, existingLeads }) {
  const cfg = cfgProp || DEFAULT_LEADS_SETTINGS;
  const _serviceOptions  = cfg.serviceOptions  || SERVICE_OPTIONS;
  const _statusOptions   = cfg.statusOptions   || STATUS_OPTIONS;
  const _sourceOptions   = cfg.sourceOptions   || SOURCE_OPTIONS;
  const _priorityOptions = ["", ...(cfg.priorityOptions || DEFAULT_LEADS_SETTINGS.priorityOptions)];
  const _staffOptions    = ["", ...(cfg.staffOptions    || DEFAULT_LEADS_SETTINGS.staffOptions)];
  const _tagOptions      = cfg.tagOptions      || DEFAULT_LEADS_SETTINGS.tagOptions;

  const [mode, setMode] = useState("basic");
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});

  // ── Step 1: Identity & Personal
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [phone,       setPhone]       = useState("");
  const [whatsapp,    setWhatsapp]    = useState("");
  const [source,      setSource]      = useState(_sourceOptions[0] || "Other");
  const [nationality, setNationality] = useState("");
  const [dob,         setDob]         = useState("");
  const [gender,      setGender]      = useState("");
  const [address,     setAddress]     = useState("");
  const [passportNo,  setPassportNo]  = useState("");
  const [emiratesId,  setEmiratesId]  = useState("");
  const [campaign,    setCampaign]    = useState("");

  // ── Step 2: Deal & Operations
  const [service,       setService]       = useState(_serviceOptions[0] || "Self Sponsored Visa");
  const [status,        setStatus]        = useState(_statusOptions[0]  || "New Lead");
  const [priority,      setPriority]      = useState("");
  const [value,         setValue]         = useState("");
  const [assignedTo,    setAssignedTo]    = useState("");
  const [notes,         setNotes]         = useState("");
  const [followUpDate,  setFollowUpDate]  = useState("");
  const [estimatedClose,setEstimatedClose]= useState("");
  const [lastContacted, setLastContacted] = useState("");
  const [tags,          setTags]          = useState([]);
  const [lostReason,    setLostReason]    = useState("");
  const [reservationAmt,setReservationAmt]= useState("");
  const [orientationType,setOrientationType]=useState("");
  const [maritalStatus,  setMaritalStatus]  = useState("");
  const [occupation,     setOccupation]     = useState("");
  const [employer,       setEmployer]       = useState("");
  const [monthlyIncome,  setMonthlyIncome]  = useState("");
  const [visaStatus,     setVisaStatus]     = useState("");
  const [referredBy,     setReferredBy]     = useState("");
  const [whatsappOptIn,  setWhatsappOptIn]  = useState(true);
  const [language,       setLanguage]       = useState("");

  // ── NEW: extra flexibility fields ────────────────────────────────────────────
  const [firstCallNote, setFirstCallNote] = useState("");

  const toggleTag = (t) => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  // Auto-fill WhatsApp from phone on blur
  const handlePhoneBlur = () => { if (phone && !whatsapp) setWhatsapp(phone); };

  const inp = (extra = {}, fieldKey) => ({
    style: {
      width: "100%", padding: "9px 12px", fontSize: 13,
      border: `1.5px solid ${fieldKey && errors[fieldKey] ? "#fca5a5" : "#e2e8f0"}`,
      borderRadius: 8, fontFamily: "inherit",
      outline: "none", boxSizing: "border-box",
      background: fieldKey && errors[fieldKey] ? "#fff5f5" : "#fff",
      transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
      ...extra,
    },
    onFocus: e => {
      e.target.style.borderColor = fieldKey && errors[fieldKey] ? "#f87171" : "#6366f1";
      e.target.style.boxShadow = fieldKey && errors[fieldKey] ? "0 0 0 3px #fee2e2" : "0 0 0 3px #eef2ff";
      e.target.style.background = "#fafbff";
    },
    onBlur: e => {
      e.target.style.borderColor = fieldKey && errors[fieldKey] ? "#fca5a5" : "#e2e8f0";
      e.target.style.boxShadow = "none";
      e.target.style.background = fieldKey && errors[fieldKey] ? "#fff5f5" : "#fff";
    },
  });
  const sel = (extra = {}, fieldKey) => ({
    style: {
      width: "100%", padding: "9px 12px", fontSize: 13,
      border: `1.5px solid ${fieldKey && errors[fieldKey] ? "#fca5a5" : "#e2e8f0"}`,
      borderRadius: 8, fontFamily: "inherit",
      outline: "none", background: fieldKey && errors[fieldKey] ? "#fff5f5" : "#fff",
      cursor: "pointer",
      transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
      ...extra,
    },
    onFocus: e => {
      e.target.style.borderColor = fieldKey && errors[fieldKey] ? "#f87171" : "#6366f1";
      e.target.style.boxShadow = fieldKey && errors[fieldKey] ? "0 0 0 3px #fee2e2" : "0 0 0 3px #eef2ff";
    },
    onBlur: e => {
      e.target.style.borderColor = fieldKey && errors[fieldKey] ? "#fca5a5" : "#e2e8f0";
      e.target.style.boxShadow = "none";
    },
  });
  const lbl = (text, required, hint) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
      {text}{required && <span style={{ color: "#ef4444" }}>*</span>}
      {hint && <span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8", textTransform: "none", letterSpacing: 0 }}>({hint})</span>}
    </div>
  );
  const sectionHdr = (icon, text) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 4px", borderBottom: "1.5px solid #f1f5f9", marginBottom: 4, marginTop: 4 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.6 }}>{text}</span>
    </div>
  );

  const validateStep1 = () => {
    const e = {};
    if (!name.trim()) e.name = "Name is required";
    if (!phone.trim() && !email.trim()) e.phone = "Phone or email required";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Invalid email format";
    return e;
  };

  const _buildLeadObj = (overrides = {}) => {
    const today = new Date().toISOString().slice(0, 10);
    const timeline = firstCallNote ? [{ date: today, text: `📞 Initial note: ${firstCallNote}` }] : [];
    return {
      name, email, phone, whatsapp: whatsapp || phone, source, service, status, priority,
      value: value ? Number(value) : "", assignedTo, notes, nationality, dob, gender,
      address, passportNo, emiratesId, campaign, followUpDate, estimatedClose, lastContacted,
      tags, lostReason, reservationAmount: reservationAmt ? Number(reservationAmt) : "",
      orientationType, maritalStatus, occupation, employer,
      monthlyIncome: monthlyIncome ? Number(monthlyIncome) : "", visaStatus, referredBy,
      whatsappOptIn, language, timeline, callLog: firstCallNote ? [{ date: today, note: firstCallNote, staff: assignedTo || "" }] : [],
      quickNotes: [],
      ...overrides,
    };
  };

  const _resetForm = () => {
    setName(""); setEmail(""); setPhone(""); setWhatsapp(""); setSource(_sourceOptions[0] || "Other");
    setNationality(""); setDob(""); setGender(""); setAddress(""); setPassportNo(""); setEmiratesId(""); setCampaign("");
    setService(_serviceOptions[0] || "Self Sponsored Visa"); setStatus(_statusOptions[0] || "New Lead");
    setPriority(""); setValue(""); setAssignedTo(""); setNotes(""); setFollowUpDate("");
    setEstimatedClose(""); setLastContacted(""); setTags([]); setLostReason(""); setReservationAmt("");
    setOrientationType(""); setMaritalStatus(""); setOccupation(""); setEmployer(""); setMonthlyIncome("");
    setVisaStatus(""); setReferredBy(""); setWhatsappOptIn(true); setLanguage(""); setFirstCallNote(""); setErrors({});
  };

  const handleBasicSave = (andAnother = false) => {
    const e = validateStep1();
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave(_buildLeadObj({ status: "New Lead", priority: "", value: "", assignedTo: "", notes: "", nationality: "", dob: "", gender: "", tags: [] }));
    if (andAnother) { _resetForm(); } else { onClose(); }
  };
  const handleNext = () => {
    if (step === 1) { const e = validateStep1(); if (Object.keys(e).length) { setErrors(e); return; } setErrors({}); }
    setStep(s => s + 1);
  };
  const handleSave = (andAnother = false) => {
    const e = validateStep1();
    if (Object.keys(e).length) { setErrors(e); setStep(1); return; }
    onSave(_buildLeadObj());
    if (andAnother) { _resetForm(); setStep(1); } else { onClose(); }
  };

  const STEP_LABELS = ["Identity & Personal", "Deal & Operations", "Review & Confirm"];
  const stageColor = { "New Lead":"#6366f1","Contacted":"#f59e0b","Orientation Invited":"#3b82f6","Orientation Payment Pending":"#f97316","Orientation Paid":"#06b6d4","Orientation Scheduled":"#8b5cf6","Orientation Attended":"#ec4899","Follow-Up":"#eab308","Interested":"#14b8a6","Reservation Pending":"#f97316","Reserved":"#6366f1","Won":"#10b981","Not Interested":"#94a3b8","Lost":"#ef4444","No Response":"#64748b","Duplicate":"#a855f7" };
  const completeness = (() => {
    const filled = [name, phone||email, service, status, source, nationality, assignedTo, followUpDate, tags.length > 0, notes].filter(Boolean).length;
    return Math.round((filled / 10) * 100);
  })();

  // ── Cmd+Enter to save ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (mode === "basic") handleBasicSave(false);
        else if (step === 3) handleSave(false);
        else if (step < 3) handleNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, step, handleBasicSave, handleSave, handleNext]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close guard ────────────────────────────────────────────────────────────
  const handleClose = () => {
    const dirty = name || phone || email || notes || nationality || campaign || value || assignedTo;
    if (dirty && !window.confirm("You have unsaved changes. Discard and close?")) return;
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={handleClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.55)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 18, width: mode === "basic" ? 440 : 600, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.28)" }} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className="ti ti-user-plus" style={{ fontSize: 16, color: "#fff" }} />
                </div>
                Add New Lead
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {mode === "basic" ? "⚡ Quick add — name, phone & service · ⌘↵ to save" : `Step ${step} of 3 · ${STEP_LABELS[step - 1]} · ⌘↵ to ${step < 3 ? "advance" : "save"}`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 2, gap: 1 }}>
                {[["basic","Quick"], ["advanced","Full"]].map(([m, label]) => (
                  <button key={m} onClick={() => { setMode(m); setStep(1); }} style={{
                    padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: mode === m ? 700 : 400,
                    background: mode === m ? "#fff" : "none", color: mode === m ? "#2563eb" : "#94a3b8",
                    cursor: "pointer", fontFamily: "inherit", boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    transition: "all 0.12s", textTransform: "capitalize",
                  }}>{label}</button>
                ))}
              </div>
              <button onClick={handleClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 7, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 14, cursor: "pointer", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.color = "#94a3b8"; }}>✕</button>
            </div>
          </div>

          {/* Step progress — advanced only */}
          {mode === "advanced" && (
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {STEP_LABELS.map((label, i) => (
                <div key={label} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "none" }}>
                  <button onClick={() => { if (i + 1 < step) setStep(i + 1); }} style={{
                    display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: i + 1 < step ? "pointer" : "default", padding: 0,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800,
                      background: step > i + 1 ? "#10b981" : step === i + 1 ? "linear-gradient(135deg,#2563eb,#7c3aed)" : "#f1f5f9",
                      color: step >= i + 1 ? "#fff" : "#94a3b8",
                      transition: "all 0.2s", boxShadow: step === i + 1 ? "0 0 0 3px #dbeafe" : "none",
                    }}>
                      {step > i + 1 ? "✓" : i + 1}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: step === i + 1 ? 700 : 400, color: step === i + 1 ? "#2563eb" : step > i + 1 ? "#10b981" : "#94a3b8", whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                  {i < 2 && <div style={{ flex: 1, height: 2, background: step > i + 1 ? "#10b981" : "#e2e8f0", margin: "0 8px", borderRadius: 2 }} />}
                </div>
              ))}
            </div>
          )}

          {/* Completeness bar — advanced only */}
          {mode === "advanced" && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${completeness}%`, height: "100%", background: completeness >= 80 ? "#10b981" : completeness >= 40 ? "#f59e0b" : "#6366f1", borderRadius: 99, transition: "width 0.3s ease" }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, minWidth: 72, color: completeness >= 80 ? "#059669" : completeness >= 40 ? "#d97706" : "#4f46e5" }}>
                {completeness >= 80 ? "✓ Excellent" : completeness >= 40 ? "Good" : `${completeness}% filled`}
              </span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>

          {/* ── Duplicate banner (always visible) ── */}
          <DupeBanner leads={existingLeads} phone={phone} email={email} />

          {/* ── BASIC MODE ── */}
          {mode === "basic" && (
            <>
              <div>
                {lbl("Full Name", true)}
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ahmed Al Mansouri" autoFocus {...inp({}, "name")} />
                {errors.name && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.name}</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  {lbl("Phone", true)}
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 000 0000" {...inp({}, "phone")} />
                  {errors.phone && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.phone}</div>}
                </div>
                <div>
                  {lbl("Email")}
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" {...inp({}, "email")} />
                  {errors.email && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.email}</div>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  {lbl("Service")}
                  <select value={service} onChange={e => setService(e.target.value)} {...sel()}>
                    {_serviceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  {lbl("Source")}
                  <select value={source} onChange={e => setSource(e.target.value)} {...sel()}>
                    {_sourceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                {lbl("Initial Note", false, "logged to timeline")}
                <input value={firstCallNote} onChange={e => setFirstCallNote(e.target.value)} placeholder="First contact context, what they asked about…" {...inp()} />
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
                Need priority, value, tags or docs? Switch to <button onClick={() => { setMode("advanced"); setStep(1); }} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 700, fontSize: 11, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Full mode</button>.
              </div>
            </>
          )}

          {/* ── ADVANCED MODE ── */}
          {mode === "advanced" && (
            <>
              {/* ── Step 1: Identity & Personal ── */}
              {step === 1 && (
                <>
                  {sectionHdr("👤", "Contact Details")}
                  <div>
                    {lbl("Full Name", true)}
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ahmed Al Mansouri" autoFocus {...inp({}, "name")} />
                    {errors.name && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.name}</div>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Phone", true)}
                      <input value={phone} onChange={e => setPhone(e.target.value)} onBlur={handlePhoneBlur} placeholder="+971 50 000 0000" {...inp({}, "phone")} />
                      {errors.phone && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.phone}</div>}
                    </div>
                    <div>
                      {lbl("WhatsApp", false, "auto-filled from phone")}
                      <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="Same as phone if blank" {...inp()} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Email")}
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" {...inp({}, "email")} />
                      {errors.email && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.email}</div>}
                    </div>
                    <div>
                      {lbl("Lead Source")}
                      <select value={source} onChange={e => setSource(e.target.value)} {...sel()}>
                        {_sourceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    {lbl("Campaign / Ad Set", false, "optional")}
                    <input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. FB – Visa Ad Oct" {...inp()} />
                  </div>

                  {sectionHdr("🪪", "Personal Information")}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Nationality")}
                      <input value={nationality} onChange={e => setNationality(e.target.value)} placeholder="e.g. Filipino" {...inp()} />
                    </div>
                    <div>
                      {lbl("Date of Birth")}
                      <input type="date" value={dob} onChange={e => setDob(e.target.value)} {...inp()} />
                    </div>
                    <div>
                      {lbl("Gender")}
                      <select value={gender} onChange={e => setGender(e.target.value)} {...sel()}>
                        <option value="">— Select —</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Passport No.")}
                      <input value={passportNo} onChange={e => setPassportNo(e.target.value)} placeholder="AB1234567" {...inp()} />
                    </div>
                    <div>
                      {lbl("Emirates ID")}
                      <input value={emiratesId} onChange={e => setEmiratesId(e.target.value)} placeholder="784-XXXX-XXXXXXX-X" {...inp()} />
                    </div>
                  </div>
                  <div>
                    {lbl("Address")}
                    <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Apartment, building, area, emirate…" {...inp()} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Marital Status")}
                      <select value={maritalStatus} onChange={e => setMaritalStatus(e.target.value)} {...sel()}>
                        <option value="">— Select —</option>
                        {["Single","Married","Divorced","Widowed"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      {lbl("Preferred Language")}
                      <select value={language} onChange={e => setLanguage(e.target.value)} {...sel()}>
                        <option value="">— Select —</option>
                        {["Arabic","English","Tagalog","Hindi","Urdu","French","Other"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Visa Status")}
                      <select value={visaStatus} onChange={e => setVisaStatus(e.target.value)} {...sel()}>
                        <option value="">— Select —</option>
                        {["Visit Visa","Employment Visa","Family Visa","Tourist Visa","Cancelled","Overstay","Other"].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      {lbl("Referred By")}
                      <input value={referredBy} onChange={e => setReferredBy(e.target.value)} placeholder="Name or lead ID" {...inp()} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Occupation")}
                      <input value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="e.g. Engineer, Teacher" {...inp()} />
                    </div>
                    <div>
                      {lbl("Employer")}
                      <input value={employer} onChange={e => setEmployer(e.target.value)} placeholder="Company name" {...inp()} />
                    </div>
                  </div>
                  <div>
                    {lbl("Monthly Income (AED)", false, "optional")}
                    <input type="number" value={monthlyIncome} onChange={e => setMonthlyIncome(e.target.value)} placeholder="e.g. 8000" min={0} {...inp()} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                    <input type="checkbox" id="waOptIn" checked={whatsappOptIn} onChange={e => setWhatsappOptIn(e.target.checked)} style={{ accentColor: "#25d366", width: 14, height: 14 }} />
                    <label htmlFor="waOptIn" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, cursor: "pointer" }}>💬 WhatsApp marketing opt-in</label>
                  </div>
                </>
              )}

              {/* ── Step 2: Deal & Operations ── */}
              {step === 2 && (
                <>
                  {/* Service hint */}
                  {SERVICE_HINTS[service] && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#fffbeb", border: "1px solid #fed7aa", borderRadius: 7, fontSize: 11, color: "#92400e" }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>💡</span>
                      <span><strong>{service}:</strong> {SERVICE_HINTS[service]}</span>
                    </div>
                  )}
                  {sectionHdr("💼", "Service & Pipeline")}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Service", true)}
                      <select value={service} onChange={e => setService(e.target.value)} {...sel()}>
                        {_serviceOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      {lbl("Pipeline Stage")}
                      <select value={status} onChange={e => setStatus(e.target.value)} {...sel({ color: stageColor[status] || "#334155", fontWeight: 600 })}>
                        {_statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Priority")}
                      <select value={priority} onChange={e => setPriority(e.target.value)} {...sel()}>
                        {_priorityOptions.map(o => <option key={o || "none"} value={o}>{o || "— None —"}</option>)}
                      </select>
                    </div>
                    <div>
                      {lbl("Lead Value (AED)")}
                      <input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" min={0} {...inp()} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Assign To")}
                      <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} {...sel()}>
                        {_staffOptions.map(o => <option key={o || "u"} value={o}>{o || "— Unassigned —"}</option>)}
                      </select>
                    </div>
                    <div>
                      {lbl("Reservation Amount")}
                      <input type="number" value={reservationAmt} onChange={e => setReservationAmt(e.target.value)} placeholder="0" min={0} {...inp()} />
                    </div>
                  </div>
                  <div>
                    {lbl("Orientation Type", false, "if applicable")}
                    <select value={orientationType} onChange={e => setOrientationType(e.target.value)} {...sel()}>
                      <option value="">— None —</option>
                      <option value="Group">Group Orientation</option>
                      <option value="Private">Private Orientation</option>
                      <option value="Online">Online / Virtual</option>
                      <option value="Walk-in">Walk-in</option>
                    </select>
                  </div>

                  {sectionHdr("📅", "Dates & Follow-up")}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      {lbl("Follow-up Date")}
                      <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                        {[["Today",0],["Tomorrow",1],["+3d",3],["+1w",7],["+2w",14]].map(([label,days]) => (
                          <button key={label} type="button" onClick={() => setFollowUpDate(_dateOffset(days))}
                            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, border: `1px solid ${followUpDate === _dateOffset(days) ? "#6366f1" : "#e2e8f0"}`, background: followUpDate === _dateOffset(days) ? "#eef2ff" : "#f8fafc", cursor: "pointer", color: followUpDate === _dateOffset(days) ? "#6366f1" : "#64748b", fontWeight: 600 }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} {...inp()} />
                    </div>
                    <div>
                      {lbl("Estimated Close")}
                      <input type="date" value={estimatedClose} onChange={e => setEstimatedClose(e.target.value)} {...inp()} />
                    </div>
                    <div>
                      {lbl("Last Contacted")}
                      <input type="date" value={lastContacted} onChange={e => setLastContacted(e.target.value)} {...inp()} />
                    </div>
                  </div>

                  {sectionHdr("🏷", "Tags")}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {_tagOptions.map(t => {
                      const active = tags.includes(t);
                      return (
                        <button key={t} type="button" onClick={() => toggleTag(t)} style={{
                          padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          border: `1.5px solid ${active ? "#6366f1" : "#e2e8f0"}`,
                          background: active ? "#eef2ff" : "#f8fafc",
                          color: active ? "#4338ca" : "#64748b",
                          transition: "all 0.12s",
                        }}>{active ? "✓ " : ""}{t}</button>
                      );
                    })}
                  </div>

                  {sectionHdr("📝", "Notes & Context")}
                  <div>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes, context, or requirements about this lead…"
                      style={{ width: "100%", padding: "9px 12px", fontSize: 13, border: "1.5px solid #e2e8f0", borderRadius: 8, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical", minHeight: 80 }} />
                  </div>
                  <div>
                    {lbl("Initial Note", false, "logged as first call entry")}
                    <input value={firstCallNote} onChange={e => setFirstCallNote(e.target.value)} placeholder="What did they ask? Key context from first contact…" {...inp()} />
                  </div>
                  {["Not Interested","Lost","No Response","Duplicate"].includes(status) && (
                    <div>
                      {lbl("Lost / Closed Reason")}
                      <select value={lostReason} onChange={e => setLostReason(e.target.value)} {...sel({ color: "#ef4444" })}>
                        <option value="">— Select reason —</option>
                        {(cfg.lostOptions || DEFAULT_LEADS_SETTINGS.lostOptions).map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* ── Step 3: Review & Confirm ── */}
              {step === 3 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Completeness indicator */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: completeness >= 70 ? "#f0fdf4" : "#fffbeb", border: `1px solid ${completeness >= 70 ? "#bbf7d0" : "#fde68a"}`, borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ fontSize: 20 }}>{completeness >= 70 ? "✅" : "⚠️"}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: completeness >= 70 ? "#065f46" : "#92400e" }}>
                        {completeness >= 70 ? "Lead profile is well-filled" : "Some fields are empty"}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>Profile completeness: {completeness}%</div>
                    </div>
                  </div>

                  {/* Section: Contact */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e8ecf1", borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>👤 Contact & Personal</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[["Name", name], ["Phone", phone||"—"], ["WhatsApp", whatsapp||phone||"—"], ["Email", email||"—"], ["Source", source], ["Campaign", campaign||"—"], ["Nationality", nationality||"—"], ["DOB", dob||"—"], ["Gender", gender||"—"], ["Passport", passportNo||"—"], ["Emirates ID", emiratesId||"—"], ["Address", address||"—"], ["Marital Status", maritalStatus||"—"], ["Language", language||"—"], ["Visa Status", visaStatus||"—"], ["Referred By", referredBy||"—"], ["Occupation", occupation||"—"], ["Employer", employer||"—"], ["Monthly Income", monthlyIncome ? `AED ${Number(monthlyIncome).toLocaleString()}` : "—"], ["WA Opt-in", whatsappOptIn ? "✅ Yes" : "❌ No"]].map(([k,v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section: Deal */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e8ecf1", borderRadius: 12, padding: "14px 18px" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#10b981", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>💼 Deal & Pipeline</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[["Service", service], ["Status", status], ["Priority", priority||"—"], ["Value", value ? `AED ${Number(value).toLocaleString()}` : "—"], ["Reservation", reservationAmt ? `AED ${Number(reservationAmt).toLocaleString()}` : "—"], ["Assigned To", assignedTo||"—"], ["Follow-up", followUpDate||"—"], ["Est. Close", estimatedClose||"—"], ["Last Contact", lastContacted||"—"], ["Orientation", orientationType||"—"], ["Lost Reason", lostReason||"—"]].map(([k,v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: k === "Status" ? (stageColor[v]||"#334155") : "#334155", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {tags.map(t => <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe" }}>{t}</span>)}
                    </div>
                  )}
                  {/* Notes */}
                  {notes && (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
                      <strong>Notes:</strong> {notes}
                    </div>
                  )}
                  {Object.keys(errors).length > 0 && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#ef4444" }}>
                      ⚠ Fix errors on step 1 before saving.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafafa", borderRadius: "0 0 18px 18px", flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b", fontFamily: "inherit", transition: "background 0.12s, border-color 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#cbd5e1"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e2e8f0"; }}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {mode === "basic" ? (
              <>
                <button onClick={() => handleBasicSave(true)} style={{ padding: "9px 18px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b", fontFamily: "inherit", transition: "background 0.12s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  + Add Another
                </button>
                <button onClick={() => handleBasicSave(false)} style={{ padding: "9px 26px", borderRadius: 9, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(16,185,129,0.35)", transition: "box-shadow 0.15s, transform 0.1s" }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(16,185,129,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(16,185,129,0.35)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  ✓ Add Lead
                </button>
              </>
            ) : (
              <>
                {step > 1 && (
                  <button onClick={() => setStep(s => s - 1)} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#334155", fontFamily: "inherit" }}>
                    ← Back
                  </button>
                )}
                {step < 3 ? (
                  <button onClick={handleNext} style={{ padding: "9px 24px", borderRadius: 9, fontSize: 12, fontWeight: 700, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(37,99,235,0.3)" }}>
                    Next Step →
                  </button>
                ) : (
                  <>
                    <button onClick={() => handleSave(true)} style={{ padding: "9px 18px", borderRadius: 9, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b", fontFamily: "inherit", transition: "background 0.12s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                      + Add Another
                    </button>
                    <button onClick={() => handleSave(false)} style={{ padding: "9px 26px", borderRadius: 9, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 2px 8px rgba(16,185,129,0.35)", transition: "box-shadow 0.15s, transform 0.1s" }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(16,185,129,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(16,185,129,0.35)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                      ✓ Save Lead
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ADD_FIELDS = [
  { key: "name",       label: "Name",                      placeholder: "Full name" },
  { key: "email",      label: "Email",      type: "email" },
  { key: "phone",      label: "Phone",                      placeholder: "+971 50 000 0000" },
  { key: "service",    label: "Service",    type: "select", options: SERVICE_OPTIONS,  default: "Self Sponsored Visa" },
  { key: "status",     label: "Status",     type: "select", options: STATUS_OPTIONS,   default: "New Lead" },
  { key: "priority",   label: "Priority",   type: "select", options: PRIORITY_OPTIONS, default: "" },
  { key: "assignedTo", label: "Assigned To",type: "select", options: STAFF_OPTIONS,    default: "" },
  { key: "value",      label: "Value (AED)",type: "number", placeholder: "0" },
  { key: "source",     label: "Source",     type: "select", options: SOURCE_OPTIONS,   default: "Other" },
  { key: "lostReason", label: "Lost Reason (if lost)", type: "select", options: LOST_OPTIONS, default: "" },
  { key: "notes",      label: "Notes",                      placeholder: "Optional notes" },
];

// Edit fields include all Add fields (same set)
const EDIT_FIELDS = ADD_FIELDS;

// ─── Color maps — module-level fallbacks; main component uses cfg.stageColors etc. ─
const SCORE_COLORS = { Hot: B.red, Warm: B.orange, Cold: B.blue };
const PRIORITY_COLORS = { VIP: "#7c3aed", High: "#ef4444", Medium: "#f59e0b", Low: "#64748b" };
const STAGE_COLORS = {
  "New Lead": "#6366f1",
  "Contacted": "#f59e0b",
  "Orientation Invited": "#3b82f6",
  "Orientation Payment Pending": "#f97316",
  "Orientation Paid": "#06b6d4",
  "Orientation Scheduled": "#8b5cf6",
  "Orientation Attended": "#ec4899",
  "Follow-Up": "#eab308",
  "Interested": "#14b8a6",
  "Reservation Pending": "#f97316",
  "Reserved": "#6366f1",
  "Won": "#10b981",
  "Not Interested": "#94a3b8",
  "Lost": "#ef4444",
  "No Response": "#64748b",
  "Duplicate": "#a855f7",
};

// ─── Styles ────────────────────────────────────────────────────────────────────
const pill = (color, bg) => ({
  display: "inline-flex", alignItems: "center",
  padding: "2px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700,
  color: color, background: bg,
  letterSpacing: 0.3, whiteSpace: "nowrap",
  border: `1px solid ${color}30`,
  transition: "background 0.15s, color 0.15s",
});

const inlineSelect = (accent) => ({
  fontSize: 11, border: `1.5px solid ${accent}40`,
  borderRadius: 6, padding: "3px 6px",
  fontFamily: "inherit", background: accent + "0d",
  color: accent, fontWeight: 600, cursor: "pointer",
  width: "100%", outline: "none",
  transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
  boxShadow: "none",
});

const inlineInput = (opts = {}) => ({
  fontSize: 11, border: "1.5px solid #e2e8f0",
  borderRadius: 6, padding: "3px 6px",
  fontFamily: "inherit", background: "transparent",
  color: "#334155", width: "100%", outline: "none",
  transition: "border-color 0.15s, background 0.15s",
  boxSizing: "border-box",
  ...opts,
});

const actionBtn = (color, bg) => ({
  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
  border: `1px solid ${color}50`, background: bg,
  color: color, cursor: "pointer", fontFamily: "inherit",
  transition: "opacity 0.15s, transform 0.1s, box-shadow 0.1s",
  whiteSpace: "nowrap",
  minHeight: "unset",
  lineHeight: "1.4",
  outline: "none",
});

const ADD_LEAD_TOASTS  = ["Lead added to pipeline.", "New lead created.", "Lead registered successfully.", "Added to pipeline."];
const WIN_LEAD_TOASTS  = ["Lead marked as Won.", "Deal closed successfully.", "Won — ready for handover.", "Closed and won."];
const CONVERT_TOASTS   = ["Lead converted to client.", "Client record created.", "Conversion complete."];

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ search }) {
  const { data, setData, dispatch } = useAppData();
  // ── Load live settings from localStorage (SettingsTab writes here) ───────────
  const cfg = useLeadsSettings();
  const { toasts, push: pushToast } = useLeadToasts();

  // ── XP + Achievement helpers (only active when cfg flags are on) ───────────
  const [xpTotal, setXpTotal] = useState(() => { try { return Number(localStorage.getItem("crm_xp") || 0); } catch { return 0; } });
  const [newlyUnlocked, setNewlyUnlocked] = useState([]);
  const grantXP = useCallback((amount) => {
    if (!cfg.xpEnabled) return;
    setXpTotal(prev => { const next = prev + amount; try { localStorage.setItem("crm_xp", String(next)); } catch {} return next; });
  }, [cfg.xpEnabled]);
  const checkAchievements = useCallback((currentLeads) => {
    if (!cfg.achievementsEnabled) return;
    const prev = (() => { try { return JSON.parse(localStorage.getItem("crm_achievements") || "[]"); } catch { return []; } })();
    const justUnlocked = LEAD_ACHIEVEMENTS.filter(a => !prev.includes(a.id) && a.check(currentLeads)).map(a => a.id);
    if (justUnlocked.length > 0) {
      const next = [...prev, ...justUnlocked];
      try { localStorage.setItem("crm_achievements", JSON.stringify(next)); } catch {}
      setNewlyUnlocked(justUnlocked);
      justUnlocked.forEach(id => {
        const a = LEAD_ACHIEVEMENTS.find(x => x.id === id);
        if (a) pushToast(`${a.title}: ${a.desc}`, a.icon, "achievement", "Achievement Unlocked");
      });
    }
  }, [cfg.achievementsEnabled, pushToast]);
  // Derive option arrays from settings so every dropdown, filter, and widget
  // immediately reflects what the user configured in Settings → Leads Tab.
  const serviceOptions  = cfg.serviceOptions  || SERVICE_OPTIONS;
  const statusOptions   = cfg.statusOptions   || STATUS_OPTIONS;
  const sourceOptions   = cfg.sourceOptions   || SOURCE_OPTIONS;
  const lostOptions     = ["", ...(cfg.lostOptions   || DEFAULT_LEADS_SETTINGS.lostOptions)];
  const priorityOptions = ["", ...(cfg.priorityOptions || DEFAULT_LEADS_SETTINGS.priorityOptions)];
  const staffOptions    = ["", ...(cfg.staffOptions   || DEFAULT_LEADS_SETTINGS.staffOptions)];
  const tagOptions      = cfg.tagOptions      || TAG_OPTIONS_DEFAULT;
  const stageColors     = cfg.stageColors     || DEFAULT_LEADS_SETTINGS.stageColors;
  const priorityColors  = cfg.priorityColors  || DEFAULT_LEADS_SETTINGS.priorityColors;
  const currencyLabel   = cfg.currencyLabel   || "AED";
  // Safe array refs
  data.leads      ??= [];
  data.clients    ??= [];
  data.accounting ??= [];

  // Resolve current user: AppContext data.currentUser → localStorage yp_current_user → safe stub
  const _ctxUser = data.currentUser ?? (() => {
    try { return JSON.parse(localStorage.getItem("yp_current_user")); } catch { return null; }
  })();
  const currentUser = _ctxUser
    ? { userId: _ctxUser.id || _ctxUser.userId || "user_1", userName: _ctxUser.name || _ctxUser.userName || "Current User", userRole: _ctxUser.role || _ctxUser.userRole || "Admin" }
    : { userId: "user_1", userName: "Current User", userRole: "Admin" };

  // When another tab broadcasts a data update, merge leads into local state
  const handleRemoteDataUpdate = useCallback((payload) => {
    if (payload.updateType === "lead_stage_change") {
      const { leadId, newStage } = payload.data;
      const today = new Date().toISOString().slice(0, 10);
      setData(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id !== leadId ? l : { ...l, status: newStage, updatedAt: today, timeline: [...(l.timeline || []), { date: today, text: `↔ Stage updated by ${payload.userName}: → ${newStage}` }] }
        ),
      }));
    }
  }, [setData]);

  const { activeUsers, tabLocks, requestLock, releaseLock, broadcastUpdate, broadcastTabChange } = useMultiUserSync(currentUser.userId, currentUser.userName, currentUser.userRole, handleRemoteDataUpdate);

  // Keep AppContext presence in sync with activeUsers from the sync hook
  useEffect(() => {
    dispatch({ type: "UPDATE_PRESENCE", payload: { userId: currentUser.userId, name: currentUser.userName, activeTab: "leads", lastSeen: Date.now() } });
    return () => {
      dispatch({ type: "REMOVE_PRESENCE", payload: { userId: currentUser.userId } });
    };
  }, [currentUser.userId, currentUser.userName, dispatch]);

  useEffect(() => {
    activeUsers.forEach(u => {
      dispatch({ type: "UPDATE_PRESENCE", payload: { userId: u.userId, name: u.userName, activeTab: u.activeTab, lastSeen: u.lastSeen } });
    });
  }, [activeUsers, dispatch]);

  // Workflow integration
  const leadWorkflow = workflowEngine.getWorkflowByEntityType("lead");
  const [slaAlerts, setSlaAlerts] = useState([]);
  const [workflowHistory, setWorkflowHistory] = useState(() => workflowEngine.getEntityHistory ? [] : []);

  // Sync workflowHistory from engine whenever leads change
  useEffect(() => {
    if (!leadWorkflow) return;
    // Refresh SLA alerts — engine's SLATracker uses entity.id, not createdAt
    const alerts = workflowEngine.getSLAAlerts(leadWorkflow.id, data.leads);
    setSlaAlerts(alerts);
    // Pull full history from engine for display
    const allHistory = data.leads.flatMap(l => workflowEngine.getEntityHistory(l.id));
    allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setWorkflowHistory(allHistory);
  }, [data.leads, leadWorkflow]);

  // Subscribe to workflow engine events once on mount
  useEffect(() => {
    if (!leadWorkflow) return;
    const offBreach = workflowEngine.events.on("sla:breach", ({ entityId, stage, overdueBy, severity }) => {
      const lead = data.leads.find(l => l.id === entityId);
      const name = lead?.name || entityId;
      toast(`⏰ SLA ${severity === "critical" ? "critical" : "warning"}: ${name} overdue in ${stage} by ${Math.round(overdueBy)}h`, severity === "critical" ? "error" : "warning");
    });
    const offRolledBack = workflowEngine.events.on("transition:rolledBack", ({ entityId }) => {
      const lead = data.leads.find(l => l.id === entityId);
      toast(`↩️ Transition rolled back for ${lead?.name || entityId}`, "info");
    });
    return () => { offBreach(); offRolledBack(); };
  }, [leadWorkflow]); // eslint-disable-line

  // Broadcast tab change for multi-user sync
  useEffect(() => {
    broadcastTabChange("leads");
  }, [broadcastTabChange]);

  // Handle workflow stage transition — the single authoritative path for all stage changes
  const handleStageTransition = async (lead, newStage, additionalData = {}) => {
    if (!leadWorkflow) {
      // Fallback: no workflow configured — update status and stamp stageEnteredAt
      const today = new Date().toISOString().slice(0, 10);
      setData(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id !== lead.id ? l : {
            ...l, status: newStage, updatedAt: today, stageEnteredAt: today,
            timeline: [...(l.timeline || []), { date: today, text: `Status changed: ${lead.status} → ${newStage}` }],
          }
        ),
      }));
      return;
    }

    // 1. Permission + condition check (passes lead data for conditional transitions)
    const canProceed = workflowEngine.canTransition(
      leadWorkflow.id, lead.status, newStage, currentUser.userRole, lead
    );
    if (!canProceed.allowed) {
      toast(`⛔ Cannot move to ${newStage}: ${canProceed.reason}`, "warning");
      return;
    }

    // 2. Required-field + custom validator check
    const validation = workflowEngine.validateStageFields(leadWorkflow.id, newStage, lead);
    if (!validation.valid) {
      const issues = [
        ...validation.missingFields.map(f => `missing: ${f}`),
        ...validation.errors,
      ];
      toast(`📋 Fix before advancing — ${issues.join(", ")}`, "error");
      return;
    }

    // 3. Approval gate — show a confirmation for transitions that requiresApproval
    if (canProceed.requiresApproval) {
      const ok = window.confirm(`"${newStage}" requires approval.\nProceed and log as pending approval?`);
      if (!ok) return;
    }

    // 3b. SOP gate — show field-collection modal for stages that require data entry
    const STAGE_GATES = {
      "Orientation Payment Pending": ["followUpDate"],
      "Orientation Paid":            ["paymentDate", "paymentAmount", "paymentMethod"],
      "Orientation Scheduled":       ["orientationDate", "orientationTime", "orientationType", "assignedTo"],
      "Orientation Attended":        ["attendanceConfirmed", "followUpDate"],
      "Interested":                  ["service", "notes"],
      "Reservation Pending":         ["reservationAmount", "followUpDate"],
      "Reserved":                    ["reservationAmount", "reservationDate"],
      "Won":                         ["service", "handoverNote"],
      "Lost":                        ["lostReason"],
      "No Response":                 ["followUpDate"],
    };
    if (STAGE_GATES[newStage] && !additionalData._gateConfirmed) {
      setPendingTransition({ lead, newStage });
      return;
    }

    setIsLoading(true);
    try {
      // 4. Optimistic lock via multi-user sync
      const lockAcquired = await requestLock(lead.id, "lead");
      if (!lockAcquired) {
        toast("⚠️ This lead is being edited by another user", "warning");
        setIsLoading(false);
        return;
      }

      // 5. Execute through workflow engine (handles SLA start/stop + history)
      await workflowEngine.executeTransition(
        leadWorkflow.id,
        lead.id,
        lead.status,
        newStage,
        currentUser.userId,
        currentUser.userName,
        additionalData
      );

      // 6. Persist new status into app state + timeline
      const today = new Date().toISOString().slice(0, 10);
      setData(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id !== lead.id ? l : {
            ...l,
            status: newStage,
            updatedAt: today,
            stageEnteredAt: today,
            timeline: [...(l.timeline || []), { date: today, text: `Status changed: ${lead.status} → ${newStage}` }],
          }
        ),
      }));

      // 7. Broadcast to other users
      broadcastUpdate("lead_stage_change", { leadId: lead.id, oldStage: lead.status, newStage });
      releaseLock(lead.id, "lead");

      toast(`✅ Moved to ${newStage}`, "success");
      if (cfg.xpEnabled !== false) grantXP(cfg.xpPerStageMove ?? 5);

      // 8. Won confetti
      if (newStage === (cfg.wonStage || "Won") && lead.status !== (cfg.wonStage || "Won")) {
        if (cfg.confettiEnabled !== false) spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
        const winToasts = cfg.winToasts || WIN_LEAD_TOASTS;
        pushToast(winToasts[Math.floor(Math.random() * winToasts.length)], "🏆", "win");
        if (cfg.xpEnabled !== false) { grantXP((cfg.xpPerWin ?? 25) - (cfg.xpPerStageMove ?? 5)); } // top-up
        checkAchievements(data.leads.map(l => l.id === lead.id ? { ...l, status: newStage } : l));
      }

      // 9. Stage-change automations (same as handleChange)
      _runStageAutomations(lead.id, newStage, today);

    } catch (error) {
      toast(`Failed to transition: ${error.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Rollback the last recorded workflow transition for a lead
  const handleRollbackTransition = async (lead) => {
    if (!leadWorkflow) return;
    const history = workflowEngine.getEntityHistory(lead.id);
    if (history.length === 0) { toast("No transitions to roll back.", "info"); return; }
    if (!window.confirm(`Roll back "${lead.name}" from "${lead.status}" to "${history[0].fromStage}"?`)) return;
    setIsLoading(true);
    try {
      const entry = await workflowEngine.rollbackTransition(lead.id, currentUser.userId, currentUser.userName, "Manual rollback");
      const today = new Date().toISOString().slice(0, 10);
      setData(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id !== lead.id ? l : {
            ...l,
            status: entry.toStage,
            updatedAt: today,
            stageEnteredAt: today,
            timeline: [...(l.timeline || []), { date: today, text: `↩️ Rolled back: ${entry.fromStage} → ${entry.toStage}` }],
          }
        ),
      }));
      toast(`↩️ Rolled back to ${entry.toStage}`, "info");
    } catch (e) {
      toast(`Rollback failed: ${e.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Returns available transitions for a lead given current user role
  const getLeadAvailableTransitions = useCallback((lead) => {
    if (!leadWorkflow) return [];
    return workflowEngine.getAvailableTransitions(leadWorkflow.id, lead.status, currentUser.userRole, lead);
  }, [leadWorkflow, currentUser.userRole]);

  // Stage-change automations extracted so both handleChange and handleStageTransition can call them
  const _runStageAutomations = useCallback((leadId, newStage, today) => {
    const in24h = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (newStage === "Orientation Paid") {
      setData(prev => ({ ...prev, leads: prev.leads.map(l =>
        l.id !== leadId ? l : { ...l, followUpDate: in24h, timeline: [...(l.timeline||[]), { date: today, text: "⚙️ Auto: Orientation reminder scheduled" }] }
      )}));
      toast && toast("📅 Orientation reminder set automatically", "info");
    }
    if (newStage === "Orientation Attended") {
      setData(prev => ({ ...prev, leads: prev.leads.map(l =>
        l.id !== leadId ? l : { ...l, followUpDate: in24h, timeline: [...(l.timeline||[]), { date: today, text: "⚙️ Auto: Follow-up task created for 24h" }] }
      )}));
      toast && toast("📞 24h follow-up task created", "info");
    }
    if (newStage === "Interested") {
      setData(prev => ({ ...prev, leads: prev.leads.map(l =>
        l.id !== leadId ? l : { ...l, timeline: [...(l.timeline||[]), { date: today, text: "⚙️ Auto: Quotation generation triggered" }] }
      )}));
      toast && toast("📄 Generate a quotation for this client", "warning");
    }
    if (newStage === "Reserved") {
      setData(prev => ({ ...prev, leads: prev.leads.map(l =>
        l.id !== leadId ? l : { ...l, timeline: [...(l.timeline||[]), { date: today, text: "⚙️ Auto: Onboarding checklist sent" }] }
      )}));
      toast && toast("📋 Explain requirements & send onboarding checklist", "info");
    }
  }, [setData]);

  const [filter,         setFilter]         = useState("All");
  const [staffFilter,    setStaffFilter]    = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [tagFilter,      setTagFilter]      = useState("All");

  const [savedFilters,   setSavedFilters]   = useState(() => { try { return JSON.parse(localStorage.getItem("crm_saved_filters") || "[]"); } catch { return []; } });
  const [showSavedFilters, setShowSavedFilters] = useState(false);
  const [displayMode,    setDisplayModeRaw] = useState(() => getCachedView());
  const setDisplayMode = useCallback((v) => { setCachedView(v); setDisplayModeRaw(v); }, []);
  const [addModal,       setAddModal]       = useState(false);
  const [editLead,       setEditLead]       = useState(null);
  const [detailLead,     setDetailLead]     = useState(null);
  const [showDupesOnly,  setShowDupesOnly]  = useState(false);
  const [showStaleOnly,  setShowStaleOnly]  = useState(false);
  const [showReminderCenter, setShowReminderCenter] = useState(false);
  const [showFunnel,       setShowFunnel]       = useState(false);
  const [showSourceROI,    setShowSourceROI]    = useState(false);
  const [showStaffROI,     setShowStaffROI]     = useState(false);
  const [showForecast,     setShowForecast]     = useState(false);
  const [showCustomFields, setShowCustomFields] = useState(false);
  const [showHeatmap,      setShowHeatmap]      = useState(false);
  const [showAIAssist,     setShowAIAssist]     = useState(null);
  const [showArchived,     setShowArchived]     = useState(false);
  const [showWorkflowView, setShowWorkflowView] = useState(false);
  const [showTimeline,     setShowTimeline]     = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [autoRulesAlert,   setAutoRulesAlert]   = useState(null);
  const [bulkSelected,   setBulkSelected]   = useState(new Set());
  const [bulkTarget,     setBulkTarget]     = useState("");
  const [bulkAssign,     setBulkAssign]     = useState("");
  const [bulkTag,        setBulkTag]        = useState("");
  const [hoverLead,        setHoverLead]        = useState(null);
  const [hoverPos,         setHoverPos]         = useState({ x: 0, y: 0 });
  const [isLoading,        setIsLoading]        = useState(false);
  const [pendingTransition, setPendingTransition] = useState(null); // { lead, newStage }

  const winW         = useWindowWidth();
  const isPhone      = winW < 640;
  const isTablet     = winW >= 640 && winW < 1100;
  const isDesktop    = winW >= 1100;
  const isNarrow     = winW < 820; // between phone and tablet

  // ── Global CMD+K search ────────────────────────────────────────────────────
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      // Ignore when typing in an input/textarea/select
      const tag = document.activeElement?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowGlobalSearch(v => !v);
      }
      if (e.key === "Escape") { setShowGlobalSearch(false); }
      if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "n" || e.key === "N") { e.preventDefault(); setAddModal(true); }
        if (e.key === "f" || e.key === "F") { e.preventDefault(); setShowReminderCenter(true); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Mobile-responsive styles
  const containerStyle = {
    padding: isPhone ? "12px" : isTablet ? "16px" : "20px",
    maxWidth: isDesktop ? "1400px" : "100%",
    margin: "0 auto",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: isPhone ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
    gap: isPhone ? "12px" : "16px",
  };

  // Additional features for LeadsTab (15+ features)
  const [showKanban, setShowKanban] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showEmailCampaign, setShowEmailCampaign] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showLeadScoring, setShowLeadScoring] = useState(false);
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [showCalendarSync, setShowCalendarSync] = useState(false);
  const [showTeamPerformance, setShowTeamPerformance] = useState(false);
  const [showConversionMetrics, setShowConversionMetrics] = useState(false);
  const [showLeadSources, setShowLeadSources] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);

  // ── NEW FEATURE STATES ──────────────────────────────────────────────────────
  const [showLeadRadar,      setShowLeadRadar]      = useState(false);
  const [showGoalTracker,    setShowGoalTracker]     = useState(false);
  const [showEmailComposer,  setShowEmailComposer]   = useState(null);   // lead
  const [showPipelineGoals,  setShowPipelineGoals]   = useState(false);
  const [showWinLossReport,  setShowWinLossReport]   = useState(false);
  const [showCallScheduler,  setShowCallScheduler]   = useState(null);   // lead
  const [showLeadCompare,    setShowLeadCompare]     = useState(false);
  const [compareSelected,    setCompareSelected]     = useState([]);
  const [showNotes,          setShowNotes]           = useState(null);   // lead
  const [showTagManager,     setShowTagManager]      = useState(false);
  const [columnVisibility,   setColumnVisibility]    = useState({});
  const [showColumnPicker,   setShowColumnPicker]    = useState(false);
  const [showSpeedDial,      setShowSpeedDial]       = useState(false);
  const [globalNote,         setGlobalNote]          = useState("");
  const [showPipelineHealth, setShowPipelineHealth]  = useState(false);
  const [showPhoneTools,     setShowPhoneTools]      = useState(false);
  const [expandedCards,      setExpandedCards]       = useState(new Set());
  // Exclusive expand: clicking "More" on one card collapses all others first
  const toggleCardExpand = (id, e) => { e.stopPropagation(); setExpandedCards(prev => { const wasOpen = prev.has(id); const n = new Set(); if (!wasOpen) n.add(id); return n; }); };

  const leads        = data.leads || [];
  const statuses     = ["All", ...ALL_PIPELINE_STAGES];
  const dupeIds      = useMemo(() => findDuplicates(leads),    [leads]);
  const staleLeads   = useMemo(() => getStaleLeads(leads),     [leads]);
  const pipelineStats= useMemo(() => getPipelineStats(leads),  [leads]);
  const lostReasons  = useMemo(() => getLostReasons(leads),    [leads]);

  const [localSearch, setLocalSearch] = useState(search || "");
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const LEAD_SUGGESTION_FIELDS = ["status", "priority", "source", "service", "assignedTo"];
  const { suggestions, showSuggestions, onSuggestionSelect } = useSearchSuggestions(localSearch, LEAD_SUGGESTION_FIELDS, setLocalSearch);

  // ── Filtered rows ────────────────────────────────────────────────────────────
  const preFilteredRows = useMemo(() => {
    let rows = filter === "All" ? leads : leads.filter((l) => l.status === filter);
    rows = showArchived ? rows.filter(l => l.archived) : rows.filter(l => !l.archived);
    if (staffFilter === "__unassigned__") rows = rows.filter(l => !l.assignedTo);
    else if (staffFilter !== "All")    rows = rows.filter(l => (l.assignedTo || "") === staffFilter);
    if (priorityFilter !== "All") rows = rows.filter(l => (l.priority   || "") === priorityFilter);
    if (tagFilter !== "All")      rows = rows.filter(l => (l.tags || []).includes(tagFilter));
    if (showDupesOnly) rows = rows.filter((l) => dupeIds.has(l.id));
    if (showStaleOnly) rows = rows.filter((l) => staleLeads.some((s) => s.id === l.id));
    return rows;
  }, [leads, filter, showArchived, staffFilter, priorityFilter, tagFilter, showDupesOnly, showStaleOnly, dupeIds, staleLeads]);

  // Hooks must always be called unconditionally, outside any conditional branches
  const searchFilteredRows = useTableFilterV2(preFilteredRows, parsedQuery, ["name", "email", "phone", "service", "source", "notes"]);
  const { sortedData: sortedLeadRows, sortKey: leadSortKey, sortDir: leadSortDir, toggleSort: toggleLeadSort } = useSortedData(searchFilteredRows);
  const { page: leadPage, setPage: setLeadPage, pageSize: leadPageSize, setPageSize: setLeadPageSize, pageData: leadPageData, pageCount: leadPageCount } = usePagination(sortedLeadRows);
  const rows = sortedLeadRows;

  // Reset to page 1 whenever filters or search change so you never land on a non-existent page
  useEffect(() => { setLeadPage(0); }, [filter, staffFilter, priorityFilter, tagFilter, localSearch, showDupesOnly, showStaleOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────────

  /** Update a single field on a lead — accepts either lead ID (string) or row index (number) */
  const handleChange = (leadIdOrIndex, key, val) => {
    let lead;
    if (typeof leadIdOrIndex === "number") {
      lead = data.leads.find(l => l.id === leadPageData[leadIdOrIndex]?.id);
    } else {
      lead = data.leads.find(l => l.id === leadIdOrIndex);
    }
    if (!lead) return;

    // ── Status changes route through the workflow engine ────────────────────────
    if (key === "status" && val !== lead.status) {
      handleStageTransition(lead, val);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    let timelineEntry = null;
    if (key === "assignedTo" && lead.assignedTo !== val)
      timelineEntry = { date: today, text: `Assigned to ${val || "nobody"}` };
    else if (key === "value" && lead.value !== Number(val))
      timelineEntry = { date: today, text: `Value updated: ${aed(lead.value)} → ${aed(Number(val))}` };
    const updated = data.leads.map(l => {
      if (l.id !== lead.id) return l;
      const timeline = timelineEntry ? [...(l.timeline || []), timelineEntry] : (l.timeline || []);
      return { ...l, [key]: val, updatedAt: today, timeline };
    });
    setData({ ...data, leads: updated });
  };

  const handleDelete = (leadIdOrIndex) => {
    let leadId;
    if (typeof leadIdOrIndex === "number") {
      leadId = leadPageData[leadIdOrIndex]?.id;
    } else {
      leadId = leadIdOrIndex;
    }
    if (!leadId) return;
    const lead = data.leads.find(l => l.id === leadId);
    const name = lead?.name ? `"${lead.name}"` : "this lead";
    if (!window.confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    setData({ ...data, leads: data.leads.filter(l => l.id !== leadId) });
    toast(`\uD83D\uDDD1 ${lead?.name || "Lead"} deleted.`, "info");
  };

  /** Add new lead — always honour the form values for status & service */
  const handleAdd = (vals) => {
    const today = new Date().toISOString().slice(0, 10);
    const newLead = {
      id:         nextId("L"),
      lostReason: "",
      status:  "New Lead",
      service: "Self Sponsored Visa",
      source:  "Other",
      timeline: [{ date: today, text: "Lead created" }],
      callLog: [],
      quickNotes: [],
      ...vals,
      value:   Number(vals.value) || 0,
      date:    today,
      updatedAt: today,
      stageEnteredAt: today,
      tags: Array.isArray(vals.tags) ? vals.tags : [],
    };
    const nextLeads = [...data.leads, newLead];
    setData({ ...data, leads: nextLeads });

    // Start SLA clock for the initial stage
    if (leadWorkflow) {
      workflowEngine.slaTracker.start(newLead.id, newLead.status);
    }

    // 🎯 Fun layer — add toast + XP + achievements
    if (cfg.xpEnabled !== false) {
      const addToasts = cfg.addToasts || ADD_LEAD_TOASTS;
      pushToast(`${addToasts[Math.floor(Math.random() * addToasts.length)]} — ${newLead.name}`, "🎯", "lead");
      grantXP(cfg.xpPerAdd ?? 10);
      checkAchievements(nextLeads);
    }
  };

  /** Save all edits from the edit modal */
  const handleEditSave = async (vals, timelineEntries = []) => {
    if (!editLead) return;
    const today = new Date().toISOString().slice(0, 10);
    const wasWon = editLead.status !== (cfg.wonStage || "Won") && vals.status === (cfg.wonStage || "Won");
    const statusChanged = vals.status && vals.status !== editLead.status;

    // If status changed, route through workflow engine
    if (statusChanged) {
      await handleStageTransition(editLead, vals.status);
      // handleStageTransition updates status in data; proceed to save the rest of the fields
    }

    const updated = data.leads.map(l => {
      if (l.id !== editLead.id) return l;
      const timeline = [...(l.timeline || []), ...timelineEntries];
      // If status was routed through the workflow engine, omit it here to avoid overwriting the engine's result
      if (statusChanged) {
        const { status: _omit, ...rest } = vals;
        return { ...l, ...rest, value: Number(vals.value) || 0, updatedAt: today, timeline };
      }
      return { ...l, ...vals, value: Number(vals.value) || 0, updatedAt: today, timeline };
    });
    setData({ ...data, leads: updated });
    setEditLead(null);
    toast("Lead saved.", "success");
    // 🏆 Fun layer — Won via edit
    if (wasWon && cfg.xpEnabled !== false) {
      if (cfg.confettiEnabled !== false) spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      const winToasts = cfg.winToasts || WIN_LEAD_TOASTS;
      pushToast(winToasts[Math.floor(Math.random() * winToasts.length)], "🏆", "win");
      grantXP(cfg.xpPerWin ?? 25);
      checkAchievements(updated);
    }
  };

  const handleArchiveLead = (lead) => {
    const today = new Date().toISOString().slice(0, 10);
    const willArchive = !lead.archived;
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, archived: willArchive, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: willArchive ? "Lead archived" : "Lead restored from archive" }] } : l
    );
    setData({ ...data, leads: updated });
    toast(willArchive ? `${lead.name} archived.` : `${lead.name} restored.`, "success");
  };

  const handleSnooze = (lead, days) => {
    const snoozeDay = new Date();
    snoozeDay.setDate(snoozeDay.getDate() + days);
    const snoozeDate = snoozeDay.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, followUpDate: snoozeDate, snoozedUntil: snoozeDate, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Snoozed ${days} day(s) — follow-up set to ${snoozeDate}` }] } : l
    );
    setData({ ...data, leads: updated });
    toast(`Follow-up snoozed to ${snoozeDate}`, "success");
  };

  // Auto Status Rules — run whenever leads change
  const runAutoRules = useCallback(async (leads) => {
    if (cfg.autoRulesEnabled === false) return;
    const autoLostDays     = cfg.autoLostDays     ?? 30;
    const autoEscalateDays = cfg.autoEscalateDays ?? 7;
    const wonStage         = cfg.wonStage          || "Won";
    const today = new Date().toISOString().slice(0, 10);
    let changed = 0;
    const updated = await Promise.all(leads.map(async l => {
      const days = getDaysInStage(l);
      if (l.status === "New Lead" && days >= autoLostDays && !l.archived) {
        if (leadWorkflow) {
          try {
            await workflowEngine.executeTransition(
              leadWorkflow.id, l.id, l.status, "Lost",
              "system", "Auto-Rules", { reason: `${autoLostDays} days no activity` }
            );
          } catch { /* transition may not be defined — still apply */ }
        }
        changed++;
        return { ...l, status: "Lost", lostReason: "No response", updatedAt: today, stageEnteredAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Auto-moved to Lost: ${autoLostDays} days no activity` }] };
      }
      if (l.status === wonStage && days >= autoEscalateDays && l.priority !== "VIP" && !l.archived) {
        changed++;
        return { ...l, priority: "VIP", updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Auto-escalated to VIP: ${wonStage} for ${autoEscalateDays}+ days` }] };
      }
      return l;
    }));
    if (changed > 0) {
      setData(d => ({ ...d, leads: updated }));
      setAutoRulesAlert(`Auto-rules applied: ${changed} lead(s) updated`);
      setTimeout(() => setAutoRulesAlert(null), 4000);
    }
  }, [cfg, leadWorkflow]);

  // Run auto rules on mount
  useEffect(() => { if (leads.length) runAutoRules(leads); }, []); // eslint-disable-line

  const handleMention = (leadId, text) => {
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, mentions: [...(l.mentions||[]), { date: today, text }], timeline: [...(l.timeline||[]), { date: today, text: `💬 Mention: ${text}` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleSaveCustomFields = (fields) => {
    try { localStorage.setItem("crm_custom_fields", JSON.stringify(fields)); } catch {}
    setShowCustomFields(false);
  };

  const handleDocChecklist = (leadId, item, checked) => {
    setData(prev => ({ ...prev, leads: prev.leads.map(l => {
      if (l.id !== leadId) return l;
      return { ...l, docChecklist: { ...(l.docChecklist || {}), [item]: checked } };
    })}));
  };

  const handleDocAttachment = (leadId, item, file) => {
    if (!file) return;
    const allowed = ["image/jpeg","image/png","image/gif","image/webp","application/pdf"];
    if (!allowed.includes(file.type)) { toast("Only images and PDFs are supported", "error"); return; }
    if (file.size > 8 * 1024 * 1024) { toast("File must be under 8 MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const storageKey = `crm_doc_attachments_${leadId}`;
        const existing = JSON.parse(localStorage.getItem(storageKey) || "{}");
        existing[item] = [...(existing[item] || []), { name: file.name, type: file.type, data: e.target.result, uploadedAt: new Date().toISOString().slice(0, 10) }];
        localStorage.setItem(storageKey, JSON.stringify(existing));
        // nudge a re-render so the drawer re-reads localStorage
        setData(prev => ({ ...prev, leads: prev.leads.map(l => l.id === leadId ? { ...l, _attachTs: Date.now() } : l) }));
        toast(`${file.name} attached`, "success");
      } catch { toast("Storage full — try a smaller file", "error"); }
    };
    reader.readAsDataURL(file);
  };

  const handleDocAttachmentDelete = (leadId, item, idx) => {
    try {
      const storageKey = `crm_doc_attachments_${leadId}`;
      const existing = JSON.parse(localStorage.getItem(storageKey) || "{}");
      existing[item] = (existing[item] || []).filter((_, i) => i !== idx);
      localStorage.setItem(storageKey, JSON.stringify(existing));
      setData(prev => ({ ...prev, leads: prev.leads.map(l => l.id === leadId ? { ...l, _attachTs: Date.now() } : l) }));
    } catch {}
  };

  const handleSetRecurrence = (leadId, days) => {
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, followUpRecurrence: days } : l
    );
    setData({ ...data, leads: updated });
  };


  const handleBulkAssign = () => {
    if (!bulkAssign || bulkSelected.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      bulkSelected.has(l.id) ? { ...l, assignedTo: bulkAssign, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Assigned to ${bulkAssign}` }] } : l
    );
    setData({ ...data, leads: updated });
    toast(`Assigned ${bulkSelected.size} lead${bulkSelected.size !== 1 ? "s" : ""} to ${bulkAssign}`, "success");
    setBulkAssign(""); setBulkSelected(new Set());
  };

  const handleBulkDelete = () => {
    if (bulkSelected.size === 0) return;
    if (!window.confirm(`Delete ${bulkSelected.size} lead(s)? This cannot be undone.`)) return;
    setData({ ...data, leads: data.leads.filter(l => !bulkSelected.has(l.id)) });
    setBulkSelected(new Set());
  };

  const handleBulkArchive = () => {
    if (bulkSelected.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      bulkSelected.has(l.id) ? { ...l, archived: true, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: "Lead archived (bulk)" }] } : l
    );
    setData({ ...data, leads: updated });
    toast(`Archived ${bulkSelected.size} lead${bulkSelected.size !== 1 ? "s" : ""}.`, "success");
    setBulkSelected(new Set());
  };

  const handleBulkTag = () => {
    if (!bulkTag || bulkSelected.size === 0) return;
    const updated = data.leads.map(l =>
      bulkSelected.has(l.id) ? { ...l, tags: [...new Set([...(l.tags||[]), bulkTag])] } : l
    );
    setData({ ...data, leads: updated });
    setBulkTag(""); setBulkSelected(new Set());
  };

  const handleBulkExport = () => {
    const sel = bulkSelected.size > 0 ? data.leads.filter(l => bulkSelected.has(l.id)) : data.leads.filter(l => !l.archived);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["ID,Name,Email,Phone,Status,Service,Value,Source,Priority,Assigned,Follow-up",
      ...sel.map(l => [l.id,l.name,l.email,l.phone,l.status,l.service,l.value,l.source,l.priority||"",l.assignedTo||"",l.followUpDate||""].map(q).join(","))
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(`Exported ${sel.length} lead${sel.length !== 1 ? "s" : ""} to CSV`, "success");
  };

  const handleReopenLead = async (lead, reason) => {
    const today = new Date().toISOString().slice(0, 10);
    // Log the reopen as a workflow transition if engine has the workflow
    if (leadWorkflow) {
      try {
        await workflowEngine.executeTransition(
          leadWorkflow.id, lead.id, lead.status, "New Lead",
          currentUser.userId, currentUser.userName, { reason, action: "reopen" }
        );
      } catch { /* transition may not be in engine's defined list — that's OK, still reopen */ }
    }
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, status: "New Lead", lostReason: "", updatedAt: today, stageEnteredAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Lead reopened — ${reason}` }] } : l
    );
    setData({ ...data, leads: updated });
    toast(`${lead.name} reopened as New Lead.`, "success");
  };

  const handleAddNote = (leadId, note) => {
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, quickNotes: [...(l.quickNotes||[]), { date: today, text: note }], timeline: [...(l.timeline||[]), { date: today, text: `Note added` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleLogCall = (leadId, callNote) => {
    const today = new Date().toISOString().slice(0, 10);
    const nowISO = new Date().toISOString();
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, callLog: [...(l.callLog||[]), { date: today, note: callNote }], lastContacted: today, lastContactedAt: nowISO, timeline: [...(l.timeline||[]), { date: today, text: `📞 Call logged: ${callNote}` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleSaveFilter = () => {
    const name = window.prompt("Name this filter set:");
    if (!name?.trim()) return;
    const newFilter = { name: name.trim(), status: filter, staff: staffFilter, priority: priorityFilter, tag: tagFilter };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    try { localStorage.setItem("crm_saved_filters", JSON.stringify(updated)); } catch {}
    toast(`Filter "${name.trim()}" saved.`, "success");
  };

  const applyFilter = (f) => {
    setFilter(f.status); setStaffFilter(f.staff); setPriorityFilter(f.priority); setTagFilter(f.tag || "All");
    setShowSavedFilters(false);
  };

  const deleteFilter = (idx) => {
    const updated = savedFilters.filter((_, i) => i !== idx);
    setSavedFilters(updated);
    try { localStorage.setItem("crm_saved_filters", JSON.stringify(updated)); } catch {}
    toast("Filter removed.", "info");
  };

  const handleConvertToClient = async (lead) => {
    const already = data.clients?.some(c =>
      (c.name?.toLowerCase().trim() === lead.name?.toLowerCase().trim()) ||
      (lead.email && c.email?.toLowerCase().trim() === lead.email?.toLowerCase().trim()) ||
      (lead.phone && c.phone?.replace(/\s/g,"") === lead.phone?.replace(/\s/g,""))
    );
    if (already) { toast(`${lead.name} is already a client.`, "warning"); return; }

    const today = new Date().toISOString().slice(0, 10);
    const wonStage = cfg.wonStage || "Won";

    // If not already Won, run through the workflow engine first
    if (lead.status !== wonStage && leadWorkflow) {
      const canProceed = workflowEngine.canTransition(leadWorkflow.id, lead.status, wonStage, currentUser.userRole, lead);
      if (!canProceed.allowed) {
        toast(`⛔ Cannot convert: ${canProceed.reason}`, "warning");
        return;
      }
      if (canProceed.requiresApproval) {
        const ok = window.confirm(`Converting to client requires approval. Proceed?`);
        if (!ok) return;
      }
      try {
        await workflowEngine.executeTransition(
          leadWorkflow.id, lead.id, lead.status, wonStage,
          currentUser.userId, currentUser.userName, { convertedToClient: true }
        );
      } catch (e) {
        toast(`Workflow error: ${e.message}`, "error");
        return;
      }
    }

    const newClient = {
      id:            nextId("C"),
      name:          lead.name,
      contact:       lead.name,
      email:         lead.email  || "",
      phone:         lead.phone  || "",
      service:       lead.service || "",
      licenseNumber: "",
      status:        "Active",
      value:         lead.value  || 0,
      renewal:       "",
      progress:      0,
      notes:         `Converted from lead ${lead.id} on ${today}`,
      started:       today,
    };
    const updatedLeads = data.leads.map(l =>
      l.id === lead.id ? { ...l, status: wonStage, updatedAt: today, stageEnteredAt: today, timeline: [...(l.timeline||[]), { date: today, text: "Converted to client 🎉" }] } : l
    );
    setData({ ...data, clients: [...(data.clients || []), newClient], leads: updatedLeads });
    // 🌟 Fun layer — convert toast + confetti + XP
    if (cfg.xpEnabled !== false) {
      if (cfg.confettiEnabled !== false) spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      const convertToasts = cfg.convertToasts || CONVERT_TOASTS;
      pushToast(convertToasts[Math.floor(Math.random() * convertToasts.length)], "🌟", "convert");
      grantXP(cfg.xpPerConvert ?? 40);
      checkAchievements(updatedLeads);
    }
  };

  const handleMergeDupes = () => {
    const seenPhone = new Map();
    const seenEmail = new Map();
    const toRemove = new Set();
    data.leads.forEach(l => {
      const p = (l.phone || "").replace(/\s/g, "").toLowerCase();
      const e = (l.email || "").toLowerCase().trim();
      if (p) {
        if (seenPhone.has(p)) toRemove.add(l.id);
        else seenPhone.set(p, l.id);
      }
      if (e) {
        if (seenEmail.has(e)) toRemove.add(l.id);
        else seenEmail.set(e, l.id);
      }
    });
    if (toRemove.size === 0) { toast("No duplicates to merge.", "info"); return; }
    if (!window.confirm(`Remove ${toRemove.size} duplicate lead(s)?`)) return;
    setData({ ...data, leads: data.leads.filter(l => !toRemove.has(l.id)) });
    toast(`Merged ${toRemove.size} duplicate${toRemove.size !== 1 ? "s" : ""}.`, "success");
  };

  const handleKanbanDrop = (leadId, newStatus) => {
    const lead = data.leads.find(l => l.id === leadId);
    if (!lead) return;
    // Route through workflow engine (handles permission, validation, SLA, history)
    handleStageTransition(lead, newStatus);
  };

  const handleBulkMove = async () => {
    if (!bulkTarget || bulkSelected.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);

    if (leadWorkflow) {
      // Use engine's bulkTransition — validates each lead individually
      const entityIds = [...bulkSelected];
      // Pre-flight: check every lead has a valid transition defined
      const leads = data.leads.filter(l => bulkSelected.has(l.id));
      const blocked = leads.filter(l => {
        const { allowed } = workflowEngine.canTransition(leadWorkflow.id, l.status, bulkTarget, currentUser.userRole, l);
        return !allowed;
      });
      if (blocked.length > 0) {
        toast(`⛔ ${blocked.length} lead(s) cannot move to ${bulkTarget} (role/condition blocked)`, "warning");
        return;
      }

      setIsLoading(true);

      // Fallback: engine's bulkTransition needs a single fromStage; do it lead-by-lead instead
      let successCount = 0;
      const succeededIds = new Set();
      for (const lead of leads) {
        try {
          await workflowEngine.executeTransition(
            leadWorkflow.id, lead.id, lead.status, bulkTarget,
            currentUser.userId, currentUser.userName
          );
          succeededIds.add(lead.id);
          successCount++;
        } catch { /* skip blocked */ }
      }

      const updated = data.leads.map(l => {
        if (!bulkSelected.has(l.id)) return l;
        if (!succeededIds.has(l.id)) return l;
        return { ...l, status: bulkTarget, updatedAt: today, stageEnteredAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Status changed to ${bulkTarget} (bulk)` }] };
      });
      setData({ ...data, leads: updated });
      toast(`Moved ${successCount} lead${successCount !== 1 ? "s" : ""} to ${bulkTarget}`, "success");
      setIsLoading(false);
      setBulkSelected(new Set());
      setBulkTarget("");
    } else {
      // No workflow configured — move freely
      const updated = data.leads.map(l =>
        bulkSelected.has(l.id) ? { ...l, status: bulkTarget, updatedAt: today, stageEnteredAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Status changed to ${bulkTarget} (bulk)` }] } : l
      );
      setData({ ...data, leads: updated });
      toast(`Moved ${bulkSelected.size} lead${bulkSelected.size !== 1 ? "s" : ""} to ${bulkTarget}`, "success");
      setBulkSelected(new Set());
      setBulkTarget("");
    }
  };

  const toggleBulkSelect = (id) => {
    const next = new Set(bulkSelected);
    next.has(id) ? next.delete(id) : next.add(id);
    setBulkSelected(next);
  };

  // ── Table columns ─────────────────────────────────────────────────────────────
  // priority: 0=always, 1=tablet+desktop, 2=desktop only
  const allCols = [
    {
      key: "_sel", label: "", width: 36, priority: 0,
      render: (_, r) => (
        <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={() => toggleBulkSelect(r.id)}
          style={{ accentColor: B.blue, cursor: "pointer", width: 14, height: 14 }} />
      ),
    },
    { key: "id", label: "ID", width: 68, priority: 2 },
    {
      key: "name", label: "Name", width: 155, priority: 0,
      render: (v, r, ri) => (
        <div
          style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }}
          onMouseEnter={e => { setHoverLead(r); setHoverPos({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={e => setHoverPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoverLead(null)}
        >
          {dupeIds.has(r.id) && (
            <span title="Potential duplicate" style={{ color: B.orange, fontWeight: 700, fontSize: 10 }}>⚠</span>
          )}
          <input
            value={v || ""}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); setDetailLead(r); setHoverLead(null); }}
            onChange={e => handleChange(r.id, "name", e.target.value)}
            title="Edit name · Double-click to open detail"
            style={{ ...inlineInput(), color: B.blue, fontWeight: 600, cursor: "text", textDecoration: "underline dotted", minWidth: 0 }}
          />
        </div>
      ),
    },
    {
      key: "service", label: "Service", width: 165, priority: 0,
      render: (v, r, ri) => (
        <select
          value={v || serviceOptions[0] || "Self Sponsored Visa"}
          onClick={e => e.stopPropagation()}
          onChange={e => handleChange(r.id, "service", e.target.value)}
          style={inlineSelect("#64748b")}
        >
          {serviceOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ),
    },
    {
      key: "status", label: "Status", width: 130, priority: 0,
      render: (v, r, ri) => {
        const color = stageColors[v] || B.border;
        return (
          <select
            value={v || "New Lead"}
            onClick={e => e.stopPropagation()}
            onChange={e => handleChange(r.id, "status", e.target.value)}
            style={inlineSelect(color)}
          >
            {statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    {
      key: "score", label: "Score", width: 82, priority: 1,
      render: (_, r) => {
        const s = scoreLead(r);
        const label = scoreLabel(s);
        return (
          <span style={pill(SCORE_COLORS[label], SCORE_COLORS[label] + "18")}>
            {s} {label}
          </span>
        );
      },
      xlRender: (_, r) => scoreLead(r),
    },
    { key: "value",  label: "Value",   width: 105, priority: 0, render: (v, r, ri) => (
      <input
        type="number" min="0" value={v || 0}
        onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "value", Number(e.target.value))}
        style={{ ...inlineInput(), fontWeight: 600 }}
      />
    ), xlRender: (v) => aed(v) },
    { key: "source", label: "Source",  width: 115,  priority: 1, render: (v, r, ri) => (
      <select value={v || ""} onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "source", e.target.value)}
        style={inlineSelect("#64748b")}>
        <option value="">—</option>
        {sourceOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )},
    { key: "date",   label: "Date",    width: 115,  priority: 1, render: (v, r, ri) => (
      <input type="date" value={v || ""} onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "date", e.target.value)}
        style={inlineInput()} />
    )},
    {
      key: "stale", label: "Follow-up", width: 135, priority: 0,
      render: (_, r, ri) => {
        const fu = getFollowUpStatus(r.followUpDate, cfg);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {fu
              ? <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>
              : staleLeads.some((s) => s.id === r.id)
                ? <span style={pill(B.orange, B.orange + "15")}>⏰ Due</span>
                : <span style={{ color: B.muted, fontSize: 11 }}>—</span>}
            <input type="date" value={r.followUpDate || ""} onClick={e => e.stopPropagation()}
              onChange={e => handleChange(r.id, "followUpDate", e.target.value)}
              title="Set follow-up date"
              style={{ ...inlineInput(), width: 32, minWidth: 32, padding: "2px 2px", opacity: 0.5, cursor: "pointer" }} />
          </div>
        );
      },
    },
    {
      key: "priority", label: "Priority", width: 85, priority: 1,
      render: (v, r, ri) => {
        const color = (cfg.priorityColors || priorityColors)[v] || B.muted;
        return (
          <select value={v || ""} onClick={e => e.stopPropagation()}
            onChange={e => handleChange(r.id, "priority", e.target.value)}
            style={inlineSelect(v ? color : "#94a3b8")}>
            {priorityOptions.map(o => <option key={o} value={o}>{o || "—"}</option>)}
          </select>
        );
      },
    },
    {
      key: "assignedTo", label: "Assigned", width: 105, priority: 1,
      render: (v, r, ri) => (
        <select value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(r.id, "assignedTo", e.target.value)}
          style={inlineSelect("#64748b")}>
          {staffOptions.map(o => <option key={o} value={o}>{o || "—"}</option>)}
        </select>
      ),
    },
    { key: "lostReason", label: "Lost Reason", width: 125, priority: 2, render: (v, r, ri) => (
      <select value={v || ""} onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "lostReason", e.target.value)}
        style={inlineSelect(v ? "#ef4444" : "#94a3b8")}>
        <option value="">—</option>
        {lostOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )},
    {
      key: "_health", label: "Health", width: 110, priority: 1,
      render: (_, r) => {
        const s = getHealthScore(r, cfg); const h = getHealthLabel(s, cfg);
        return <span style={pill(h.color, h.color + "15")}>{s}% {h.label}</span>;
      },
    },
    {
      key: "_nextAction", label: "Next Action", width: 160, priority: 1,
      render: (_, r) => {
        const na = getNextAction(r, cfg);
        return na ? <span style={{ fontSize: 11, color: "#334155" }}>{na.icon} {na.text}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span>;
      },
    },
    {
      key: "_stageAge", label: "Stage Age", width: 90, priority: 2,
      render: (_, r) => {
        const d = getDaysInStage(r);
        const warnD   = cfg.stageAgeWarnDays   ?? 7;
        const dangerD = cfg.stageAgeDangerDays ?? 14;
        const color = d > dangerD ? "#ef4444" : d > warnD ? "#f59e0b" : "#10b981";
        return <span style={pill(color, color + "15")}>{d}d</span>;
      },
    },
    {
      key: "_temperature", label: "Temp", width: 90, priority: 2,
      render: (_, r) => {
        const t = getTemperature(r, cfg); const tl = getTempLabel(t, cfg);
        return <span style={pill(tl.color, tl.bg)} title={`Temperature: ${t}/100`}>{tl.label}</span>;
      },
    },
    {
      key: "_sla", label: "Last Contact", width: 150, priority: 2,
      render: (_, r, ri) => {
        const s = getSLAStatus(r, cfg);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {s
              ? <span style={pill(s.color, s.bg)}>{s.urgent ? "⚠ " : ""}{s.label}</span>
              : <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>}
            <input type="date"
              value={r.lastContacted || ""}
              onClick={e => e.stopPropagation()}
              onChange={e => handleChange(r.id, "lastContacted", e.target.value)}
              title="Set last contacted date"
              style={{ ...inlineInput(), width: 32, minWidth: 32, padding: "2px 2px", opacity: 0.5, cursor: "pointer" }} />
          </div>
        );
      },
    },
    {
      key: "estimatedClose", label: "Est. Close", width: 110, priority: 2,
      render: (v, r, ri) => (
        <input type="date" value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(r.id, "estimatedClose", e.target.value)}
          style={{ fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 4px", fontFamily: "inherit", background: "transparent", color: "#334155", width: "100%" }} />
      ),
    },
    {
      key: "_tags", label: "Tags", width: 185, priority: 2,
      render: (_, r, ri) => <InlineTagPicker lead={r} tagOptions={tagOptions} onChange={tags => handleChange(r.id, "tags", tags)} />,
    },
    { key: "email", label: "Email",  width: 175, priority: 2, render: (v, r, ri) => (
      <input type="email" value={v || ""} placeholder="—" onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "email", e.target.value)}
        style={inlineInput()} />
    )},
    { key: "phone", label: "Phone",  width: 140, priority: 2, render: (v, r, ri) => (
      <input type="tel" value={v || ""} placeholder="—" onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "phone", e.target.value)}
        style={inlineInput()} />
    )},
    { key: "notes", label: "Notes",  width: 195, priority: 2, render: (v, r, ri) => (
      <input value={v || ""} placeholder="—" onClick={e => e.stopPropagation()}
        onChange={e => handleChange(r.id, "notes", e.target.value)}
        style={inlineInput()} />
    )},
    {
      key: "_actions", label: "", width: 160, priority: 0,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
          <button onClick={e => { e.stopPropagation(); setEditLead(r); }} style={actionBtn(B.blue, B.blue + "12")} title="Edit lead">✏️ Edit</button>
          {r.phone && (
            <button onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank"); }}
              style={actionBtn("#25d366", "#25d36612")} title="Open WhatsApp">💬</button>
          )}
          {r.status === "Won" && (
            <button onClick={e => { e.stopPropagation(); handleConvertToClient(r); }} style={actionBtn(B.green, B.green + "12")} title="Convert to client">↗</button>
          )}
          {["Not Interested", "Lost", "No Response", "Duplicate"].includes(r.status) && (
            <button onClick={e => { e.stopPropagation(); const reason = window.prompt("Reopen reason?"); if (reason) handleReopenLead(r, reason); }}
              style={actionBtn("#7c3aed", "#7c3aed12")} title="Reopen lead">↩</button>
          )}
          <button onClick={e => { e.stopPropagation(); handleArchiveLead(r); }}
            style={actionBtn(r.archived ? "#10b981" : "#94a3b8", r.archived ? "#f0fdf4" : "#f8fafc")} title={r.archived ? "Restore" : "Archive"}>
            {r.archived ? "↩" : "📦"}
          </button>
          <button onClick={e => { e.stopPropagation(); setShowAIAssist(r); }}
            style={actionBtn("#8b5cf6", "#ede9fe")} title="AI Assist">✨</button>
          <button onClick={e => { e.stopPropagation(); setShowEmailComposer(r); }}
            style={actionBtn("#0ea5e9", "#f0f9ff")} title="Email">📧</button>
          <button onClick={e => { e.stopPropagation(); setShowNotes(r); }}
            style={actionBtn("#f59e0b", "#fffbeb")} title="Quick note">📝</button>
          <button onClick={e => { e.stopPropagation(); setShowCallScheduler(r); }}
            style={actionBtn("#10b981", "#f0fdf4")} title="Schedule call">📅</button>
          <button onClick={e => {
            e.stopPropagation();
            setCompareSelected(prev => {
              if (prev.find(x => x.id === r.id)) return prev.filter(x => x.id !== r.id);
              if (prev.length >= 2) return [prev[1], r];
              return [...prev, r];
            });
          }} style={actionBtn(compareSelected.find(x => x.id === r.id) ? "#7c3aed" : "#94a3b8", compareSelected.find(x => x.id === r.id) ? "#ede9fe" : "#f8fafc")} title="Compare">⚖</button>
        </div>
      ),
    },
  ];

  // Show all columns always — table scrolls horizontally
  // Admin-disabled columns are stripped before column-visibility check
  const adminHiddenKeys = [
    ...(cfg.showColScore       !== true  ? ["score"]         : []),
    ...(cfg.showColHealth      !== true  ? ["_health"]       : []),
    ...(cfg.showColTemperature !== true  ? ["_temperature"]  : []),
    ...(cfg.showColEstClose    !== true  ? ["estimatedClose"]: []),
    ...(cfg.showColTags        !== true  ? ["_tags"]         : []),
  ];
  const cols = allCols
    .filter(c => !adminHiddenKeys.includes(c.key))
    .filter(c => columnVisibility[c.key] !== false);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 8 : 12, ...(isPhone ? {} : { height: "100%", minHeight: 0 }) }}>


      {/* ── KPI Widgets ── */}
      {cfg.showStatCards !== false && (() => {
        const overdueCount   = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate, cfg); return fu && fu.color === "#ef4444"; }).length;
        const followUpsToday = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate, cfg); return fu && (fu.color === "#f59e0b"); }).length;
        const orientationToday = leads.filter(l => l.status === "Orientation Scheduled" || l.status === "Orientation Paid").length;
        const reservationPending = leads.filter(l => l.status === "Reservation Pending").length;
        const wonThisMonth   = leads.filter(l => { if (l.status !== "Won") return false; const d = new Date(l.updatedAt || l.date || ""); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;
        const newLeads       = leads.filter(l => l.status === "New Lead").length;

        // Compute real context for delta labels
        const overdueActive = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate, cfg); return fu && fu.color === "#ef4444"; }).length;
        const totalActive = leads.filter(l => !["Won","Lost","No Response","Not Interested","Duplicate"].includes(l.status) && !l.archived).length;
        const wonAllTime = leads.filter(l => l.status === "Won").length;
        const conversionRate = totalActive + wonAllTime > 0 ? Math.round((wonAllTime / (totalActive + wonAllTime)) * 100) : 0;
        const kpiCards = [
          { label: "New Leads",          value: newLeads,           icon: "ti-user-plus",   color: "#6366f1", bg: "#eef2ff", delta: `${totalActive} active in pipeline` },
          { label: "Follow Ups Today",   value: followUpsToday,     icon: "ti-phone",       color: "#f97316", bg: "#fff7ed", delta: overdueActive > 0 ? `⚠ ${overdueActive} overdue` : "All on track", onClick: () => setShowReminderCenter(true) },
          { label: "Orientation Today",  value: orientationToday,   icon: "ti-users",       color: "#10b981", bg: "#f0fdf4", delta: orientationToday > 0 ? `${orientationToday} paid or scheduled` : "None scheduled" },
          { label: "Reservation Pending",value: reservationPending, icon: "ti-bookmark",    color: "#f59e0b", bg: "#fffbeb", delta: reservationPending > 0 ? "Awaiting payment" : "All cleared" },
          { label: "Won This Month",     value: wonThisMonth,       icon: "ti-trophy",      color: "#10b981", bg: "#f0fdf4", delta: `${conversionRate}% conversion rate` },
        ];
        if (isPhone) {
          // ── PHONE: 4 compact stat boxes in a single row (matches image screen 1) ──
          const phoneStats = [
            { label: "Follows\nToday",     value: followUpsToday,     color: "#6366f1" },
            { label: "Overdue\nFollow-ups", value: overdueCount,        color: "#f59e0b" },
            { label: "Reservtn\nPending",  value: reservationPending,  color: "#10b981" },
            { label: "Orientation\nPending", value: orientationToday,    color: "#ef4444" },
          ];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
              {phoneStats.map((s, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 12px 12px", border: "1px solid #e8ecf1", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", minWidth: 0, overflow: "hidden" }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", lineHeight: 1, letterSpacing: -1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, lineHeight: 1.3, whiteSpace: "pre-line", fontWeight: 500 }}>{s.label}</div>
                  <div style={{ width: 24, height: 3, borderRadius: 2, background: s.color, margin: "8px auto 0" }} />
                </div>
              ))}
            </div>
          );
        }
        return (
          <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "nowrap" }}>
            {kpiCards.map((k, ki) => {
              const isWarning = k.delta && (k.delta.startsWith("⚠") || k.delta.toLowerCase().includes("overdue"));
              const isNeutral = k.delta && (k.delta.includes("active") || k.delta.includes("rate") || k.delta.includes("paid") || k.delta.includes("scheduled") || k.delta.includes("cleared") || k.delta.includes("track") || k.delta.includes("payment") || k.delta.includes("none"));
              const deltaColor = isWarning ? "#ef4444" : isNeutral ? "#64748b" : "#10b981";
              const deltaPrefix = isWarning || isNeutral ? "" : "↑ ";
              return (
                <div key={k.label} onClick={k.onClick} style={{
                  flex: "1 1 0",
                  background: "#fff", borderRadius: 14, padding: "16px 18px",
                  border: "1px solid #e8ecf1", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  cursor: k.onClick ? "pointer" : "default",
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.label}</div>
                    <div style={{ fontSize: 34, fontWeight: 800, color: "#0f172a", lineHeight: 1, marginBottom: 8, letterSpacing: -1 }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: deltaColor, fontWeight: 600 }}>{deltaPrefix}{k.delta}</div>
                  </div>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: k.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ${k.icon}`} style={{ fontSize: 22, color: k.color }} />
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", alignItems: "center", paddingLeft: 4 }}>
              <button style={{ background: "none", border: "none", fontSize: 18, color: "#94a3b8", cursor: "pointer", padding: "4px 6px", borderRadius: 6 }}>···</button>
            </div>
          </div>
        );
      })()}

      {/* ── Action Queue ── */}
      {(() => {
        const overdueCount      = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate, cfg); return fu && fu.color === "#ef4444"; }).length;
        const callTodayCount    = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate, cfg); return fu && (fu.color === "#f59e0b" || fu.color === "#ef4444"); }).length;
        const orientTomorrow    = leads.filter(l => { if (l.status !== "Orientation Scheduled") return false; const d = new Date(l.followUpDate || ""); const tom = new Date(); tom.setDate(tom.getDate() + 1); return d.toDateString() === tom.toDateString(); }).length;
        const awaitingPayment   = leads.filter(l => l.status === "Orientation Payment Pending").length;
        const wonNotHandedOver  = leads.filter(l => l.status === "Won" && getDaysInStage(l) > 3).length;
        const unassignedCount   = leads.filter(l => !l.assignedTo && !CLOSED_STAGES.includes(l.status)).length;
        const aqItems = [
          { label: "Call Today",              count: callTodayCount,    color: "#10b981", bg: "#f0fdf4", icon: "ti-phone",          onClick: () => setShowReminderCenter(true) },
          { label: "Overdue Follow Ups",      count: overdueCount,      color: "#ef4444", bg: "#fef2f2", icon: "ti-alert-triangle",  onClick: () => setShowReminderCenter(true) },
          { label: "Orientation Tomorrow",    count: orientTomorrow,    color: "#3b82f6", bg: "#eff6ff", icon: "ti-calendar",        onClick: () => setFilter("Orientation Scheduled") },
          { label: "Awaiting Payment",        count: awaitingPayment,   color: "#f59e0b", bg: "#fffbeb", icon: "ti-credit-card",     onClick: () => setFilter("Orientation Payment Pending") },
          { label: "Won — Not Handed Over",   count: wonNotHandedOver,  color: "#7c3aed", bg: "#f5f3ff", icon: "ti-arrow-right",     onClick: () => setFilter("Won") },
          { label: "Unassigned",              count: unassignedCount,   color: "#ef4444", bg: "#fef2f2", icon: "ti-user-off",        onClick: () => setStaffFilter("__unassigned__") },
        ];
        return (
          <>{isPhone ? (
            /* ── PHONE: Action Queue as vertical list (image screen 1 style) ── */
            <div style={{ background: "#fff", border: "1px solid #e8ecf1", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.7 }}>Action Queue</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", background: "#eff6ff", borderRadius: 6, padding: "1px 8px" }}>{aqItems.reduce((s,i) => s + i.count, 0)} Items</span>
              </div>
              {aqItems.map((item, idx) => (
                <button key={item.label} onClick={item.onClick} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%", padding: "11px 14px",
                  borderTop: "1px solid #f1f5f9",
                  borderBottom: "none", borderLeft: "none", borderRight: "none",
                  background: "none",
                  cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  minHeight: "unset",
                }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ${item.icon}`} style={{ fontSize: 16, color: item.color }} />
                  </div>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{item.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: item.color, minWidth: 24, textAlign: "right" }}>{item.count}</span>
                  <i className="ti ti-chevron-right" style={{ fontSize: 13, color: "#cbd5e1" }} />
                </button>
              ))}
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #e8ecf1", borderRadius: 10, padding: "8px 14px", display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", marginRight: 14, paddingRight: 14, borderRight: "1px solid #e8ecf1", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.7 }}>Action Queue</span>
                <span style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>Needs attention</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", flex: 1 }}>
                {aqItems.map((item, idx) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center" }}>
                    <button onClick={item.onClick} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 11px", borderRadius: 7, cursor: "pointer",
                      border: `1.5px solid ${item.color}30`, background: item.bg,
                      fontSize: 11, fontWeight: 600, color: "#334155", whiteSpace: "nowrap",
                    }}>
                      <i className={`ti ${item.icon}`} style={{ fontSize: 12, color: item.color }} />
                      {item.label}
                      <span style={{ fontSize: 13, fontWeight: 800, color: item.color, background: item.color + "18", borderRadius: 5, padding: "0 5px", minWidth: 20, textAlign: "center", lineHeight: "18px" }}>{item.count}</span>
                    </button>
                    {idx < aqItems.length - 1 && <div style={{ width: 1, height: 16, background: "#e8ecf1", margin: "0 4px" }} />}
                  </div>
                ))}
              </div>
            </div>
          )}</>
        );
      })()}

      {/* ── Auto-rules alert ── */}
      {autoRulesAlert && (
        <div style={{ background: "#f0fdf4", border: "1px solid #6ee7b7", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#065f46", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
          ⚡ {autoRulesAlert}
          <button onClick={() => setAutoRulesAlert(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* ── PHONE: Pipeline Snapshot ── */}
      {isPhone && (() => {
        const pipelineCounts = PIPELINE_STAGES.map(stage => ({
          stage,
          count: leads.filter(l => l.status === stage).length,
          color: stageColors[stage] || "#64748b",
        }));
        const wonCount = leads.filter(l => l.status === "Won").length;
        const totalActive = leads.filter(l => !["Won","Lost","No Response","Not Interested","Duplicate"].includes(l.status)).length;
        return (
          <div style={{ background: "#fff", border: "1px solid #e8ecf1", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.7 }}>Pipeline Snapshot</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>See All</span>
            </div>
            {/* Stage counts bar */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
              {[
                { label: "Sampled",   value: leads.filter(l => l.status === "Contacted").length,            color: "#6366f1" },
                { label: "Follow-up", value: leads.filter(l => l.status === "Follow-Up").length,             color: "#f59e0b" },
                { label: "Reservtn",  value: leads.filter(l => l.status === "Reserved").length,              color: "#10b981" },
                { label: "Won",       value: wonCount,                                                         color: "#059669" },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center", minWidth: 60, flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 500 }}>{s.label}</div>
                  <div style={{ height: 3, borderRadius: 2, background: s.color, marginTop: 4 }} />
                </div>
              ))}
            </div>
            {/* Mini stage pill scroll */}
            <div style={{ display: "flex", gap: 5, marginTop: 10, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
              {PIPELINE_STAGES.map(stage => {
                const cnt = leads.filter(l => l.status === stage).length;
                const c = stageColors[stage] || "#64748b";
                return (
                  <button key={stage} onClick={() => setFilter(stage)} style={{
                    flexShrink: 0, padding: "4px 10px", borderRadius: 20, border: `1.5px solid ${c}30`,
                    background: filter === stage ? c : c + "12", color: filter === stage ? "#fff" : c,
                    fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                  }}>
                    {stage.replace("Orientation ", "Orn. ")} {cnt}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── PHONE: Hot Leads section ── */}
      {isPhone && (() => {
        const hotLeads = leads
          .filter(l => l.priority === "High" || l.priority === "VIP" || (l.score && l.score >= 75))
          .slice(0, 3);
        if (hotLeads.length === 0) return null;
        return (
          <div style={{ background: "#fff", border: "1px solid #e8ecf1", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 8px" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.7 }}>Hot Leads</span>
              <span style={{ fontSize: 11, color: "#2563eb", cursor: "pointer" }} onClick={() => setPriorityFilter("High")}>See All</span>
            </div>
            {hotLeads.map((lead, idx) => {
              const sc = scoreLead(lead); const sl = scoreLabel(sc);
              const _stageColor = stageColors[lead.status] || "#64748b";
              const fu = getFollowUpStatus(lead.followUpDate, cfg);
              return (
                <div key={lead.id} onClick={() => setDetailLead(lead)} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderTop: "1px solid #f1f5f9", cursor: "pointer",
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: `${_stageColor}18`, border: `1.5px solid ${_stageColor}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: _stageColor, flexShrink: 0 }}>
                    {(lead.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.service || "—"}</div>
                    {fu && <div style={{ fontSize: 10, color: fu.color, marginTop: 2, fontWeight: 600 }}>Follow up: {fu.label}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 8, background: sl === "Hot" ? "#fef2f2" : sl === "Warm" ? "#fffbeb" : "#eff6ff", color: sl === "Hot" ? "#ef4444" : sl === "Warm" ? "#f59e0b" : "#3b82f6", flexShrink: 0 }}>{sl === "Hot" ? "🔥 Hot" : sl === "Warm" ? "🌡 Warm" : "❄ Cold"}</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Pipeline Toolbar ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Main toolbar row */}
        {isPhone ? (
          /* ── PHONE toolbar: matches image screens 2 & 3 ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Row 1: "Leads ▾" title + Kanban|Table toggle + icons */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} onClick={() => setFilter("All")}>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>Leads</span>
                <i className="ti ti-chevron-down" style={{ fontSize: 14, color: "#94a3b8" }} />
              </div>
              <div style={{ flex: 1 }} />
              {/* Cards / Table pill toggle — Kanban is tablet/desktop only */}
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3, gap: 2 }}>
                {[
                  { id: "cards", label: "Cards" },
                  { id: "table", label: "Table" },
                ].map(v => {
                  const active = displayMode === v.id || (displayMode === "kanban" && v.id === "cards");
                  return (
                    <button key={v.id} onClick={() => setDisplayMode(v.id)} style={{
                      padding: "5px 12px", borderRadius: 6, border: "none",
                      background: active ? "#fff" : "none",
                      color: active ? "#4f46e5" : "#94a3b8",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      boxShadow: active ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                      transition: "all 0.12s", fontFamily: "inherit",
                    }}>{v.label}</button>
                  );
                })}
              </div>
              {/* Tools button — opens bottom sheet on phone */}
              <button onClick={() => setShowPhoneTools(true)} style={{ width: 34, height: 34, borderRadius: 8, background: "#fff", border: "1.5px solid #e8ecf1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-tools" style={{ fontSize: 16, color: "#64748b" }} />
              </button>
              {/* + Add Lead FAB */}
              <button onClick={() => setAddModal(true)} style={{
                width: 34, height: 34, borderRadius: 8, border: "none",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#fff",
                fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(37,99,235,0.4)", fontWeight: 300, lineHeight: 1,
              }}>+</button>
            </div>
            {/* Row 2: Search box full width */}
            <div style={{ position: "relative" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8", pointerEvents: "none" }} />
              <input
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
                placeholder="Search leads…"
                style={{ width: "100%", padding: "9px 36px 9px 32px", fontSize: 14, border: "1.5px solid #e8ecf1", borderRadius: 10, outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "#fff" }}
              />
              {localSearch && (
                <button onClick={() => setLocalSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16 }}>✕</button>
              )}
            </div>
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>

          {/* "Pipeline ▾" label */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", border: "1.5px solid #e8ecf1", borderRadius: 7, background: "#fff", cursor: "pointer", flexShrink: 0 }}
            onClick={() => setFilter("All")}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Pipeline</span>
            <i className="ti ti-chevron-down" style={{ fontSize: 11, color: "#94a3b8" }} />
          </div>

          {/* View toggles — kanban | cards | table */}
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
            {[
              { id: "kanban", icon: "ti-layout-columns", label: "Kanban" },
              { id: "cards",  icon: "ti-layout-grid",    label: "Cards"  },
              { id: "table",  icon: "ti-table",          label: "Table"  },
            ].map(v => (
              <button key={v.id} onClick={() => setDisplayMode(v.id)} style={{
                padding: "4px 10px", borderRadius: 6, border: "none",
                background: displayMode === v.id ? "#fff" : "none",
                color: displayMode === v.id ? "#4f46e5" : "#94a3b8",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                boxShadow: displayMode === v.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                fontWeight: displayMode === v.id ? 700 : 500,
                fontSize: 11, transition: "all 0.12s", whiteSpace: "nowrap",
              }}>
                <i className={`ti ${v.icon}`} style={{ fontSize: 12 }} />
                {v.label}
              </button>
            ))}
          </div>

          {/* Product / Source / Owner dropdowns */}
          {!isPhone && [
            { val: filter,         set: setFilter,         label: "All Products", opts: (cfg.serviceOptions || SERVICE_OPTIONS).map(s => s) },
            { val: "all",          set: () => {},          label: "All Sources",  opts: (cfg.sourceOptions  || SOURCE_OPTIONS) },
            { val: staffFilter,    set: setStaffFilter,    label: "All Owners",   opts: (cfg.staffOptions   || DEFAULT_LEADS_SETTINGS.staffOptions).filter(Boolean) },
          ].map(({ val, set: setter, label, opts }, di) => {
            const isActive = di === 0 ? val !== "All" : di === 2 ? val !== "All" : false;
            return (
              <div key={label} style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                <select
                  value={di === 0 ? filter : di === 2 ? staffFilter : "all"}
                  onChange={e => di === 0 ? setFilter(e.target.value) : di === 2 ? setStaffFilter(e.target.value) : null}
                  style={{
                    fontSize: 11, borderRadius: 7, padding: "5px 26px 5px 10px",
                    border: `1.5px solid ${isActive ? "#c7d2fe" : "#e8ecf1"}`,
                    background: isActive ? "#eef2ff" : "#fff",
                    color: isActive ? "#4338ca" : "#64748b", fontWeight: isActive ? 600 : 400,
                    cursor: "pointer", outline: "none", fontFamily: "inherit",
                    appearance: "none", WebkitAppearance: "none",
                  }}>
                  <option value="all">{label}</option>
                  {di === 0 && <option value="All">All Leads</option>}
                  {di === 0 ? PIPELINE_STAGES.map(o => <option key={o} value={o}>{o}</option>) : opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <i className="ti ti-chevron-down" style={{ position: "absolute", right: 7, pointerEvents: "none", fontSize: 11, color: isActive ? "#4338ca" : "#9ca3af" }} />
              </div>
            );
          })}

          {/* Search box */}
          <div style={{ position: "relative", flex: 1, minWidth: isPhone ? "100%" : 180 }}>
            <i className="ti ti-search" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8", pointerEvents: "none" }} />
            <input
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              placeholder="Search leads…"
              style={{ width: "100%", padding: "6px 36px 6px 30px", fontSize: 12, border: "1.5px solid #e8ecf1", borderRadius: 7, outline: "none", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.15s" }}
              onFocus={e => e.target.style.borderColor = "#93c5fd"}
              onBlur={e => e.target.style.borderColor = "#e8ecf1"}
            />
            {localSearch ? (
              <button onClick={() => setLocalSearch("")} title="Clear search" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#94a3b8", background: "#e2e8f0", border: "none", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>✕</button>
            ) : (
              <span onClick={() => setShowGlobalSearch(true)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: "#94a3b8", background: "#f1f5f9", borderRadius: 4, padding: "2px 5px", fontWeight: 600, cursor: "pointer" }}>⌘K</span>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 400, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 200, overflowY: "auto" }}>
                {suggestions.map((s, i) => (
                  <div key={i} onClick={() => onSuggestionSelect(s)} style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: `1px solid ${B.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = B.light}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{s}</div>
                ))}
              </div>
            )}
          </div>

          {/* Filter icon */}
          <button
            title="Advanced filters"
            onClick={() => setShowAdvancedFilters(v => !v)}
            style={{ width: 32, height: 32, border: `1.5px solid ${filter !== "All" || staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All" ? "#93c5fd" : "#e8ecf1"}`, borderRadius: 7, background: filter !== "All" || staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All" ? "#eff6ff" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
            <i className="ti ti-adjustments-horizontal" style={{ fontSize: 15, color: filter !== "All" || staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All" ? "#2563eb" : "#64748b" }} />
          </button>

          {/* ── + Add Lead button ── */}
          <button
            onClick={() => setAddModal(true)}
            title="Add new lead (N)"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 16px", borderRadius: 8, cursor: "pointer",
              background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", border: "none", fontSize: 12, fontWeight: 700,
              boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
              whiteSpace: "nowrap", flexShrink: 0,
              transition: "box-shadow 0.15s, transform 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(37,99,235,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(37,99,235,0.35)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <i className="ti ti-plus" style={{ fontSize: 14 }} />
            Add Lead
          </button>

          {/* Collaborators button — shows active user count, opens panel */}
          {activeUsers.length > 0 && (
            <button
              onClick={() => setShowCollaborators(c => !c)}
              title={`${activeUsers.length} collaborator${activeUsers.length !== 1 ? "s" : ""} active`}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                background: showCollaborators ? "#eff6ff" : "#fff",
                border: `1.5px solid ${showCollaborators ? "#93c5fd" : "#e8ecf1"}`,
                color: showCollaborators ? "#2563eb" : "#64748b",
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              <span style={{ display: "flex" }}>
                {activeUsers.slice(0, 3).map((u, idx) => (
                  <span key={u.userId} style={{
                    width: 20, height: 20, borderRadius: 6,
                    background: `hsl(${(u.userId.charCodeAt(0) * 37) % 360},55%,55%)`,
                    color: "#fff", fontSize: 9, fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginLeft: idx > 0 ? -6 : 0,
                    border: "2px solid #fff", flexShrink: 0,
                  }}>
                    {(u.userName || "?")[0].toUpperCase()}
                  </span>
                ))}
              </span>
              {activeUsers.length} online
            </button>
          )}

          {/* Tools button — opens same bottom sheet as phone */}
          <button onClick={() => setShowPhoneTools(true)} style={{ width: 32, height: 32, borderRadius: 7, background: "#fff", border: "1.5px solid #e8ecf1", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#c7d2fe"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e8ecf1"; }}
            title="Tools">
            <i className="ti ti-tools" style={{ fontSize: 15, color: "#64748b" }} />
          </button>
        </div>
        )}

        {/* Bulk action bar */}
        {bulkSelected.size > 0 && (
          <div style={{ display: "flex", gap: 5, alignItems: "center", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, padding: "7px 11px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginRight: 3 }}>{bulkSelected.size} of {rows.length} selected</span>
            {bulkSelected.size < rows.length && (
              <button onClick={() => setBulkSelected(new Set(rows.map(r => r.id)))} style={{ fontSize: 10, padding: "2px 7px", background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>Select all {rows.length}</button>
            )}
            <div style={{ width: "1.5px", height: 16, background: "#bfdbfe" }} />
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Move to…</option>
              {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            <button onClick={handleBulkMove} disabled={!bulkTarget} style={{ padding: "3px 9px", fontSize: 11, background: bulkTarget ? "#2563eb" : "#e8ecf1", color: bulkTarget ? "#fff" : "#94a3b8", border: "none", borderRadius: 5, cursor: bulkTarget ? "pointer" : "default", fontWeight: 600 }}>Move</button>
            <select value={bulkAssign} onChange={e => setBulkAssign(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Assign to…</option>
              {staffOptions.filter(Boolean).map(s => <option key={s}>{s}</option>)}
            </select>
            <button onClick={handleBulkAssign} disabled={!bulkAssign} style={{ padding: "3px 9px", fontSize: 11, background: bulkAssign ? "#059669" : "#e8ecf1", color: bulkAssign ? "#fff" : "#94a3b8", border: "none", borderRadius: 5, cursor: bulkAssign ? "pointer" : "default", fontWeight: 600 }}>Assign</button>
            <select value={bulkTag} onChange={e => setBulkTag(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Tag…</option>
              {tagOptions.map(t => <option key={t}>{t}</option>)}
            </select>
            <button onClick={handleBulkTag} disabled={!bulkTag} style={{ padding: "3px 9px", fontSize: 11, background: bulkTag ? "#4338ca" : "#e8ecf1", color: bulkTag ? "#fff" : "#94a3b8", border: "none", borderRadius: 5, cursor: bulkTag ? "pointer" : "default", fontWeight: 600 }}>Tag</button>
            <div style={{ width: "1.5px", height: 16, background: "#bfdbfe" }} />
            <button onClick={handleBulkExport}  style={{ padding: "3px 9px", fontSize: 11, background: "#fff", border: "1.5px solid #e8ecf1", borderRadius: 5, cursor: "pointer", color: "#374151", fontWeight: 500 }}>Export</button>
            <button onClick={handleBulkArchive} style={{ padding: "3px 9px", fontSize: 11, background: "#fff", border: "1.5px solid #e8ecf1", borderRadius: 5, cursor: "pointer", color: "#64748b", fontWeight: 500 }}>Archive</button>
            <button onClick={handleBulkDelete}  style={{ padding: "3px 9px", fontSize: 11, background: "#fff", border: "1.5px solid #fecaca", borderRadius: 5, cursor: "pointer", color: "#dc2626", fontWeight: 500 }}>Delete</button>
            <button onClick={() => setBulkSelected(new Set())} style={{ marginLeft: "auto", padding: "2px 5px", fontSize: 13, background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>✕</button>
          </div>
        )}

      </div>

      {/* ── Content ── */}
      {/* Phone Tools bottom sheet */}
      {showPhoneTools && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", flexDirection: "column", justifyContent: "flex-end" }} onClick={() => setShowPhoneTools(false)}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.45)", backdropFilter: "blur(3px)" }} />
          <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: "18px 18px 0 0", padding: "20px 20px 32px", boxShadow: "0 -8px 40px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e2e8f0", margin: "0 auto 18px" }} />
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 14 }}>Tools</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { icon: "ti-chart-bar",         label: "Funnel",         action: () => { setShowFunnel(true);        setShowPhoneTools(false); } },
                { icon: "ti-heart-rate-monitor", label: "Pipeline Health",action: () => { setShowPipelineHealth(true); setShowPhoneTools(false); } },
                { icon: "ti-bell",               label: "Reminders",      action: () => { setShowReminderCenter(true); setShowPhoneTools(false); } },
                { icon: "ti-upload",             label: "Import",         action: () => { setShowBulkImport(true);    setShowPhoneTools(false); } },
                { icon: "ti-tag",                label: "Tag Manager",    action: () => { setShowTagManager(true);    setShowPhoneTools(false); } },
                { icon: "ti-target",             label: "Goals",          action: () => { setShowGoalTracker(true);   setShowPhoneTools(false); } },
                { icon: "ti-copy",               label: "Merge Dupes",    action: () => { handleMergeDupes();         setShowPhoneTools(false); } },
                { icon: "ti-trending-up",        label: "Win/Loss",       action: () => { setShowWinLossReport(true); setShowPhoneTools(false); } },
                { icon: "ti-currency-dollar",    label: "Source ROI",     action: () => { setShowSourceROI(true);     setShowPhoneTools(false); } },
                { icon: "ti-users",              label: "Staff ROI",      action: () => { setShowStaffROI(true);      setShowPhoneTools(false); } },
                { icon: "ti-chart-line",         label: "Forecast",       action: () => { setShowForecast(true);      setShowPhoneTools(false); } },
                { icon: "ti-map-2",              label: "Heatmap",        action: () => { setShowHeatmap(true);       setShowPhoneTools(false); } },
                { icon: "ti-adjustments",        label: "Custom Fields",  action: () => { setShowCustomFields(true);  setShowPhoneTools(false); } },
                { icon: "ti-columns",            label: "Columns",        action: () => { setShowColumnPicker(true);  setShowPhoneTools(false); } },
                { icon: "ti-git-compare",        label: "Compare",        action: () => { setShowLeadCompare(true);   setShowPhoneTools(false); } },
              ].map(({ icon, label, action }) => (
                <button key={label} onClick={action} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 14px", borderRadius: 10,
                  background: "#f8fafc", border: "1.5px solid #e8ecf1",
                  cursor: "pointer", textAlign: "left",
                }}>
                  <i className={`ti ${icon}`} style={{ fontSize: 18, color: "#4f46e5", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", lineHeight: 1.25 }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Kanban is desktop/tablet only — force table on phone */}
      {(displayMode === "kanban" && !isPhone) ? (
        <KanbanBoard
          leads={rows}
          onDrop={handleKanbanDrop}
          dupeIds={dupeIds}
          staleLeads={staleLeads}
          onConvert={handleConvertToClient}
          onEdit={setEditLead}
          onDetail={(lead) => { setDetailLead(lead); setHoverLead(null); }}
          onHover={(lead, pos) => { setHoverLead(lead); setHoverPos(pos); }}
          onHoverEnd={() => setHoverLead(null)}
          tabLocks={tabLocks}
          currentUser={currentUser}
          onSetFollowUp={(lead, date) => {
            const updated = data.leads.map(l => l.id === lead.id ? { ...l, followUpDate: date, updatedAt: new Date().toISOString().slice(0,10) } : l);
            setData({ ...data, leads: updated });
          }}
        />
      ) : (
        <>
          {/* ── Table tab strip + toolbar ── */}
          {!isPhone && (
            <div style={{ background: "linear-gradient(135deg, #f8faff 0%, #eef2ff 100%)", borderRadius: "10px 10px 0 0", border: "1px solid #c7d2fe", borderBottom: "none", padding: "0 14px", display: "flex", alignItems: "center" }}>
              {/* Tab strip */}
              <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 0 }}>
                {[
                  { label: "All Leads",        icon: "ti-users",        count: data.leads?.filter(l => !l.archived).length, active: filter === "All" && !showDupesOnly && !showStaleOnly, onClick: () => { setFilter("All"); setShowDupesOnly(false); setShowStaleOnly(false); } },
                  { label: "My Leads",         icon: "ti-user",         count: null, active: staffFilter !== "All", onClick: () => { setStaffFilter(staffFilter !== "All" ? "All" : (cfg.staffOptions?.[0] || "Ahmed")); } },
                  { label: "🔥 Hot Leads",     icon: null,              count: null, active: priorityFilter === "High" || priorityFilter === "VIP", onClick: () => setPriorityFilter(priorityFilter === "High" ? "All" : "High") },
                  { label: "Orientation Paid", icon: "ti-credit-card",  count: null, active: filter === "Orientation Paid", onClick: () => setFilter(filter === "Orientation Paid" ? "All" : "Orientation Paid") },
                ].map(tab => (
                  <button key={tab.label} onClick={tab.onClick} style={{
                    padding: "11px 16px", fontSize: 12, fontWeight: tab.active ? 700 : 500,
                    color: tab.active ? "#4f46e5" : "#64748b",
                    borderBottom: tab.active ? "2.5px solid #4f46e5" : "2.5px solid transparent",
                    borderTop: "none", borderLeft: "none", borderRight: "none",
                    background: tab.active ? "rgba(79,70,229,0.06)" : "none",
                    cursor: "pointer", whiteSpace: "nowrap",
                    transition: "color 0.12s, border-color 0.12s, background 0.12s",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {tab.icon && <i className={`ti ${tab.icon}`} style={{ fontSize: 12 }} />}
                    {tab.label}
                    {tab.count != null && <span style={{ fontSize: 10, fontWeight: 700, background: tab.active ? "#e0e7ff" : "#f1f5f9", color: tab.active ? "#4f46e5" : "#94a3b8", borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>{tab.count}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {isPhone ? (
            /* ── PHONE: plain scrollable list, no SectionCard wrapper ── */
            <div style={{ borderRadius: 10, overflow: "hidden", background: "#fff", border: "1px solid #e8ecf1" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {isPhone && displayMode === "table" ? (
              /* ── PHONE TABLE: compact list rows ── */
              <div>
                {rows.length === 0 ? (
                  <div style={{ padding: "40px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No leads found</div>
                ) : leadPageData.map(r => {
                  const fu = getFollowUpStatus(r.followUpDate, cfg);
                  const sc2 = scoreLead(r); const sl2 = scoreLabel(sc2);
                  const _sc = stageColors[r.status] || STAGE_COLORS[r.status] || "#64748b";
                  return (
                    <div key={r.id} onClick={() => setDetailLead(r)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", borderLeft: `3px solid ${_sc}`, background: "#fff" }}
                      onTouchStart={e => e.currentTarget.style.background = "#f8fafc"}
                      onTouchEnd={e => e.currentTarget.style.background = "#fff"}>
                      {/* Avatar */}
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${_sc}18`, border: `1.5px solid ${_sc}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: _sc, flexShrink: 0 }}>
                        {(r.name||"?").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()||"?"}
                      </div>
                      {/* Name + service */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                          {r.service || "—"}{r.assignedTo ? ` · ${r.assignedTo}` : ""}
                        </div>
                      </div>
                      {/* Right: status + follow-up */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: `${_sc}18`, color: _sc, border: `1px solid ${_sc}44`, whiteSpace: "nowrap" }}>{r.status}</span>
                        {fu && <span style={{ fontSize: 10, fontWeight: 600, color: fu.color, whiteSpace: "nowrap" }}>{fu.icon} {fu.label}</span>}
                        {r.value > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981" }}>{cfg.currencyLabel||"AED"} {Number(r.value).toLocaleString()}</span>}
                      </div>
                      {/* Quick actions */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditLead(r)} style={{ padding: "5px 8px", background: "#eff6ff", border: "none", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>✏️</button>
                        {r.phone && <a href={`https://wa.me/${r.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" style={{ padding: "5px 8px", background: "#f0fdf4", border: "none", borderRadius: 7, fontSize: 13, textDecoration: "none", textAlign: "center" }}>💬</a>}
                      </div>
                    </div>
                  );
                })}
                {leadPageCount > 1 && (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"12px 0", borderTop: "1px solid #f1f5f9" }}>
                    <button onClick={() => setLeadPage(p => Math.max(0,p-1))} disabled={leadPage===0} style={{ minWidth:36, minHeight:34, border:"1px solid #e2e8f0", borderRadius:8, cursor:"pointer", background:"#fff", fontSize:16, opacity: leadPage===0 ? 0.4 : 1 }}>‹</button>
                    <span style={{ fontSize:12, fontWeight:600, color:"#334155" }}>Page {leadPage+1} / {leadPageCount}</span>
                    <button onClick={() => setLeadPage(p => Math.min(leadPageCount-1,p+1))} disabled={leadPage===leadPageCount-1} style={{ minWidth:36, minHeight:34, border:"1px solid #e2e8f0", borderRadius:8, cursor:"pointer", background:"#fff", fontSize:16, opacity: leadPage===leadPageCount-1 ? 0.4 : 1 }}>›</button>
                  </div>
                )}
              </div>
            ) : (
              /* ── PHONE CARDS: rich card list ── */
              <div>
              {rows.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "56px 20px", gap: 14 }}>
                  <div style={{ width: 64, height: 64, borderRadius: 20, background: "linear-gradient(135deg,#eff6ff,#dbeafe)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(37,99,235,0.12)" }}>
                    <i className="ti ti-users" aria-hidden style={{ fontSize: 28, color: "#2563eb" }} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>No leads found</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {localSearch || filter !== "All" ? "Try clearing your filters" : "Add your first lead to get started"}
                    </div>
                  </div>
                  {!localSearch && filter === "All" && (
                    <button onClick={() => setAddModal(true)} style={{ padding: "10px 28px", background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(37,99,235,0.35)" }}>
                      + Add Lead
                    </button>
                  )}
                </div>
              )}
              {leadPageData.map((r, ri) => {
                const fu = getFollowUpStatus(r.followUpDate, cfg);
                const sc = scoreLead(r); const sl = scoreLabel(sc);
                const na = getNextAction(r, cfg);
                const _stageColor = stageColors[r.status] || STAGE_COLORS[r.status] || "#64748b";
                return (
                  <div key={r.id} onClick={() => setDetailLead(r)}
                    style={{ background: "#fff", borderRadius: 0, border: "none", borderBottom: "1px solid #f1f5f9", padding: "11px 14px", cursor: "pointer", borderLeft: `3px solid ${_stageColor}`, transition: "background 0.12s" }}
                    onTouchStart={e => e.currentTarget.style.background = "#f8fafc"}
                    onTouchEnd={e => e.currentTarget.style.background = "#fff"}>
                    {/* Row 1: avatar + name + priority badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${_stageColor}18`, border: `1.5px solid ${_stageColor}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: _stageColor, flexShrink: 0, letterSpacing: -0.5 }}>
                        {(r.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.service || "—"}{r.phone ? <span style={{ color: "#94a3b8" }}> · {r.phone}</span> : null}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                        {r.priority && <span style={pill((cfg.priorityColors||PRIORITY_COLORS)[r.priority], (cfg.priorityColors||PRIORITY_COLORS)[r.priority] + "18")}>{r.priority}</span>}
                        <span style={pill(_stageColor, _stageColor + "18")}>{r.status}</span>
                      </div>
                    </div>
                    {/* Row 2: value + follow-up */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      {fu
                        ? <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>
                        : <span style={{ fontSize: 11, color: "#cbd5e1" }}>No follow-up set</span>}
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        {r.value > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>{cfg.currencyLabel || "AED"} {Number(r.value).toLocaleString()}</span>}
                      </div>
                    </div>
                    {/* Row 3: assigned + next action */}
                    {(r.assignedTo || na) && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        {r.assignedTo && <span style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}><i className="ti ti-user" style={{ fontSize: 10 }} />{r.assignedTo}</span>}
                        {na && <div style={{ fontSize: 10, color: "#334155", background: "#f8fafc", borderRadius: 5, padding: "3px 7px", borderLeft: "2px solid #e2e8f0", maxWidth: "60%", textAlign: "right" }}>{na.icon} {na.text}</div>}
                      </div>
                    )}
                    {/* Row 5: quick actions */}
                    <div style={{ display: "flex", gap: 5, marginTop: 6, paddingTop: 6, borderTop: "1px solid #f1f5f9" }} onClick={e => e.stopPropagation()}>
                      <button aria-label="Edit lead" onClick={() => setEditLead(r)} style={{ ...actionBtn(B.blue, B.blue + "12"), minHeight: 32, flex: 1, justifyContent: "center", display: "flex", alignItems: "center" }}>✏️ Edit</button>
                      {r.phone && (
                        <button aria-label="Open WhatsApp" onClick={() => window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank")} style={{ ...actionBtn("#25d366", "#25d36612"), minHeight: 32, flex: 1, justifyContent: "center", display: "flex", alignItems: "center" }}>💬 WA</button>
                      )}
                      {r.phone && (
                        <a href={`tel:${r.phone}`} aria-label="Call lead" onClick={e => e.stopPropagation()} style={{ ...actionBtn("#0ea5e9", "#f0f9ff"), textDecoration: "none", minHeight: 32, flex: 1, justifyContent: "center", display: "flex", alignItems: "center" }}>📞 Call</a>
                      )}
                      {r.status === "Won" && (
                        <button aria-label="Convert to client" onClick={() => handleConvertToClient(r)} style={{ ...actionBtn(B.green, B.green + "12"), minHeight: 32, flex: 1, justifyContent: "center", display: "flex", alignItems: "center" }}>↗ Convert</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Mobile pagination */}
              {leadPageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 0 8px", fontSize:12, color:B.muted, justifyContent:"center" }}>
                  <button onClick={() => setLeadPage(p => Math.max(0,p-1))} disabled={leadPage===0} style={{ minWidth:40, minHeight:36, border:`1px solid ${B.border}`, borderRadius:8, cursor:"pointer", background:"#fff", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", opacity: leadPage===0 ? 0.4 : 1 }}>‹</button>
                  <span style={{ fontWeight:600, color:"#334155", fontSize:12, minWidth:80, textAlign:"center" }}>Page {leadPage+1} / {leadPageCount}</span>
                  <button onClick={() => setLeadPage(p => Math.min(leadPageCount-1,p+1))} disabled={leadPage===leadPageCount-1} style={{ minWidth:40, minHeight:36, border:`1px solid ${B.border}`, borderRadius:8, cursor:"pointer", background:"#fff", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", opacity: leadPage===leadPageCount-1 ? 0.4 : 1 }}>›</button>
                </div>
              )}
            </div>
            )}{/* end table/cards ternary */}
            </div>
            </div>
          ) : (
            /* ── Desktop/tablet: SectionCard wraps cards+table ── */
            <SectionCard title={`Leads — ${rows.length.toLocaleString()} record${rows.length !== 1 ? "s" : ""}${rows.length !== data.leads?.filter(l => !l.archived).length ? ` (filtered from ${data.leads?.filter(l => !l.archived).length})` : ""}`} style={{ flex: 1, minHeight: 0, overflow: "hidden", borderRadius: "0 0 10px 10px" }}>
          {displayMode === "cards" ? (
            /* ── Lead card grid — desktop/tablet (cards mode) ── */
            <>
              <style id="leads-card-styles">{`
                .lc-card { transition: box-shadow 0.2s ease, transform 0.18s ease, border-color 0.2s ease; cursor: pointer; position: relative; }
                .lc-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.11) !important; transform: translateY(-1px); }
                .lc-card:active { transform: translateY(0px) scale(0.99); box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important; }
                .lc-card:hover .lc-view-hint { opacity: 1 !important; }
                .lc-card-sel { outline: 2px solid #818cf8; outline-offset: -1px; background: #eef2ff !important; }
                .lc-add-card { transition: box-shadow 0.15s, background 0.12s; cursor: pointer; }
                .lc-add-card:hover { box-shadow: 0 4px 16px rgba(99,102,241,0.08) !important; background: #eef2ff !important; }
                .lc-action-btn { transition: background 0.12s, opacity 0.12s; opacity: 0.85; border-radius: 7px !important; }
                .lc-action-btn:hover { opacity: 1; }
                .lc-action-btn:active { opacity: 0.8; }
                .lc-expand-body { overflow: hidden; transition: max-height 0.32s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease; }
                .lc-section-hdr { font-size: 10px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; border-left: 2px solid #a5b4fc; padding-left: 6px; }
                .lc-kv { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; padding: 2px 0; }
                .lc-kv-key { color: #64748b; font-weight: 500; }
                .lc-kv-val { font-weight: 600; color: #1e293b; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
              `}</style>
              <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 380px)", padding: "2px 2px 12px" }}>
                {leadPageData.length === 0 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "56px 20px", gap: 12 }}>
                    <div style={{ width: 60, height: 60, borderRadius: 16, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="ti ti-users" aria-hidden style={{ fontSize: 28, color: "#2563eb" }} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>No leads found</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                      {localSearch ? `No results for "${localSearch}"` : filter !== "All" ? `No leads in "${filter}"` : "Add your first lead to get started"}
                    </div>
                    {(localSearch || filter !== "All" || staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All") && (
                      <button onClick={() => { setLocalSearch(""); setFilter("All"); setStaffFilter("All"); setPriorityFilter("All"); setTagFilter("All"); }} style={{ padding: "7px 18px", background: "#f1f5f9", color: "#4f46e5", border: "1.5px solid #c7d2fe", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        ✕ Clear all filters
                      </button>
                    )}
                    {!localSearch && filter === "All" && (
                      <button onClick={() => setAddModal(true)} style={{ marginTop: 4, padding: "9px 22px", background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.35)", transition: "box-shadow 0.15s, transform 0.1s" }}
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(37,99,235,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(37,99,235,0.35)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                        + Add First Lead
                      </button>
                    )}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12, alignItems: "start" }}>
                  {leadPageData.map((r, i) => {
                    const isSel = bulkSelected.has(r.id);
                    const isExpanded = expandedCards.has(r.id);
                    const fu = getFollowUpStatus(r.followUpDate, cfg);
                    const sc = scoreLead(r); const sl = scoreLabel(sc);
                    const na = getNextAction(r, cfg);
                    const _stageColor = stageColors[r.status] || STAGE_COLORS[r.status] || "#64748b";
                    const _priorityColor = (cfg.priorityColors || PRIORITY_COLORS)[r.priority];
                    const isDupe  = dupeIds?.has?.(r.id);
                    const isStale = staleLeads?.some?.(s => s.id === r.id);
                    const sla = getSLAStatus(r, cfg);
                    const isOverdue = fu && fu.color === "#ef4444";
                    const tags = r.tags || [];
                    const temp = getTemperature(r, cfg); const tempLabel = getTempLabel(temp, cfg);
                    const daysInStage = getDaysInStage(r);
                    const stageWarn = daysInStage > (cfg.stageAgeDangerDays ?? 14) ? "#ef4444" : daysInStage > (cfg.stageAgeWarnDays ?? 7) ? "#f59e0b" : null;
                    const lastContactLabel = (() => {
                      const ref = r.lastContacted || r.date;
                      if (!ref) return null;
                      const mins = Math.floor((Date.now() - new Date(ref)) / 60000);
                      if (mins < 5) return "Just now";
                      if (mins < 60) return `${mins}m ago`;
                      const h = Math.floor(mins / 60);
                      if (h < 24) return `${h}h ago`;
                      const d = Math.floor(h / 24);
                      return d === 1 ? "Yesterday" : `${d}d ago`;
                    })();
                    const age = (() => {
                      if (!r.date) return null;
                      const d = Math.floor((Date.now() - new Date(r.date)) / 86400000);
                      if (d === 0) return "Today";
                      if (d === 1) return "Yesterday";
                      return `${d}d old`;
                    })();
                    return (
                      <div
                        key={r.id}
                        className={`lc-card${isSel ? " lc-card-sel" : ""}`}
                        onClick={() => setDetailLead(r)}
                        style={{
                          background: isSel ? "#eef2ff" : isOverdue ? "#fff8f7" : isDupe ? "#faf7ff" : "#fff",
                          borderRadius: 16,
                          border: `1.5px solid ${isOverdue ? "#fca5a5" : isDupe ? "#c4b5fd" : "#e0e7ff"}`,
                          borderLeft: `4px solid ${_stageColor}`,
                          padding: "14px 16px 12px",
                          boxShadow: "0 2px 8px rgba(99,102,241,0.06)",
                          display: "flex", flexDirection: "column", gap: 0,
                        }}
                      >
                        {/* ── Warning pills — same as table ── */}
                        {(isDupe || isStale || isOverdue) && (
                          <div style={{ display: "flex", gap: 4, marginBottom: 9, flexWrap: "wrap" }}>
                            {isDupe    && <span className="lt-warn" style={{ background: "#faf5ff", color: "#7c3aed", borderColor: "#c4b5fd" }}>⚠ Duplicate</span>}
                            {isStale   && <span className="lt-warn" style={{ background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" }}>⏱ Stale</span>}
                            {isOverdue && <span className="lt-warn" style={{ background: "#fef2f2", color: "#dc2626", borderColor: "#fca5a5" }}>🔴 Overdue</span>}
                          </div>
                        )}

                        {/* ── Header: checkbox + avatar + name + value ── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <div onClick={e => { e.stopPropagation(); setBulkSelected(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }); }} style={{ flexShrink: 0 }}>
                            <input type="checkbox" checked={isSel} onChange={() => {}} style={{ accentColor: "#818cf8", cursor: "pointer", width: 13, height: 13 }} />
                          </div>
                          {/* Avatar — same style as table */}
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: `${_stageColor}20`, border: `2px solid ${_stageColor}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: _stageColor, flexShrink: 0 }}>
                            {(r.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Name — same weight/color as table */}
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "—"}</div>
                            {/* Phone/email — same as table sub line */}
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.phone || r.email || "No contact"}</div>
                          </div>
                          {/* Value — same bold green as table */}
                          {r.value > 0 && (
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#059669", flexShrink: 0, whiteSpace: "nowrap" }}>
                              {cfg.currencyLabel || "AED"} {Number(r.value).toLocaleString()}
                            </div>
                          )}
                        </div>

                        {/* ── Row 1: Stage + Priority + Follow-up — same badges as table ── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                          {/* Stage badge — same as table */}
                          <span className="lt-badge" style={{ background: `${_stageColor}18`, color: _stageColor, borderColor: `${_stageColor}55` }}>{r.status}</span>
                          {/* Priority badge — same as table */}
                          {r.priority && _priorityColor && (
                            <span className="lt-badge" style={{ background: _priorityColor + "18", color: _priorityColor, borderColor: _priorityColor + "55" }}>{r.priority}</span>
                          )}
                          {/* Follow-up badge — same as table */}
                          {fu && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 12, background: fu.bg + "cc", color: fu.color, border: `1px solid ${fu.color}44`, whiteSpace: "nowrap" }}>
                              {fu.icon} {fu.label}
                            </span>
                          )}
                          {/* Age — right-aligned */}
                          {age && <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: "auto" }}>{age}</span>}
                        </div>

                        {/* ── Row 2: Service + Owner + Source — same as table ── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                          {r.service && <span style={{ fontSize: 11, fontWeight: 500, color: "#334155" }}>{r.service}</span>}
                          {r.service && r.assignedTo && <span style={{ color: "#cbd5e1", fontSize: 10 }}>·</span>}
                          {r.assignedTo && (
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 18, height: 18, borderRadius: 5, background: "#e0e7ff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#4f46e5" }}>
                                {r.assignedTo.charAt(0).toUpperCase()}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{r.assignedTo}</span>
                            </span>
                          )}
                          {r.source && <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>{r.source}</span>}
                        </div>

                        {/* ── Row 3: SLA / stage age warning — same colors as table ── */}
                        {(sla || stageWarn) && (
                          <div style={{ marginBottom: 8 }}>
                            {sla && <span style={{ fontSize: 10, fontWeight: 600, color: sla.urgent ? "#dc2626" : "#64748b" }}>{sla.urgent ? "⚠ " : ""}SLA {sla.label}</span>}
                            {!sla && stageWarn && <span style={{ fontSize: 9, color: stageWarn, fontWeight: 700 }}>⏱ {daysInStage}d in stage</span>}
                          </div>
                        )}

                        {/* ── Next action box — same indigo style as table ── */}
                        {na && (
                          <div style={{ fontSize: 11, color: "#4338ca", background: "#eef2ff", borderRadius: 8, padding: "6px 10px", marginBottom: 9, lineHeight: 1.4, border: "1px solid #c7d2fe", fontWeight: 500 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 2 }}>Next Action</span>
                            {na.icon} {na.text}
                          </div>
                        )}

                        {/* ── Tags — same green pills as table ── */}
                        {tags.length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 9 }}>
                            {tags.slice(0, 3).map(t => (
                              <span key={t} className="lt-tag">{t}</span>
                            ))}
                            {tags.length > 3 && <span style={{ fontSize: 9, color: "#6366f1", padding: "2px 6px", background: "#eef2ff", borderRadius: 20, border: "1px solid #c7d2fe", fontWeight: 700 }}>+{tags.length - 3} more</span>}
                          </div>
                        )}

                        {/* ── Nationality — shown in table, now shown in card too ── */}
                        {r.nationality && (
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>🌍 {r.nationality}</div>
                        )}

                        {/* ── EXPAND SECTION ── */}
                        {isExpanded && (
                          <div className="lc-expand-body" style={{ maxHeight: "2000px", opacity: 1 }}>
                            <div style={{ borderTop: "1px solid #f0f2f5", paddingTop: 10, marginTop: 2, display: "flex", flexDirection: "column", gap: 10 }} onClick={e => e.stopPropagation()}>
                              <style>{`@keyframes mobileExpand{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>

                              {/* Contact */}
                              <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                <div className="lc-section-hdr">Contact</div>
                                {r.phone && <div className="lc-kv"><span className="lc-kv-key">Phone</span><a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 500, color: "#6a9fd8", textDecoration: "none", fontSize: 11 }}>{r.phone}</a></div>}
                                {r.whatsapp && r.whatsapp !== r.phone && <div className="lc-kv"><span className="lc-kv-key">WhatsApp</span><a href={`https://wa.me/${r.whatsapp.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontWeight: 500, color: "#5bab7e", textDecoration: "none", fontSize: 11 }}>{r.whatsapp}</a></div>}
                                {r.email && <div className="lc-kv"><span className="lc-kv-key">Email</span><a href={`mailto:${r.email}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 500, color: "#6a9fd8", textDecoration: "none", fontSize: 11, maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{r.email}</a></div>}
                                {r.address && <div className="lc-kv"><span className="lc-kv-key">Address</span><span className="lc-kv-val">{r.address}</span></div>}
                              </div>

                              {/* Personal */}
                              {(r.nationality || r.dob || r.gender || r.passportNo || r.emiratesId) && (
                                <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                  <div className="lc-section-hdr">Personal</div>
                                  {r.nationality && <div className="lc-kv"><span className="lc-kv-key">Nationality</span><span className="lc-kv-val">{r.nationality}</span></div>}
                                  {r.gender && <div className="lc-kv"><span className="lc-kv-key">Gender</span><span className="lc-kv-val">{r.gender}</span></div>}
                                  {r.dob && <div className="lc-kv"><span className="lc-kv-key">DOB</span><span className="lc-kv-val">{r.dob}</span></div>}
                                  {r.passportNo && <div className="lc-kv"><span className="lc-kv-key">Passport</span><span className="lc-kv-val" style={{ fontFamily: "monospace", fontSize: 10 }}>{r.passportNo}</span></div>}
                                  {r.emiratesId && <div className="lc-kv"><span className="lc-kv-key">Emirates ID</span><span className="lc-kv-val" style={{ fontFamily: "monospace", fontSize: 10 }}>{r.emiratesId}</span></div>}
                                </div>
                              )}

                              {/* Deal */}
                              <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                <div className="lc-section-hdr">Deal</div>
                                <div className="lc-kv"><span className="lc-kv-key">Service</span><span className="lc-kv-val">{r.service || "—"}</span></div>
                                <div className="lc-kv"><span className="lc-kv-key">Value</span><span className="lc-kv-val" style={{ color: r.value ? "#4caf88" : undefined }}>{r.value ? `${cfg.currencyLabel || "AED"} ${Number(r.value).toLocaleString()}` : "Not set"}</span></div>
                                {r.reservationAmount > 0 && <div className="lc-kv"><span className="lc-kv-key">Reservation</span><span className="lc-kv-val">{cfg.currencyLabel || "AED"} {Number(r.reservationAmount).toLocaleString()}</span></div>}
                                <div className="lc-kv"><span className="lc-kv-key">Source</span><span className="lc-kv-val">{r.source || "—"}</span></div>
                                {r.campaign && <div className="lc-kv"><span className="lc-kv-key">Campaign</span><span className="lc-kv-val">{r.campaign}</span></div>}
                                {r.orientationType && <div className="lc-kv"><span className="lc-kv-key">Orientation</span><span className="lc-kv-val">{r.orientationType}</span></div>}
                                {r.lostReason && <div className="lc-kv"><span className="lc-kv-key">Lost reason</span><span className="lc-kv-val" style={{ color: "#c97474" }}>{r.lostReason}</span></div>}
                              </div>

                              {/* Dates */}
                              <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                <div className="lc-section-hdr">Dates</div>
                                <div className="lc-kv"><span className="lc-kv-key">Created</span><span className="lc-kv-val">{r.date || "—"}</span></div>
                                {r.updatedAt && <div className="lc-kv"><span className="lc-kv-key">Updated</span><span className="lc-kv-val">{r.updatedAt}</span></div>}
                                {r.lastContacted && <div className="lc-kv"><span className="lc-kv-key">Last contact</span><span className="lc-kv-val">{r.lastContacted}</span></div>}
                                {r.followUpDate && <div className="lc-kv"><span className="lc-kv-key">Follow-up</span><span className="lc-kv-val" style={{ color: fu?.color || undefined }}>{r.followUpDate}</span></div>}
                                {r.estimatedClose && <div className="lc-kv"><span className="lc-kv-key">Est. close</span><span className="lc-kv-val">{r.estimatedClose}</span></div>}
                                {r.stageEnteredAt && <div className="lc-kv"><span className="lc-kv-key">In stage</span><span className="lc-kv-val" style={{ color: stageWarn || undefined }}>{daysInStage}d</span></div>}
                              </div>

                              {/* Notes */}
                              {r.notes && (
                                <div style={{ background: "#fefdf6", borderRadius: 10, padding: "10px 12px", border: "1px solid #f0ead8" }}>
                                  <div className="lc-section-hdr" style={{ display: "flex", justifyContent: "space-between" }}><span>Notes</span><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{r.notes.length} chars</span></div>
                                  <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.notes}</div>
                                </div>
                              )}

                              {/* Call log */}
                              {(r.callLog || []).length > 0 && (
                                <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                  <div className="lc-section-hdr">Call Log</div>
                                  {(r.callLog || []).slice(-3).map((c, ci) => (
                                    <div key={ci} style={{ display: "flex", gap: 8, fontSize: 11, padding: "2px 0" }}>
                                      <span style={{ color: "#b8c0cc", flexShrink: 0 }}>{c.date}</span>
                                      <span style={{ color: "#5a6472" }}>{c.note || c.text || "Call logged"}</span>
                                    </div>
                                  ))}
                                  {(r.callLog || []).length > 3 && <span style={{ fontSize: 10, color: "#b8c0cc" }}>+{(r.callLog||[]).length - 3} more</span>}
                                </div>
                              )}

                              {/* Tasks */}
                              {(r.tasks || []).length > 0 && (
                                <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                  <div className="lc-section-hdr">Tasks</div>
                                  {(r.tasks || []).slice(0, 4).map((t, ti) => (
                                    <div key={ti} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, padding: "2px 0" }}>
                                      <span style={{ fontSize: 11, opacity: 0.7 }}>{t.done ? "✓" : "○"}</span>
                                      <span style={{ color: t.done ? "#b0b8c4" : "#5a6472", textDecoration: t.done ? "line-through" : "none" }}>{t.text || t}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Payments */}
                              {(r.payments || []).length > 0 && (
                                <div style={{ background: "#f6fdf9", borderRadius: 10, padding: "10px 12px", border: "1px solid #e0f0e8" }}>
                                  <div className="lc-section-hdr">Payments</div>
                                  {(r.payments || []).map((p, pi) => (
                                    <div key={pi} className="lc-kv">
                                      <span className="lc-kv-key">{p.label || `Payment ${pi + 1}`}</span>
                                      <span className="lc-kv-val" style={{ color: "#4caf88" }}>{cfg.currencyLabel || "AED"} {(p.amount || 0).toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Docs */}
                              {(r.docChecklist && Object.keys(r.docChecklist).length > 0) && (() => {
                                const DOC_ITEMS = (cfg.docChecklistItems || ["Emirates ID","Passport","Visa Copy","Trade License","MOA","Proof of Address","Bank Statement","NOC Letter"]);
                                const checked = DOC_ITEMS.filter(d => r.docChecklist?.[d]);
                                return (
                                  <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                    <div className="lc-section-hdr">Docs {checked.length}/{DOC_ITEMS.length}</div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                                      {DOC_ITEMS.map(d => (
                                        <div key={d} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                                          <span style={{ color: r.docChecklist?.[d] ? "#4caf88" : "#c8d0da", fontSize: 10 }}>{r.docChecklist?.[d] ? "✓" : "○"}</span>
                                          <span style={{ color: r.docChecklist?.[d] ? "#5a7a6a" : "#9aa5b4" }}>{d}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Timeline */}
                              {(r.timeline || []).length > 0 && (
                                <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                  <div className="lc-section-hdr">Timeline</div>
                                  {(r.timeline || []).slice(-5).reverse().map((t, ti) => (
                                    <div key={ti} style={{ display: "flex", gap: 8, fontSize: 10, padding: "2px 0" }}>
                                      <span style={{ color: "#b8c0cc", flexShrink: 0, fontFamily: "monospace" }}>{t.date}</span>
                                      <span style={{ color: "#5a6472" }}>{t.text}</span>
                                    </div>
                                  ))}
                                  {(r.timeline || []).length > 5 && <span style={{ fontSize: 10, color: "#b8c0cc" }}>+{(r.timeline||[]).length - 5} earlier</span>}
                                </div>
                              )}

                              {/* All tags (expanded) */}
                              {tags.length > 0 && (
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  {tags.map(t => (
                                    <span key={t} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, background: "#f0f1fa", color: "#8892c4", border: "1px solid #e4e7f5" }}>{t}</span>
                                  ))}
                                </div>
                              )}

                              {/* Custom fields */}
                              {r.customFields && Object.keys(r.customFields).length > 0 && (
                                <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 12px" }}>
                                  <div className="lc-section-hdr">Custom Fields</div>
                                  {Object.entries(r.customFields).map(([k, v]) => (
                                    <div key={k} className="lc-kv"><span className="lc-kv-key">{k}</span><span className="lc-kv-val">{String(v)}</span></div>
                                  ))}
                                </div>
                              )}

                              {/* ID */}
                              <div style={{ fontSize: 9, color: "#cdd2da", paddingTop: 2 }}>
                                {r.id}{r.archived && <span style={{ marginLeft: 8, background: "#f1f2f5", padding: "1px 5px", borderRadius: 3, color: "#9aa5b4" }}>archived</span>}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── View hint on hover ── */}
                        {!isExpanded && (
                          <div className="lc-view-hint" style={{ fontSize: 10, color: "#9aa5b4", fontWeight: 500, textAlign: "center", marginBottom: 4, opacity: 0, transition: "opacity 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            <i className="ti ti-external-link" style={{ fontSize: 10 }} />Open detail
                          </div>
                        )}

                        {/* ── Actions — same set as table ── */}
                        <div style={{ display: "flex", gap: 4, paddingTop: 8, borderTop: "1px solid #f0f2f5", flexWrap: "wrap", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                          <button className="lc-action-btn" onClick={e => { e.stopPropagation(); setDetailLead(r); }} style={actionBtn("#4f46e5", "#eef2ff")} title="View detail">👁</button>
                          <button className="lc-action-btn" onClick={e => { e.stopPropagation(); setEditLead(r); }} style={actionBtn("#0284c7", "#f0f9ff")} title="Edit">✏️</button>
                          {r.phone && (
                            <button className="lc-action-btn" onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank"); }}
                              style={actionBtn("#15803d", "#f0fdf4")} title="WhatsApp">💬</button>
                          )}
                          {r.phone && (
                            <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()} className="lc-action-btn" style={{ ...actionBtn("#d97706", "#fffbeb"), textDecoration: "none" }} title="Call">📞</a>
                          )}
                          <button className="lc-action-btn" onClick={e => { e.stopPropagation(); setShowCallScheduler(r); }} style={actionBtn("#0891b2", "#f0f9ff")} title="Schedule call">📅</button>
                          <button className="lc-action-btn" onClick={e => { e.stopPropagation(); setShowNotes(r); }} style={actionBtn("#9333ea", "#fdf4ff")} title="Add note">📝</button>
                          {r.status === "Won" && (
                            <button className="lc-action-btn" onClick={e => { e.stopPropagation(); handleConvertToClient(r); }} style={actionBtn("#15803d", "#f0fdf4")} title="Convert to client">↗ Client</button>
                          )}
                          {["Not Interested","Lost","No Response","Duplicate"].includes(r.status) && (
                            <button className="lc-action-btn" onClick={e => { e.stopPropagation(); const reason = window.prompt("Reopen reason (optional):"); if (reason !== null) handleReopenLead(r, reason || "Manually reopened"); }} style={actionBtn("#7c3aed", "#faf5ff")} title="Reopen lead">↩ Reopen</button>
                          )}
                          <button className="lc-action-btn" onClick={e => { e.stopPropagation(); setShowEmailComposer(r); }} style={actionBtn("#64748b", "#f8fafc")} title="Email">📧</button>
                          <button
                            className="lc-action-btn"
                            onClick={e => toggleCardExpand(r.id, e)}
                            style={{ ...actionBtn(isExpanded ? "#7c3aed" : "#64748b", isExpanded ? "#faf5ff" : "#f8fafc"), marginLeft: "auto", minHeight: 28, padding: "3px 12px", fontSize: 11 }}
                            title={isExpanded ? "Collapse" : "Show more"}
                          >{isExpanded ? "▲ Less" : "▼ More"}</button>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Ghost "Add Lead" card ── */}
                  <div
                    className="lc-add-card"
                    onClick={() => setAddModal(true)}
                    style={{
                      borderRadius: 14, border: "2px dashed #c7d2fe",
                      padding: "14px 15px", background: "#fafbff",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      gap: 10, minHeight: 160, boxShadow: "none",
                    }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#eff6ff,#dbeafe)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="ti ti-plus" style={{ fontSize: 22, color: "#2563eb" }} />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#2563eb" }}>Add New Lead</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>Click to open the form</div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Pagination + count */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 2px 2px", fontSize: 12, color: B.muted }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Showing {leadPage * leadPageSize + 1}–{Math.min((leadPage + 1) * leadPageSize, rows.length)} of {rows.length} leads</span>
                {leadPageCount > 1 && (
                  <>
                    <button onClick={() => setLeadPage(p => Math.max(0, p - 1))} disabled={leadPage === 0} style={{ padding: "3px 10px", border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", background: "#fff" }}>‹</button>
                    {Array.from({ length: Math.min(leadPageCount, 7) }, (_, k) => {
                      const pg = leadPageCount <= 7 ? k : k === 0 ? 0 : k === 6 ? leadPageCount - 1 : leadPage - 2 + k;
                      return (
                        <button key={pg} onClick={() => setLeadPage(pg)}
                          style={{ padding: "3px 8px", border: `1px solid ${pg === leadPage ? "#2563eb" : B.border}`, borderRadius: 5, cursor: "pointer", background: pg === leadPage ? "#2563eb" : "#fff", color: pg === leadPage ? "#fff" : B.muted, fontWeight: pg === leadPage ? 700 : 400, fontSize: 12 }}>
                          {pg + 1}
                        </button>
                      );
                    })}
                    <button onClick={() => setLeadPage(p => Math.min(leadPageCount - 1, p + 1))} disabled={leadPage === leadPageCount - 1} style={{ padding: "3px 10px", border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", background: "#fff" }}>›</button>
                  </>
                )}
                <select value={leadPageSize} onChange={e => { setLeadPageSize(Number(e.target.value)); setLeadPage(0); }} style={{ marginLeft: "auto", padding: "3px 6px", fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5 }}>
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </>
          ) : (
            /* ── Lead table — desktop/tablet ── */
            <>
              <style id="leads-table-styles">{`
                .lt-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
                .lt-th { position: sticky; top: 0; z-index: 2; background: linear-gradient(180deg,#1e1b4b 0%,#312e81 100%); color: #e0e7ff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 10px 12px; white-space: nowrap; border-right: 1px solid rgba(255,255,255,0.08); cursor: pointer; user-select: none; transition: background 0.12s; }
                .lt-th:last-child { border-right: none; }
                .lt-th:hover { background: linear-gradient(180deg,#312e81 0%,#4338ca 100%); }
                .lt-tr { background: #fff; border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
                .lt-tr:nth-child(even) { background: #fafbff; }
                .lt-tr:hover { background: #f0f0ff !important; }
                .lt-tr:hover .lt-row-actions { opacity: 1; }
                .lt-tr.lt-sel { background: #eef2ff !important; outline: 1.5px solid #818cf8; outline-offset: -1.5px; }
                .lt-td { padding: 9px 12px; vertical-align: middle; border-right: 1px solid #f1f5f9; color: #1e293b; }
                .lt-td:last-child { border-right: none; }
                .lt-badge { display: inline-flex; align-items: center; font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; border: 1px solid; }
                .lt-row-actions { opacity: 0; transition: opacity 0.15s; display: flex; gap: 3px; align-items: center; }
                .lt-btn { border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; font-weight: 600; transition: transform 0.1s, filter 0.1s; line-height: 1; }
                .lt-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
                .lt-avatar { width: 28px; height: 28px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0; border: 1.5px solid; }
                .lt-sort-icon { opacity: 0.45; margin-left: 3px; font-size: 9px; }
                .lt-sort-icon.on { opacity: 1; color: #a5b4fc; }
                .lt-name { font-weight: 700; color: #0f172a; }
                .lt-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; }
                .lt-warn { display: inline-flex; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 10px; border: 1px solid; margin-right: 2px; }
                .lt-tag { display: inline-flex; font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: #f0fdf4; color: #15803d; border: 1px solid #86efac; margin-right: 2px; }
                .lt-tbl-wrap { overflow: auto; max-height: calc(100vh - 340px); }
                .lt-tbl-wrap::-webkit-scrollbar { width: 6px; height: 6px; }
                .lt-tbl-wrap::-webkit-scrollbar-track { background: #f8fafc; }
                .lt-tbl-wrap::-webkit-scrollbar-thumb { background: #c7d2fe; border-radius: 3px; }
                .lt-td select:focus { box-shadow: 0 0 0 2px #c7d2fe; border-color: #6366f1 !important; }
                .lt-td input:focus { box-shadow: 0 0 0 2px #c7d2fe; border-color: #6366f1 !important; }
              `}</style>

              {/* ── Bulk action bar ── */}
              {bulkSelected.size > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "linear-gradient(90deg,#eef2ff,#f0f4ff)", border: "1px solid #c7d2fe", borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: "#4f46e5" }}>{bulkSelected.size} selected</span>
                  <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #c7d2fe", color: "#4338ca", fontWeight: 600, background: "#fff" }}>
                    <option value="">Move to stage…</option>
                    {ALL_PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {bulkTarget && <button onClick={handleBulkMove} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Apply</button>}
                  <select value={bulkAssign} onChange={e => setBulkAssign(e.target.value)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #c7d2fe", color: "#4338ca", fontWeight: 600, background: "#fff" }}>
                    <option value="">Assign to…</option>
                    {(cfg.staffOptions || DEFAULT_LEADS_SETTINGS.staffOptions).filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {bulkAssign && <button onClick={handleBulkAssign} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, background: "#0891b2", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Assign</button>}
                  <button onClick={() => setBulkSelected(new Set())} style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11, fontWeight: 600, background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" }}>Clear</button>
                </div>
              )}

              {/* ── Empty state ── */}
              {leadPageData.length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 20px", gap: 14 }}>
                  <div style={{ width: 60, height: 60, borderRadius: 16, background: "linear-gradient(135deg,#eef2ff,#e0e7ff)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className="ti ti-users" style={{ fontSize: 28, color: "#4f46e5" }} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>No leads found</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                    {localSearch ? `No results for "${localSearch}"` : filter !== "All" ? `No leads in "${filter}"` : "Add your first lead to get started"}
                  </div>
                  {(localSearch || filter !== "All" || staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All") && (
                    <button onClick={() => { setLocalSearch(""); setFilter("All"); setStaffFilter("All"); setPriorityFilter("All"); setTagFilter("All"); }} style={{ padding: "7px 18px", background: "#f1f5f9", color: "#4f46e5", border: "1.5px solid #c7d2fe", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      ✕ Clear all filters
                    </button>
                  )}
                  {!localSearch && filter === "All" && (
                    <button onClick={() => setAddModal(true)} style={{ marginTop: 4, padding: "9px 22px", background: "linear-gradient(135deg,#4f46e5,#4338ca)", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(79,70,229,0.4)" }}>
                      + Add First Lead
                    </button>
                  )}
                </div>
              )}

              {/* ── Main table ── */}
              {leadPageData.length > 0 && (
                <div className="lt-tbl-wrap">
                  <table className="lt-table">
                    <thead>
                      <tr>
                        {/* Checkbox col */}
                        <th className="lt-th" style={{ width: 36, padding: "10px 10px" }}>
                          <input type="checkbox"
                            style={{ accentColor: "#818cf8", cursor: "pointer", width: 13, height: 13 }}
                            checked={leadPageData.length > 0 && leadPageData.every(r => bulkSelected.has(r.id))}
                            onChange={e => {
                              if (e.target.checked) setBulkSelected(new Set(leadPageData.map(r => r.id)));
                              else setBulkSelected(new Set());
                            }}
                          />
                        </th>
                        {[
                          { key: "name",        label: "Lead",          icon: "ti-user" },
                          { key: "status",      label: "Stage",         icon: "ti-circle-dot" },
                          { key: "priority",    label: "Priority",      icon: "ti-flag" },
                          { key: "service",     label: "Service",       icon: "ti-briefcase" },
                          { key: "assignedTo",  label: "Owner",         icon: "ti-user-check" },
                          { key: "followUpDate",label: "Follow-Up",     icon: "ti-calendar" },
                          { key: "value",       label: "Value",         icon: "ti-coin" },
                          { key: "source",      label: "Source",        icon: "ti-antenna" },
                          { key: "date",        label: "Created",       icon: "ti-clock" },
                          { key: "_actions",    label: "Actions",       icon: null },
                        ].map(col => (
                          <th key={col.key} className="lt-th"
                            onClick={col.key !== "_actions" ? () => toggleLeadSort(col.key) : undefined}
                            style={col.key === "_actions" ? { cursor: "default", minWidth: 140 } : {}}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {col.icon && <i className={`ti ${col.icon}`} style={{ fontSize: 11, opacity: 0.7 }} />}
                              {col.label}
                              {col.key !== "_actions" && (
                                <i className={`ti ${leadSortKey === col.key ? (leadSortDir === "asc" ? "ti-sort-ascending" : "ti-sort-descending") : "ti-selector"} lt-sort-icon${leadSortKey === col.key ? " on" : ""}`} />
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leadPageData.map((r, i) => {
                        const isSel       = bulkSelected.has(r.id);
                        const fu          = getFollowUpStatus(r.followUpDate, cfg);
                        const na          = getNextAction(r, cfg);
                        const sc          = scoreLead(r); const sl = scoreLabel(sc);
                        const stageColor  = stageColors[r.status] || STAGE_COLORS[r.status] || "#64748b";
                        const priColor    = (cfg.priorityColors || PRIORITY_COLORS)[r.priority];
                        const isDupe      = dupeIds?.has?.(r.id);
                        const isStale     = staleLeads?.some?.(s => s.id === r.id);
                        const isOverdue   = fu && fu.color === "#ef4444";
                        const tags        = r.tags || [];
                        const daysInStage = getDaysInStage(r);
                        const stageWarn   = daysInStage > (cfg.stageAgeDangerDays ?? 14) ? "#ef4444" : daysInStage > (cfg.stageAgeWarnDays ?? 7) ? "#f59e0b" : null;
                        const temp        = getTemperature(r, cfg); const tempLabel = getTempLabel(temp, cfg);
                        const tempStyle   = tempLabel === "🔥 Hot" ? { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" }
                                          : tempLabel === "🌡 Warm" ? { bg: "#fffbeb", color: "#d97706", border: "#fde68a" }
                                          : { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" };
                        const lockKey     = `lead:${r.id}`;
                        const lock        = tabLocks[lockKey];
                        const isLockedByOther = lock && lock.userId !== currentUser.userId;
                        return (
                          <tr key={r.id} className={`lt-tr${isSel ? " lt-sel" : ""}`}
                            style={{ borderLeft: `3px solid ${stageColor}` }}>
                            {/* Checkbox */}
                            <td className="lt-td" style={{ padding: "9px 10px" }}>
                              <input type="checkbox" checked={isSel} onChange={() => {}} style={{ accentColor: "#818cf8", cursor: "pointer", width: 13, height: 13 }}
                                onClick={e => { e.stopPropagation(); setBulkSelected(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }); }} />
                            </td>

                            {/* Lead name + sub info */}
                            <td className="lt-td" style={{ minWidth: 200, maxWidth: 260, cursor: "pointer" }} onClick={() => setDetailLead(r)}>
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <span className="lt-avatar" style={{ background: stageColor + "20", color: stageColor, borderColor: stageColor + "50" }}>
                                  {(r.name || "?").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase()}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div className="lt-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                                    {r.name || "—"}
                                  </div>
                                  <div className="lt-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
                                    {r.phone || r.email || "No contact"}
                                  </div>
                                  {(isDupe || isStale || isOverdue || isLockedByOther) && (
                                    <div style={{ marginTop: 3 }}>
                                      {isDupe    && <span className="lt-warn" style={{ background: "#faf5ff", color: "#7c3aed", borderColor: "#c4b5fd" }}>⚠ dupe</span>}
                                      {isStale   && <span className="lt-warn" style={{ background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" }}>⏱ stale</span>}
                                      {isOverdue && <span className="lt-warn" style={{ background: "#fef2f2", color: "#dc2626", borderColor: "#fca5a5" }}>🔴 overdue</span>}
                                      {isLockedByOther && <span className="lt-warn" title={`Locked by ${lock.userName}`} style={{ background: "#fefce8", color: "#a16207", borderColor: "#fde68a" }}>🔒 {lock.userName}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Stage */}
                            <td className="lt-td" style={{ minWidth: 160 }}>
                              <span className="lt-badge" style={{ background: stageColor + "18", color: stageColor, borderColor: stageColor + "55" }}>
                                {r.status || "—"}
                              </span>
                              {stageWarn && (
                                <div style={{ fontSize: 9, color: stageWarn, fontWeight: 700, marginTop: 3 }}>⏱ {daysInStage}d in stage</div>
                              )}
                            </td>

                            {/* Priority */}
                            <td className="lt-td" style={{ minWidth: 90 }}>
                              {r.priority ? (
                                <span className="lt-badge" style={{ background: (priColor || "#94a3b8") + "18", color: priColor || "#94a3b8", borderColor: (priColor || "#94a3b8") + "55" }}>
                                  {r.priority}
                                </span>
                              ) : <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>}
                            </td>

                            {/* Service */}
                            <td className="lt-td" style={{ minWidth: 140, maxWidth: 180 }}>
                              <span style={{ fontSize: 11, color: "#334155", fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {r.service || <span style={{ color: "#cbd5e1" }}>—</span>}
                              </span>
                              {tags.slice(0,2).map(t => <span key={t} className="lt-tag">{t}</span>)}
                            </td>

                            {/* Owner */}
                            <td className="lt-td" style={{ minWidth: 100 }}>
                              {r.assignedTo ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                  <div style={{ width: 22, height: 22, borderRadius: 6, background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#4f46e5", flexShrink: 0 }}>
                                    {r.assignedTo.charAt(0).toUpperCase()}
                                  </div>
                                  <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{r.assignedTo}</span>
                                </div>
                              ) : <span style={{ color: "#cbd5e1", fontSize: 11 }}>Unassigned</span>}
                            </td>

                            {/* Follow-up */}
                            <td className="lt-td" style={{ minWidth: 120 }}>
                              {fu ? (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 12, background: fu.bg + "cc", color: fu.color, border: `1px solid ${fu.color}44`, whiteSpace: "nowrap" }}>
                                  {fu.icon} {fu.label}
                                </span>
                              ) : r.followUpDate ? (
                                <span style={{ fontSize: 11, color: "#64748b" }}>{r.followUpDate}</span>
                              ) : (
                                <span style={{ color: "#cbd5e1", fontSize: 11 }}>Not set</span>
                              )}
                              {na && (
                                <div style={{ fontSize: 9, color: "#6366f1", marginTop: 3, fontWeight: 600 }}>{na.icon} {na.text}</div>
                              )}
                            </td>

                            {/* Value */}
                            <td className="lt-td" style={{ minWidth: 90, textAlign: "right" }}>
                              {r.value > 0 ? (
                                <span style={{ fontSize: 12, fontWeight: 800, color: "#059669" }}>
                                  {cfg.currencyLabel || "AED"} {Number(r.value).toLocaleString()}
                                </span>
                              ) : <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>}
                            </td>

                            {/* Source */}
                            <td className="lt-td" style={{ minWidth: 90 }}>
                              <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>{r.source || <span style={{ color: "#cbd5e1" }}>—</span>}</span>
                            </td>

                            {/* Created */}
                            <td className="lt-td" style={{ minWidth: 90 }}>
                              <span style={{ fontSize: 11, color: "#64748b" }}>{r.date || "—"}</span>
                              {r.nationality && <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{r.nationality}</div>}
                            </td>

                            {/* Actions */}
                            <td className="lt-td" style={{ minWidth: 150 }}>
                              <div className="lt-row-actions">
                                <button className="lt-btn" onClick={e => { e.stopPropagation(); setDetailLead(r); }} style={{ background: "#eef2ff", color: "#4f46e5" }} title="View detail">👁</button>
                                <button className="lt-btn" onClick={e => { e.stopPropagation(); setEditLead(r); }} style={{ background: "#f0f9ff", color: "#0284c7" }} title="Edit">✏️</button>
                                {r.phone && (
                                  <button className="lt-btn" onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank"); }} style={{ background: "#f0fdf4", color: "#15803d" }} title="WhatsApp">💬</button>
                                )}
                                {r.phone && (
                                  <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()} className="lt-btn" style={{ background: "#fffbeb", color: "#d97706", textDecoration: "none" }} title="Call">📞</a>
                                )}
                                {r.status === "Won" && (
                                  <button className="lt-btn" onClick={e => { e.stopPropagation(); handleConvertToClient(r); }} style={{ background: "#f0fdf4", color: "#15803d", fontSize: 10 }} title="Convert to client">↗ Client</button>
                                )}
                                <button className="lt-btn" onClick={e => { e.stopPropagation(); setShowNotes(r); }} style={{ background: "#fdf4ff", color: "#9333ea" }} title="Add note">📝</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Pagination ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px 2px", fontSize: 12, color: B.muted }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  Showing {rows.length === 0 ? 0 : leadPage * leadPageSize + 1}–{Math.min((leadPage + 1) * leadPageSize, rows.length)} of {rows.length} leads
                </span>
                {leadPageCount > 1 && (
                  <>
                    <button onClick={() => setLeadPage(p => Math.max(0, p - 1))} disabled={leadPage === 0} style={{ padding: "3px 10px", border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", background: "#fff", color: "#374151" }}>‹</button>
                    {Array.from({ length: Math.min(leadPageCount, 7) }, (_, k) => {
                      const pg = leadPageCount <= 7 ? k : k === 0 ? 0 : k === 6 ? leadPageCount - 1 : Math.min(Math.max(leadPage - 2 + k, 1), leadPageCount - 2);
                      return (
                        <button key={pg} onClick={() => setLeadPage(pg)}
                          style={{ padding: "3px 8px", border: `1px solid ${pg === leadPage ? "#4f46e5" : B.border}`, borderRadius: 5, cursor: "pointer", background: pg === leadPage ? "#4f46e5" : "#fff", color: pg === leadPage ? "#fff" : B.muted, fontWeight: pg === leadPage ? 700 : 400, fontSize: 12 }}>
                          {pg + 1}
                        </button>
                      );
                    })}
                    <button onClick={() => setLeadPage(p => Math.min(leadPageCount - 1, p + 1))} disabled={leadPage === leadPageCount - 1} style={{ padding: "3px 10px", border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", background: "#fff", color: "#374151" }}>›</button>
                  </>
                )}
                <select value={leadPageSize} onChange={e => { setLeadPageSize(Number(e.target.value)); setLeadPage(0); }} style={{ marginLeft: "auto", padding: "3px 6px", fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5 }}>
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </>
          )}
        </SectionCard>
          )}
        </>
      )}

      {/* ── Lost Reasons footer ── */}
      {lostReasons.length > 0 && (
        <SectionCard title="Lost Reasons Breakdown">
          <div style={{ display: "flex", gap: 12, padding: "8px 14px", flexWrap: "wrap" }}>
            {lostReasons.map((r) => (
              <div key={r.reason} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: B.red }}>{r.count}×</span>
                <span style={{ color: B.muted }}>{r.reason}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Hover Detail Card (follows cursor — table & kanban) ── */}
      {hoverLead && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "none" }}
        >
          <LeadHoverCard
            lead={hoverLead}
            pos={hoverPos}
            staleLeads={staleLeads}
            dupeIds={dupeIds}
            cfg={cfg}
            onClose={() => setHoverLead(null)}
            onEdit={() => { setEditLead(hoverLead); setHoverLead(null); }}
            onDetail={() => { setDetailLead(hoverLead); setHoverLead(null); }}
          />
        </div>
      )}

      {/* ── Add Modal (3-step) ── */}
      {addModal && (
        <AddLeadModal
          onSave={handleAdd}
          onClose={() => setAddModal(false)}
          cfg={cfg}
          existingLeads={leads}
        />
      )}

      {/* ── Edit Modal ── */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onSave={handleEditSave}
          onClose={() => setEditLead(null)}
          onConvert={handleConvertToClient}
          cfg={cfg}
          onDelete={() => {
            if (!window.confirm("Delete this lead?")) return;
            setData({ ...data, leads: data.leads.filter(l => l.id !== editLead.id) });
            setEditLead(null);
          }}
        />
      )}

      {/* ── Detail Drawer ── */}
      {detailLead && (
        <LeadDetailDrawer
          lead={data.leads.find(l => l.id === detailLead.id) || detailLead}
          staleLeads={staleLeads}
          dupeIds={dupeIds}
          onClose={() => setDetailLead(null)}
          onEdit={() => { setEditLead(detailLead); setDetailLead(null); }}
          onConvert={handleConvertToClient}
          onAddNote={handleAddNote}
          onLogCall={handleLogCall}
          onReopen={handleReopenLead}
          onArchive={handleArchiveLead}
          onSnooze={handleSnooze}
          onMention={handleMention}
          onDocChecklist={handleDocChecklist}
          onDocAttachment={handleDocAttachment}
          onDocAttachmentDelete={handleDocAttachmentDelete}
          onSetRecurrence={handleSetRecurrence}
        />
      )}

      {/* ── Reminder Center ── */}
      {showReminderCenter && (
        <ReminderCenter leads={leads} onClose={() => setShowReminderCenter(false)} onOpenLead={l => { setDetailLead(l); setShowReminderCenter(false); }} />
      )}

      {/* ── Funnel Visualizer ── */}
      {showFunnel && (
        <FunnelModal leads={leads} pipelineStats={pipelineStats} onClose={() => setShowFunnel(false)} />
      )}

      {/* ── Source ROI ── */}
      {showSourceROI && (
        <SourceROIModal leads={leads} onClose={() => setShowSourceROI(false)} />
      )}

      {/* ── Staff ROI ── */}
      {showStaffROI && (
        <StaffROIModal leads={leads} cfg={cfg} onClose={() => setShowStaffROI(false)} />
      )}

      {/* ── Pipeline Forecast ── */}
      {showForecast && (
        <ForecastModal leads={leads} onClose={() => setShowForecast(false)} />
      )}

      {/* ── Heatmap ── */}
      {showHeatmap && (
        <HeatmapModal leads={leads} onClose={() => setShowHeatmap(false)} />
      )}

      {/* ── Custom Fields ── */}
      {showCustomFields && (
        <CustomFieldsModal onSave={handleSaveCustomFields} onClose={() => setShowCustomFields(false)} />
      )}

      {/* ── AI Assist ── */}
      {showAIAssist && (
        <AIAssistModal lead={showAIAssist} onClose={() => setShowAIAssist(null)} />
      )}

      {/* ── Toast stack ── */}
      <LeadToastStack toasts={toasts} />

      {/* ── Speed Dial FAB — hidden whenever any modal/drawer/overlay is open ── */}
      {!addModal && !editLead && !detailLead && !showReminderCenter && !showFunnel &&
       !showSourceROI && !showStaffROI && !showForecast && !showCustomFields && !showHeatmap &&
       !showAIAssist && !showGoalTracker && !showWinLossReport && !showEmailComposer &&
       !showCallScheduler && !showLeadCompare && !showColumnPicker && !showNotes &&
       !showTagManager && !showBulkImport && !showGlobalSearch && !showPipelineHealth && (
        <SpeedDialFAB
          onAddLead={() => setAddModal(true)}
          onReminders={() => setShowReminderCenter(true)}
          onImport={() => setShowBulkImport(true)}
        />
      )}

      {/* ── NEW MODALS ── */}
      {pendingTransition && (
        <StageGateModal
          lead={pendingTransition.lead}
          newStage={pendingTransition.newStage}
          cfg={cfg}
          onCancel={() => setPendingTransition(null)}
          onConfirm={(gateData) => {
            const { lead, newStage } = pendingTransition;
            setPendingTransition(null);
            // Merge gate data into lead fields then re-run transition with _gateConfirmed flag
            const today = new Date().toISOString().slice(0, 10);
            const merged = data.leads.map(l =>
              l.id !== lead.id ? l : { ...l, ...gateData, updatedAt: today }
            );
            setData(prev => ({ ...prev, leads: merged }));
            const updatedLead = { ...lead, ...gateData };
            handleStageTransition(updatedLead, newStage, { ...gateData, _gateConfirmed: true });
          }}
        />
      )}
      {showGoalTracker && <GoalTrackerModal leads={leads} onClose={() => setShowGoalTracker(false)} />}
      {showWinLossReport && <WinLossReportModal leads={leads} onClose={() => setShowWinLossReport(false)} />}
      {showPipelineHealth && <PipelineHealthModal leads={leads} staleLeads={staleLeads} dupeIds={dupeIds} onClose={() => setShowPipelineHealth(false)} />}
      {showEmailComposer && <EmailComposerModal lead={showEmailComposer} onClose={() => setShowEmailComposer(null)} />}
      {showBulkImport && <BulkImportModal onImport={(newLeads) => { setData(d => ({ ...d, leads: [...d.leads, ...newLeads] })); setShowBulkImport(false); toast(`Imported ${newLeads.length} leads`, "success"); }} onClose={() => setShowBulkImport(false)} />}
      {showNotes && <QuickNoteModal lead={showNotes} onSave={(note) => { handleAddNote(showNotes.id, note); setShowNotes(null); }} onClose={() => setShowNotes(null)} />}
      {showCallScheduler && <CallSchedulerModal lead={showCallScheduler} onSave={(date, note) => { handleChange(showCallScheduler.id, "followUpDate", date); if (note) handleAddNote(showCallScheduler.id, `Call scheduled: ${note}`); setShowCallScheduler(null); toast("Call scheduled!", "success"); }} onClose={() => setShowCallScheduler(null)} />}
      {showLeadCompare && compareSelected.length === 2 && <LeadCompareModal leads={compareSelected} onClose={() => { setShowLeadCompare(false); setCompareSelected([]); }} />}
      {showColumnPicker && <ColumnPickerModal cols={allCols} visibility={columnVisibility} onChange={setColumnVisibility} onClose={() => setShowColumnPicker(false)} />}
      {showTagManager && (
        <ModalWrap title="🏷 Tag Manager" onClose={() => setShowTagManager(false)} width={460}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Tags in use across your {leads.length} leads. Click a tag to filter by it.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[...new Set(leads.flatMap(l => l.tags || []))].sort().map(tag => {
                const count = leads.filter(l => (l.tags || []).includes(tag)).length;
                return (
                  <button key={tag} onClick={() => { setTagFilter(tag); setShowTagManager(false); }}
                    style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1.5px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                    {tag}
                    <span style={{ fontSize: 10, background: "#4338ca", color: "#fff", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>{count}</span>
                  </button>
                );
              })}
              {leads.every(l => !(l.tags || []).length) && (
                <div style={{ color: "#94a3b8", fontSize: 12, padding: "20px 0", width: "100%", textAlign: "center" }}>No tags used yet. Add tags to leads to see them here.</div>
              )}
            </div>
            {tagFilter !== "All" && (
              <button onClick={() => setTagFilter("All")} style={{ alignSelf: "flex-start", padding: "4px 12px", fontSize: 11, fontWeight: 600, background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" }}>
                ✕ Clear filter ({tagFilter})
              </button>
            )}
          </div>
        </ModalWrap>
      )}

      {/* ── Collaborators panel ── */}
      {showCollaborators && activeUsers.length > 0 && (
        <div style={{
          position: "fixed", top: 60, right: 16, zIndex: 500,
          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", minWidth: 240, maxWidth: 300,
          padding: "14px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
              👥 {activeUsers.length} Online Now
            </span>
            <button onClick={() => setShowCollaborators(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
          </div>
          {activeUsers.map(u => (
            <div key={u.userId} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: "1px solid #f1f5f9" }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: `hsl(${(u.userId.charCodeAt(0) * 37) % 360},55%,55%)`,
                color: "#fff", fontSize: 11, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {(u.userName || "?")[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.userName}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>
                  {u.userRole || ""}
                  {u.activeTab ? ` · on ${u.activeTab}` : ""}
                </div>
              </div>
              <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} title="Active" />
            </div>
          ))}
        </div>
      )}

      {/* ── Global Search (CMD+K) ── */}
      {showGlobalSearch && (
        <GlobalSearchModal
          leads={leads}
          onClose={() => setShowGlobalSearch(false)}
          onOpenLead={l => { setDetailLead(l); setShowGlobalSearch(false); }}
        />
      )}
    </div>
  );
}

// ─── Edit Lead Modal ───────────────────────────────────────────────────────────
function EditLeadModal({ lead, onSave, onClose, onConvert, onDelete, cfg: cfgProp }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => cfgProp || loadLeadsSettings(), []);
  const _serviceOptions  = cfg.serviceOptions  || SERVICE_OPTIONS;
  const _statusOptions   = cfg.statusOptions   || STATUS_OPTIONS;
  const _sourceOptions   = cfg.sourceOptions   || SOURCE_OPTIONS;
  const _lostOptions     = ["", ...(cfg.lostOptions   || DEFAULT_LEADS_SETTINGS.lostOptions)];
  const _priorityOptions = ["", ...(cfg.priorityOptions || DEFAULT_LEADS_SETTINGS.priorityOptions)];
  const _staffOptions    = ["", ...(cfg.staffOptions   || DEFAULT_LEADS_SETTINGS.staffOptions)];
  const _tagOptions      = cfg.tagOptions      || TAG_OPTIONS_DEFAULT;
  const _stageColors     = cfg.stageColors     || STAGE_COLORS;
  const _priorityColors  = cfg.priorityColors  || PRIORITY_COLORS;
  const [vals, setVals] = useState({
    name: lead.name || "", email: lead.email || "", phone: lead.phone || "",
    whatsapp: lead.whatsapp || "",
    service: lead.service || (cfg.serviceOptions?.[0] || "Self Sponsored Visa"), status: lead.status || "New Lead",
    priority: lead.priority || "", assignedTo: lead.assignedTo || "",
    value: lead.value || "", source: lead.source || "Other",
    lostReason: lead.lostReason || "", notes: lead.notes || "",
    followUpDate: lead.followUpDate || "", estimatedClose: lead.estimatedClose || "",
    tags: lead.tags || [],
    nationality: lead.nationality || "", dob: lead.dob || "", gender: lead.gender || "",
    maritalStatus: lead.maritalStatus || "", language: lead.language || "",
    visaStatus: lead.visaStatus || "", referredBy: lead.referredBy || "",
    occupation: lead.occupation || "", employer: lead.employer || "",
    monthlyIncome: lead.monthlyIncome || "", whatsappOptIn: lead.whatsappOptIn ?? true,
    passportNo: lead.passportNo || "", emiratesId: lead.emiratesId || "",
    address: lead.address || "", campaign: lead.campaign || "",
  });
  const [tab, setTab] = useState("deal");
  const set = (k, v) => setVals(p => ({ ...p, [k]: v }));

  const handleSave = () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [];
    if (vals.status !== lead.status) entries.push({ date: today, text: `Status: ${lead.status} → ${vals.status}` });
    if ((vals.assignedTo || "") !== (lead.assignedTo || "")) entries.push({ date: today, text: `Assigned to ${vals.assignedTo || "nobody"}` });
    if (Number(vals.value) !== Number(lead.value || 0)) entries.push({ date: today, text: `Value: ${aed(lead.value)} → ${aed(Number(vals.value))}` });
    if ((vals.notes || "") !== (lead.notes || "")) entries.push({ date: today, text: "Notes updated" });
    onSave(vals, entries);
  };

  const hasChanges = Object.keys(vals).some(k => {
    const a = vals[k];
    const b = lead[k] ?? (k === "tags" ? [] : k === "value" ? 0 : "");
    // Normalise numeric fields so "" and 0 don't falsely differ
    if (k === "value") return Number(a) !== Number(b);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  const sc = _stageColors[vals.status] || "#64748b";

  const F = { // field styles
    wrap: { display: "flex", flexDirection: "column", gap: 5 },
    lbl: { fontSize: 10, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" },
    inp: { padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e8ecf1", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#f8fafc", color: "#0f172a", width: "100%", boxSizing: "border-box", transition: "border-color 0.15s, background 0.1s" },
    sel: { padding: "8px 11px", borderRadius: 8, border: "1.5px solid #e8ecf1", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#f8fafc", color: "#0f172a", width: "100%", boxSizing: "border-box", cursor: "pointer" },
  };
  const fi = e => { e.target.style.borderColor = "#3b82f6"; e.target.style.background = "#fff"; };
  const fo = e => { e.target.style.borderColor = "#e8ecf1"; e.target.style.background = "#f8fafc"; };

  const PillGroup = ({ options, value, onSelect, colorMap }) => (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {options.map(o => {
        const key = o || "none";
        const color = colorMap?.[o] || "#64748b";
        const on = value === o;
        return (
          <button key={key} onClick={() => onSelect(o)} style={{
            padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: on ? 600 : 400,
            border: `1.5px solid ${on ? color : "#e8ecf1"}`,
            background: on ? color + "1a" : "#f8fafc",
            color: on ? color : "#94a3b8", cursor: "pointer", transition: "all 0.12s",
          }}>{o || "None"}</button>
        );
      })}
    </div>
  );

  const TABS = [{ id: "deal", label: "Deal" }, { id: "contact", label: "Contact" }, { id: "notes", label: "Notes & Tags" }];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.55)", backdropFilter: "blur(6px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 500, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "18px 22px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: sc + "1a", border: `1.5px solid ${sc}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: sc }}>{(lead.name||"?").charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", lineHeight: 1 }}>{lead.name}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{lead.id} · added {lead.date}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              {hasChanges && <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 5, background: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a" }}>unsaved</span>}
              <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 7, border: "1.5px solid #e8ecf1", background: "#f8fafc", color: "#64748b", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1.5px solid #f1f5f9" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "7px 14px", fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? "#1d4ed8" : "#94a3b8",
                background: "none", border: "none", borderBottom: `2px solid ${tab === t.id ? "#3b82f6" : "transparent"}`,
                marginBottom: -2, cursor: "pointer", fontFamily: "inherit", transition: "color 0.1s",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          {tab === "deal" && <>
            <div style={F.wrap}>
              <span style={F.lbl}>Status</span>
              <PillGroup options={_statusOptions} value={vals.status} onSelect={v => set("status", v)} colorMap={_stageColors} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Service</span>
                <select value={vals.service} onChange={e => set("service", e.target.value)} style={F.sel}>{_serviceOptions.map(o => <option key={o}>{o}</option>)}</select>
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Value ({cfg.currencyLabel || "AED"})</span>
                <input type="number" value={vals.value} onChange={e => set("value", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="0" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Priority</span>
                <PillGroup options={_priorityOptions} value={vals.priority} onSelect={v => set("priority", v)} colorMap={_priorityColors} />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Assigned to</span>
                <select value={vals.assignedTo} onChange={e => set("assignedTo", e.target.value)} style={F.sel}>{_staffOptions.map(o => <option key={o||"u"} value={o}>{o||"— Unassigned —"}</option>)}</select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Follow-up</span>
                <input type="date" value={vals.followUpDate} onChange={e => set("followUpDate", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Est. close</span>
                <input type="date" value={vals.estimatedClose} onChange={e => set("estimatedClose", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} />
              </div>
            </div>
            {["Not Interested","Lost","No Response","Duplicate"].includes(vals.status) && (
              <div style={F.wrap}>
                <span style={F.lbl}>Lost reason</span>
                <select value={vals.lostReason} onChange={e => set("lostReason", e.target.value)} style={F.sel}>{_lostOptions.map(o => <option key={o||"n"} value={o}>{o||"— None —"}</option>)}</select>
              </div>
            )}
          </>}

          {tab === "contact" && <>
            <div style={F.wrap}>
              <span style={F.lbl}>Full name</span>
              <input value={vals.name} onChange={e => set("name", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Email</span>
                <input type="email" value={vals.email} onChange={e => set("email", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="email@example.com" />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Phone</span>
                <input value={vals.phone} onChange={e => set("phone", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="+971 50 000 0000" />
              </div>
            </div>
            <div style={F.wrap}>
              <span style={F.lbl}>WhatsApp</span>
              <input value={vals.whatsapp} onChange={e => set("whatsapp", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="Same as phone, or different number" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Nationality</span>
                <input value={vals.nationality} onChange={e => set("nationality", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="e.g. Filipino" />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Date of Birth</span>
                <input type="date" value={vals.dob} onChange={e => set("dob", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Gender</span>
                <select value={vals.gender} onChange={e => set("gender", e.target.value)} style={F.sel}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div style={F.wrap}>
              <span style={F.lbl}>Source</span>
              <PillGroup options={SOURCE_OPTIONS} value={vals.source} onSelect={v => set("source", v)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Passport No.</span>
                <input value={vals.passportNo} onChange={e => set("passportNo", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="AB1234567" />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Emirates ID</span>
                <input value={vals.emiratesId} onChange={e => set("emiratesId", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="784-XXXX-XXXXXXX-X" />
              </div>
            </div>
            <div style={F.wrap}>
              <span style={F.lbl}>Address</span>
              <input value={vals.address} onChange={e => set("address", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="Apt, building, area, emirate" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Marital Status</span>
                <select value={vals.maritalStatus} onChange={e => set("maritalStatus", e.target.value)} style={F.sel}>
                  <option value="">—</option>
                  {["Single","Married","Divorced","Widowed"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Language</span>
                <select value={vals.language} onChange={e => set("language", e.target.value)} style={F.sel}>
                  <option value="">—</option>
                  {["Arabic","English","Tagalog","Hindi","Urdu","French","Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Visa Status</span>
                <select value={vals.visaStatus} onChange={e => set("visaStatus", e.target.value)} style={F.sel}>
                  <option value="">—</option>
                  {["Visit Visa","Employment Visa","Family Visa","Tourist Visa","Cancelled","Overstay","Other"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Referred By</span>
                <input value={vals.referredBy} onChange={e => set("referredBy", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="Name or lead ID" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Occupation</span>
                <input value={vals.occupation} onChange={e => set("occupation", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="e.g. Engineer" />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Employer</span>
                <input value={vals.employer} onChange={e => set("employer", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="Company name" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Monthly Income (AED)</span>
                <input type="number" value={vals.monthlyIncome} onChange={e => set("monthlyIncome", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="0" />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Campaign / Ad Set</span>
                <input value={vals.campaign} onChange={e => set("campaign", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="e.g. FB – Visa Ad Oct" />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <input type="checkbox" id="editWaOptIn" checked={!!vals.whatsappOptIn} onChange={e => set("whatsappOptIn", e.target.checked)} style={{ accentColor: "#25d366", width: 14, height: 14 }} />
              <label htmlFor="editWaOptIn" style={{ fontSize: 12, color: "#15803d", fontWeight: 600, cursor: "pointer" }}>💬 WhatsApp marketing opt-in</label>
            </div>
            {(vals.phone || vals.email) && (
              <div style={{ display: "flex", gap: 7, paddingTop: 2 }}>
                {vals.phone && <a href={`https://wa.me/${vals.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", background: "#f0fdf4", color: "#15803d", border: "1.5px solid #bbf7d0", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>WhatsApp</a>}
                {vals.phone && <a href={`tel:${vals.phone}`} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", background: "#f8fafc", color: "#334155", border: "1.5px solid #e8ecf1", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>Call</a>}
                {vals.email && <a href={`mailto:${vals.email}`} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: "none" }}>Email</a>}
              </div>
            )}
          </>}

          {tab === "notes" && <>
            <div style={F.wrap}>
              <span style={F.lbl}>Notes</span>
              <textarea value={vals.notes} onChange={e => set("notes", e.target.value)} rows={6}
                style={{ ...F.inp, resize: "vertical", lineHeight: 1.65 }} onFocus={fi} onBlur={fo}
                placeholder="Context, requirements, anything relevant…" />
            </div>
            <div style={F.wrap}>
              <span style={F.lbl}>Tags</span>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {_tagOptions.map(t => {
                  const on = (vals.tags || []).includes(t);
                  return (
                    <button key={t} onClick={() => set("tags", on ? (vals.tags||[]).filter(x=>x!==t) : [...(vals.tags||[]),t])} style={{
                      padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: on ? 600 : 400,
                      border: `1.5px solid ${on ? "#6366f1" : "#e8ecf1"}`,
                      background: on ? "#eef2ff" : "#f8fafc",
                      color: on ? "#4338ca" : "#94a3b8", cursor: "pointer",
                    }}>{on && "✓ "}{t}</button>
                  );
                })}
              </div>
            </div>
          </>}
        </div>

        {/* Footer */}
        <div style={{ padding: "13px 22px", borderTop: "1.5px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafbfc", borderRadius: "0 0 16px 16px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onDelete} style={{ padding: "7px 13px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: "1.5px solid #fecaca", background: "#fff5f5", color: "#dc2626", cursor: "pointer" }}>Delete</button>
            {vals.status === "Won" && <button onClick={() => { onConvert({ ...lead, ...vals }); onClose(); }} style={{ padding: "7px 13px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: "1.5px solid #a7f3d0", background: "#f0fdf4", color: "#059669", cursor: "pointer" }}>Convert →</button>}
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: "1.5px solid #e8ecf1", background: "#fff", color: "#64748b", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: "7px 18px", borderRadius: 7, fontSize: 12, fontWeight: 700, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lead Detail Drawer ─────────────────────────────────────────────────────────
function LeadDetailDrawer({ lead, staleLeads, dupeIds, onClose, onEdit, onConvert, onAddNote, onLogCall, onReopen, onArchive, onSnooze, onMention, onDocChecklist, onDocAttachment, onDocAttachmentDelete, onSetRecurrence }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drawerCfg = useMemo(() => loadLeadsSettings(), []);
  const DOC_ITEMS = (drawerCfg.docChecklistItems || DEFAULT_LEADS_SETTINGS.docChecklistItems);

  const [noteInput, setNoteInput] = useState("");
  const [callInput, setCallInput] = useState("");
  const [mentionInput, setMentionInput] = useState("");
  const [activeTab, setActiveTab] = useState("details");

  // Load attachments from localStorage (stored separately to avoid bloating main data)
  const getAttachments = () => { try { return JSON.parse(localStorage.getItem(`crm_doc_attachments_${lead.id}`) || "{}"); } catch { return {}; } };
  const [attachments, setAttachmentsState] = useState(getAttachments);
  // Re-read whenever lead._attachTs changes (set by parent after upload/delete)
  useEffect(() => { setAttachmentsState(getAttachments()); }, [lead._attachTs, lead.id]);

  const isStale = staleLeads.some(s => s.id === lead.id);
  const isDupe  = dupeIds.has(lead.id);
  const nextAction = getNextAction(lead, drawerCfg);
  const temp = getTemperature(lead, drawerCfg);
  const tempLabel = getTempLabel(temp, drawerCfg);
  const sla = getSLAStatus(lead, drawerCfg);

  const row = (icon, k, v) => v ? (
    <div key={k} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13, color: "#334155", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span style={{ fontSize: 15, width: 20, flexShrink: 0, textAlign: "center", marginTop: 1 }}>{icon}</span>
      <span style={{ color: "#94a3b8", minWidth: 90, fontWeight: 500, flexShrink: 0 }}>{k}</span>
      <span style={{ fontWeight: 600, color: "#0f172a", wordBreak: "break-word" }}>{v}</span>
    </div>
  ) : null;

  const tabStyle = (t) => ({
    padding: "6px 12px", fontSize: 12, fontWeight: activeTab === t ? 700 : 500, cursor: "pointer", border: "none",
    borderBottom: `2.5px solid ${activeTab === t ? "#3b82f6" : "transparent"}`,
    background: activeTab === t ? "#eff6ff" : "none",
    color: activeTab === t ? "#2563eb" : "#64748b", fontFamily: "inherit",
    borderRadius: "6px 6px 0 0",
    transition: "color 0.12s, background 0.12s",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.45)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 420, maxWidth: "95vw", background: "#fff", height: "100%", overflowY: "auto", padding: "20px 22px", boxShadow: "-12px 0 48px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", gap: 16 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${(drawerCfg.stageColors||STAGE_COLORS)[lead.status] || "#6366f1"}18`, border: `2px solid ${(drawerCfg.stageColors||STAGE_COLORS)[lead.status] || "#6366f1"}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: (drawerCfg.stageColors||STAGE_COLORS)[lead.status] || "#6366f1", flexShrink: 0 }}>
              {(lead.name || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
              {lead.assignedTo && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, fontWeight: 500 }}>👤 {lead.assignedTo}</div>}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                <span style={pill((drawerCfg.stageColors||STAGE_COLORS)[lead.status] || "#64748b", ((drawerCfg.stageColors||STAGE_COLORS)[lead.status] || "#64748b") + "22")}>{lead.status}</span>
                <span style={pill(tempLabel.color, tempLabel.bg)}>{tempLabel.label}</span>
                {lead.priority && <span style={pill((drawerCfg.priorityColors||PRIORITY_COLORS)[lead.priority], (drawerCfg.priorityColors||PRIORITY_COLORS)[lead.priority] + "22")}>{lead.priority}</span>}
                {sla && <span style={pill(sla.color, sla.bg)}>{sla.urgent ? "⚠ " : ""}SLA: {sla.label}</span>}
                {isStale && <span style={pill("#f59e0b", "#fef3c7")}>⏰ Stale</span>}
                {isDupe  && <span style={pill("#f59e0b", "#fef3c7")}>⚠ Dupe</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", width: 32, height: 32, borderRadius: 8, fontSize: 14, cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
        </div>

        {/* Next Action */}
        {nextAction && (
          <div style={{ background: "linear-gradient(135deg, #f0f9ff, #e0f2fe)", border: "1px solid #bae6fd", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{nextAction.icon}</span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>Next Action</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{nextAction.text}</div>
            </div>
          </div>
        )}

        {/* Quick actions */}
        {lead.phone && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", background: "#f8fafc", borderRadius: 10, padding: "10px 12px", border: "1px solid #f1f5f9" }}>
            <a href={`tel:${lead.phone}`}
              style={{ fontSize: 12, padding: "7px 14px", background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 8, cursor: "pointer", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
              📞 Call
            </a>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}`, "_blank")}
              style={{ fontSize: 12, padding: "7px 14px", background: "#25d366", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
              💬 WhatsApp
            </button>
            <div style={{ width: 1, background: "#e2e8f0", alignSelf: "stretch", margin: "0 2px" }} />
            <button onClick={() => { navigator.clipboard?.writeText(lead.phone); }}
              style={{ fontSize: 12, padding: "7px 11px", background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              📋 Copy
            </button>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=Hi ${encodeURIComponent(lead.name)}, please send us your Emirates ID copy.`, "_blank")}
              style={{ fontSize: 12, padding: "7px 11px", background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              📄 Docs
            </button>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=Hi ${encodeURIComponent(lead.name)}, just a reminder for your appointment tomorrow.`, "_blank")}
              style={{ fontSize: 12, padding: "7px 11px", background: "#fff", color: "#475569", border: "1.5px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              🔔 Reminder
            </button>
          </div>
        )}

        {/* Snooze bar */}
        <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 12px", border: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13 }}>⏰</span>
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginRight: 2 }}>Snooze</span>
            {(drawerCfg.snoozeOptions || [1, 3, 7, 14]).map(d => (
              <button key={d} onClick={() => onSnooze && onSnooze(lead, d)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                {d}d
              </button>
            ))}
            <div style={{ width: 1, background: "#e2e8f0", alignSelf: "stretch", margin: "0 2px" }} />
            {lead.followUpRecurrence && (
              <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700, background: "#eff6ff", borderRadius: 5, padding: "2px 7px" }}>↻ Every {lead.followUpRecurrence}d</span>
            )}
            <select value={lead.followUpRecurrence || ""} onChange={e => onSetRecurrence && onSetRecurrence(lead.id, Number(e.target.value) || null)}
              style={{ fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "3px 8px", fontFamily: "inherit", color: "#475569", background: "#fff", cursor: "pointer" }}>
              <option value="">↻ Recurrence…</option>
              {(drawerCfg.recurrenceOptions || [3,7,14,30]).map(d => <option key={d} value={d}>Every {d} days</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1.5px solid #e8ecf1", gap: 0, flexWrap: "wrap" }}>
          {[["details","Details"],["notes","Notes"],["calls","Calls"],["docs","Docs"],["mentions","Mentions"],["history","Timeline"]].map(([t, label]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={tabStyle(t)}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, background: "#f8fafc", borderRadius: 12, padding: "4px 16px", border: "1px solid #f1f5f9" }}>
            {row("💼", "Service",   lead.service)}
            {row("📅", "Date",      lead.date)}
            {row("💰", "Value",     aed(lead.value))}
            {row("📣", "Source",    lead.source)}
            {row("✉️", "Email",     lead.email)}
            {row("📱", "Phone",     lead.phone)}
            {lead.whatsapp && row("💬", "WhatsApp",  lead.whatsapp)}
            {lead.assignedTo && row("👤", "Assigned",  lead.assignedTo)}
            {lead.estimatedClose && row("🎯", "Est. Close", lead.estimatedClose)}
            {/* Personal Details — collapsible, below sales fields */}
            {(lead.nationality || lead.dob || lead.gender || lead.passportNo || lead.emiratesId || lead.address) && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: 0.5, padding: "6px 0", listStyle: "none", display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 9 }}>▶</span> Personal Details
                </summary>
                <div style={{ paddingTop: 2 }}>
                  {lead.nationality && row("🌍", "Nationality", lead.nationality)}
                  {lead.dob        && row("🎂", "Date of Birth", lead.dob)}
                  {lead.gender     && row("👤", "Gender", lead.gender)}
                  {lead.passportNo && row("🪪", "Passport", lead.passportNo)}
                  {lead.emiratesId && row("🪪", "Emirates ID", lead.emiratesId)}
                  {lead.address    && row("📍", "Address", lead.address)}
                </div>
              </details>
            )}
            {lead.priority && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 15, width: 20, flexShrink: 0, textAlign: "center" }}>🎯</span>
                <span style={{ color: "#94a3b8", minWidth: 90, fontWeight: 500, flexShrink: 0 }}>Priority</span>
                <span style={pill(PRIORITY_COLORS[lead.priority], PRIORITY_COLORS[lead.priority] + "18")}>{lead.priority}</span>
              </div>
            )}
            {lead.followUpDate && (() => {
              const fu = getFollowUpStatus(lead.followUpDate, drawerCfg);
              return (
                <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: 15, width: 20, flexShrink: 0, textAlign: "center" }}>🗓</span>
                  <span style={{ color: "#94a3b8", minWidth: 90, fontWeight: 500, flexShrink: 0 }}>Follow-up</span>
                  {fu ? <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span> : <span style={{ fontWeight: 600, color: "#0f172a" }}>{lead.followUpDate}</span>}
                </div>
              );
            })()}
            {lead.lostReason && row("❌", "Lost Reason", lead.lostReason)}
            {(lead.tags||[]).length > 0 && (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 15, width: 20, flexShrink: 0, textAlign: "center" }}>🏷</span>
                <span style={{ color: "#94a3b8", minWidth: 90, fontWeight: 500, flexShrink: 0 }}>Tags</span>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {lead.tags.map(t => <span key={t} style={{ fontSize: 10, background: "#e0e7ff", color: "#4338ca", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>{t}</span>)}
                </div>
              </div>
            )}
            {lead.notes && (
              <div style={{ margin: "8px 0", padding: "10px 12px", background: "#fff", borderRadius: 8, fontSize: 13, color: "#475569", lineHeight: 1.65, borderTop: "1px solid #e8ecf1", borderRight: "1px solid #e8ecf1", borderBottom: "1px solid #e8ecf1", borderLeft: "3px solid #3b82f6" }}>{lead.notes}</div>
            )}
          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 7 }}>
              <input value={noteInput} onChange={e => setNoteInput(e.target.value)}
                placeholder="Add a quick note…"
                onKeyDown={e => { if (e.key === "Enter" && noteInput.trim()) { onAddNote(lead.id, noteInput.trim()); setNoteInput(""); }}}
                style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", color: "#0f172a", background: "#f8fafc" }} />
              <button onClick={() => { if (noteInput.trim()) { onAddNote(lead.id, noteInput.trim()); setNoteInput(""); }}}
                style={{ padding: "9px 16px", background: B.blue, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Add</button>
            </div>
            {[...(lead.quickNotes||[])].reverse().map((n, i) => (
              <div key={i} style={{ background: "#fafbfe", borderRadius: 9, padding: "10px 14px", fontSize: 13, borderTop: "1px solid #e8ecf1", borderRight: "1px solid #e8ecf1", borderBottom: "1px solid #e8ecf1", borderLeft: "3px solid #93c5fd" }}>
                <div style={{ color: "#94a3b8", fontSize: 10, fontWeight: 600, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>{n.date}</div>
                <div style={{ color: "#1e293b", lineHeight: 1.55 }}>{n.text}</div>
              </div>
            ))}
            {(lead.quickNotes||[]).length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>No notes yet</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>Type above and press Enter to add one</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "calls" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 7 }}>
              <input value={callInput} onChange={e => setCallInput(e.target.value)}
                placeholder="Log a call (e.g. 12 min, interested)"
                onKeyDown={e => { if (e.key === "Enter" && callInput.trim()) { onLogCall(lead.id, callInput.trim()); setCallInput(""); }}}
                style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", color: "#0f172a", background: "#f8fafc" }} />
              <button onClick={() => { if (callInput.trim()) { onLogCall(lead.id, callInput.trim()); setCallInput(""); }}}
                style={{ padding: "9px 16px", background: "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📞 Log</button>
            </div>
            {[...(lead.callLog||[])].reverse().map((c, i) => (
              <div key={i} style={{ background: "#f0fdf4", borderRadius: 9, padding: "10px 14px", fontSize: 13, borderTop: "1px solid #d1fae5", borderRight: "1px solid #d1fae5", borderBottom: "1px solid #d1fae5", borderLeft: "3px solid #10b981" }}>
                <div style={{ color: "#6ee7b7", fontSize: 10, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>📞 {c.date}</div>
                <div style={{ color: "#065f46", lineHeight: 1.55 }}>{c.note}</div>
              </div>
            ))}
            {(lead.callLog||[]).length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📞</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>No calls logged yet</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>Type above and press Enter to log one</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "docs" && (() => {
          const checklist = lead.docChecklist || {};
          const done  = DOC_ITEMS.filter(d => checklist[d]).length;
          const total = DOC_ITEMS.length;
          const pct   = total ? Math.round((done / total) * 100) : 0;
          const allDone = done === total;
          const DOC_ICONS = { "Emirates ID":"🪪","Passport":"📗","Visa Copy":"📋","Trade License":"🏢","MOA":"📜","Proof of Address":"🏠","Bank Statement":"🏦","NOC Letter":"✉️" };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Progress header */}
              <div style={{ background: allDone ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "linear-gradient(135deg,#f8fafc,#f1f5f9)", border: `1.5px solid ${allDone ? "#6ee7b7" : "#e2e8f0"}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: allDone ? "#065f46" : "#0f172a" }}>{allDone ? "✅ All documents received!" : "Document Checklist"}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{done} of {total} received{!allDone && done > 0 && ` · ${total - done} still needed`}</div>
                  </div>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: `conic-gradient(${allDone ? "#10b981" : "#3b82f6"} ${pct * 3.6}deg, #e2e8f0 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: allDone ? "#f0fdf4" : "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: allDone ? "#10b981" : "#3b82f6" }}>{pct}%</div>
                  </div>
                </div>
                <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: allDone ? "#10b981" : pct > 50 ? "#3b82f6" : "#f59e0b", transition: "width 0.4s" }} />
                </div>
              </div>

              {/* Request all missing */}
              {!allDone && lead.phone && (
                <button onClick={() => { const missing = DOC_ITEMS.filter(d => !checklist[d]); window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=${encodeURIComponent(`Hi ${lead.name || ""},\n\nCould you please send us the following documents:\n${missing.map((d,i)=>`${i+1}. ${d}`).join("\n")}\n\nThank you!`)}`, "_blank"); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 14px", background: "#f0fdf4", color: "#15803d", border: "1.5px solid #bbf7d0", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%" }}>
                  💬 Request all {total - done} missing via WhatsApp
                </button>
              )}

              {/* Checklist items */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...DOC_ITEMS.filter(d => !checklist[d]), ...DOC_ITEMS.filter(d => checklist[d])].map(item => {
                  const checked = !!checklist[item];
                  const itemFiles = attachments[item] || [];
                  return (
                    <div key={item} style={{ background: checked ? "#f0fdf4" : "#fff", borderRadius: 10, border: `1.5px solid ${checked ? "#6ee7b7" : "#e8ecf1"}`, overflow: "hidden", transition: "all 0.18s" }}>
                      {/* Main row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => { e.stopPropagation(); onDocChecklist && onDocChecklist(lead.id, item, e.target.checked); }}
                          style={{ accentColor: "#10b981", width: 16, height: 16, flexShrink: 0, cursor: "pointer" }} />
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{DOC_ICONS[item] || "📄"}</span>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: checked ? 600 : 500, color: checked ? "#065f46" : "#1e293b", textDecoration: checked ? "line-through" : "none" }}>{item}</span>
                        {/* Attach button — standalone, no label wrapper needed */}
                        <button
                          onClick={e => { e.stopPropagation(); document.getElementById(`attach_${lead.id}_${item.replace(/\s/g,"_")}`).click(); }}
                          style={{ fontSize: 11, padding: "4px 8px", background: "#eff6ff", color: "#2563eb", border: "1.5px solid #bfdbfe", borderRadius: 6, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          📎 {itemFiles.length > 0 ? `${itemFiles.length}` : "Attach"}
                        </button>
                        <input id={`attach_${lead.id}_${item.replace(/\s/g,"_")}`} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
                          onChange={e => { if (e.target.files[0]) { onDocAttachment && onDocAttachment(lead.id, item, e.target.files[0]); e.target.value = ""; } }} />
                        {/* WA request or received badge */}
                        {checked ? (
                          <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700, background: "#dcfce7", borderRadius: 5, padding: "2px 8px", flexShrink: 0 }}>✓ Done</span>
                        ) : lead.phone ? (
                          <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=${encodeURIComponent(`Hi ${lead.name || ""}, could you please send us your ${item}? Thank you!`)}`, "_blank")}
                            style={{ fontSize: 11, padding: "4px 9px", background: "#f0fdf4", color: "#15803d", border: "1.5px solid #bbf7d0", borderRadius: 6, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                            💬
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, background: "#fffbeb", borderRadius: 5, padding: "2px 8px", flexShrink: 0 }}>Pending</span>
                        )}
                      </div>
                      {/* Attachments strip */}
                      {itemFiles.length > 0 && (
                        <div style={{ borderTop: `1px solid ${checked ? "#a7f3d0" : "#e8ecf1"}`, padding: "8px 12px", background: checked ? "#f0fdf4" : "#f8fafc", display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {itemFiles.map((f, idx) => {
                            const isImg = f.type && f.type.startsWith("image/");
                            return (
                              <div key={idx} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                {isImg ? (
                                  <a href={f.data} target="_blank" rel="noreferrer" title={f.name}>
                                    <img src={f.data} alt={f.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 7, border: "1.5px solid #e2e8f0", display: "block" }} />
                                  </a>
                                ) : (
                                  <a href={f.data} target="_blank" rel="noreferrer" title={f.name}
                                    style={{ width: 56, height: 56, borderRadius: 7, border: "1.5px solid #fecaca", background: "#fff5f5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textDecoration: "none", gap: 2 }}>
                                    <span style={{ fontSize: 22 }}>📄</span>
                                    <span style={{ fontSize: 8, color: "#ef4444", fontWeight: 700 }}>PDF</span>
                                  </a>
                                )}
                                <span style={{ fontSize: 9, color: "#64748b", maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{f.name}</span>
                                <button onClick={() => onDocAttachmentDelete && onDocAttachmentDelete(lead.id, item, idx)}
                                  style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "none", cursor: "pointer", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, padding: 0 }}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", paddingTop: 2 }}>
                Checkbox marks received · 📎 attaches photos/PDFs · stored in browser · 💬 sends WhatsApp request
              </div>
            </div>
          );
        })()}

        {activeTab === "mentions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 7 }}>
              <input value={mentionInput} onChange={e => setMentionInput(e.target.value)}
                placeholder="@Ahmed — check proposal status…"
                onKeyDown={e => { if (e.key === "Enter" && mentionInput.trim()) { onMention && onMention(lead.id, mentionInput.trim()); setMentionInput(""); }}}
                style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", color: "#0f172a", background: "#f8fafc" }} />
              <button onClick={() => { if (mentionInput.trim()) { onMention && onMention(lead.id, mentionInput.trim()); setMentionInput(""); }}}
                style={{ padding: "9px 16px", background: "#4338ca", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>@ Tag</button>
            </div>
            {[...(lead.mentions||[])].reverse().map((m, i) => (
              <div key={i} style={{ background: "#f5f3ff", borderRadius: 9, padding: "10px 14px", fontSize: 13, borderTop: "1px solid #ddd6fe", borderRight: "1px solid #ddd6fe", borderBottom: "1px solid #ddd6fe", borderLeft: "3px solid #6366f1" }}>
                <div style={{ color: "#a78bfa", fontSize: 10, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>@ {m.date}</div>
                <div style={{ color: "#3730a3", lineHeight: 1.55 }}>{m.text}</div>
              </div>
            ))}
            {!(lead.mentions||[]).length && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>@</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>No mentions yet</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>Tag a teammate to loop them in</div>
              </div>
            )}
          </div>
        )}


        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, paddingLeft: 4 }}>
            {[...(lead.timeline||[{ date: lead.date, text: "Lead created" }])].reverse().map((t, i, arr) => {
              const txt = t.text || "";
              const dotColor = txt.includes("Won") || txt.includes("Converted") ? "#10b981"
                : txt.includes("Lost") || txt.includes("Closed") ? "#ef4444"
                : txt.includes("⚙️") || txt.includes("Auto") ? "#8b5cf6"
                : txt.includes("↩️") || txt.includes("Rolled") ? "#f59e0b"
                : txt.includes("📞") || txt.includes("call") || txt.includes("Call") ? "#3b82f6"
                : txt.includes("Assigned") ? "#06b6d4"
                : "#94a3b8";
              return (
                <div key={i} style={{ display: "flex", gap: 14, position: "relative", paddingBottom: i < arr.length - 1 ? 18 : 0 }}>
                  {i < arr.length - 1 && <div style={{ position: "absolute", left: 9, top: 20, bottom: 0, width: 1.5, background: "#e2e8f0" }} />}
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: dotColor, border: "3px solid #fff", boxShadow: `0 0 0 2px ${dotColor}40`, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ paddingBottom: 2 }}>
                    <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, lineHeight: 1.4 }}>{txt}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, fontWeight: 500 }}>{t.date}</div>
                  </div>
                </div>
              );
            })}
            {!(lead.timeline||[]).length && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🕐</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>No history yet</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>Activity will appear here as the lead progresses</div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 14, borderTop: "1.5px solid #f1f5f9", flexWrap: "wrap" }}>
          <button onClick={onEdit}
            style={{ flex: 1, padding: "11px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #2563eb, #3b82f6)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px #3b82f640" }}>
            ✏️ Edit Lead
          </button>
          {lead.status === "Won" && (
            <button onClick={() => { onConvert(lead); onClose(); }}
              style={{ flex: 1, padding: "11px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #059669, #10b981)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px #10b98140" }}>
              ↗ Convert
            </button>
          )}
          {["Not Interested", "Lost", "No Response", "Duplicate"].includes(lead.status) && (
            <button onClick={() => { const r = window.prompt("Reopen reason?"); if (r) { onReopen(lead, r); onClose(); }}}
              style={{ flex: 1, padding: "11px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #6d28d9, #7c3aed)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px #7c3aed40" }}>
              ↩ Reopen
            </button>
          )}
          <button onClick={() => { onArchive && onArchive(lead); onClose(); }}
            style={{ padding: "11px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: lead.archived ? "#f0fdf4" : "#f8fafc", color: lead.archived ? "#059669" : "#64748b", border: "1.5px solid #e2e8f0", cursor: "pointer" }}>
            {lead.archived ? "↩ Restore" : "📦"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lead Hover Card (follows cursor — table + kanban) ──────────────────────────
function LeadHoverCard({ lead, pos, staleLeads, dupeIds, cfg: cfgProp, onClose, onEdit, onDetail }) {
  const _stageColors = (cfgProp || DEFAULT_LEADS_SETTINGS).stageColors || STAGE_COLORS;
  const ref = useRef(null);
  const score  = scoreLead(lead);
  const sLabel = scoreLabel(score);
  const isStale = staleLeads.some(s => s.id === lead.id);
  const isDupe  = dupeIds.has(lead.id);

  // Position the card so it never overflows viewport
  const [style, setStyle] = useState({ top: 0, left: 0, opacity: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const { innerWidth: W, innerHeight: H } = window;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const MARGIN = 12, OFFSET = 16;
    let x = pos.x + OFFSET;
    let y = pos.y + OFFSET;
    if (x + w > W - MARGIN) x = pos.x - w - OFFSET;
    if (y + h > H - MARGIN) y = pos.y - h - OFFSET;
    setStyle({ position: "fixed", top: y, left: x, zIndex: 9999, opacity: 1, transition: "opacity 0.12s" });
  }, [pos]);

  return (
    <div ref={ref} style={{
      ...style,
      background: "#fff",
      borderRadius: 12,
      padding: "14px 16px",
      width: 260,
      boxShadow: "0 8px 32px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08)",
      border: "1.5px solid #e2e8f0",
      pointerEvents: "none",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", marginBottom: 6 }}>{lead.name}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={pill(_stageColors[lead.status] || "#64748b", (_stageColors[lead.status] || "#64748b") + "18")}>{lead.status}</span>
        <span style={pill(SCORE_COLORS[sLabel], SCORE_COLORS[sLabel] + "18")}>{score} {sLabel}</span>
        {isStale && <span style={pill("#f59e0b", "#fef3c7")}>⏰ Stale</span>}
        {isDupe  && <span style={pill("#f59e0b", "#fef3c7")}>⚠ Dupe</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
        {lead.service && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>💼 Service</span><span style={{ fontWeight: 500, color: "#334155" }}>{lead.service}</span></div>}
        {lead.value   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>💰 Value</span><span style={{ fontWeight: 600, color: "#10b981" }}>{aed(lead.value)}</span></div>}
        {lead.email   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>✉️ Email</span><span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.email}</span></div>}
        {lead.phone   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>📱 Phone</span><span style={{ color: "#334155" }}>{lead.phone}</span></div>}
        {lead.source  && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>📣 Source</span><span style={{ color: "#334155" }}>{lead.source}</span></div>}
        {lead.followUpDate && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>🗓 Follow-up</span><span style={{ color: "#3b82f6", fontWeight: 600 }}>{lead.followUpDate}</span></div>}
      </div>
      {lead.notes && (
        <div style={{ marginTop: 8, padding: "7px 9px", background: "#f8fafc", borderRadius: 7, fontSize: 11, color: "#64748b", lineHeight: 1.5, borderLeft: "3px solid #e2e8f0" }}>
          {lead.notes.length > 90 ? lead.notes.slice(0, 90) + "…" : lead.notes}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10, color: "#cbd5e1", textAlign: "center", fontStyle: "italic" }}>Click to open full details</div>
    </div>
  );
}

// ─── Kanban Board ────────────────────────────────────────────────────────────────
function KanbanBoard({ leads, onDrop, dupeIds, staleLeads, onConvert, onEdit, onSetFollowUp, onHover, onHoverEnd, onDetail, tabLocks, currentUser }) {
  // Read settings once at component level — not per-card inside a render loop
  const kanbanCfg = useMemo(() => loadLeadsSettings(), []);
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [editFollowUp, setEditFollowUp] = useState(null);

  const handleDragOver = (e, stage) => { e.preventDefault(); setDragOver(stage); };
  const handleDrop = (e, stage) => {
    e.preventDefault();
    if (dragId) onDrop(dragId, stage);
    setDragId(null); setDragOver(null);
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(168px, 1fr))`,
      gap: 8, flex: 1, minHeight: 0, overflow: "auto",
      paddingBottom: 8,
    }}>
      {PIPELINE_STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.status === stage);
        const stageValue = stageLeads.reduce((a, l) => a + (l.value || 0), 0);
        const isOver = dragOver === stage;
        return (
          <div
            key={stage}
            onDragOver={e => handleDragOver(e, stage)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, stage)}
            style={{
              background: isOver ? STAGE_COLORS[stage] + "0d" : "#f4f6f9",
              borderRadius: 10,
              padding: "8px 7px",
              minWidth: 168,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              border: `2px solid ${isOver ? STAGE_COLORS[stage] + "70" : "transparent"}`,
              transition: "all 0.12s",
            }}
          >
            {/* Column header */}
            <div style={{ padding: "3px 4px 7px", borderBottom: `2px solid ${STAGE_COLORS[stage]}25` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: STAGE_COLORS[stage], textTransform: "uppercase", letterSpacing: 0.8 }}>{stage}</span>
                <span style={{ fontSize: 10, background: STAGE_COLORS[stage], color: "#fff", borderRadius: 9, padding: "1px 7px", fontWeight: 700 }}>{stageLeads.length}</span>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, fontWeight: 600 }}>{aed(stageValue)}</div>
            </div>

            {/* Cards */}
            <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              {stageLeads.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px 0", color: "#d1d5db", fontSize: 10, fontStyle: "italic", letterSpacing: 0.3 }}>No leads here</div>
              )}
              {stageLeads.map((lead) => {
                const score = scoreLead(lead);
                const sLabel = scoreLabel(score);
                const isDupe = dupeIds.has(lead.id);
                const isStale = staleLeads.some((s) => s.id === lead.id);
                const isEditingFU = editFollowUp === lead.id;
                const kanbanLockKey = `lead:${lead.id}`;
                const kanbanLock = tabLocks[kanbanLockKey];
                const kanbanLockedByOther = kanbanLock && kanbanLock.userId !== currentUser.userId;
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => { setDragId(lead.id); onHoverEnd && onHoverEnd(); }}
                    onClick={(e) => { e.stopPropagation(); onDetail && onDetail(lead); }}
                    onMouseEnter={e => { onHover && onHover(lead, { x: e.clientX, y: e.clientY }); }}
                    onMouseMove={e => { onHover && onHover(lead, { x: e.clientX, y: e.clientY }); }}
                    onMouseLeave={() => { onHoverEnd && onHoverEnd(); }}
                    style={{
                      background: "#fff",
                      borderRadius: 9,
                      padding: "8px 9px",
                      cursor: "pointer",
                      border: `1px solid ${isDupe ? "#f59e0b40" : "#e8ecf1"}`,
                      borderLeft: `3px solid ${STAGE_COLORS[stage] || "#e8ecf1"}`,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                      transition: "box-shadow 0.12s, transform 0.1s",
                    }}
                    onMouseOver={e => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.10)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseOut={e => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)"; e.currentTarget.style.transform = ""; }}
                  >
                    {/* Row 1: Name + priority + edit */}
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                      <span style={{ lineHeight: 1.25, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</span>
                      <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
                        {lead.priority && (
                          <span style={{ fontSize: 8, fontWeight: 800, color: PRIORITY_COLORS[lead.priority], background: PRIORITY_COLORS[lead.priority] + "18", borderRadius: 3, padding: "1px 4px" }}>{lead.priority}</span>
                        )}
                        {isDupe && <span title="Duplicate" style={{ fontSize: 9, color: "#f59e0b" }}>⚠</span>}
                        {kanbanLockedByOther && <span title={`Locked by ${kanbanLock.userName}`} style={{ fontSize: 9, color: "#a16207" }}>🔒</span>}
                        <button onClick={e => { e.stopPropagation(); onEdit(lead); }}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#cbd5e1", padding: 0, lineHeight: 1 }} title="Edit">✏️</button>
                      </div>
                    </div>
                    {/* Row 2: Service + phone + owner */}
                    <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", overflow: "hidden" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{lead.service}</span>
                        {lead.assignedTo && <span style={{ color: "#64748b", fontWeight: 600, flexShrink: 0, marginLeft: 4 }}>· {lead.assignedTo}</span>}
                      </div>
                      {lead.phone && <div style={{ color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>📞 {lead.phone}</span>
                        {lead.nationality && <span>· 🌍 {lead.nationality}</span>}
                      </div>}
                    </div>
                    {/* Sub-status badge for intermediate stages */}
                    {["Orientation Payment Pending", "Orientation Scheduled", "Reservation Pending"].includes(lead.status) && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                        background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa",
                        display: "inline-block", marginBottom: 4,
                      }}>
                        {lead.status === "Orientation Payment Pending" ? "Payment Pending"
                          : lead.status === "Orientation Scheduled"    ? "Scheduled"
                          : "Reservation Pending"}
                      </span>
                    )}
                    {/* Next action */}
                    {(() => {
                      const na = getNextAction(lead, kanbanCfg);
                      return na ? (
                        <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, display: "flex", gap: 4, alignItems: "center" }}>
                          <span style={{ flexShrink: 0 }}>{na.icon}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{na.text}</span>
                        </div>
                      ) : null;
                    })()}
                    {/* Row 3: Value + temperature */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>{lead.value ? aed(lead.value) : <span style={{ color: "#cbd5e1", fontWeight: 400 }}>No value</span>}</span>
                      {(() => { const t = getTemperature(lead); const tl = getTempLabel(t); return <span style={pill(tl.color, tl.bg)}>{tl.label}</span>; })()}
                    </div>
                    {/* Row 4: Source + tags */}
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 3 }}>
                      {lead.source && <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: "#f1f5f9", color: "#64748b" }}>{lead.source}</span>}
                      {(lead.tags || []).slice(0, 2).map(t => <span key={t} style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#e0e7ff", color: "#4338ca" }}>{t}</span>)}
                      {(lead.tags || []).length > 2 && <span style={{ fontSize: 8, color: "#94a3b8" }}>+{(lead.tags||[]).length - 2}</span>}
                    </div>
                    {/* Row 5: SLA + stage age */}
                    {(() => {
                      const sla = getSLAStatus(lead);
                      const age = getDaysInStage(lead);
                      const dangerD = kanbanCfg.stageAgeDangerDays ?? 14;
                      const warnD = kanbanCfg.stageAgeWarnDays ?? 7;
                      const ageColor = age > dangerD ? "#ef4444" : age > warnD ? "#f59e0b" : null;
                      return (
                        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                          {sla && <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: sla.bg, color: sla.color }}>{sla.urgent ? "⚠ " : ""}SLA: {sla.label}</span>}
                          {ageColor && <span style={{ fontSize: 8, color: ageColor, fontWeight: 700 }}>⏱ {age}d in stage</span>}
                          {lead.estimatedClose && <span style={{ fontSize: 8, color: "#64748b" }}>🎯 {lead.estimatedClose}</span>}
                        </div>
                      );
                    })()}
                    {/* Row 6: Notes preview */}
                    {lead.notes && (
                      <div style={{ fontSize: 9, color: "#64748b", background: "#fffbeb", borderRadius: 4, padding: "3px 5px", marginBottom: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        📝 {lead.notes}
                      </div>
                    )}
                    {/* Stage age — only when stale */}
                    {isStale && (() => {
                      const age = getDaysInStage(lead);
                      const dangerD = kanbanCfg.stageAgeDangerDays ?? 14;
                      const ageColor = age > dangerD ? "#ef4444" : "#f59e0b";
                      return <div style={{ fontSize: 9, color: ageColor, fontWeight: 700, marginBottom: 2 }}>⏰ {age}d in stage</div>;
                    })()}

                    {/* Follow-up setter */}
                    <div style={{ marginTop: 5, borderTop: "1px solid #f1f5f9", paddingTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {isEditingFU ? (
                        <div style={{ display: "flex", gap: 4, flex: 1 }} onClick={e => e.stopPropagation()}>
                          <input type="date" defaultValue={lead.followUpDate || ""}
                            onBlur={e => { onSetFollowUp(lead, e.target.value); setEditFollowUp(null); }}
                            autoFocus
                            style={{ fontSize: 10, border: "1px solid #3b82f6", borderRadius: 4, padding: "2px 4px", flex: 1, fontFamily: "inherit" }} />
                          <button onClick={() => setEditFollowUp(null)} style={{ fontSize: 10, background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>✕</button>
                        </div>
                      ) : (() => {
                        const fu = getFollowUpStatus(lead.followUpDate);
                        return (
                          <button onClick={(e) => { e.stopPropagation(); setEditFollowUp(lead.id); }}
                            style={{ fontSize: 9, color: fu ? fu.color : "#94a3b8", background: fu ? fu.bg : "none", border: fu ? `1px solid ${fu.color}30` : "none", borderRadius: 4, padding: fu ? "2px 5px" : 0, cursor: "pointer", fontFamily: "inherit", fontWeight: fu ? 700 : 400 }}>
                            {fu ? `${fu.icon} ${fu.label}` : "📅 Set follow-up"}
                          </button>
                        );
                      })()}
                      {/* Phone quick-dial icon */}
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                          style={{ fontSize: 13, textDecoration: "none", color: "#10b981", marginLeft: 5, flexShrink: 0 }} title={`Call ${lead.phone}`}>📞</a>
                      )}
                    </div>

                    {stage === "Won" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onConvert(lead); }}
                        style={{ marginTop: 6, width: "100%", fontSize: 9, fontWeight: 700, padding: "3px 0", background: "#f0fdf4", color: "#10b981", border: "1px solid #6ee7b740", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
                        ↗ Convert to Client
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Reminder Center ───────────────────────────────────────────────────────────
function ReminderCenter({ leads, onClose, onOpenLead }) {
  const today = new Date(); today.setHours(0,0,0,0);
  const [tab, setTab] = useState("queue");
  const categorize = (lead) => {
    const fu = getFollowUpStatus(lead.followUpDate);
    if (!fu) return null;
    if (fu.color === "#ef4444") return "overdue";
    if (fu.color === "#f59e0b") return "today";
    if (fu.color === "#3b82f6") return "soon";
    return "upcoming";
  };
  const overdue   = leads.filter(l => categorize(l) === "overdue"   && !l.archived);
  const dueToday  = leads.filter(l => categorize(l) === "today"     && !l.archived);
  const soon      = leads.filter(l => categorize(l) === "soon"      && !l.archived);
  const upcoming  = leads.filter(l => categorize(l) === "upcoming"  && !l.archived);
  const orientationPending = leads.filter(l =>
    !l.archived && (l.status === "Orientation Payment Pending" || l.status === "Reservation Pending")
  );

  // Priority queue: overdue first, then today, then soon — sorted by value desc
  const priorityQueue = [
    ...overdue.sort((a,b) => (b.value||0) - (a.value||0)),
    ...dueToday.sort((a,b) => (b.value||0) - (a.value||0)),
    ...soon.sort((a,b) => (b.value||0) - (a.value||0)),
  ].slice(0, 20);

  const Section = ({ title, items, color, bg }) => items.length === 0 ? null : (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ background: color, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 10 }}>{items.length}</span>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(lead => {
          const fu = getFollowUpStatus(lead.followUpDate);
          const na = getNextAction(lead);
          return (
            <div key={lead.id} onClick={() => onOpenLead(lead)}
              style={{ background: bg, border: `1px solid ${color}30`, borderRadius: 9, padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 2 }}>{lead.name}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{lead.service} · {lead.assignedTo || "Unassigned"}</div>
                {na && <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>{na.icon} {na.text}</div>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                {fu && <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>}
                {lead.value > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>AED {lead.value.toLocaleString()}</div>}
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}
                    style={{ fontSize: 10, padding: "2px 7px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 5, textDecoration: "none", fontWeight: 600 }}>
                    📞 Call
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const total = overdue.length + dueToday.length + soon.length + upcoming.length;
  const tabBtn = (id, label, count, color) => (
    <button key={id} onClick={() => setTab(id)} style={{
      padding: "6px 12px", fontSize: 11, fontWeight: tab === id ? 700 : 400,
      color: tab === id ? color : "#94a3b8", background: "none", border: "none",
      borderBottom: `2px solid ${tab === id ? color : "transparent"}`,
      cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
    }}>
      {label} {count > 0 && <span style={{ fontSize: 10, background: color + "20", color, borderRadius: 8, padding: "1px 6px", fontWeight: 700, marginLeft: 4 }}>{count}</span>}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 420, maxWidth: "95vw", height: "100%", background: "#fff", overflowY: "auto", padding: 26, boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>🔔 Follow-Up Center</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{total} follow-up{total !== 1 ? "s" : ""} pending</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8ecf1", marginBottom: 16, gap: 2 }}>
          {tabBtn("queue",    "Contact Next", priorityQueue.length,       "#ef4444")}
          {tabBtn("all",      "All",          total,                      "#3b82f6")}
          {tabBtn("payments", "Payments Pending", orientationPending.length, "#f59e0b")}
          {tabBtn("upcoming", "Upcoming",     upcoming.length,            "#10b981")}
        </div>

        {total === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#334155" }}>All caught up!</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No pending follow-ups right now.</div>
          </div>
        )}

        {tab === "queue" && (
          <div>
            {priorityQueue.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", paddingTop: 30 }}>No urgent follow-ups</div>}
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>Sorted by urgency then value</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {priorityQueue.map((lead, idx) => {
                const fu = getFollowUpStatus(lead.followUpDate);
                const na = getNextAction(lead);
                return (
                  <div key={lead.id} onClick={() => onOpenLead(lead)}
                    style={{ background: fu?.color === "#ef4444" ? "#fef2f2" : fu?.color === "#f59e0b" ? "#fffbeb" : "#eff6ff", border: `1px solid ${fu?.color || "#e8ecf1"}30`, borderRadius: 9, padding: "10px 14px", cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: fu?.color || "#3b82f6", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{lead.name}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{lead.service} · {lead.assignedTo || "Unassigned"}</div>
                      {na && <div style={{ fontSize: 11, color: "#334155", marginTop: 3 }}>{na.icon} {na.text}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {fu && <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>}
                      {lead.value > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginTop: 3 }}>AED {lead.value.toLocaleString()}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "all" && (
          <>
            <Section title="Overdue"          items={overdue}             color="#ef4444" bg="#fef2f2" />
            <Section title="Due Today"        items={dueToday}            color="#f59e0b" bg="#fffbeb" />
            <Section title="Payments Pending" items={orientationPending}  color="#f97316" bg="#fff7ed" />
            <Section title="In 1–3 Days"      items={soon}                color="#3b82f6" bg="#eff6ff" />
          </>
        )}

        {tab === "payments" && (
          <Section title="Payments Pending" items={orientationPending} color="#f97316" bg="#fff7ed" />
        )}

        {tab === "upcoming" && (
          <Section title="Upcoming" items={upcoming} color="#10b981" bg="#f0fdf4" />
        )}
      </div>
    </div>
  );
}

// ─── Funnel Modal ──────────────────────────────────────────────────────────────
function FunnelModal({ leads, pipelineStats, onClose }) {
  const total = leads.filter(l => !l.archived).length;
  const won   = leads.filter(l => l.status === "Won").length;
  const lost  = leads.filter(l => ["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status)).length;
  const wonVal = leads.filter(l => l.status === "Won").reduce((a,l) => a + (l.value||0), 0);
  const lostVal = leads.filter(l => ["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status)).reduce((a,l) => a + (l.value||0), 0);
  const overallConv = total > 0 ? Math.round((won / total) * 100) : 0;
  const avgDeal = won > 0 ? Math.round(wonVal / won) : 0;

  const stages = pipelineStats.filter(s => !["Not Interested", "Lost", "No Response", "Duplicate"].includes(s.stage));
  const maxCount = Math.max(1, ...stages.map(s => s.count));

  // Drop-off between stages
  const withDropoff = stages.map((s, i) => ({
    ...s,
    dropoff: i > 0 ? stages[i-1].count - s.count : 0,
    pct: total > 0 ? Math.round((s.count / total) * 100) : 0,
  }));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 580, maxWidth: "95vw", maxHeight: "88vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>📊 Conversion Funnel</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {/* Summary stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            ["Total Leads", total, "#3b82f6"],
            ["Converted", `${won} (${overallConv}%)`, "#10b981"],
            ["Avg Deal", `AED ${avgDeal.toLocaleString()}`, "#8b5cf6"],
            ["Lost Value", `AED ${lostVal.toLocaleString()}`, "#ef4444"],
          ].map(([k,v,c]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", textAlign: "center", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Funnel bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {withDropoff.map((s, i) => {
            const barW = maxCount > 0 ? Math.round((s.count / maxCount) * 100) : 0;
            return (
              <div key={s.stage}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                  <div style={{ width: 80, fontSize: 11, fontWeight: 700, color: STAGE_COLORS[s.stage] }}>{s.stage}</div>
                  <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 6, height: 28, overflow: "hidden", position: "relative" }}>
                    <div style={{ width: `${barW}%`, height: "100%", background: STAGE_COLORS[s.stage], borderRadius: 6, transition: "width 0.4s", opacity: 0.85 }} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 10, fontSize: 11, fontWeight: 700, color: barW > 30 ? "#fff" : STAGE_COLORS[s.stage] }}>
                      {s.count} leads · AED {(s.value||0).toLocaleString()} · {s.pct}%
                    </div>
                  </div>
                </div>
                {i > 0 && s.dropoff > 0 && (
                  <div style={{ paddingLeft: 90, fontSize: 10, color: "#ef4444", marginBottom: 2 }}>
                    ↓ {s.dropoff} dropped off from {stages[i-1].stage}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Won / Lost summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#f0fdf4", borderRadius: 10, padding: "14px 16px", border: "1px solid #6ee7b740" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", marginBottom: 6 }}>✅ Won</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{won}</div>
            <div style={{ fontSize: 12, color: "#065f46", marginTop: 2 }}>AED {wonVal.toLocaleString()}</div>
          </div>
          <div style={{ background: "#fef2f2", borderRadius: 10, padding: "14px 16px", border: "1px solid #fca5a540" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>❌ Lost</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444" }}>{lost}</div>
            <div style={{ fontSize: 12, color: "#991b1b", marginTop: 2 }}>AED {lostVal.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Source ROI Modal ──────────────────────────────────────────────────────────
function SourceROIModal({ leads, onClose }) {
  const sources = [...new Set(leads.map(l => l.source).filter(Boolean))];
  const stats = sources.map(src => {
    const sl       = leads.filter(l => l.source === src);
    const won      = sl.filter(l => l.status === "Won");
    const lost     = sl.filter(l => ["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status));
    const revenue  = won.reduce((a,l) => a + (l.value||0), 0);
    const pipeline = sl.filter(l => !["Won",...["Not Interested", "Lost", "No Response", "Duplicate"]].includes(l.status)).reduce((a,l) => a + (l.value||0), 0);
    const convRate = sl.length ? Math.round((won.length / sl.length) * 100) : 0;
    const avgVal   = won.length ? Math.round(revenue / won.length) : 0;
    return { src, total: sl.length, won: won.length, lost: lost.length, revenue, pipeline, convRate, avgVal };
  }).sort((a,b) => b.revenue - a.revenue);

  const totalRevenue = stats.reduce((a,s) => a + s.revenue, 0);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 640, maxWidth: "95vw", maxHeight: "88vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>💰 Lead Source ROI</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Total closed revenue: AED {totalRevenue.toLocaleString()}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {stats.length === 0 && <div style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>No source data yet</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.map((s, i) => {
            const revShare = totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 100) : 0;
            const SOURCE_ICONS = { Facebook: "📘", Google: "🔍", Referral: "🤝", Instagram: "📸", "Walk-in": "🚶", Other: "📋" };
            return (
              <div key={s.src} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{SOURCE_ICONS[s.src] || "📋"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{s.src}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{s.total} leads · {revShare}% of revenue</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981" }}>AED {s.revenue.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>closed</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 10 }}>
                  {[
                    ["Won",      s.won,                          "#10b981"],
                    ["Closed",   s.lost,                         "#ef4444"],
                    ["Conv %",   `${s.convRate}%`,               s.convRate >= 40 ? "#10b981" : s.convRate >= 20 ? "#f59e0b" : "#ef4444"],
                    ["Avg Deal", `AED ${s.avgVal.toLocaleString()}`, "#8b5cf6"],
                  ].map(([k,v,c]) => (
                    <div key={k} style={{ background: "#fff", borderRadius: 6, padding: "6px 8px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 2 }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
                {/* Revenue share bar */}
                <div style={{ background: "#e2e8f0", borderRadius: 4, height: 5, overflow: "hidden" }}>
                  <div style={{ width: `${revShare}%`, height: "100%", background: "#10b981", borderRadius: 4 }} />
                </div>
                {s.pipeline > 0 && (
                  <div style={{ fontSize: 10, color: "#3b82f6", marginTop: 6, fontWeight: 600 }}>
                    + AED {s.pipeline.toLocaleString()} in pipeline
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Staff ROI Modal ────────────────────────────────────────────────────────────
function StaffROIModal({ leads, onClose, cfg }) {
  const _cfg = cfg || DEFAULT_LEADS_SETTINGS;
  const staff = (_cfg.staffOptions || DEFAULT_LEADS_SETTINGS.staffOptions).filter(Boolean);
  const stats = staff.map(s => {
    const assigned = leads.filter(l => l.assignedTo === s);
    const won      = assigned.filter(l => l.status === "Won");
    const lost     = assigned.filter(l => ["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status));
    const revenue  = won.reduce((a, l) => a + (l.value || 0), 0);
    const rate     = assigned.length ? Math.round((won.length / assigned.length) * 100) : 0;
    const avgDays  = won.length ? Math.round(won.reduce((a, l) => a + getDaysInStage(l), 0) / won.length) : 0;
    return { name: s, assigned: assigned.length, won: won.length, lost: lost.length, revenue, rate, avgDays };
  }).filter(s => s.assigned > 0);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 640, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>👤 Staff ROI & Conversion Rates</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        {stats.length === 0 && <div style={{ color: "#94a3b8", textAlign: "center", padding: 40 }}>No assigned leads yet</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.sort((a,b) => b.rate - a.rate).map(s => (
            <div key={s.name} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>👤 {s.name}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 11, background: s.rate >= 50 ? "#f0fdf4" : s.rate >= 25 ? "#fffbeb" : "#fef2f2", color: s.rate >= 50 ? "#065f46" : s.rate >= 25 ? "#92400e" : "#991b1b", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>{s.rate}% conversion</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, fontSize: 12 }}>
                {[["Assigned", s.assigned, "#64748b"], ["Won", s.won, "#10b981"], ["Lost", s.lost, "#ef4444"], ["Revenue", `AED ${s.revenue.toLocaleString()}`, "#3b82f6"], ["Avg Close", `${s.avgDays}d`, "#8b5cf6"]].map(([k, v, c]) => (
                  <div key={k} style={{ textAlign: "center", background: "#fff", borderRadius: 7, padding: "8px 6px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, background: "#e2e8f0", borderRadius: 4, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${s.rate}%`, height: "100%", background: s.rate >= 50 ? "#10b981" : s.rate >= 25 ? "#f59e0b" : "#ef4444", borderRadius: 4, transition: "width 0.4s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Forecast Modal ───────────────────────────────────────────────────
function ForecastModal({ leads, onClose }) {
  const WEIGHTS = { "New Lead": 0.05, Contacted: 0.1, "Orientation Invited": 0.15, "Orientation Payment Pending": 0.2, "Orientation Paid": 0.3, "Orientation Scheduled": 0.35, "Orientation Attended": 0.45, "Follow-Up": 0.55, "Interested": 0.7, "Reservation Pending": 0.8, Reserved: 0.9, Won: 1.0, "Not Interested": 0, Lost: 0, "No Response": 0, Duplicate: 0 };
  const active = leads.filter(l => !l.archived && !["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status));
  const weighted = active.reduce((a, l) => a + (l.value || 0) * (WEIGHTS[l.status] || 0), 0);
  const best     = active.filter(l => ["Interested","Reservation Pending","Reserved","Won"].includes(l.status)).reduce((a,l) => a + (l.value||0), 0);
  const worst    = active.filter(l => l.status === "Won").reduce((a,l) => a + (l.value||0), 0);
  const byStage  = ["New Lead","Contacted","Orientation Invited","Orientation Paid","Orientation Attended","Interested","Reservation Pending","Reserved","Won"].map(s => {
    const sl = active.filter(l => l.status === s);
    return { stage: s, count: sl.length, value: sl.reduce((a,l)=>a+(l.value||0),0), weight: WEIGHTS[s] };
  });
  const closingSoon = active.filter(l => l.estimatedClose).sort((a,b) => new Date(a.estimatedClose) - new Date(b.estimatedClose)).slice(0, 5);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 620, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>🔮 Pipeline Forecast</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[["Weighted", `AED ${Math.round(weighted).toLocaleString()}`, "#3b82f6", "Probability-adjusted"], ["Best Case", `AED ${best.toLocaleString()}`, "#10b981", "Interested+ Won"], ["Committed", `AED ${worst.toLocaleString()}`, "#8b5cf6", "Won only"]].map(([k,v,c,sub]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px", border: "1px solid #e2e8f0", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Stage Breakdown</div>
          {(() => {
            const totalVal = byStage.reduce((a, s) => a + s.value, 0) || 1;
            return byStage.map(s => s.count > 0 && (
              <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 12 }}>
                <div style={{ width: 80, color: "#64748b" }}>{s.stage}</div>
                <div style={{ flex: 1, background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${(s.value / totalVal) * 100}%`, height: "100%", background: STAGE_COLORS[s.stage], opacity: 0.7 + s.weight * 0.3, borderRadius: 4 }} />
                </div>
                <div style={{ width: 30, textAlign: "right", fontWeight: 700 }}>{s.count}</div>
                <div style={{ width: 110, textAlign: "right", color: "#334155", fontWeight: 600 }}>AED {s.value.toLocaleString()}</div>
                <div style={{ width: 50, textAlign: "right", color: "#94a3b8" }}>{Math.round(s.weight*100)}%</div>
              </div>
            ));
          })()}
        </div>
        {closingSoon.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Closing Soon</div>
            {closingSoon.map(l => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 10px", background: "#f8fafc", borderRadius: 7, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{l.name}</span>
                <span style={{ color: "#64748b" }}>{l.service}</span>
                <span style={{ color: "#3b82f6", fontWeight: 700 }}>{l.estimatedClose}</span>
                <span style={{ color: "#10b981", fontWeight: 700 }}>AED {(l.value||0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead Heatmap Modal ────────────────────────────────────────────────────────
function HeatmapModal({ leads, onClose }) {
  const cfg = loadLeadsSettings();
  const days = cfg.heatmapDays || 63; // configurable via Settings → Leads
  const today = new Date(); today.setHours(0,0,0,0);
  const grid = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLeads = leads.filter(l => l.date === dateStr || l.updatedAt === dateStr || l.lastContacted === dateStr);
    const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    grid.push({ date: dateStr, count: dayLeads.length, label: `${weekday}, ${label}` });
  }
  const max = Math.max(1, ...grid.map(g => g.count));
  const weeks = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));
  const colors = (n) => {
    if (n === 0) return "#f1f5f9";
    const intensity = n / max;
    if (intensity < 0.25) return "#bfdbfe";
    if (intensity < 0.5)  return "#60a5fa";
    if (intensity < 0.75) return "#3b82f6";
    return "#1d4ed8";
  };
  const totalActivity = grid.reduce((a, g) => a + g.count, 0);
  const activeDays    = grid.filter(g => g.count > 0).length;
  const peakDay       = grid.reduce((a, g) => g.count > a.count ? g : a, { count: 0, label: "—" });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 600, maxWidth: "95vw", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>🗺 Lead Activity Heatmap</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[["Total Activity", totalActivity, "#3b82f6"], ["Active Days", activeDays, "#10b981"], ["Peak Day", `${peakDay.count} — ${peakDay.label}`, "#f59e0b"]].map(([k,v,c]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 8 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {week.map((day, di) => (
                <div key={di} title={`${day.label}: ${day.count} activities`}
                  style={{ width: 14, height: 14, borderRadius: 3, background: colors(day.count), cursor: "default", flexShrink: 0 }} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 10, color: "#94a3b8" }}>
          <span>Less</span>
          {["#f1f5f9","#bfdbfe","#60a5fa","#3b82f6","#1d4ed8"].map(c => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

// ─── Custom Fields Modal ───────────────────────────────────────────────────────
function CustomFieldsModal({ onSave, onClose }) {
  const [fields, setFields] = useState(() => {
    try { return JSON.parse(localStorage.getItem("crm_custom_fields") || "[]"); } catch { return []; }
  });
  const [newLabel, setNewLabel] = useState("");
  const [newType,  setNewType]  = useState("text");

  const addField = () => {
    if (!newLabel.trim()) return;
    setFields(f => [...f, { id: `cf_${Date.now()}`, label: newLabel.trim(), type: newType }]);
    setNewLabel(""); setNewType("text");
  };
  const removeField = (id) => setFields(f => f.filter(x => x.id !== id));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 500, maxWidth: "95vw", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>⚙ Custom Fields</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Field label…"
            style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
          <select value={newType} onChange={e => setNewType(e.target.value)}
            style={{ padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
            <option value="checkbox">Checkbox</option>
          </select>
          <button onClick={addField} style={{ padding: "7px 14px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>+ Add</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60 }}>
          {fields.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", paddingTop: 20 }}>No custom fields yet. Add one above.</div>}
          {fields.map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#f8fafc", borderRadius: 7, padding: "8px 12px", border: "1px solid #e2e8f0" }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#334155" }}>{f.label}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", background: "#e2e8f0", borderRadius: 4, padding: "2px 7px" }}>{f.type}</span>
              <button onClick={() => removeField(f.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={{ padding: "7px 18px", borderRadius: 7, fontSize: 12, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave(fields)} style={{ padding: "7px 22px", borderRadius: 7, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>Save Fields</button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Assist Modal ────────────────────────────────────────────────────────────
function AIAssistModal({ lead, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [mode, setMode]       = useState("message");

  const MODES = [
    { key: "message",    label: "✉️ Draft Message",     prompt: `Draft a short, professional WhatsApp or email message to follow up with a lead named ${lead.name} who is interested in ${lead.service}. Their status is ${lead.status}. Keep it under 80 words, friendly and action-oriented.` },
    { key: "nextaction", label: "🎯 Suggest Next Step", prompt: `A lead named ${lead.name} is interested in ${lead.service}. Status: ${lead.status}. Priority: ${lead.priority || "none"}. Notes: "${lead.notes || "none"}". Suggest the single best next action for the sales team in 2-3 sentences.` },
    { key: "objections", label: "💬 Handle Objections", prompt: `A lead interested in ${lead.service} in UAE has gone ${lead.status === "Lost" ? "lost with reason: " + (lead.lostReason || "unspecified") : "quiet"}. Write 3 short, empathetic responses to re-engage them.` },
    { key: "summary",    label: "📋 Lead Summary",      prompt: `Summarize this lead in 3 bullet points for a sales manager: Name: ${lead.name}, Service: ${lead.service}, Status: ${lead.status}, Value: AED ${lead.value || 0}, Source: ${lead.source || "unknown"}, Priority: ${lead.priority || "none"}, Notes: "${lead.notes || "none"}".` },
  ];

  const run = async () => {
    setLoading(true); setResult(null);
    const selected = MODES.find(m => m.key === mode);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: selected.prompt }] }),
      });
      const data = await res.json();
      setResult(data.content?.[0]?.text || "No response.");
    } catch { setResult("Error connecting to AI. Please try again."); }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>✨ AI Assist</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{lead.name} · {lead.service}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {MODES.map(m => (
            <button key={m.key} onClick={() => { setMode(m.key); setResult(null); }}
              style={{ padding: "6px 12px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: `1.5px solid ${mode === m.key ? "#8b5cf6" : "#e2e8f0"}`, background: mode === m.key ? "#ede9fe" : "#fff", color: mode === m.key ? "#7c3aed" : "#64748b", cursor: "pointer" }}>
              {m.label}
            </button>
          ))}
        </div>
        <button onClick={run} disabled={loading}
          style={{ width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, background: loading ? "#c4b5fd" : "#8b5cf6", color: "#fff", border: "none", cursor: loading ? "default" : "pointer", marginBottom: 16 }}>
          {loading ? "✨ Generating…" : "✨ Generate"}
        </button>
        {result && (
          <div style={{ background: "#faf5ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "14px 16px", fontSize: 13, color: "#1e1b4b", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {result}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button onClick={() => navigator.clipboard?.writeText(result)}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 5, border: "1px solid #ddd6fe", background: "#fff", color: "#7c3aed", cursor: "pointer", fontWeight: 600 }}>📋 Copy</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stage Gate Modal — SOP field collection before stage transition ───────────
function StageGateModal({ lead, newStage, onConfirm, onCancel, cfg }) {
  const staffOptions = (cfg?.staffOptions || DEFAULT_LEADS_SETTINGS.staffOptions).filter(Boolean);
  const lostOptions  = cfg?.lostOptions  || DEFAULT_LEADS_SETTINGS.lostOptions;

  const GATE_CONFIG = {
    "Orientation Payment Pending": [
      { key: "followUpDate", label: "Follow-up Date", type: "date", required: true },
    ],
    "Orientation Paid": [
      { key: "paymentDate",   label: "Payment Date",   type: "date",   required: true },
      { key: "paymentAmount", label: "Amount (AED)",   type: "number", required: true },
      { key: "paymentMethod", label: "Payment Method", type: "select", required: true,
        options: ["Cash", "Bank Transfer", "Card", "Cheque", "Other"] },
      { key: "paymentRef",    label: "Reference / Receipt No.", type: "text", required: false },
    ],
    "Orientation Scheduled": [
      { key: "orientationDate", label: "Orientation Date", type: "date",   required: true },
      { key: "orientationTime", label: "Orientation Time", type: "time",   required: true },
      { key: "orientationType", label: "Type",             type: "select", required: true,
        options: ["In-person", "Online", "Phone", "WhatsApp"] },
      { key: "assignedTo",      label: "Assigned Staff",   type: "select", required: true, options: staffOptions },
    ],
    "Orientation Attended": [
      { key: "attendanceConfirmed", label: "Attendance Confirmed", type: "checkbox", required: true },
      { key: "followUpDate",        label: "Follow-up Date (within 24h)", type: "date", required: true },
      { key: "orientationNotes",    label: "Orientation Notes",   type: "textarea", required: false },
    ],
    "Interested": [
      { key: "service", label: "Selected Service", type: "select", required: true,
        options: cfg?.serviceOptions || DEFAULT_LEADS_SETTINGS.serviceOptions },
      { key: "notes",   label: "Client Concern / Note", type: "textarea", required: true },
    ],
    "Reservation Pending": [
      { key: "reservationAmount", label: "Reservation Amount (AED)", type: "number", required: true },
      { key: "followUpDate",      label: "Follow-up Date",           type: "date",   required: true },
    ],
    "Reserved": [
      { key: "reservationAmount", label: "Reservation Amount (AED)", type: "number", required: true },
      { key: "reservationDate",   label: "Payment Date",             type: "date",   required: true },
      { key: "reservationRef",    label: "Reference / Receipt No.",  type: "text",   required: false },
    ],
    "Won": [
      { key: "service",      label: "Final Service Selected", type: "select", required: true,
        options: cfg?.serviceOptions || DEFAULT_LEADS_SETTINGS.serviceOptions },
      { key: "handoverNote", label: "Sales Handover Note",    type: "textarea", required: true },
      { key: "assignedTo",   label: "Assign to Operations",   type: "select",   required: false, options: staffOptions },
    ],
    "Lost": [
      { key: "lostReason", label: "Lost Reason", type: "select", required: true, options: lostOptions },
      { key: "notes",      label: "Notes",        type: "textarea", required: false },
    ],
    "No Response": [
      { key: "followUpDate", label: "Retry Date", type: "date", required: true },
    ],
  };

  const fields = GATE_CONFIG[newStage] || [];
  const init = {};
  fields.forEach(f => {
    if (f.type === "checkbox") init[f.key] = false;
    else if (f.key === "service") init[f.key] = lead.service || "";
    else if (f.key === "assignedTo") init[f.key] = lead.assignedTo || "";
    else init[f.key] = "";
  });

  const [vals, setVals] = useState(init);
  const [errors, setErrors] = useState({});

  const set = (k, v) => { setVals(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  const handleConfirm = () => {
    const errs = {};
    fields.forEach(f => {
      if (!f.required) return;
      const v = vals[f.key];
      if (f.type === "checkbox" && !v) errs[f.key] = "Required";
      else if (!v || (typeof v === "string" && !v.trim())) errs[f.key] = "Required";
    });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onConfirm({ ...vals, _gateConfirmed: true });
  };

  const stageColor = DEFAULT_LEADS_SETTINGS.stageColors[newStage] || "#6366f1";

  const inp = (err) => ({
    style: {
      width: "100%", padding: "8px 10px", fontSize: 13, borderRadius: 7,
      border: `1.5px solid ${err ? "#fca5a5" : "#e2e8f0"}`,
      background: err ? "#fff5f5" : "#fff",
      fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    },
    onFocus: e => { e.target.style.borderColor = err ? "#f87171" : "#6366f1"; e.target.style.boxShadow = "0 0 0 3px #eef2ff"; },
    onBlur:  e => { e.target.style.borderColor = err ? "#fca5a5" : "#e2e8f0"; e.target.style.boxShadow = "none"; },
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.55)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 460, maxWidth: "95vw",
          maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.22)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: stageColor, display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: stageColor, textTransform: "uppercase", letterSpacing: 0.6 }}>Moving to</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{newStage}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{lead.name} · {lead.service}</div>
        </div>

        {/* Fields */}
        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {fields.map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, fontWeight: 700, color: errors[f.key] ? "#ef4444" : "#64748b",
                  textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 5 }}>
                {f.label}{f.required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
              </label>
              {f.type === "checkbox" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  <input type="checkbox" checked={!!vals[f.key]} onChange={e => set(f.key, e.target.checked)}
                    style={{ accentColor: stageColor, width: 16, height: 16, cursor: "pointer" }} />
                  Confirmed
                  {errors[f.key] && <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 400 }}>— required</span>}
                </label>
              ) : f.type === "textarea" ? (
                <textarea value={vals[f.key]} onChange={e => set(f.key, e.target.value)}
                  rows={3} placeholder={f.required ? "Required" : "Optional"}
                  {...inp(errors[f.key])} style={{ ...inp(errors[f.key]).style, resize: "vertical", minHeight: 72 }}
                  onFocus={inp(errors[f.key]).onFocus} onBlur={inp(errors[f.key]).onBlur} />
              ) : f.type === "select" ? (
                <select value={vals[f.key]} onChange={e => set(f.key, e.target.value)} {...inp(errors[f.key])}>
                  <option value="">Select…</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type} value={vals[f.key]} onChange={e => set(f.key, e.target.value)}
                  placeholder={f.required ? "Required" : "Optional"} {...inp(errors[f.key])} />
              )}
              {errors[f.key] && f.type !== "checkbox" && (
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{errors[f.key]}</div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px 18px", display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onCancel}
            style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={handleConfirm}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: stageColor, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Confirm & Move
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics Menu ────────────────────────────────────────────────────────────
function AnalyticsMenu({ isPhone, dupeIds, onMergeDupes, onReminders, onFunnel, onROI, onStaffROI, onForecast, onHeatmap, onFields, onGoals, onWinLoss, onHealth, onCompare, onColumns, onImport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const groups = [
    { label: "Analytics", items: [
      { icon: "ti-chart-dots",      label: "Funnel",      fn: onFunnel },
      { icon: "ti-currency-dollar", label: "ROI",         fn: onROI },
      { icon: "ti-chart-line",      label: "Forecast",    fn: onForecast },
      { icon: "ti-chart-bar",       label: "Win / Loss",  fn: onWinLoss },
      { icon: "ti-map-2",           label: "Heatmap",     fn: onHeatmap },
    ]},
    { label: "Tools", items: [
      { icon: "ti-bell",        label: "Reminders",       fn: onReminders },
      { icon: "ti-columns",     label: "Columns",         fn: onColumns },
      { icon: "ti-adjustments", label: "Custom fields",   fn: onFields },
      { icon: "ti-upload",      label: "Import CSV",      fn: onImport },
      ...(dupeIds.size > 0 ? [{ icon: "ti-copy", label: `Merge dupes (${dupeIds.size})`, fn: onMergeDupes }] : []),
    ]},
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 5, padding: "5px 11px",
        borderRadius: 7, fontSize: 11, fontWeight: 500,
        border: `1.5px solid ${open ? "#c7d2fe" : "#e8ecf1"}`,
        background: open ? "#eef2ff" : "#fff",
        color: open ? "#4338ca" : "#64748b",
        cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s",
      }}>
        <i className="ti ti-chart-bar" aria-hidden style={{ fontSize: 13 }} />
        {!isPhone && <span>Analytics</span>}
        <i className="ti ti-chevron-down" aria-hidden style={{ fontSize: 10, opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", right: 0, zIndex: 600,
          background: "#fff", borderRadius: 10, border: "1.5px solid #e8ecf1",
          boxShadow: "0 8px 30px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
          width: 210, paddingBottom: 6, overflow: "hidden",
        }}>
          {groups.map((g, gi) => (
            <div key={g.label}>
              {gi > 0 && <div style={{ height: "1.5px", background: "#f1f5f9", margin: "4px 0" }} />}
              <div style={{ padding: "9px 13px 3px", fontSize: 9, fontWeight: 700, color: "#c0c8d4", textTransform: "uppercase", letterSpacing: "0.08em" }}>{g.label}</div>
              {g.items.map(item => (
                <button key={item.label} onClick={() => { item.fn(); setOpen(false); }} style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%",
                  padding: "7px 13px", background: "none", border: "none",
                  cursor: "pointer", fontSize: 12, color: "#374151", fontFamily: "inherit",
                  textAlign: "left", borderRadius: 0,
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}>
                  <i className={`ti ${item.icon}`} aria-hidden style={{ fontSize: 14, color: "#94a3b8", width: 16, textAlign: "center" }} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tiny UI helpers ────────────────────────────────────────────────────────────
function FilterBtn({ active, label, onClick, danger, warn }) {
  const color = danger ? "#ef4444" : warn ? "#f59e0b" : B.blue;
  return (
    <button onClick={onClick} aria-pressed={active} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11,
      border: `1.5px solid ${active ? color : B.border}`,
      background: active ? color : "#fff",
      color: active ? "#fff" : B.muted,
      cursor: "pointer", fontWeight: active ? 700 : 400,
      transition: "all 0.15s",
    }}>{label}</button>
  );
}

function ModeBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 13px", borderRadius: 7, fontSize: 11, fontWeight: 600,
      border: `1.5px solid ${active ? B.blue : B.border}`,
      background: active ? B.blue + "15" : "#fff",
      color: active ? B.blue : B.muted,
      cursor: "pointer", transition: "all 0.15s",
    }}>{label}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed Dial FAB — floating action button with sub-actions
// ─────────────────────────────────────────────────────────────────────────────
function SpeedDialFAB({ onAddLead, onReminders, onImport }) {
  const [open, setOpen] = useState(false);
  const actions = [
    { icon: "➕", label: "Add Lead",   color: "#3b82f6", fn: onAddLead },
    { icon: "🔔", label: "Reminders",  color: "#f59e0b", fn: onReminders },
    { icon: "📥", label: "Import",     color: "#d97706", fn: onImport },
  ];
  return (
    <div style={{ position: "fixed", bottom: 80, right: 24, zIndex: 9990, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {open && actions.map((a, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, animation: "fadeInUp 0.15s ease" }}>
          <span style={{ background: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", color: "#334155", whiteSpace: "nowrap" }}>{a.label}</span>
          <button onClick={() => { a.fn(); setOpen(false); }} style={{ width: 40, height: 40, borderRadius: "50%", background: a.color, color: "#fff", border: "none", fontSize: 16, cursor: "pointer", boxShadow: `0 4px 12px ${a.color}60`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {a.icon}
          </button>
        </div>
      ))}
      <button onClick={() => setOpen(o => !o)} aria-label={open ? "Close quick actions" : "Quick actions"} style={{ width: 52, height: 52, borderRadius: "50%", background: open ? "#ef4444" : "#3b82f6", color: "#fff", border: "none", fontSize: 22, cursor: "pointer", boxShadow: "0 6px 20px rgba(59,130,246,0.45)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
        {open ? "✕" : "⚡"}
      </button>
      <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal Tracker Modal — monthly/quarterly targets
// ─────────────────────────────────────────────────────────────────────────────
function GoalTrackerModal({ leads, onClose }) {
  const [goals, setGoals] = useState(() => {
    try { return JSON.parse(localStorage.getItem("crm_lead_goals") || "{}"); } catch { return {}; }
  });
  const won   = leads.filter(l => l.status === "Won");
  const total = leads.filter(l => !l.archived);
  const revenue = won.reduce((s, l) => s + (l.value || 0), 0);
  const defaults = { wonTarget: 10, revenueTarget: 100000, leadsTarget: 30, ...(loadLeadsSettings().goalDefaults || {}) };
  const g = { ...defaults, ...goals };
  const save = (k, v) => { const next = { ...goals, [k]: Number(v) }; setGoals(next); try { localStorage.setItem("crm_lead_goals", JSON.stringify(next)); } catch {} };
  const Bar = ({ label, val, target, color, fmt }) => {
    const pct = Math.min(100, target > 0 ? Math.round((val / target) * 100) : 0);
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{label}</span>
          <span style={{ fontSize: 12, color: pct >= 100 ? "#10b981" : "#64748b" }}>{fmt(val)} / {fmt(target)} ({pct}%)</span>
        </div>
        <div style={{ height: 10, background: "#f1f5f9", borderRadius: 5, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#10b981" : color, borderRadius: 5, transition: "width 0.6s ease" }} />
        </div>
      </div>
    );
  };
  return (
    <ModalWrap title="🎯 Goal Tracker" onClose={onClose} width={480}>
      <Bar label="Deals Won"   val={won.length}  target={g.wonTarget}     color="#3b82f6" fmt={v => v} />
      <Bar label="Revenue"     val={revenue}      target={g.revenueTarget} color="#8b5cf6" fmt={v => `AED ${v.toLocaleString()}`} />
      <Bar label="Total Leads" val={total.length} target={g.leadsTarget}  color="#f59e0b" fmt={v => v} />
      <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 12 }}>Set Targets</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[["wonTarget","Won Deals"],["revenueTarget","Revenue (AED)"],["leadsTarget","Total Leads"]].map(([k,lbl]) => (
            <div key={k}>
              <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4, fontWeight: 600 }}>{lbl}</label>
              <input type="number" value={g[k]} onChange={e => save(k, e.target.value)} style={{ width: "100%", padding: "5px 8px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
            </div>
          ))}
        </div>
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Win/Loss Report Modal
// ─────────────────────────────────────────────────────────────────────────────
function WinLossReportModal({ leads, onClose }) {
  const won  = leads.filter(l => l.status === "Won");
  const lost = leads.filter(l => ["Not Interested", "Lost", "No Response", "Duplicate"].includes(l.status));
  const total = won.length + lost.length;
  const winRate = total > 0 ? Math.round((won.length / total) * 100) : 0;
  const wonRevenue  = won.reduce((s, l) => s + (l.value || 0), 0);
  const lostRevenue = lost.reduce((s, l) => s + (l.value || 0), 0);
  const bySource = {};
  [...won, ...lost].forEach(l => {
    const s = l.source || "Other";
    if (!bySource[s]) bySource[s] = { won: 0, lost: 0 };
    l.status === "Won" ? bySource[s].won++ : bySource[s].lost++;
  });
  const lostReasonMap = {};
  lost.forEach(l => { const r = l.lostReason || "Unknown"; lostReasonMap[r] = (lostReasonMap[r] || 0) + 1; });
  return (
    <ModalWrap title="📈 Win / Loss Report" onClose={onClose} width={560}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Win Rate",      value: `${winRate}%`,                     color: "#10b981" },
          { label: "Won Revenue",   value: `AED ${wonRevenue.toLocaleString()}`, color: "#3b82f6" },
          { label: "Lost Revenue",  value: `AED ${lostRevenue.toLocaleString()}`, color: "#ef4444" },
        ].map(s => (
          <div key={s.label} style={{ background: s.color + "10", borderRadius: 10, padding: "14px 16px", border: `1px solid ${s.color}25` }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Win Rate by Source</div>
        {Object.entries(bySource).sort((a,b) => {
          const ra = a[1].won + a[1].lost > 0 ? a[1].won / (a[1].won + a[1].lost) : 0;
          const rb = b[1].won + b[1].lost > 0 ? b[1].won / (b[1].won + b[1].lost) : 0;
          return rb - ra;
        }).map(([src, counts]) => {
          const total = counts.won + counts.lost;
          const rate = total > 0 ? Math.round((counts.won / total) * 100) : 0;
          return (
            <div key={src} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
              <span style={{ width: 90, fontSize: 11, color: "#64748b", fontWeight: 600 }}>{src}</span>
              <div style={{ flex: 1, height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${rate}%`, height: "100%", background: rate >= 50 ? "#10b981" : "#f59e0b", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#334155", width: 36, textAlign: "right" }}>{rate}%</span>
            </div>
          );
        })}
      </div>
      {Object.keys(lostReasonMap).length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Lost Reasons</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(lostReasonMap).sort((a,b) => b[1]-a[1]).map(([r,c]) => (
              <span key={r} style={{ background: "#fef2f2", color: "#ef4444", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                {r} ×{c}
              </span>
            ))}
          </div>
        </div>
      )}
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Health Modal
// ─────────────────────────────────────────────────────────────────────────────
function PipelineHealthModal({ leads, staleLeads, dupeIds, onClose }) {
  const active    = leads.filter(l => !l.archived && !["Won",...["Not Interested", "Lost", "No Response", "Duplicate"]].includes(l.status));
  const overdue   = leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate); return fu && fu.color === "#ef4444"; });
  const noContact = leads.filter(l => !l.email && !l.phone);
  const unassigned= leads.filter(l => !l.assignedTo);
  const noValue   = leads.filter(l => !l.value || l.value === 0);
  const score = Math.max(0, 100
    - Math.round((overdue.length / Math.max(active.length,1)) * 30)
    - Math.round((staleLeads.length / Math.max(active.length,1)) * 20)
    - Math.round((dupeIds.size / Math.max(leads.length,1)) * 15)
    - Math.round((unassigned.length / Math.max(active.length,1)) * 20)
    - Math.round((noValue.length / Math.max(active.length,1)) * 15)
  );
  const healthColor = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const issues = [
    { label: "Overdue Follow-ups",  count: overdue.length,    color: "#ef4444", tip: "Call or reschedule these leads today" },
    { label: "Stale Leads",         count: staleLeads.length, color: "#f59e0b", tip: "No activity in 7+ days" },
    { label: "Duplicate Leads",     count: dupeIds.size,       color: "#f97316", tip: "Merge to keep pipeline clean" },
    { label: "Unassigned Leads",    count: unassigned.length, color: "#8b5cf6", tip: "Assign to a team member" },
    { label: "No Contact Info",     count: noContact.length,  color: "#3b82f6", tip: "Missing email and phone" },
    { label: "No Value Set",        count: noValue.length,    color: "#64748b", tip: "Estimate deal value for forecasting" },
  ];
  return (
    <ModalWrap title="🩺 Pipeline Health" onClose={onClose} width={500}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, padding: "16px 20px", background: healthColor + "10", borderRadius: 12, border: `1px solid ${healthColor}30` }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 42, fontWeight: 900, color: healthColor, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>Health Score</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ height: 14, background: "#f1f5f9", borderRadius: 7, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${score}%`, height: "100%", background: healthColor, borderRadius: 7, transition: "width 0.8s ease" }} />
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {score >= 75 ? "✅ Pipeline is healthy" : score >= 50 ? "⚠️ Needs attention" : "🚨 Critical issues detected"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {issues.map(iss => (
          <div key={iss.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: iss.count > 0 ? iss.color + "08" : "#f8fafc", borderRadius: 8, border: `1px solid ${iss.count > 0 ? iss.color + "30" : "#e2e8f0"}` }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: iss.count > 0 ? iss.color : "#10b981", width: 30, textAlign: "center" }}>{iss.count > 0 ? iss.count : "✓"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{iss.label}</div>
              {iss.count > 0 && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{iss.tip}</div>}
            </div>
          </div>
        ))}
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Composer Modal
// ─────────────────────────────────────────────────────────────────────────────
function EmailComposerModal({ lead, onClose }) {
  const templates = [
    { label: "Follow-up",    subject: `Following up — ${lead.service}`, body: `Hi ${lead.name},\n\nI wanted to follow up regarding your interest in ${lead.service}. Please let me know if you have any questions.\n\nBest regards` },
    { label: "Quotation",    subject: `Quotation — ${lead.service}`,     body: `Hi ${lead.name},\n\nPlease find attached our quotation for ${lead.service}. We look forward to working with you.\n\nBest regards` },
    { label: "Introduction", subject: `Welcome — ${lead.service}`,      body: `Hi ${lead.name},\n\nThank you for your interest in ${lead.service}. I'd love to schedule a quick call to discuss your needs.\n\nBest regards` },
    { label: "Re-engage",    subject: `Checking in — ${lead.service}`,  body: `Hi ${lead.name},\n\nI wanted to check in and see if you're still interested in ${lead.service}. Circumstances change and we'd love to help if the timing is right.\n\nBest regards` },
  ];
  const [subject, setSubject] = useState(templates[0].subject);
  const [body, setBody]       = useState(templates[0].body);
  const [copied, setCopied]   = useState(false);
  return (
    <ModalWrap title={`📧 Email Composer — ${lead.name}`} onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {templates.map(t => (
          <button key={t.label} onClick={() => { setSubject(t.subject); setBody(t.body); }}
            style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1.5px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", color: "#334155" }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>To</label>
        <input value={lead.email || "(no email)"} readOnly style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, background: "#f8fafc", color: "#64748b", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Body</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={7}
          style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {lead.email && (
          <a href={`mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
            style={{ padding: "8px 18px", background: "#3b82f6", color: "#fff", borderRadius: 7, fontSize: 12, fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            📤 Open in Mail
          </a>
        )}
        <button onClick={() => { navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          style={{ padding: "8px 18px", background: copied ? "#f0fdf4" : "#f8fafc", color: copied ? "#10b981" : "#334155", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          {copied ? "✅ Copied" : "📋 Copy"}
        </button>
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Import Modal — paste CSV to import leads
// ─────────────────────────────────────────────────────────────────────────────
function BulkImportModal({ onImport, onClose }) {
  const [csv, setCsv]     = useState("Name,Email,Phone,Service,Status,Source,Value\nAhmed Ali,ahmed@test.com,0501234567,Self Sponsored Visa,New Lead,Facebook,5000");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");

  const parse = () => {
    try {
      const lines = csv.trim().split("\n");
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
      const ALL_STATUSES_LOWER = ALL_PIPELINE_STAGES.map(s => s.toLowerCase());
      const leads = lines.slice(1).filter(l => l.trim()).map((line, i) => {
        // Handle quoted fields (simple CSV parse)
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g)?.map(v => v.replace(/^"|"$/g, "").trim()) || line.split(",").map(v => v.trim());
        const obj = {};
        headers.forEach((h, j) => { obj[h] = vals[j] || ""; });
        // Normalize status: find closest match, fall back to "New Lead"
        const rawStatus = obj.status || obj["lead status"] || "New Lead";
        const matchedStatus = ALL_PIPELINE_STAGES.find(s => s.toLowerCase() === rawStatus.toLowerCase()) || "New Lead";
        const today = new Date().toISOString().slice(0,10);
        return {
          id: `IMP_${Date.now()}_${i}`,
          name: obj.name || obj["full name"] || "Unknown",
          email: obj.email || "",
          phone: obj.phone || obj["phone number"] || "",
          service: obj.service || "Self Sponsored Visa",
          status: matchedStatus,
          source: obj.source || "Other",
          value: Number(obj.value) || 0,
          date: today,
          updatedAt: today,
          timeline: [{ date: today, text: "Imported via CSV" }],
          tags: [],
          callLog: [],
          quickNotes: [],
        };
      }).filter(l => l.name && l.name !== "Unknown");
      setPreview(leads);
      setError("");
    } catch(e) { setError("Invalid CSV format. Check your data and try again."); setPreview([]); }
  };

  return (
    <ModalWrap title="📥 Bulk Import Leads" onClose={onClose} width={600}>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>Paste CSV with columns: Name, Email, Phone, Service, Status, Source, Value</p>
      <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={6}
        style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 11, fontFamily: "monospace", outline: "none", boxSizing: "border-box", marginBottom: 10, resize: "vertical" }} />
      <button onClick={parse} style={{ padding: "7px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 14 }}>Preview ({csv.trim().split("\n").length - 1} rows)</button>
      {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>⚠ {error}</div>}
      {preview.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>Preview — {preview.length} leads</div>
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 14 }}>
            {preview.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "7px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 11 }}>
                <span style={{ fontWeight: 600, color: "#334155", flex: 1 }}>{l.name}</span>
                <span style={{ color: "#64748b" }}>{l.service}</span>
                <span style={{ color: "#94a3b8" }}>{l.status}</span>
                <span style={{ color: "#10b981", fontWeight: 600 }}>AED {l.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <button onClick={() => onImport(preview)} style={{ padding: "8px 22px", background: "#10b981", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            ✓ Import {preview.length} Leads
          </button>
        </>
      )}
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Note Modal
// ─────────────────────────────────────────────────────────────────────────────
function QuickNoteModal({ lead, onSave, onClose }) {
  const [note, setNote] = useState("");
  return (
    <ModalWrap title={`📝 Quick Note — ${lead.name}`} onClose={onClose} width={420}>
      {(lead.quickNotes || []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 8 }}>Previous Notes</div>
          <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {[...(lead.quickNotes || [])].reverse().map((n, i) => (
              <div key={i} style={{ background: "#fffbeb", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}>
                <span style={{ color: "#94a3b8", marginRight: 6 }}>{n.date}</span>
                <span style={{ color: "#334155" }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Type a quick note…" rows={4} autoFocus
        style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { if (note.trim()) { onSave(note.trim()); onClose(); } }} disabled={!note.trim()}
          style={{ padding: "8px 20px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: note.trim() ? "pointer" : "not-allowed", opacity: note.trim() ? 1 : 0.5 }}>
          Save Note
        </button>
        <button onClick={onClose} style={{ padding: "8px 14px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 12, cursor: "pointer", color: "#64748b" }}>Cancel</button>
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Call Scheduler Modal
// ─────────────────────────────────────────────────────────────────────────────
function CallSchedulerModal({ lead, onSave, onClose }) {
  const [date, setDate]   = useState(new Date(Date.now() + 86400000).toISOString().slice(0,10));
  const [time, setTime]   = useState("10:00");
  const [note, setNote]   = useState("");
  const quickDates = [
    { label: "Today",     days: 0 },
    { label: "Tomorrow",  days: 1 },
    { label: "In 3 days", days: 3 },
    { label: "Next week", days: 7 },
  ];
  const setQuick = (days) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0,10));
  };
  return (
    <ModalWrap title={`📅 Schedule Call — ${lead.name}`} onClose={onClose} width={420}>
      {lead.phone && (
        <div style={{ background: "#f0fdf4", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#166534", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          📞 <span style={{ fontWeight: 600 }}>{lead.phone}</span>
          <a href={`tel:${lead.phone}`} style={{ marginLeft: "auto", color: "#10b981", fontWeight: 700, fontSize: 11, textDecoration: "none" }}>Call now →</a>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {quickDates.map(q => (
          <button key={q.label} onClick={() => setQuick(q.days)}
            style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "1.5px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", color: "#334155" }}>
            {q.label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Call Agenda</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="What to discuss…"
          style={{ width: "100%", padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
      </div>
      <button onClick={() => { onSave(date, note ? `[${time}] ${note}` : `Call at ${time}`); onClose(); }}
        style={{ padding: "8px 22px", background: "#10b981", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        📅 Schedule Call
      </button>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead Compare Modal — side-by-side 2-lead comparison
// ─────────────────────────────────────────────────────────────────────────────
function LeadCompareModal({ leads, onClose }) {
  const [a, b] = leads;
  const fields = [
    { label: "Status",      fn: l => l.status },
    { label: "Service",     fn: l => l.service },
    { label: "Value",       fn: l => `AED ${(l.value||0).toLocaleString()}`, num: l => l.value||0 },
    { label: "Priority",    fn: l => l.priority || "—" },
    { label: "Source",      fn: l => l.source || "—" },
    { label: "Score",       fn: l => `${scoreLead(l)} ${scoreLabel(scoreLead(l))}`, num: l => scoreLead(l) },
    { label: "Health",      fn: l => `${getHealthScore(l)}%`, num: l => getHealthScore(l) },
    { label: "Days in Stage", fn: l => `${getDaysInStage(l)}d`, num: l => -getDaysInStage(l) },
    { label: "Assigned",    fn: l => l.assignedTo || "—" },
    { label: "Follow-up",   fn: l => l.followUpDate || "—" },
    { label: "Date Added",  fn: l => l.date || "—" },
    { label: "Notes",       fn: l => l.notes ? (l.notes.length > 40 ? l.notes.slice(0,40) + "…" : l.notes) : "—" },
  ];
  const winner = (field) => {
    if (!field.num) return null;
    const av = field.num(a), bv = field.num(b);
    if (av === bv) return null;
    return av > bv ? "a" : "b";
  };
  return (
    <ModalWrap title="⚖ Lead Comparison" onClose={onClose} width={600}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 0 }}>
        <div />
        {[a, b].map(l => (
          <div key={l.id} style={{ textAlign: "center", padding: "10px 14px", background: "#f8fafc", borderRadius: 8, margin: "0 4px 12px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{l.name}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{l.id}</div>
          </div>
        ))}
        {fields.map(f => {
          const w = winner(f);
          return [
            <div key={f.label + "_l"} style={{ fontSize: 11, fontWeight: 600, color: "#64748b", padding: "7px 0", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center" }}>{f.label}</div>,
            ...[a,b].map((l, i) => {
              const isWinner = w === (i === 0 ? "a" : "b");
              return (
                <div key={f.label + i} style={{ fontSize: 12, padding: "7px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "center", background: isWinner ? "#f0fdf4" : "transparent", color: isWinner ? "#10b981" : "#334155", fontWeight: isWinner ? 700 : 400, margin: "0 4px" }}>
                  {f.fn(l)}{isWinner ? " ✓" : ""}
                </div>
              );
            })
          ];
        })}
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Picker Modal
// ─────────────────────────────────────────────────────────────────────────────
function ColumnPickerModal({ cols, visibility, onChange, onClose }) {
  const toggle = (key) => onChange(prev => ({ ...prev, [key]: prev[key] === false }));
  const visibleCount = cols.filter(c => visibility[c.key] !== false && c.label).length;
  return (
    <ModalWrap title="🗂 Column Visibility" onClose={onClose} width={400}>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>{visibleCount} of {cols.filter(c=>c.label).length} columns visible</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {cols.filter(c => c.label).map(c => {
          const visible = visibility[c.key] !== false;
          return (
            <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${visible ? "#3b82f6" : "#e2e8f0"}`, background: visible ? "#eff6ff" : "#f8fafc", cursor: "pointer" }}>
              <input type="checkbox" checked={visible} onChange={() => toggle(c.key)} style={{ accentColor: "#3b82f6", width: 13, height: 13 }} />
              <span style={{ fontSize: 12, fontWeight: visible ? 600 : 400, color: visible ? "#1d4ed8" : "#64748b" }}>{c.label}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => onChange({})} style={{ padding: "7px 16px", background: "#f0fdf4", color: "#10b981", border: "1.5px solid #bbf7d0", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Show All</button>
        <button onClick={() => {
          const hidden = {};
          cols.filter(c => c.label).forEach(c => { hidden[c.key] = false; });
          onChange(hidden);
        }} style={{ padding: "7px 16px", background: "#fef2f2", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Hide All</button>
      </div>
    </ModalWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Tag Picker — click to open, multi-select, click outside to close
// ─────────────────────────────────────────────────────────────────────────────
function InlineTagPicker({ lead, tagOptions, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const tags = lead.tags || [];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (t) => {
    const next = tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t];
    onChange(next);
  };

  return (
    <div ref={ref} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", gap: 3, flexWrap: "wrap", minHeight: 22, cursor: "pointer", padding: "2px 4px", borderRadius: 6, border: "1.5px solid #e2e8f0", background: open ? "#f8fafc" : "transparent", transition: "border-color 0.15s" }}
      >
        {tags.length === 0
          ? <span style={{ color: "#94a3b8", fontSize: 10, lineHeight: "18px" }}>+ tags</span>
          : tags.map(t => (
            <span key={t} style={{ fontSize: 9, background: "#e0e7ff", color: "#4338ca", borderRadius: 4, padding: "1px 5px", fontWeight: 600, lineHeight: "16px" }}>{t}</span>
          ))}
      </div>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 9999, background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.13)", padding: 10, minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Select Tags</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(tagOptions || []).map(t => {
              const active = tags.includes(t);
              return (
                <label key={t} onClick={() => toggle(t)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, background: active ? "#ede9fe" : "#f8fafc", border: `1.5px solid ${active ? "#8b5cf6" : "#e2e8f0"}`, cursor: "pointer", transition: "all 0.12s" }}>
                  <span style={{ width: 13, height: 13, borderRadius: 4, border: `2px solid ${active ? "#8b5cf6" : "#cbd5e1"}`, background: active ? "#8b5cf6" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {active && <span style={{ color: "#fff", fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? "#4c1d95" : "#334155" }}>{t}</span>
                </label>
              );
            })}
          </div>
          {tags.length > 0 && (
            <button onClick={() => onChange([])} style={{ marginTop: 8, width: "100%", padding: "4px 0", background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Clear {tags.length} selected</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Search Modal (CMD+K)
// ─────────────────────────────────────────────────────────────────────────────
function GlobalSearchModal({ leads, onClose, onOpenLead }) {
  const [q, setQ] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase();
    return leads.filter(l =>
      (l.name  || "").toLowerCase().includes(lower) ||
      (l.phone || "").toLowerCase().includes(lower) ||
      (l.email || "").toLowerCase().includes(lower) ||
      (l.whatsapp || "").toLowerCase().includes(lower) ||
      (l.status || "").toLowerCase().includes(lower) ||
      (l.service || "").toLowerCase().includes(lower) ||
      (l.source || "").toLowerCase().includes(lower) ||
      (l.assignedTo || "").toLowerCase().includes(lower) ||
      (l.notes || "").toLowerCase().includes(lower) ||
      (l.nationality || "").toLowerCase().includes(lower) ||
      (l.tags || []).some(t => t.toLowerCase().includes(lower))
    ).slice(0, 12);
  }, [q, leads]);

  // Highlight matching text
  const highlight = (text, query) => {
    if (!query.trim() || !text) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <span>
        {text.slice(0, idx)}
        <mark style={{ background: "#fef08a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </span>
    );
  };

  useEffect(() => { setSelectedIdx(0); }, [results.length]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) { onOpenLead(results[selectedIdx]); onClose(); }
    if (e.key === "Escape") { onClose(); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,8,23,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 600, maxWidth: "95vw", background: "#fff", borderRadius: 16, boxShadow: "0 32px 80px rgba(0,0,0,0.25)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #f1f5f9" }}>
          <i className="ti ti-search" aria-hidden style={{ fontSize: 18, color: "#94a3b8", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search leads by name, phone, email, nationality, tag…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontFamily: "inherit", color: "#0f172a", background: "transparent" }}
          />
          {q.trim() && results.length > 0 && (
            <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, background: "#f1f5f9", borderRadius: 5, padding: "2px 7px", flexShrink: 0 }}>{results.length}</span>
          )}
          {q.trim() && (
            <button onClick={() => setQ("")} style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}>✕</button>
          )}
          {!q.trim() && (
            <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", borderRadius: 5, padding: "2px 7px", fontWeight: 600, flexShrink: 0 }}>ESC</span>
          )}
        </div>
        {q.trim() === "" && (
          <div style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Quick tips</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                ["📞", "Search by phone or WhatsApp number"],
                ["🌍", "Search by nationality (e.g. Filipino, Indian)"],
                ["💼", "Search by service (e.g. Visa, Loan, Wedding)"],
                ["🏷", "Search by tag (e.g. VIP, Urgent)"],
                ["👤", "Search by assigned staff name"],
              ].map(([icon, tip]) => (
                <div key={tip} style={{ fontSize: 12, color: "#64748b", display: "flex", gap: 8 }}>
                  <span>{icon}</span><span>{tip}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {q.trim() !== "" && results.length === 0 && (
          <div style={{ padding: "28px 18px", textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
              <i className="ti ti-search-off" style={{ fontSize: 22, color: "#94a3b8" }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 4 }}>No results for "{q}"</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Try a phone number, nationality, service type, or tag</div>
          </div>
        )}
        {results.map((r, idx) => (
          <div key={r.id} onClick={() => { onOpenLead(r); onClose(); }}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", cursor: "pointer", borderBottom: "1px solid #f8fafc", background: idx === selectedIdx ? "#f0f7ff" : "transparent", transition: "background 0.1s" }}
            onMouseEnter={() => setSelectedIdx(idx)}
          >
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#2563eb", flexShrink: 0 }}>
              {(r.name || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{highlight(r.name, q)}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {r.phone && <span>{highlight(r.phone, q)}</span>}
                {r.service && <span>· {highlight(r.service, q)}</span>}
                {r.nationality && <span>· {highlight(r.nationality, q)}</span>}
                {r.assignedTo && <span>· {highlight(r.assignedTo, q)}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexShrink: 0, alignItems: "center" }}>
              {r.priority && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: PRIORITY_COLORS[r.priority] + "18", color: PRIORITY_COLORS[r.priority] }}>{r.priority}</span>}
              <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 5, background: "#f1f5f9", color: "#475569" }}>{r.status}</span>
            </div>
          </div>
        ))}
        {results.length > 0 && (
          <div style={{ padding: "8px 18px", fontSize: 10, color: "#94a3b8", background: "#fafbfe", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ display: "flex", gap: 10 }}>
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>ESC close</span>
            </span>
            <span style={{ fontWeight: 600, color: "#475569" }}>{results.length} result{results.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared modal wrapper
// ─────────────────────────────────────────────────────────────────────────────
function ModalWrap({ title, onClose, width = 520, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", fontSize: 14, cursor: "pointer", color: "#64748b", lineHeight: 1, width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.12s, color 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.color = "#ef4444"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#64748b"; }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
