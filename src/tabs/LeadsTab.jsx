import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId } from "../helpers";
import { useAppData } from "../context/AppContext";
import {
  scoreLead,
  scoreLabel,
  findDuplicates,
  getPipelineStats,
  getStaleLeads,
  getLostReasons,
  PIPELINE_STAGES,
} from "../services/crmEngine";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

// ─── Tab view cache (persists display mode across tab switches) ────────────────
const VIEW_CACHE_KEY = "leadsTab_displayMode";
function getCachedView() {
  try { return sessionStorage.getItem(VIEW_CACHE_KEY) || "table"; } catch { return "table"; }
}
function setCachedView(v) {
  try { sessionStorage.setItem(VIEW_CACHE_KEY, v); } catch {}
}

// ─── Field definitions ─────────────────────────────────────────────────────────
const SERVICE_OPTIONS  = ["UAE Visa", "Business License", "Employment Visa", "Business Setup", "Freezone License"];
const STATUS_OPTIONS   = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
const SOURCE_OPTIONS   = ["Facebook", "Google", "Referral", "Instagram", "Walk-in", "Other"];
const LOST_OPTIONS     = ["", "Price", "Competitor", "No response", "Changed mind", "Other"];
const PRIORITY_OPTIONS = ["", "Low", "Medium", "High", "VIP"];
const STAFF_OPTIONS    = ["", "Ahmed", "Sarah", "Omar", "Layla", "Other"];

// ─── Follow-up status helper ───────────────────────────────────────────────────
function getFollowUpStatus(followUpDate) {
  if (!followUpDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(followUpDate); due.setHours(0, 0, 0, 0);
  const diff  = (due - today) / 86_400_000;
  if (diff < 0)   return { label: `Overdue ${Math.abs(Math.round(diff))}d`, color: "#ef4444", bg: "#fef2f2", icon: "🔴" };
  if (diff === 0) return { label: "Today",   color: "#f59e0b", bg: "#fffbeb", icon: "🟡" };
  if (diff <= 3)  return { label: `In ${Math.round(diff)}d`, color: "#3b82f6", bg: "#eff6ff", icon: "🔵" };
  return { label: followUpDate, color: "#10b981", bg: "#f0fdf4", icon: "🟢" };
}

// ─── Lead health score ─────────────────────────────────────────────────────────
function getHealthScore(lead) {
  let score = 0;
  if (lead.followUpDate) score += 20;
  if (lead.notes && lead.notes.length > 10) score += 20;
  if (lead.email || lead.phone) score += 20;
  if (lead.assignedTo) score += 20;
  const fu = getFollowUpStatus(lead.followUpDate);
  if (!fu || fu.color !== "#ef4444") score += 20; // no overdue
  return score;
}
function getHealthLabel(score) {
  if (score >= 80) return { label: "Healthy", color: "#10b981" };
  if (score >= 40) return { label: "Needs Attention", color: "#f59e0b" };
  return { label: "Neglected", color: "#ef4444" };
}

// ─── Stage age helper ──────────────────────────────────────────────────────────
function getDaysInStage(lead) {
  const ref = lead.updatedAt || lead.date;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000);
}

// ─── Next action suggestions ───────────────────────────────────────────────────
function getNextAction(lead) {
  const fu = getFollowUpStatus(lead.followUpDate);
  if (fu && fu.color === "#ef4444") return { icon: "📞", text: "Call — overdue follow-up" };
  if (lead.status === "New") return { icon: "📞", text: "Call client" };
  if (lead.status === "Contacted") return { icon: "📄", text: "Send proposal" };
  if (lead.status === "Qualified") return { icon: "💬", text: "WhatsApp reminder" };
  if (lead.status === "Proposal") return { icon: "📞", text: "Follow up on proposal" };
  if (lead.status === "Won") return { icon: "🪪", text: "Request documents" };
  if (lead.status === "Lost") return { icon: "💬", text: "Re-engage in 30 days" };
  return null;
}

// ─── Temperature auto-decay ────────────────────────────────────────────────────
function getTemperature(lead) {
  const days = getDaysInStage(lead);
  const fu = getFollowUpStatus(lead.followUpDate);
  let temp = 100;
  // Decay by inactivity
  temp -= Math.min(50, days * 2);
  // Boost for recent follow-up
  if (fu && fu.color === "#10b981") temp += 15;
  if (fu && fu.color === "#3b82f6") temp += 8;
  if (fu && fu.color === "#ef4444") temp -= 20;
  // Boost for high priority
  if (lead.priority === "VIP") temp += 20;
  if (lead.priority === "High") temp += 10;
  // Boost for value
  if (lead.value > 10000) temp += 10;
  // Boost for recent contact
  if (lead.lastContacted) {
    const d = Math.floor((Date.now() - new Date(lead.lastContacted)) / 86400000);
    if (d <= 1) temp += 15;
    else if (d <= 3) temp += 8;
    else temp -= d;
  }
  return Math.max(0, Math.min(100, Math.round(temp)));
}
function getTempLabel(t) {
  if (t >= 75) return { label: "🔥 Hot",   color: "#ef4444", bg: "#fef2f2" };
  if (t >= 45) return { label: "🌡 Warm",  color: "#f59e0b", bg: "#fffbeb" };
  if (t >= 20) return { label: "❄ Cool",   color: "#3b82f6", bg: "#eff6ff" };
  return             { label: "🧊 Cold",   color: "#94a3b8", bg: "#f8fafc" };
}

// ─── SLA / Response Timer ──────────────────────────────────────────────────────
function getSLAStatus(lead) {
  const ref = lead.lastContacted || lead.date;
  if (!ref) return null;
  const hours = Math.floor((Date.now() - new Date(ref)) / 3600000);
  if (lead.status === "Won" || lead.status === "Lost") return null;
  if (hours < 24)  return { label: `${hours}h ago`, color: "#10b981", bg: "#f0fdf4", urgent: false };
  if (hours < 48)  return { label: `${Math.floor(hours/24)}d ago`, color: "#f59e0b", bg: "#fffbeb", urgent: false };
  return { label: `${Math.floor(hours/24)}d — SLA breach`, color: "#ef4444", bg: "#fef2f2", urgent: true };
}

// ─── Tag options ───────────────────────────────────────────────────────────────
const TAG_OPTIONS = ["VIP", "Urgent", "Arabic speaker", "Needs callback", "Cold lead", "Government", "Returning"];

const ADD_FIELDS = [
  { key: "name",       label: "Name",                      placeholder: "Full name" },
  { key: "email",      label: "Email",      type: "email" },
  { key: "phone",      label: "Phone",                      placeholder: "+971 50 000 0000" },
  { key: "service",    label: "Service",    type: "select", options: SERVICE_OPTIONS,  default: "UAE Visa" },
  { key: "status",     label: "Status",     type: "select", options: STATUS_OPTIONS,   default: "New" },
  { key: "priority",   label: "Priority",   type: "select", options: PRIORITY_OPTIONS, default: "" },
  { key: "assignedTo", label: "Assigned To",type: "select", options: STAFF_OPTIONS,    default: "" },
  { key: "value",      label: "Value (AED)",type: "number", placeholder: "0" },
  { key: "source",     label: "Source",     type: "select", options: SOURCE_OPTIONS,   default: "Other" },
  { key: "lostReason", label: "Lost Reason (if lost)", type: "select", options: LOST_OPTIONS, default: "" },
  { key: "notes",      label: "Notes",                      placeholder: "Optional notes" },
];

// Edit fields include all Add fields (same set)
const EDIT_FIELDS = ADD_FIELDS;

// ─── Color maps ────────────────────────────────────────────────────────────────
const SCORE_COLORS = { Hot: B.red, Warm: B.orange, Cold: B.blue };
const PRIORITY_COLORS = { VIP: "#7c3aed", High: "#ef4444", Medium: "#f59e0b", Low: "#64748b" };
const STAGE_COLORS = {
  New: "#6366f1", Contacted: "#f59e0b", Qualified: "#3b82f6",
  Proposal: "#8b5cf6", Won: "#10b981", Lost: "#ef4444",
};

// ─── Styles ────────────────────────────────────────────────────────────────────
const pill = (color, bg) => ({
  display: "inline-flex", alignItems: "center",
  padding: "2px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700,
  color: color, background: bg,
  letterSpacing: 0.3, whiteSpace: "nowrap",
});

const inlineSelect = (accent) => ({
  fontSize: 11, border: `1.5px solid ${accent}40`,
  borderRadius: 6, padding: "3px 6px",
  fontFamily: "inherit", background: accent + "0d",
  color: accent, fontWeight: 600, cursor: "pointer",
  width: "100%", outline: "none",
  transition: "border-color 0.15s",
});

const actionBtn = (color, bg) => ({
  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
  border: `1px solid ${color}40`, background: bg,
  color: color, cursor: "pointer", fontFamily: "inherit",
  transition: "opacity 0.15s",
  whiteSpace: "nowrap",
});

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ viewMode, search }) {
  const { data, setData } = useAppData();

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
  const [autoRulesAlert,   setAutoRulesAlert]   = useState(null);
  const [bulkSelected,   setBulkSelected]   = useState(new Set());
  const [bulkTarget,     setBulkTarget]     = useState("");
  const [bulkAssign,     setBulkAssign]     = useState("");
  const [bulkTag,        setBulkTag]        = useState("");
  const [hoverLead,      setHoverLead]      = useState(null);
  const [hoverPos,       setHoverPos]       = useState({ x: 0, y: 0 });

  const leads        = data.leads;
  const statuses     = ["All", ...PIPELINE_STAGES];
  const dupeIds      = useMemo(() => findDuplicates(leads),    [leads]);
  const staleLeads   = useMemo(() => getStaleLeads(leads),     [leads]);
  const pipelineStats= useMemo(() => getPipelineStats(leads),  [leads]);
  const lostReasons  = useMemo(() => getLostReasons(leads),    [leads]);

  // ── Filtered rows ────────────────────────────────────────────────────────────
  let rows = filter === "All" ? leads : leads.filter((l) => l.status === filter);
  // Archived filter
  rows = showArchived ? rows.filter(l => l.archived) : rows.filter(l => !l.archived);
  if (staffFilter !== "All")    rows = rows.filter(l => (l.assignedTo || "") === staffFilter);
  if (priorityFilter !== "All") rows = rows.filter(l => (l.priority   || "") === priorityFilter);
  if (tagFilter !== "All")      rows = rows.filter(l => (l.tags || []).includes(tagFilter));
  if (showDupesOnly) rows = rows.filter((l) => dupeIds.has(l.id));
  if (showStaleOnly) rows = rows.filter((l) => staleLeads.some((s) => s.id === l.id));
  rows = filterSearch(rows, search, ["name", "email", "phone", "service", "source", "notes"]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  /** Update a single field on a lead by its row index within the current filtered view */
  const handleChange = (ri, key, val) => {
    const leadId = rows[ri]?.id;
    if (!leadId) return;
    const lead = data.leads.find(l => l.id === leadId);
    const today = new Date().toISOString().slice(0, 10);
    let timelineEntry = null;
    if (key === "status" && lead?.status !== val)
      timelineEntry = { date: today, text: `Status changed: ${lead.status} → ${val}` };
    else if (key === "assignedTo" && lead?.assignedTo !== val)
      timelineEntry = { date: today, text: `Assigned to ${val || "nobody"}` };
    else if (key === "value" && lead?.value !== Number(val))
      timelineEntry = { date: today, text: `Value updated: ${aed(lead.value)} → ${aed(Number(val))}` };
    const updated = data.leads.map(l => {
      if (l.id !== leadId) return l;
      const timeline = timelineEntry ? [...(l.timeline || []), timelineEntry] : (l.timeline || []);
      return { ...l, [key]: val, updatedAt: today, timeline };
    });
    setData({ ...data, leads: updated });
  };

  const handleDelete = (ri) => {
    const leadId = rows[ri]?.id;
    if (!leadId) return;
    if (!window.confirm("Delete this lead?")) return;
    setData({ ...data, leads: data.leads.filter(l => l.id !== leadId) });
  };

  /** Add new lead — always honour the form values for status & service */
  const handleAdd = (vals) => {
    const today = new Date().toISOString().slice(0, 10);
    const newLead = {
      id:         nextId("L"),
      lostReason: "",
      status:  "New",
      service: "UAE Visa",
      source:  "Other",
      ...vals,
      value:   Number(vals.value) || 0,
      date:    today,
      updatedAt: today,
      timeline: [{ date: today, text: "Lead created" }],
      tags: [],
      callLog: [],
    };
    setData({ ...data, leads: [...data.leads, newLead] });
  };

  /** Save all edits from the edit modal */
  const handleEditSave = (vals, timelineEntries = []) => {
    if (!editLead) return;
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l => {
      if (l.id !== editLead.id) return l;
      const timeline = [...(l.timeline || []), ...timelineEntries];
      return { ...l, ...vals, value: Number(vals.value) || 0, updatedAt: today, timeline };
    });
    setData({ ...data, leads: updated });
    setEditLead(null);
  };

  const handleArchiveLead = (lead) => {
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, archived: !l.archived, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: l.archived ? "Lead restored from archive" : "Lead archived" }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleSnooze = (lead, days) => {
    const today = new Date();
    today.setDate(today.getDate() + days);
    const snoozeDate = today.toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, followUpDate: snoozeDate, snoozedUntil: snoozeDate, updatedAt: new Date().toISOString().slice(0,10), timeline: [...(l.timeline||[]), { date: new Date().toISOString().slice(0,10), text: `Snoozed ${days} day(s) — follow-up set to ${snoozeDate}` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  // Auto Status Rules — run whenever leads change
  const runAutoRules = useCallback((leads) => {
    const today = new Date().toISOString().slice(0, 10);
    let changed = 0;
    const updated = leads.map(l => {
      // Auto-move to Lost if overdue 30+ days and still New
      const days = getDaysInStage(l);
      if (l.status === "New" && days >= 30 && !l.archived) {
        changed++;
        return { ...l, status: "Lost", lostReason: "No response", updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: "Auto-moved to Lost: 30 days no activity" }] };
      }
      // Auto-escalate priority if Won stage > 7 days without conversion
      if (l.status === "Won" && days >= 7 && l.priority !== "VIP" && !l.archived) {
        changed++;
        return { ...l, priority: "VIP", updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: "Auto-escalated to VIP: Won for 7+ days" }] };
      }
      return l;
    });
    if (changed > 0) {
      setData(d => ({ ...d, leads: updated }));
      setAutoRulesAlert(`Auto-rules applied: ${changed} lead(s) updated`);
      setTimeout(() => setAutoRulesAlert(null), 4000);
    }
  }, []);

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
    const updated = data.leads.map(l => {
      if (l.id !== leadId) return l;
      const docs = { ...(l.docChecklist || {}) };
      docs[item] = checked;
      return { ...l, docChecklist: docs };
    });
    setData({ ...data, leads: updated });
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
    const sel = data.leads.filter(l => bulkSelected.has(l.id));
    const csv = ["ID,Name,Email,Phone,Status,Service,Value,Source,Priority,Assigned,Follow-up",
      ...sel.map(l => [l.id,l.name,l.email,l.phone,l.status,l.service,l.value,l.source,l.priority||"",l.assignedTo||"",l.followUpDate||""].join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "leads_export.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleReopenLead = (lead, reason) => {
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      l.id === lead.id ? { ...l, status: "New", lostReason: "", updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Lead reopened — ${reason}` }] } : l
    );
    setData({ ...data, leads: updated });
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
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, callLog: [...(l.callLog||[]), { date: today, note: callNote }], lastContacted: today, timeline: [...(l.timeline||[]), { date: today, text: `📞 Call logged: ${callNote}` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleSaveFilter = () => {
    const name = window.prompt("Name this filter:");
    if (!name) return;
    const newFilter = { name, status: filter, staff: staffFilter, priority: priorityFilter, tag: tagFilter };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    try { localStorage.setItem("crm_saved_filters", JSON.stringify(updated)); } catch {}
  };

  const applyFilter = (f) => {
    setFilter(f.status); setStaffFilter(f.staff); setPriorityFilter(f.priority); setTagFilter(f.tag || "All");
    setShowSavedFilters(false);
  };

  const handleConvertToClient = (lead) => {
    const already = data.clients?.some(c => c.name === lead.name || c.email === lead.email);
    if (already) { alert(`${lead.name} is already a client.`); return; }
    const today = new Date().toISOString().slice(0,10);
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
      l.id === lead.id ? { ...l, status: "Won", updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: "Converted to client 🎉" }] } : l
    );
    setData({ ...data, clients: [...(data.clients || []), newClient], leads: updatedLeads });
    alert(`✅ ${lead.name} converted to client successfully!`);
  };

  const handleMergeDupes = () => {
    const seen = new Map();
    const toRemove = new Set();
    data.leads.forEach(l => {
      const key = (l.email || l.phone || "").toLowerCase().trim();
      if (!key) return;
      if (seen.has(key)) toRemove.add(l.id);
      else seen.set(key, l.id);
    });
    if (toRemove.size === 0) { alert("No duplicates to merge."); return; }
    if (!window.confirm(`Remove ${toRemove.size} duplicate lead(s)?`)) return;
    setData({ ...data, leads: data.leads.filter(l => !toRemove.has(l.id)) });
  };

  const handleKanbanDrop = (leadId, newStatus) => {
    const lead = data.leads.find(l => l.id === leadId);
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map((l) =>
      l.id === leadId ? { ...l, status: newStatus, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Status changed: ${lead?.status} → ${newStatus}` }] } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleBulkMove = () => {
    if (!bulkTarget || bulkSelected.size === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const updated = data.leads.map(l =>
      bulkSelected.has(l.id) ? { ...l, status: bulkTarget, updatedAt: today, timeline: [...(l.timeline||[]), { date: today, text: `Status changed to ${bulkTarget} (bulk)` }] } : l
    );
    setData({ ...data, leads: updated });
    setBulkSelected(new Set());
    setBulkTarget("");
  };

  const toggleBulkSelect = (id) => {
    const next = new Set(bulkSelected);
    next.has(id) ? next.delete(id) : next.add(id);
    setBulkSelected(next);
  };

  // ── Table columns ─────────────────────────────────────────────────────────────
  const cols = [
    {
      key: "_sel", label: "", width: 36,
      render: (_, r) => (
        <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={() => toggleBulkSelect(r.id)}
          style={{ accentColor: B.blue, cursor: "pointer", width: 14, height: 14 }} />
      ),
    },
    { key: "id", label: "ID", width: 68 },
    {
      key: "name", label: "Name", width: 155,
      render: (v, r) => (
        <div
          style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }}
          onMouseEnter={e => { setHoverLead(r); setHoverPos({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={e => setHoverPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoverLead(null)}
        >
          {dupeIds.has(r.id) && (
            <span title="Potential duplicate" style={{ color: B.orange, fontWeight: 700, fontSize: 10 }}>⚠</span>
          )}
          <span
            style={{ color: B.blue, cursor: "pointer", fontWeight: 600, fontSize: 12, textDecoration: "underline dotted" }}
            onClick={e => { e.stopPropagation(); setDetailLead(r); setHoverLead(null); }}
          >{v}</span>
        </div>
      ),
    },
    {
      key: "service", label: "Service", width: 165,
      render: (v, r, ri) => (
        <select
          value={v || "UAE Visa"}
          onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "service", e.target.value)}
          style={inlineSelect("#64748b")}
        >
          {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ),
    },
    {
      key: "status", label: "Status", width: 130,
      render: (v, r, ri) => {
        const color = STAGE_COLORS[v] || B.border;
        return (
          <select
            value={v || "New"}
            onClick={e => e.stopPropagation()}
            onChange={e => handleChange(ri, "status", e.target.value)}
            style={inlineSelect(color)}
          >
            {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    {
      key: "score", label: "Score", width: 82,
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
    { key: "value",  label: "Value",   width: 105, render: (v) => <span style={{ fontWeight: 600, fontSize: 12 }}>{aed(v)}</span>, xlRender: (v) => aed(v) },
    { key: "source", label: "Source",  width: 95 },
    { key: "date",   label: "Date",    width: 95 },
    {
      key: "stale", label: "Follow-up", width: 115,
      render: (_, r) => {
        const fu = getFollowUpStatus(r.followUpDate);
        if (fu) return (
          <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>
        );
        const isStale = staleLeads.some((s) => s.id === r.id);
        return isStale
          ? <span style={pill(B.orange, B.orange + "15")}>⏰ Due</span>
          : <span style={{ color: B.muted, fontSize: 11 }}>—</span>;
      },
    },
    {
      key: "priority", label: "Priority", width: 85,
      render: (v, r, ri) => {
        const color = PRIORITY_COLORS[v] || B.muted;
        return (
          <select value={v || ""} onClick={e => e.stopPropagation()}
            onChange={e => handleChange(ri, "priority", e.target.value)}
            style={inlineSelect(v ? color : "#94a3b8")}>
            {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
          </select>
        );
      },
    },
    {
      key: "assignedTo", label: "Assigned", width: 105,
      render: (v, r, ri) => (
        <select value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "assignedTo", e.target.value)}
          style={inlineSelect("#64748b")}>
          {STAFF_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
        </select>
      ),
    },
    { key: "lostReason", label: "Lost Reason", width: 115, render: (v) => v ? <span style={{ fontSize: 11 }}>{v}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span> },
    {
      key: "_health", label: "Health", width: 110,
      render: (_, r) => {
        const s = getHealthScore(r); const h = getHealthLabel(s);
        return <span style={pill(h.color, h.color + "15")}>{s}% {h.label}</span>;
      },
    },
    {
      key: "_nextAction", label: "Next Action", width: 160,
      render: (_, r) => {
        const na = getNextAction(r);
        return na ? <span style={{ fontSize: 11, color: "#334155" }}>{na.icon} {na.text}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span>;
      },
    },
    {
      key: "_stageAge", label: "Stage Age", width: 90,
      render: (_, r) => {
        const d = getDaysInStage(r);
        const color = d > 14 ? "#ef4444" : d > 7 ? "#f59e0b" : "#10b981";
        return <span style={pill(color, color + "15")}>{d}d</span>;
      },
    },
    {
      key: "_temperature", label: "Temp", width: 90,
      render: (_, r) => {
        const t = getTemperature(r); const tl = getTempLabel(t);
        return <span style={pill(tl.color, tl.bg)} title={`Temperature: ${t}/100`}>{tl.label}</span>;
      },
    },
    {
      key: "_sla", label: "Last Contact", width: 120,
      render: (_, r) => {
        const s = getSLAStatus(r);
        if (!s) return <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>;
        return <span style={pill(s.color, s.bg)}>{s.urgent ? "⚠ " : ""}{s.label}</span>;
      },
    },
    {
      key: "estimatedClose", label: "Est. Close", width: 110,
      render: (v, r, ri) => (
        <input type="date" value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "estimatedClose", e.target.value)}
          style={{ fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 4px", fontFamily: "inherit", background: "transparent", color: "#334155", width: "100%" }} />
      ),
    },
    {
      key: "_tags", label: "Tags", width: 160,
      render: (_, r) => (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {(r.tags || []).map(t => (
            <span key={t} style={{ fontSize: 9, background: "#e0e7ff", color: "#4338ca", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{t}</span>
          ))}
        </div>
      ),
    },
    { key: "email", label: "Email",  width: 175 },
    { key: "phone", label: "Phone",  width: 140 },
    { key: "notes", label: "Notes",  width: 195 },
    {
      key: "_actions", label: "", width: 160,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button onClick={e => { e.stopPropagation(); setEditLead(r); }} style={actionBtn(B.blue, B.blue + "12")} title="Edit lead">✏️ Edit</button>
          {r.phone && (
            <button onClick={e => { e.stopPropagation(); window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank"); }}
              style={actionBtn("#25d366", "#25d36612")} title="Open WhatsApp">💬</button>
          )}
          {r.status === "Won" && (
            <button onClick={e => { e.stopPropagation(); handleConvertToClient(r); }} style={actionBtn(B.green, B.green + "12")} title="Convert to client">↗</button>
          )}
          {r.status === "Lost" && (
            <button onClick={e => { e.stopPropagation(); const reason = window.prompt("Reopen reason?"); if (reason) handleReopenLead(r, reason); }}
              style={actionBtn("#7c3aed", "#7c3aed12")} title="Reopen lead">↩ Reopen</button>
          )}
          <button onClick={e => { e.stopPropagation(); handleArchiveLead(r); }}
            style={actionBtn(r.archived ? "#10b981" : "#94a3b8", r.archived ? "#f0fdf4" : "#f8fafc")} title={r.archived ? "Restore" : "Archive"}>
            {r.archived ? "↩" : "📦"}
          </button>
          <button onClick={e => { e.stopPropagation(); setShowAIAssist(r); }}
            style={actionBtn("#8b5cf6", "#ede9fe")} title="AI Assist">✨</button>
        </div>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0 }}>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }} className="stat-grid-6">
        {pipelineStats.slice(0, 5).map((s) => (
          <StatCard key={s.stage} label={s.stage} value={s.count} sub={aed(s.value)} color={STAGE_COLORS[s.stage]} />
        ))}
        <StatCard label="Dupes" value={dupeIds.size} color={dupeIds.size > 0 ? B.orange : B.green} sub={dupeIds.size > 0 ? "review needed" : "clean"} />
        <StatCard
          label="Overdue"
          value={leads.filter(l => { const fu = getFollowUpStatus(l.followUpDate); return fu && fu.color === "#ef4444"; }).length}
          color="#ef4444"
          sub="follow-ups"
          onClick={() => setShowReminderCenter(true)}
        />
      </div>

      {/* ── Auto-rules alert ── */}
      {autoRulesAlert && (
        <div style={{ background: "#f0fdf4", border: "1px solid #6ee7b7", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#065f46", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
          ⚡ {autoRulesAlert}
          <button onClick={() => setAutoRulesAlert(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>

        {/* Left: filters */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {statuses.map((s) => (
            <FilterBtn key={s} active={filter === s} label={`${s}${s !== "All" ? ` (${leads.filter(l=>l.status===s).length})` : ""}`} onClick={() => setFilter(s)} />
          ))}
          <div style={{ width: 1, height: 20, background: B.border, margin: "0 4px" }} />
          <FilterBtn active={showArchived} label={`📦 Archived (${leads.filter(l=>l.archived).length})`} onClick={() => setShowArchived(v => !v)} />
          <div style={{ width: 1, height: 20, background: B.border, margin: "0 4px" }} />
          <FilterBtn active={showDupesOnly} label={`⚠ Dupes (${dupeIds.size})`}      onClick={() => { setShowDupesOnly(!showDupesOnly); setShowStaleOnly(false); }} danger />
          <FilterBtn active={showStaleOnly} label={`⏰ Stale (${staleLeads.length})`} onClick={() => { setShowStaleOnly(!showStaleOnly); setShowDupesOnly(false); }} warn />
          <div style={{ width: 1, height: 20, background: B.border, margin: "0 4px" }} />
          {/* Staff filter */}
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
            style={{ fontSize: 11, border: `1.5px solid ${staffFilter !== "All" ? B.blue : B.border}`, borderRadius: 20, padding: "3px 10px", fontFamily: "inherit", background: staffFilter !== "All" ? B.blue + "12" : "#fff", color: staffFilter !== "All" ? B.blue : B.muted, fontWeight: staffFilter !== "All" ? 700 : 400, cursor: "pointer", outline: "none" }}>
            <option value="All">👤 All Staff</option>
            {STAFF_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Priority filter */}
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
            style={{ fontSize: 11, border: `1.5px solid ${priorityFilter !== "All" ? (PRIORITY_COLORS[priorityFilter] || B.border) : B.border}`, borderRadius: 20, padding: "3px 10px", fontFamily: "inherit", background: priorityFilter !== "All" ? (PRIORITY_COLORS[priorityFilter] || B.blue) + "12" : "#fff", color: priorityFilter !== "All" ? (PRIORITY_COLORS[priorityFilter] || B.blue) : B.muted, fontWeight: priorityFilter !== "All" ? 700 : 400, cursor: "pointer", outline: "none" }}>
            <option value="All">🎯 All Priority</option>
            {PRIORITY_OPTIONS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* Tag filter */}
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}
            style={{ fontSize: 11, border: `1.5px solid ${tagFilter !== "All" ? "#4338ca" : B.border}`, borderRadius: 20, padding: "3px 10px", fontFamily: "inherit", background: tagFilter !== "All" ? "#e0e7ff" : "#fff", color: tagFilter !== "All" ? "#4338ca" : B.muted, fontWeight: tagFilter !== "All" ? 700 : 400, cursor: "pointer", outline: "none" }}>
            <option value="All">🏷 All Tags</option>
            {TAG_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {/* Saved filters */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSavedFilters(v => !v)} style={{ fontSize: 11, border: `1.5px solid ${B.border}`, borderRadius: 20, padding: "3px 10px", background: "#fff", color: B.muted, cursor: "pointer", fontFamily: "inherit" }}>
              💾 Saved {savedFilters.length > 0 ? `(${savedFilters.length})` : ""}
            </button>
            {showSavedFilters && (
              <div style={{ position: "absolute", top: 30, left: 0, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, minWidth: 180, padding: 6 }}>
                {savedFilters.length === 0 && <div style={{ fontSize: 11, color: B.muted, padding: "6px 10px" }}>No saved filters yet</div>}
                {savedFilters.map((f, i) => (
                  <div key={i} onClick={() => applyFilter(f)} style={{ fontSize: 11, padding: "6px 10px", cursor: "pointer", borderRadius: 5, color: "#334155" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {f.name}
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${B.border}`, marginTop: 4, paddingTop: 4 }}>
                  <div onClick={handleSaveFilter} style={{ fontSize: 11, padding: "6px 10px", cursor: "pointer", color: B.blue, fontWeight: 600, borderRadius: 5 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    + Save current filter
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: actions + view toggles */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

          {/* Bulk action bar */}
          {bulkSelected.size > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", background: B.blue + "0d", border: `1px solid ${B.blue}30`, borderRadius: 8, padding: "4px 10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: B.blue }}>{bulkSelected.size} selected</span>
              {/* Move */}
              <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)}
                style={{ fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5, padding: "2px 6px", fontFamily: "inherit", background: "#fff" }}>
                <option value="">Move to…</option>
                {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={handleBulkMove} disabled={!bulkTarget}
                style={{ padding: "3px 10px", fontSize: 11, background: B.blue, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, opacity: bulkTarget ? 1 : 0.5 }}>Move</button>
              {/* Assign */}
              <select value={bulkAssign} onChange={e => setBulkAssign(e.target.value)}
                style={{ fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5, padding: "2px 6px", fontFamily: "inherit", background: "#fff" }}>
                <option value="">Assign to…</option>
                {STAFF_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={handleBulkAssign} disabled={!bulkAssign}
                style={{ padding: "3px 10px", fontSize: 11, background: "#10b981", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, opacity: bulkAssign ? 1 : 0.5 }}>Assign</button>
              {/* Tag */}
              <select value={bulkTag} onChange={e => setBulkTag(e.target.value)}
                style={{ fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5, padding: "2px 6px", fontFamily: "inherit", background: "#fff" }}>
                <option value="">Add tag…</option>
                {TAG_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={handleBulkTag} disabled={!bulkTag}
                style={{ padding: "3px 10px", fontSize: 11, background: "#4338ca", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, opacity: bulkTag ? 1 : 0.5 }}>Tag</button>
              {/* Export */}
              <button onClick={handleBulkExport}
                style={{ padding: "3px 10px", fontSize: 11, background: "#f59e0b", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700 }}>📥 Export</button>
              <button onClick={handleBulkArchive}
                style={{ padding: "3px 10px", fontSize: 11, background: "#64748b", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700 }}>📦 Archive</button>
              <button onClick={handleBulkDelete}
                style={{ padding: "3px 10px", fontSize: 11, background: "#ef4444", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700 }}>🗑 Delete</button>
              <button onClick={() => setBulkSelected(new Set())}
                style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "none", cursor: "pointer", color: B.muted }}>✕</button>
            </div>
          )}

          {dupeIds.size > 0 && (
            <button onClick={handleMergeDupes} style={actionBtn(B.orange, B.orange + "10")}>
              ⚡ Merge dupes ({dupeIds.size})
            </button>
          )}

          <button onClick={() => setShowReminderCenter(true)} style={actionBtn("#f59e0b", "#fef3c7")}>🔔 Reminders</button>
          <button onClick={() => setShowFunnel(true)} style={actionBtn("#8b5cf6", "#ede9fe")}>📊 Funnel</button>
          <button onClick={() => setShowSourceROI(true)} style={actionBtn("#10b981", "#f0fdf4")}>💰 ROI</button>
          <button onClick={() => setShowStaffROI(true)} style={actionBtn("#3b82f6", "#eff6ff")}>👤 Staff ROI</button>
          <button onClick={() => setShowForecast(true)} style={actionBtn("#7c3aed", "#f5f3ff")}>🔮 Forecast</button>
          <button onClick={() => setShowHeatmap(true)} style={actionBtn("#ef4444", "#fef2f2")}>🗺 Heatmap</button>
          <button onClick={() => setShowCustomFields(true)} style={actionBtn("#64748b", "#f8fafc")}>⚙ Fields</button>

          <ModeBtn active={displayMode === "table"}  label="⊞ Table"  onClick={() => setDisplayMode("table")} />
          <ModeBtn active={displayMode === "kanban"} label="⬛ Kanban" onClick={() => setDisplayMode("kanban")} />

          <button
            onClick={() => setAddModal(true)}
            style={{ padding: "6px 16px", background: B.blue, color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: 0.2, boxShadow: `0 2px 6px ${B.blue}40` }}
          >+ Add Lead</button>
        </div>
      </div>

      {/* ── Content ── */}
      {displayMode === "kanban" ? (
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
          onSetFollowUp={(lead, date) => {
            const updated = data.leads.map(l => l.id === lead.id ? { ...l, followUpDate: date, updatedAt: new Date().toISOString().slice(0,10) } : l);
            setData({ ...data, leads: updated });
          }}
        />
      ) : (
        <SectionCard title={`Leads — ${rows.length} record${rows.length !== 1 ? "s" : ""}`} style={{ flex: 1, minHeight: 0 }}>
          {viewMode === "excel" ? (
            <>
              <div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div>
              <div className="excel-table-wrap">
                <ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} />
              </div>
            </>
          ) : (
            /* NTable — pass onChange + onDelete so inline selects work */
            <NTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} />
          )}
        </SectionCard>
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
            onClose={() => setHoverLead(null)}
            onEdit={() => { setEditLead(hoverLead); setHoverLead(null); }}
            onDetail={() => { setDetailLead(hoverLead); setHoverLead(null); }}
          />
        </div>
      )}

      {/* ── Add Modal ── */}
      {addModal && (
        <FormModal
          title="Add New Lead"
          fields={ADD_FIELDS}
          onSave={handleAdd}
          onClose={() => setAddModal(false)}
        />
      )}

      {/* ── Edit Modal ── */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onSave={handleEditSave}
          onClose={() => setEditLead(null)}
          onConvert={handleConvertToClient}
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
          lead={detailLead}
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
        <StaffROIModal leads={leads} onClose={() => setShowStaffROI(false)} />
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
    </div>
  );
}

// ─── Edit Lead Modal ────────────────────────────────────────────────────────────
function EditLeadModal({ lead, onSave, onClose, onConvert, onDelete }) {
  const [vals, setVals] = useState({
    name:        lead.name        || "",
    email:       lead.email       || "",
    phone:       lead.phone       || "",
    service:     lead.service     || "UAE Visa",
    status:      lead.status      || "New",
    priority:    lead.priority    || "",
    assignedTo:  lead.assignedTo  || "",
    value:       lead.value       || "",
    source:      lead.source      || "Other",
    lostReason:  lead.lostReason  || "",
    notes:       lead.notes       || "",
    followUpDate: lead.followUpDate || "",
  });

  const set = (k, v) => setVals(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    const entries = [];
    const today = new Date().toISOString().slice(0, 10);
    if (vals.status !== lead.status) entries.push({ date: today, text: `Status changed: ${lead.status} → ${vals.status}` });
    if (vals.assignedTo !== (lead.assignedTo || "")) entries.push({ date: today, text: `Assigned to ${vals.assignedTo || "nobody"}` });
    if (Number(vals.value) !== (lead.value || 0)) entries.push({ date: today, text: `Value updated: ${aed(lead.value)} → ${aed(Number(vals.value))}` });
    if (vals.notes !== (lead.notes || "")) entries.push({ date: today, text: `Notes updated` });
    onSave(vals, entries);
  };

  const labelStyle = { fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3, display: "block", letterSpacing: 0.3 };
  const inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" };
  const selectStyle = { ...inputStyle, background: "#fff", cursor: "pointer" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div
        style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Edit Lead</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{lead.id} · Added {lead.date}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
        </div>

        {/* Form grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
          {[
            { k: "name",  label: "Full Name",    type: "text" },
            { k: "email", label: "Email",         type: "email" },
            { k: "phone", label: "Phone",         type: "text" },
            { k: "value", label: "Value (AED)",   type: "number" },
          ].map(({ k, label, type }) => (
            <div key={k}>
              <label style={labelStyle}>{label}</label>
              <input type={type} value={vals[k]} onChange={e => set(k, e.target.value)} style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#3b82f6"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
          ))}

          <div>
            <label style={labelStyle}>Service</label>
            <select value={vals.service} onChange={e => set("service", e.target.value)} style={selectStyle}>
              {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select value={vals.status} onChange={e => set("status", e.target.value)}
              style={{ ...selectStyle, color: STAGE_COLORS[vals.status] || "#0f172a", fontWeight: 700 }}>
              {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Source</label>
            <select value={vals.source} onChange={e => set("source", e.target.value)} style={selectStyle}>
              {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Lost Reason</label>
            <select value={vals.lostReason} onChange={e => set("lostReason", e.target.value)} style={selectStyle}>
              {LOST_OPTIONS.map(o => <option key={o} value={o}>{o || "— None —"}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Priority</label>
            <select value={vals.priority} onChange={e => set("priority", e.target.value)}
              style={{ ...selectStyle, color: PRIORITY_COLORS[vals.priority] || "#64748b", fontWeight: vals.priority ? 700 : 400 }}>
              {PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o || "— None —"}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Assigned To</label>
            <select value={vals.assignedTo} onChange={e => set("assignedTo", e.target.value)} style={selectStyle}>
              {STAFF_OPTIONS.map(o => <option key={o} value={o}>{o || "— Unassigned —"}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Est. Close Date</label>
            <input type="date" value={vals.estimatedClose || ""} onChange={e => set("estimatedClose", e.target.value)} style={inputStyle}
              onFocus={e => e.target.style.borderColor = "#3b82f6"}
              onBlur={e => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>
        </div>

        {/* Tags */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Tags</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TAG_OPTIONS.map(t => {
              const active = (vals.tags || []).includes(t);
              return (
                <button key={t} onClick={() => set("tags", active ? (vals.tags||[]).filter(x=>x!==t) : [...(vals.tags||[]), t])}
                  style={{ fontSize: 10, padding: "3px 9px", borderRadius: 20, border: `1px solid ${active ? "#4338ca" : "#e2e8f0"}`, background: active ? "#e0e7ff" : "#fff", color: active ? "#4338ca" : "#94a3b8", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes full width */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={vals.notes} onChange={e => set("notes", e.target.value)} rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            onFocus={e => e.target.style.borderColor = "#3b82f6"}
            onBlur={e => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onDelete}
              style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #fca5a5", background: "#fff5f5", color: "#ef4444", cursor: "pointer" }}>
              🗑 Delete
            </button>
            {vals.status === "Won" && (
              <button onClick={() => { onConvert({ ...lead, ...vals }); onClose(); }}
                style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #6ee7b7", background: "#f0fdf4", color: "#10b981", cursor: "pointer" }}>
                ↗ Convert to Client
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: "7px 18px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSave}
              style={{ padding: "7px 22px", borderRadius: 7, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px #3b82f640" }}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lead Detail Drawer ─────────────────────────────────────────────────────────
function LeadDetailDrawer({ lead, staleLeads, dupeIds, onClose, onEdit, onConvert, onAddNote, onLogCall, onReopen, onArchive, onSnooze, onMention, onDocChecklist, onSetRecurrence }) {
  const score = scoreLead(lead);
  const label = scoreLabel(score);
  const isStale = staleLeads.some(s => s.id === lead.id);
  const isDupe  = dupeIds.has(lead.id);
  const health  = getHealthLabel(getHealthScore(lead));
  const nextAction = getNextAction(lead);
  const [noteInput, setNoteInput] = useState("");
  const [callInput, setCallInput] = useState("");
  const [mentionInput, setMentionInput] = useState("");
  const [activeTab, setActiveTab] = useState("details");
  const temp = getTemperature(lead);
  const tempLabel = getTempLabel(temp);
  const sla = getSLAStatus(lead);

  const DOC_ITEMS = ["Emirates ID", "Passport", "Visa Copy", "Trade License", "MOA", "Proof of Address", "Bank Statement", "NOC Letter"];

  const row = (icon, k, v) => v ? (
    <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#334155" }}>
      <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: "#94a3b8", minWidth: 80 }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </div>
  ) : null;

  const tabStyle = (t) => ({
    padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
    borderBottom: `2px solid ${activeTab === t ? "#3b82f6" : "transparent"}`,
    background: "none", color: activeTab === t ? "#3b82f6" : "#94a3b8", fontFamily: "inherit",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(1px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 400, maxWidth: "95vw", background: "#fff", height: "100%", overflowY: "auto", padding: 24, boxShadow: "-8px 0 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 14 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>{lead.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={pill(STAGE_COLORS[lead.status] || "#64748b", (STAGE_COLORS[lead.status] || "#64748b") + "18")}>{lead.status}</span>
              <span style={pill(SCORE_COLORS[label], SCORE_COLORS[label] + "18")}>{score} {label}</span>
              <span style={pill(health.color, health.color + "15")}>{health.label}</span>
              <span style={pill(tempLabel.color, tempLabel.bg)}>{tempLabel.label}</span>
              {sla && <span style={pill(sla.color, sla.bg)}>{sla.urgent ? "⚠ " : ""}SLA: {sla.label}</span>}
              {lead.priority && <span style={pill(PRIORITY_COLORS[lead.priority], PRIORITY_COLORS[lead.priority] + "18")}>{lead.priority}</span>}
              {isStale && <span style={pill("#f59e0b", "#fef3c7")}>⏰ Stale</span>}
              {isDupe  && <span style={pill("#f59e0b", "#fef3c7")}>⚠ Dupe</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {/* Next Action */}
        {nextAction && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{nextAction.icon}</span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", letterSpacing: 0.5 }}>NEXT ACTION</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{nextAction.text}</div>
            </div>
          </div>
        )}

        {/* WhatsApp quick actions */}
        {lead.phone && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}`, "_blank")}
              style={{ fontSize: 11, padding: "5px 10px", background: "#25d366", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
              💬 Open WhatsApp
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(lead.phone); }}
              style={{ fontSize: 11, padding: "5px 10px", background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" }}>
              📋 Copy Number
            </button>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=Hi ${encodeURIComponent(lead.name)}, please send us your Emirates ID copy.`, "_blank")}
              style={{ fontSize: 11, padding: "5px 10px", background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" }}>
              📄 Docs Reminder
            </button>
            <button onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=Hi ${encodeURIComponent(lead.name)}, just a reminder for your appointment tomorrow.`, "_blank")}
              style={{ fontSize: 11, padding: "5px 10px", background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer" }}>
              📅 Appt Reminder
            </button>
          </div>
        )}

        {/* Snooze bar */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Snooze:</span>
          {[1, 3, 7, 14].map(d => (
            <button key={d} onClick={() => onSnooze && onSnooze(lead, d)}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}>
              {d}d
            </button>
          ))}
          {lead.followUpRecurrence && (
            <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 600 }}>↻ Every {lead.followUpRecurrence}d</span>
          )}
          <select value={lead.followUpRecurrence || ""} onChange={e => onSetRecurrence && onSetRecurrence(lead.id, Number(e.target.value) || null)}
            style={{ fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 5, padding: "2px 6px", fontFamily: "inherit", color: "#64748b" }}>
            <option value="">↻ Recurrence…</option>
            {[3,7,14,30].map(d => <option key={d} value={d}>Every {d} days</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", gap: 2, flexWrap: "wrap" }}>
          {["details", "notes", "calls", "docs", "mentions", "timeline"].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={tabStyle(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#f8fafc", borderRadius: 10, padding: "14px 16px" }}>
            {row("💼", "Service",   lead.service)}
            {row("📅", "Date",      lead.date)}
            {row("💰", "Value",     aed(lead.value))}
            {row("📣", "Source",    lead.source)}
            {row("✉️", "Email",     lead.email)}
            {row("📱", "Phone",     lead.phone)}
            {lead.assignedTo && row("👤", "Assigned",  lead.assignedTo)}
            {lead.estimatedClose && row("🎯", "Est. Close", lead.estimatedClose)}
            {lead.priority   && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>🎯</span>
                <span style={{ color: "#94a3b8", minWidth: 80 }}>Priority</span>
                <span style={pill(PRIORITY_COLORS[lead.priority], PRIORITY_COLORS[lead.priority] + "18")}>{lead.priority}</span>
              </div>
            )}
            {lead.followUpDate && (() => {
              const fu = getFollowUpStatus(lead.followUpDate);
              return (
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>🗓</span>
                  <span style={{ color: "#94a3b8", minWidth: 80 }}>Follow-up</span>
                  {fu ? <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span> : <span>{lead.followUpDate}</span>}
                </div>
              );
            })()}
            {lead.lostReason && row("❌", "Lost Reason", lead.lostReason)}
            {(lead.tags||[]).length > 0 && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12 }}>
                <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>🏷</span>
                <span style={{ color: "#94a3b8", minWidth: 80 }}>Tags</span>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {lead.tags.map(t => <span key={t} style={{ fontSize: 9, background: "#e0e7ff", color: "#4338ca", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{t}</span>)}
                </div>
              </div>
            )}
            {lead.notes && (
              <div style={{ marginTop: 4, padding: "8px 10px", background: "#fff", borderRadius: 7, fontSize: 12, color: "#64748b", lineHeight: 1.6, borderLeft: "3px solid #e2e8f0" }}>{lead.notes}</div>
            )}
          </div>
        )}

        {activeTab === "notes" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={noteInput} onChange={e => setNoteInput(e.target.value)}
                placeholder="Add a quick note…"
                onKeyDown={e => { if (e.key === "Enter" && noteInput.trim()) { onAddNote(lead.id, noteInput.trim()); setNoteInput(""); }}}
                style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <button onClick={() => { if (noteInput.trim()) { onAddNote(lead.id, noteInput.trim()); setNoteInput(""); }}}
                style={{ padding: "7px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Add</button>
            </div>
            {[...(lead.quickNotes||[])].reverse().map((n, i) => (
              <div key={i} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 3 }}>{n.date}</div>
                <div style={{ color: "#334155" }}>{n.text}</div>
              </div>
            ))}
            {(lead.quickNotes||[]).length === 0 && <div style={{ color: B.muted, fontSize: 12, textAlign: "center", paddingTop: 20 }}>No notes yet</div>}
          </div>
        )}

        {activeTab === "calls" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={callInput} onChange={e => setCallInput(e.target.value)}
                placeholder="Log a call (e.g. 12 min, interested)"
                onKeyDown={e => { if (e.key === "Enter" && callInput.trim()) { onLogCall(lead.id, callInput.trim()); setCallInput(""); }}}
                style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <button onClick={() => { if (callInput.trim()) { onLogCall(lead.id, callInput.trim()); setCallInput(""); }}}
                style={{ padding: "7px 14px", background: "#10b981", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📞 Log</button>
            </div>
            {[...(lead.callLog||[])].reverse().map((c, i) => (
              <div key={i} style={{ background: "#f0fdf4", borderRadius: 8, padding: "8px 12px", fontSize: 12, borderLeft: "3px solid #10b981" }}>
                <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 3 }}>📞 {c.date}</div>
                <div style={{ color: "#334155" }}>{c.note}</div>
              </div>
            ))}
            {(lead.callLog||[]).length === 0 && <div style={{ color: B.muted, fontSize: 12, textAlign: "center", paddingTop: 20 }}>No calls logged yet</div>}
          </div>
        )}

        {activeTab === "docs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>DOCUMENT CHECKLIST</div>
            {DOC_ITEMS.map(item => {
              const checked = !!(lead.docChecklist || {})[item];
              return (
                <label key={item} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "7px 10px", background: checked ? "#f0fdf4" : "#f8fafc", borderRadius: 7, border: `1px solid ${checked ? "#6ee7b7" : "#e2e8f0"}`, fontSize: 12 }}>
                  <input type="checkbox" checked={checked} onChange={e => onDocChecklist && onDocChecklist(lead.id, item, e.target.checked)}
                    style={{ accentColor: "#10b981", width: 14, height: 14 }} />
                  <span style={{ flex: 1, color: checked ? "#065f46" : "#334155", fontWeight: checked ? 600 : 400, textDecoration: checked ? "line-through" : "none" }}>{item}</span>
                  {checked && <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>✓</span>}
                </label>
              );
            })}
            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right" }}>
              {Object.values(lead.docChecklist || {}).filter(Boolean).length}/{DOC_ITEMS.length} received
            </div>
          </div>
        )}

        {activeTab === "mentions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={mentionInput} onChange={e => setMentionInput(e.target.value)}
                placeholder="@Ahmed — check proposal status…"
                onKeyDown={e => { if (e.key === "Enter" && mentionInput.trim()) { onMention && onMention(lead.id, mentionInput.trim()); setMentionInput(""); }}}
                style={{ flex: 1, padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <button onClick={() => { if (mentionInput.trim()) { onMention && onMention(lead.id, mentionInput.trim()); setMentionInput(""); }}}
                style={{ padding: "7px 14px", background: "#4338ca", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>@ Mention</button>
            </div>
            {[...(lead.mentions||[])].reverse().map((m, i) => (
              <div key={i} style={{ background: "#eef2ff", borderRadius: 8, padding: "8px 12px", fontSize: 12, borderLeft: "3px solid #6366f1" }}>
                <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 3 }}>@ {m.date}</div>
                <div style={{ color: "#334155" }}>{m.text}</div>
              </div>
            ))}
            {!(lead.mentions||[]).length && <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", paddingTop: 20 }}>No mentions yet</div>}
          </div>
        )}


          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[...(lead.timeline||[{ date: lead.date, text: "Lead created" }])].reverse().map((t, i, arr) => (
              <div key={i} style={{ display: "flex", gap: 10, position: "relative", paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                {i < arr.length - 1 && <div style={{ position: "absolute", left: 7, top: 16, bottom: 0, width: 1, background: "#e2e8f0" }} />}
                <div style={{ width: 15, height: 15, borderRadius: "50%", background: "#3b82f6", border: "2px solid #fff", boxShadow: "0 0 0 2px #3b82f620", flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 11, color: "#334155", fontWeight: 500 }}>{t.text}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{t.date}</div>
                </div>
              </div>
            ))}
            {!(lead.timeline||[]).length && <div style={{ color: B.muted, fontSize: 12, textAlign: "center", paddingTop: 20 }}>No history yet</div>}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 12, borderTop: "1px solid #f1f5f9", flexWrap: "wrap" }}>
          <button onClick={onEdit}
            style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>
            ✏️ Edit Lead
          </button>
          {lead.status === "Won" && (
            <button onClick={() => { onConvert(lead); onClose(); }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#10b981", color: "#fff", border: "none", cursor: "pointer" }}>
              ↗ Convert
            </button>
          )}
          {lead.status === "Lost" && (
            <button onClick={() => { const r = window.prompt("Reopen reason?"); if (r) { onReopen(lead, r); onClose(); }}}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#7c3aed", color: "#fff", border: "none", cursor: "pointer" }}>
              ↩ Reopen
            </button>
          )}
          <button onClick={() => { onArchive && onArchive(lead); onClose(); }}
            style={{ padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: lead.archived ? "#f0fdf4" : "#f8fafc", color: lead.archived ? "#10b981" : "#94a3b8", border: "1px solid #e2e8f0", cursor: "pointer" }}>
            {lead.archived ? "↩ Restore" : "📦 Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lead Hover Card (follows cursor — table + kanban) ──────────────────────────
function LeadHoverCard({ lead, pos, staleLeads, dupeIds, onClose, onEdit, onDetail }) {
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
        <span style={pill(STAGE_COLORS[lead.status] || "#64748b", (STAGE_COLORS[lead.status] || "#64748b") + "18")}>{lead.status}</span>
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
function KanbanBoard({ leads, onDrop, dupeIds, staleLeads, onConvert, onEdit, onSetFollowUp, onHover, onHoverEnd, onDetail }) {
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
      gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(150px, 1fr))`,
      gap: 10, flex: 1, minHeight: 0, overflow: "auto",
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
              background: isOver ? STAGE_COLORS[stage] + "10" : "#f8fafc",
              borderRadius: 12,
              padding: "10px 8px",
              minWidth: 150,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: `2px solid ${isOver ? STAGE_COLORS[stage] + "60" : "transparent"}`,
              transition: "all 0.15s",
            }}
          >
            {/* Column header */}
            <div style={{ padding: "4px 4px 8px", borderBottom: `2px solid ${STAGE_COLORS[stage]}30` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: STAGE_COLORS[stage], textTransform: "uppercase", letterSpacing: 1 }}>{stage}</span>
                <span style={{ fontSize: 11, background: STAGE_COLORS[stage], color: "#fff", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }}>{stageLeads.length}</span>
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{aed(stageValue)}</div>
            </div>

            {/* Cards */}
            <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              {stageLeads.length === 0 && (
                <div style={{ textAlign: "center", padding: "18px 0", color: "#cbd5e1", fontSize: 11, fontStyle: "italic" }}>Drop here</div>
              )}
              {stageLeads.map((lead) => {
                const score = scoreLead(lead);
                const sLabel = scoreLabel(score);
                const isDupe = dupeIds.has(lead.id);
                const isStale = staleLeads.some((s) => s.id === lead.id);
                const isEditingFU = editFollowUp === lead.id;
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
                      padding: "10px 11px",
                      cursor: "pointer",
                      border: `1.5px solid ${isDupe ? "#f59e0b40" : "#e2e8f0"}`,
                      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      transition: "box-shadow 0.15s, transform 0.1s",
                    }}
                    onMouseOver={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseOut={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = ""; }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                      <span style={{ lineHeight: 1.3 }}>{lead.name}</span>
                      <div style={{ display: "flex", gap: 3, flexShrink: 0, alignItems: "center" }}>
                        {lead.priority && (
                          <span style={{ fontSize: 9, fontWeight: 800, color: PRIORITY_COLORS[lead.priority], background: PRIORITY_COLORS[lead.priority] + "18", borderRadius: 4, padding: "1px 5px" }}>{lead.priority}</span>
                        )}
                        {isDupe && <span title="Duplicate" style={{ fontSize: 9, color: "#f59e0b" }}>⚠</span>}
                        <button onClick={() => onEdit(lead)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#94a3b8", padding: 0, lineHeight: 1 }} title="Edit">✏️</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                      <span>{lead.service}</span>
                      {lead.assignedTo && <span style={{ color: "#64748b", fontWeight: 600 }}>👤 {lead.assignedTo}</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isStale ? 4 : 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>{aed(lead.value)}</span>
                      <span style={pill(SCORE_COLORS[sLabel], SCORE_COLORS[sLabel] + "15")}>{sLabel}</span>
                    </div>
                    {isStale && <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>⏰ Follow up needed</div>}

                    {/* Follow-up setter */}
                    <div style={{ marginTop: 7, borderTop: "1px solid #f1f5f9", paddingTop: 6 }}>
                      {isEditingFU ? (
                        <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
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
                            style={{ fontSize: 10, color: fu ? fu.color : "#94a3b8", background: fu ? fu.bg : "none", border: fu ? `1px solid ${fu.color}30` : "none", borderRadius: 4, padding: fu ? "2px 6px" : 0, cursor: "pointer", fontFamily: "inherit", fontWeight: fu ? 700 : 400 }}>
                            {fu ? `${fu.icon} ${fu.label}` : "📅 Set follow-up"}
                          </button>
                        );
                      })()}
                    </div>

                    {stage === "Won" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onConvert(lead); }}
                        style={{ marginTop: 7, width: "100%", fontSize: 10, fontWeight: 700, padding: "4px 0", background: "#f0fdf4", color: "#10b981", border: "1px solid #6ee7b740", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
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
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>
                {lead.value > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginTop: 4 }}>AED {lead.value.toLocaleString()}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const total = overdue.length + dueToday.length + soon.length + upcoming.length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 420, maxWidth: "95vw", height: "100%", background: "#fff", overflowY: "auto", padding: 26, boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>🔔 Reminder Center</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{total} follow-up{total !== 1 ? "s" : ""} pending</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {total === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#334155" }}>All caught up!</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No pending follow-ups right now.</div>
          </div>
        )}

        <Section title="Overdue"  items={overdue}  color="#ef4444" bg="#fef2f2" />
        <Section title="Due Today" items={dueToday} color="#f59e0b" bg="#fffbeb" />
        <Section title="In 1–3 Days" items={soon}  color="#3b82f6" bg="#eff6ff" />
        <Section title="Upcoming"  items={upcoming} color="#10b981" bg="#f0fdf4" />
      </div>
    </div>
  );
}

// ─── Funnel Modal ──────────────────────────────────────────────────────────────
function FunnelModal({ leads, pipelineStats, onClose }) {
  const total = leads.filter(l => !l.archived).length;
  const won   = leads.filter(l => l.status === "Won").length;
  const lost  = leads.filter(l => l.status === "Lost").length;
  const wonVal = leads.filter(l => l.status === "Won").reduce((a,l) => a + (l.value||0), 0);
  const lostVal = leads.filter(l => l.status === "Lost").reduce((a,l) => a + (l.value||0), 0);
  const overallConv = total > 0 ? Math.round((won / total) * 100) : 0;
  const avgDeal = won > 0 ? Math.round(wonVal / won) : 0;

  const stages = pipelineStats.filter(s => s.stage !== "Lost");
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
    const lost     = sl.filter(l => l.status === "Lost");
    const revenue  = won.reduce((a,l) => a + (l.value||0), 0);
    const pipeline = sl.filter(l => !["Won","Lost"].includes(l.status)).reduce((a,l) => a + (l.value||0), 0);
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
                    ["Lost",     s.lost,                         "#ef4444"],
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
function StaffROIModal({ leads, onClose }) {
  const staff = ["Ahmed", "Sarah", "Omar", "Layla", "Other"];
  const stats = staff.map(s => {
    const assigned = leads.filter(l => l.assignedTo === s);
    const won      = assigned.filter(l => l.status === "Won");
    const lost     = assigned.filter(l => l.status === "Lost");
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
  const WEIGHTS = { New: 0.1, Contacted: 0.2, Qualified: 0.4, Proposal: 0.6, Won: 1.0, Lost: 0 };
  const active = leads.filter(l => !l.archived && l.status !== "Lost");
  const weighted = active.reduce((a, l) => a + (l.value || 0) * (WEIGHTS[l.status] || 0), 0);
  const best     = active.filter(l => ["Proposal","Won"].includes(l.status)).reduce((a,l) => a + (l.value||0), 0);
  const worst    = active.filter(l => l.status === "Won").reduce((a,l) => a + (l.value||0), 0);
  const byStage  = ["New","Contacted","Qualified","Proposal","Won"].map(s => {
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
          {[["Weighted", `AED ${Math.round(weighted).toLocaleString()}`, "#3b82f6", "Probability-adjusted"], ["Best Case", `AED ${best.toLocaleString()}`, "#10b981", "Proposal + Won"], ["Committed", `AED ${worst.toLocaleString()}`, "#8b5cf6", "Won only"]].map(([k,v,c,sub]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px", border: "1px solid #e2e8f0", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Stage Breakdown</div>
          {byStage.map(s => s.count > 0 && (
            <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 12 }}>
              <div style={{ width: 80, color: "#64748b" }}>{s.stage}</div>
              <div style={{ flex: 1, background: "#e2e8f0", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${s.count ? 100 : 0}%`, height: "100%", background: STAGE_COLORS[s.stage], opacity: 0.7 + s.weight * 0.3, borderRadius: 4 }} />
              </div>
              <div style={{ width: 30, textAlign: "right", fontWeight: 700 }}>{s.count}</div>
              <div style={{ width: 110, textAlign: "right", color: "#334155", fontWeight: 600 }}>AED {s.value.toLocaleString()}</div>
              <div style={{ width: 50, textAlign: "right", color: "#94a3b8" }}>{Math.round(s.weight*100)}%</div>
            </div>
          ))}
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
  const days = 63; // 9 weeks
  const today = new Date(); today.setHours(0,0,0,0);
  const grid = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLeads = leads.filter(l => l.date === dateStr || l.updatedAt === dateStr || l.lastContacted === dateStr);
    grid.push({ date: dateStr, count: dayLeads.length, label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) });
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

// ─── Tiny UI helpers ────────────────────────────────────────────────────────────
function FilterBtn({ active, label, onClick, danger, warn }) {
  const color = danger ? "#ef4444" : warn ? "#f59e0b" : B.blue;
  return (
    <button onClick={onClick} style={{
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
