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
  PIPELINE_STAGES,
} from "../services/crmEngine";
import workflowEngine from "../services/workflowEngine";
import { useMultiUserSync } from "../hooks/useMultiUserSync";
import { toast } from "../App";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import { EnterpriseLoader, TableSkeleton, CardSkeleton } from "../components/EnterpriseLoader";
// FormModal intentionally removed — Add Lead now uses the 3-step AddLeadModal

// ─── Window width hook ─────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
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

// ─── Fun layer: vibes, XP, achievements, confetti, toasts ────────────────────

const LEAD_VIBES = [
  { hour: [6,11],  emoji: "☀️", msg: "Morning pipeline check. Let's fill that funnel." },
  { hour: [11,14], emoji: "🔥", msg: "Midday grind. Those leads won't chase themselves." },
  { hour: [14,17], emoji: "⚡", msg: "Afternoon push. Close something today." },
  { hour: [17,20], emoji: "🌆", msg: "Golden hour. One more Win before EOD?" },
  { hour: [20,24], emoji: "🌙", msg: "Night mode. Dedication level: unmatched." },
  { hour: [0,6],   emoji: "🦉", msg: "Can't sleep? Your pipeline is restless too." },
];

const ADD_LEAD_TOASTS = [
  "🎯 New lead in the pipeline. Let's go.",
  "📥 Fresh blood! Work it.",
  "🚀 Lead launched into orbit.",
  "💼 Another one for the board.",
  "📣 New lead added. Your future self thanks you.",
  "🌱 Planted a seed. Now water it.",
  "🎪 The circus grows. New act incoming.",
  "🧲 Attracted another one. Magnetic.",
  "📊 Pipeline looking thicc.",
  "🎉 Fresh lead! Don't let it go cold.",
];

const WIN_LEAD_TOASTS = [
  "🏆 WON! Absolute legend move.",
  "💰 Ka-ching! That's revenue, baby.",
  "🎯 Direct hit. Client incoming.",
  "🥇 First place finish. Won and done.",
  "🚀 Deal closed! To the moon.",
  "✨ They said yes! Effortlessly elite.",
  "🎉 Winner winner, client dinner.",
  "😎 Another W for the board.",
  "💎 Diamond secured. Boss is shook.",
  "🦁 Closed like a predator. Respect.",
];

const CONVERT_TOASTS = [
  "↗️ Lead → Client. The dream.",
  "🎊 Conversion achieved! That's the whole point.",
  "🌟 They're officially a client now. Treat them well.",
  "💼 New client added to the roster.",
  "🏅 Converted! Someone's getting a bonus (not you, but still).",
  "📈 Conversion rate just went up. You're welcome.",
  "🤝 Deal sealed, client locked in. Smooth.",
  "🎯 Pipeline to revenue. Textbook execution.",
  "🥂 Client acquired. Cheers.",
  "👑 Another conversion. The pipeline bows to you.",
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
  setTimeout(() => document.body.removeChild(container), 1600);
}

function useLeadToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, icon = "🎯", type = "lead", title = null) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, msg, icon, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
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
          animation: "leadSlideIn 0.3s ease",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <div>
            {t.title && <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{t.title}</div>}
            {t.msg}
          </div>
        </div>
      ))}
      <style>{`@keyframes leadSlideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 14px" }}>
      <div style={{ textAlign: "center", minWidth: 40 }}>
        <div style={{ fontSize: 18, lineHeight: 1 }}>⚡</div>
        <div style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: 0.5, textTransform: "uppercase" }}>Lv.{level}</div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color }}>{title}</span>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{xp} XP</span>
        </div>
        <div style={{ height: 5, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg,${color},${color}cc)`, borderRadius: 99, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{100 - pct} XP to next level</div>
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
      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>{unlocked.length}/{LEAD_ACHIEVEMENTS.length} unlocked — hover for details</div>
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
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 22 }}>{vibe.emoji}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>{day} · Your boss has no idea how hard you're working right now.</div>
      </div>
    </div>
  );
}

// ─── 3-Step Add Lead Modal ────────────────────────────────────────────────────

function AddLeadModal({ onSave, onClose }) {
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});

  // Step 1 — Identity
  const [name,   setName]   = useState("");
  const [email,  setEmail]  = useState("");
  const [phone,  setPhone]  = useState("");
  const [source, setSource] = useState("Other");

  // Step 2 — Deal
  const [service,    setService]    = useState("UAE Visa");
  const [status,     setStatus]     = useState("New");
  const [priority,   setPriority]   = useState("");
  const [value,      setValue]      = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes,      setNotes]      = useState("");

  const inp = () => ({
    style: {
      width: "100%", padding: "9px 12px", fontSize: 13,
      border: "1.5px solid #e2e8f0", borderRadius: 8, fontFamily: "inherit",
      outline: "none", boxSizing: "border-box", background: "#fff",
    }
  });
  const sel = () => ({
    style: {
      width: "100%", padding: "9px 12px", fontSize: 13,
      border: "1.5px solid #e2e8f0", borderRadius: 8, fontFamily: "inherit",
      outline: "none", background: "#fff", cursor: "pointer",
    }
  });
  const lbl = (text) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>{text}</div>
  );

  const validateStep1 = () => {
    const e = {};
    if (!name.trim()) e.name = "Name is required";
    if (email && !/\S+@\S+\.\S+/.test(email)) e.email = "Invalid email";
    return e;
  };

  const handleNext = () => {
    if (step === 1) {
      const e = validateStep1();
      if (Object.keys(e).length) { setErrors(e); return; }
      setErrors({});
    }
    setStep(s => s + 1);
  };

  const handleSave = () => {
    const e = validateStep1();
    if (Object.keys(e).length) { setErrors(e); setStep(1); return; }
    onSave({ name, email, phone, source, service, status, priority, value, assignedTo, notes });
    onClose();
  };

  const STEP_LABELS = ["Identity", "Deal", "Review"];
  const stageColor = { New:"#6366f1",Contacted:"#f59e0b",Qualified:"#3b82f6",Proposal:"#8b5cf6",Won:"#10b981",Lost:"#ef4444" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 16, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #f1f5f9", paddingBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>🎯 Add New Lead</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Step {step} of 3 — {STEP_LABELS[step - 1]}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
          </div>
          {/* Step dots */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STEP_LABELS.map((label, i) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 800,
                  background: step > i + 1 ? "#10b981" : step === i + 1 ? "#3b82f6" : "#f1f5f9",
                  color: step >= i + 1 ? "#fff" : "#94a3b8",
                  transition: "all 0.2s",
                }}>
                  {step > i + 1 ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 11, fontWeight: step === i + 1 ? 700 : 400, color: step === i + 1 ? "#3b82f6" : "#94a3b8" }}>{label}</span>
                {i < 2 && <div style={{ width: 24, height: 1, background: step > i + 1 ? "#10b981" : "#e2e8f0", marginLeft: 2 }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── Step 1: Identity ── */}
          {step === 1 && (
            <>
              <div>
                {lbl("Full Name *")}
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ahmed Al Mansouri" {...inp()} />
                {errors.name && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.name}</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  {lbl("Email")}
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" {...inp()} />
                  {errors.email && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>{errors.email}</div>}
                </div>
                <div>
                  {lbl("Phone")}
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 000 0000" {...inp()} />
                </div>
              </div>
              <div>
                {lbl("Lead Source")}
                <select value={source} onChange={e => setSource(e.target.value)} {...sel()}>
                  {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </>
          )}

          {/* ── Step 2: Deal ── */}
          {step === 2 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  {lbl("Service")}
                  <select value={service} onChange={e => setService(e.target.value)} {...sel()}>
                    {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  {lbl("Status")}
                  <select value={status} onChange={e => setStatus(e.target.value)} {...sel()}>
                    {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  {lbl("Priority")}
                  <select value={priority} onChange={e => setPriority(e.target.value)} {...sel()}>
                    {PRIORITY_OPTIONS.map(o => <option key={o || "none"} value={o}>{o || "— None —"}</option>)}
                  </select>
                </div>
                <div>
                  {lbl("Value (AED)")}
                  <input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="0" min={0} {...inp()} />
                </div>
              </div>
              <div>
                {lbl("Assign To")}
                <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} {...sel()}>
                  {STAFF_OPTIONS.map(o => <option key={o || "unassigned"} value={o}>{o || "— Unassigned —"}</option>)}
                </select>
              </div>
              <div>
                {lbl("Notes")}
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes about this lead…"
                  style={{ width: "100%", padding: "9px 12px", fontSize: 13, border: "1.5px solid #e2e8f0", borderRadius: 8, fontFamily: "inherit", outline: "none", boxSizing: "border-box", resize: "vertical", minHeight: 72 }} />
              </div>
            </>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: `linear-gradient(135deg,#3b82f612,#8b5cf608)`, border: "1px solid #3b82f625", borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Lead Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    ["Name",       name],
                    ["Source",     source],
                    ["Email",      email || "—"],
                    ["Phone",      phone || "—"],
                    ["Service",    service],
                    ["Status",     status],
                    ["Priority",   priority || "None"],
                    ["Value",      value ? `AED ${Number(value).toLocaleString()}` : "—"],
                    ["Assigned To",assignedTo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: k === "Status" ? (stageColor[v] || "#334155") : "#334155", marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {notes && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
                  <strong>Notes:</strong> {notes}
                </div>
              )}
              {Object.keys(errors).length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#ef4444" }}>
                  ⚠ Please fix errors on step 1 before saving.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fafafa", borderRadius: "0 0 16px 16px" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b", fontFamily: "inherit" }}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", color: "#334155", fontFamily: "inherit" }}>
                ← Back
              </button>
            )}
            {step < 3 ? (
              <button onClick={handleNext} style={{ padding: "8px 22px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSave} style={{ padding: "8px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "#10b981", color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                ✓ Add Lead
              </button>
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
  // Safe array refs
  data.leads      = data.leads      || [];
  data.clients    = data.clients    || [];
  data.accounting = data.accounting || [];

  // Multi-user sync integration
  const currentUser = { userId: "user_1", userName: "Current User", userRole: "Admin" };
  const { activeUsers, tabLocks, requestLock, releaseLock, broadcastUpdate, broadcastTabChange } = useMultiUserSync(currentUser.userId, currentUser.userName, currentUser.userRole);

  // Workflow integration
  const leadWorkflow = workflowEngine.getWorkflowByEntityType("lead");
  const [slaAlerts, setSlaAlerts] = useState([]);
  const [workflowHistory, setWorkflowHistory] = useState([]);

  // Check SLA alerts on mount and when leads change
  useEffect(() => {
    if (leadWorkflow) {
      const alerts = workflowEngine.getSLAAlerts(leadWorkflow.id, data.leads);
      setSlaAlerts(alerts);
    }
  }, [data.leads, leadWorkflow]);

  // Broadcast tab change for multi-user sync
  useEffect(() => {
    broadcastTabChange("leads");
  }, [broadcastTabChange]);

  // Handle workflow stage transition
  const handleStageTransition = async (lead, newStage) => {
    if (!leadWorkflow) return;
    
    const canProceed = workflowEngine.canTransition(leadWorkflow.id, lead.status, newStage, currentUser.userRole);
    if (!canProceed.allowed) {
      toast(`Cannot transition: ${canProceed.reason}`, "warning");
      return;
    }

    const validation = workflowEngine.validateStageFields(leadWorkflow.id, newStage, lead);
    if (!validation.valid) {
      toast(`Missing required fields: ${validation.missingFields.join(", ")}`, "error");
      return;
    }

    setIsLoading(true);
    try {
      // Request lock for this lead
      const lockAcquired = await requestLock(lead.id, "lead");
      if (!lockAcquired) {
        toast("This lead is being edited by another user", "warning");
        setIsLoading(false);
        return;
      }

      // Execute workflow transition
      await workflowEngine.executeTransition(
        leadWorkflow.id,
        lead.id,
        lead.status,
        newStage,
        currentUser.userId,
        currentUser.userName
      );

      // Update lead status
      setData(prev => ({
        ...prev,
        leads: prev.leads.map(l => 
          l.id === lead.id 
            ? { ...l, status: newStage, updatedAt: new Date().toISOString() }
            : l
        )
      }));

      // Broadcast update to other users
      broadcastUpdate("lead_stage_change", { leadId: lead.id, oldStage: lead.status, newStage });

      // Release lock
      releaseLock(lead.id, "lead");

      toast(`Lead moved to ${newStage}`, "success");
      grantXP(5);
    } catch (error) {
      toast("Failed to transition lead", "error");
    } finally {
      setIsLoading(false);
    }
  };

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
  const [hoverLead,      setHoverLead]      = useState(null);
  const [hoverPos,       setHoverPos]       = useState({ x: 0, y: 0 });
  const [isLoading,      setIsLoading]      = useState(false);

  // ── Fun layer: XP, achievements, toasts ─────────────────────────────────────
  const [xp,             setXp]             = useState(() => { try { return Number(localStorage.getItem("xp_leads") || 0); } catch { return 0; } });
  const [newlyUnlocked,  setNewlyUnlocked]  = useState([]);
  const { toasts, push: pushToast }         = useLeadToasts();

  const grantXP = useCallback((amount) => {
    setXp(prev => {
      const next = prev + amount;
      try { localStorage.setItem("xp_leads", String(next)); } catch {}
      return next;
    });
  }, []);

  const checkAchievements = useCallback((nextLeads) => {
    const raw = localStorage.getItem("xp_leads_achievements");
    const already = raw ? new Set(JSON.parse(raw)) : new Set();
    const fresh = [];
    LEAD_ACHIEVEMENTS.forEach(a => {
      if (!already.has(a.id) && a.check(nextLeads)) {
        fresh.push(a.id);
        already.add(a.id);
      }
    });
    if (fresh.length) {
      const updated = JSON.stringify([...already]);
      try { localStorage.setItem("xp_leads_achievements", updated); } catch {}
      setNewlyUnlocked(fresh);
      fresh.forEach(id => {
        const a = LEAD_ACHIEVEMENTS.find(x => x.id === id);
        if (a) pushToast(`${a.title} — ${a.desc}`, a.icon, "achievement", "Achievement Unlocked");
      });
      setTimeout(() => setNewlyUnlocked([]), 4000);
    }
  }, [pushToast]);

  const winW         = useWindowWidth();
  const isPhone      = winW < 640;
  const isTablet     = winW >= 640 && winW < 1100;
  const isDesktop    = winW >= 1100;
  const isNarrow     = winW < 820; // between phone and tablet

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

  const leads        = data.leads || [];
  const statuses     = ["All", ...PIPELINE_STAGES];
  const dupeIds      = useMemo(() => findDuplicates(leads),    [leads]);
  const staleLeads   = useMemo(() => getStaleLeads(leads),     [leads]);
  const pipelineStats= useMemo(() => getPipelineStats(leads),  [leads]);
  const lostReasons  = useMemo(() => getLostReasons(leads),    [leads]);

  const [localSearch, setLocalSearch] = useState(search || "");
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const LEAD_SUGGESTION_FIELDS = ["status", "priority", "source", "service", "assignedTo"];
  const { suggestions, showSuggestions, onSuggestionSelect } = useSearchSuggestions(localSearch, LEAD_SUGGESTION_FIELDS, setLocalSearch);

  // ── Filtered rows ────────────────────────────────────────────────────────────
  let rows = filter === "All" ? leads : leads.filter((l) => l.status === filter);
  // Archived filter
  rows = showArchived ? rows.filter(l => l.archived) : rows.filter(l => !l.archived);
  if (staffFilter !== "All")    rows = rows.filter(l => (l.assignedTo || "") === staffFilter);
  if (priorityFilter !== "All") rows = rows.filter(l => (l.priority   || "") === priorityFilter);
  if (tagFilter !== "All")      rows = rows.filter(l => (l.tags || []).includes(tagFilter));
  if (showDupesOnly) rows = rows.filter((l) => dupeIds.has(l.id));
  if (showStaleOnly) rows = rows.filter((l) => staleLeads.some((s) => s.id === l.id));
  rows = useTableFilterV2(rows, parsedQuery, ["name", "email", "phone", "service", "source", "notes"]);

  const { sortedData: sortedLeadRows, sortKey: leadSortKey, sortDir: leadSortDir, toggleSort: toggleLeadSort } = useSortedData(rows);
  rows = sortedLeadRows;
  const { page: leadPage, setPage: setLeadPage, pageSize: leadPageSize, setPageSize: setLeadPageSize, pageData: leadPageData, pageCount: leadPageCount } = usePagination(rows);

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
    // 🎉 Fun layer — Won confetti + toast
    if (key === "status" && val === "Won" && lead?.status !== "Won") {
      spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      pushToast(WIN_LEAD_TOASTS[Math.floor(Math.random() * WIN_LEAD_TOASTS.length)], "🏆", "win");
      grantXP(25);
      checkAchievements(updated);
    }
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
    const nextLeads = [...data.leads, newLead];
    setData({ ...data, leads: nextLeads });
    // 🎯 Fun layer — add toast + XP + achievements
    pushToast(ADD_LEAD_TOASTS[Math.floor(Math.random() * ADD_LEAD_TOASTS.length)], "🎯", "lead");
    grantXP(10);
    checkAchievements(nextLeads);
  };

  /** Save all edits from the edit modal */
  const handleEditSave = (vals, timelineEntries = []) => {
    if (!editLead) return;
    const today = new Date().toISOString().slice(0, 10);
    const wasWon = editLead.status !== "Won" && vals.status === "Won";
    const updated = data.leads.map(l => {
      if (l.id !== editLead.id) return l;
      const timeline = [...(l.timeline || []), ...timelineEntries];
      return { ...l, ...vals, value: Number(vals.value) || 0, updatedAt: today, timeline };
    });
    setData({ ...data, leads: updated });
    setEditLead(null);
    // 🏆 Fun layer — Won via edit
    if (wasWon) {
      spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      pushToast(WIN_LEAD_TOASTS[Math.floor(Math.random() * WIN_LEAD_TOASTS.length)], "🏆", "win");
      grantXP(25);
      checkAchievements(updated);
    }
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
    // 🌟 Fun layer — convert toast + confetti + XP
    spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
    pushToast(CONVERT_TOASTS[Math.floor(Math.random() * CONVERT_TOASTS.length)], "🌟", "convert");
    grantXP(40);
    checkAchievements(updatedLeads);
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
    // 🎉 Fun layer — Won confetti on kanban drop
    if (newStatus === "Won" && lead?.status !== "Won") {
      spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      pushToast(WIN_LEAD_TOASTS[Math.floor(Math.random() * WIN_LEAD_TOASTS.length)], "🏆", "win");
      grantXP(25);
      checkAchievements(updated);
    }
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
      key: "service", label: "Service", width: 165, priority: 0,
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
      key: "status", label: "Status", width: 130, priority: 0,
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
    { key: "value",  label: "Value",   width: 105, priority: 0, render: (v) => <span style={{ fontWeight: 600, fontSize: 12 }}>{aed(v)}</span>, xlRender: (v) => aed(v) },
    { key: "source", label: "Source",  width: 95,  priority: 1 },
    { key: "date",   label: "Date",    width: 95,  priority: 1 },
    {
      key: "stale", label: "Follow-up", width: 115, priority: 0,
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
      key: "priority", label: "Priority", width: 85, priority: 1,
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
      key: "assignedTo", label: "Assigned", width: 105, priority: 1,
      render: (v, r, ri) => (
        <select value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "assignedTo", e.target.value)}
          style={inlineSelect("#64748b")}>
          {STAFF_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
        </select>
      ),
    },
    { key: "lostReason", label: "Lost Reason", width: 115, priority: 2, render: (v) => v ? <span style={{ fontSize: 11 }}>{v}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span> },
    {
      key: "_health", label: "Health", width: 110, priority: 1,
      render: (_, r) => {
        const s = getHealthScore(r); const h = getHealthLabel(s);
        return <span style={pill(h.color, h.color + "15")}>{s}% {h.label}</span>;
      },
    },
    {
      key: "_nextAction", label: "Next Action", width: 160, priority: 1,
      render: (_, r) => {
        const na = getNextAction(r);
        return na ? <span style={{ fontSize: 11, color: "#334155" }}>{na.icon} {na.text}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span>;
      },
    },
    {
      key: "_stageAge", label: "Stage Age", width: 90, priority: 2,
      render: (_, r) => {
        const d = getDaysInStage(r);
        const color = d > 14 ? "#ef4444" : d > 7 ? "#f59e0b" : "#10b981";
        return <span style={pill(color, color + "15")}>{d}d</span>;
      },
    },
    {
      key: "_temperature", label: "Temp", width: 90, priority: 2,
      render: (_, r) => {
        const t = getTemperature(r); const tl = getTempLabel(t);
        return <span style={pill(tl.color, tl.bg)} title={`Temperature: ${t}/100`}>{tl.label}</span>;
      },
    },
    {
      key: "_sla", label: "Last Contact", width: 120, priority: 2,
      render: (_, r) => {
        const s = getSLAStatus(r);
        if (!s) return <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>;
        return <span style={pill(s.color, s.bg)}>{s.urgent ? "⚠ " : ""}{s.label}</span>;
      },
    },
    {
      key: "estimatedClose", label: "Est. Close", width: 110, priority: 2,
      render: (v, r, ri) => (
        <input type="date" value={v || ""} onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "estimatedClose", e.target.value)}
          style={{ fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 4px", fontFamily: "inherit", background: "transparent", color: "#334155", width: "100%" }} />
      ),
    },
    {
      key: "_tags", label: "Tags", width: 160, priority: 2,
      render: (_, r) => (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {(r.tags || []).map(t => (
            <span key={t} style={{ fontSize: 9, background: "#e0e7ff", color: "#4338ca", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{t}</span>
          ))}
        </div>
      ),
    },
    { key: "email", label: "Email",  width: 175, priority: 2 },
    { key: "phone", label: "Phone",  width: 140, priority: 2 },
    { key: "notes", label: "Notes",  width: 195, priority: 2 },
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
          {r.status === "Lost" && (
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
  const cols = allCols.filter(c => columnVisibility[c.key] !== false);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isPhone ? 8 : 12, height: "100%", minHeight: 0 }}>


      {/* ── Fun layer: Vibe bar + XP + Achievements ── */}
      <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : isNarrow ? "1fr 1fr" : "1fr auto auto", gap: isPhone ? 6 : 10, alignItems: "stretch" }}>
        <LeadDailyVibeBar />
        {!isPhone && <LeadXPBar xp={xp} />}
        {!isPhone && <LeadAchievementShelf leads={leads} newlyUnlocked={newlyUnlocked} />}
        {isPhone && (
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}><LeadXPBar xp={xp} /></div>
            <LeadAchievementShelf leads={leads} newlyUnlocked={newlyUnlocked} />
          </div>
        )}
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: isPhone ? "repeat(2,1fr)" : isNarrow ? "repeat(3,1fr)" : isTablet ? "repeat(4,1fr)" : "repeat(7,1fr)", gap: isPhone ? 6 : 8 }} className="stat-grid-6">
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Row 1: Status filter pills — scroll on mobile */}
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center", minWidth: "max-content" }}>
            {statuses.map((s) => (
              <FilterBtn key={s} active={filter === s} label={`${s}${s !== "All" ? ` (${leads.filter(l=>l.status===s).length})` : ""}`} onClick={() => setFilter(s)} />
            ))}
            <div style={{ width: 1, height: 18, background: B.border, margin: "0 2px", flexShrink: 0 }} />
            <FilterBtn active={showArchived} label={`📦 Archived (${leads.filter(l=>l.archived).length})`} onClick={() => setShowArchived(v => !v)} />
            <div style={{ width: 1, height: 18, background: B.border, margin: "0 2px", flexShrink: 0 }} />
            <FilterBtn active={showDupesOnly} label={`⚠ Dupes (${dupeIds.size})`}      onClick={() => { setShowDupesOnly(!showDupesOnly); setShowStaleOnly(false); }} danger />
            <FilterBtn active={showStaleOnly} label={`⏰ Stale (${staleLeads.length})`} onClick={() => { setShowStaleOnly(!showStaleOnly); setShowDupesOnly(false); }} warn />
          </div>
        </div>

        {/* Row 2: secondary filters + view controls + add */}
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {/* Filter dropdowns */}
          {[
            { val: staffFilter,    set: setStaffFilter,    label: "Staff",    opts: STAFF_OPTIONS.filter(Boolean) },
            { val: priorityFilter, set: setPriorityFilter, label: "Priority", opts: PRIORITY_OPTIONS.filter(Boolean) },
            { val: tagFilter,      set: setTagFilter,      label: "Tag",      opts: TAG_OPTIONS },
          ].map(({ val, set: setter, label, opts }) => {
            const active = val !== "All";
            return (
              <div key={label} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <select value={val} onChange={e => setter(e.target.value)} style={{
                  fontSize: 11, borderRadius: 6, padding: "5px 26px 5px 9px",
                  border: `1.5px solid ${active ? "#c7d2fe" : "#e8ecf1"}`,
                  background: active ? "#eef2ff" : "#fff",
                  color: active ? "#4338ca" : "#64748b", fontWeight: active ? 600 : 400,
                  cursor: "pointer", outline: "none", fontFamily: "inherit",
                  appearance: "none", WebkitAppearance: "none",
                }}>
                  <option value="All">{label}</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <i className="ti ti-chevron-down" aria-hidden style={{ position: "absolute", right: 7, pointerEvents: "none", fontSize: 11, color: active ? "#4338ca" : "#9ca3af" }} />
              </div>
            );
          })}

          {/* Saved filters */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSavedFilters(v => !v)} style={{
              fontSize: 11, borderRadius: 6, padding: "5px 9px",
              border: "1.5px solid #e8ecf1", background: "#fff",
              color: "#64748b", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <i className="ti ti-bookmark" aria-hidden style={{ fontSize: 13 }} />
              {savedFilters.length > 0 && <span style={{ fontSize: 10, background: "#e8ecf1", borderRadius: 4, padding: "0 5px", color: "#475569", fontWeight: 600 }}>{savedFilters.length}</span>}
            </button>
            {showSavedFilters && (
              <div style={{ position: "absolute", top: "calc(100% + 5px)", left: 0, background: "#fff", border: "1.5px solid #e8ecf1", borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.09)", zIndex: 200, minWidth: 190, padding: "5px 0 6px" }}>
                {savedFilters.length === 0 && <div style={{ fontSize: 11, color: "#94a3b8", padding: "7px 13px" }}>No saved filters yet</div>}
                {savedFilters.map((f, i) => (
                  <div key={i} onClick={() => applyFilter(f)} style={{ fontSize: 12, padding: "7px 13px", cursor: "pointer", color: "#1e293b" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}>{f.name}</div>
                ))}
                <div style={{ height: "1.5px", background: "#f1f5f9", margin: "4px 0" }} />
                <div onClick={handleSaveFilter} style={{ fontSize: 12, padding: "7px 13px", cursor: "pointer", color: "#4338ca", fontWeight: 600 }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f5f3ff"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}>+ Save current filter</div>
              </div>
            )}
          </div>

          {/* Clear */}
          {(staffFilter !== "All" || priorityFilter !== "All" || tagFilter !== "All") && (
            <button onClick={() => { setStaffFilter("All"); setPriorityFilter("All"); setTagFilter("All"); }} style={{ fontSize: 11, border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontWeight: 600, padding: "4px 2px", display: "flex", alignItems: "center", gap: 3 }}>
              <i className="ti ti-x" aria-hidden style={{ fontSize: 11 }} /> Clear
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Analytics menu */}
          <AnalyticsMenu
            isPhone={isPhone} dupeIds={dupeIds}
            onMergeDupes={handleMergeDupes}
            onReminders={() => setShowReminderCenter(true)}
            onFunnel={() => setShowFunnel(true)}
            onROI={() => setShowSourceROI(true)}
            onStaffROI={() => setShowStaffROI(true)}
            onForecast={() => setShowForecast(true)}
            onHeatmap={() => setShowHeatmap(true)}
            onFields={() => setShowCustomFields(true)}
            onGoals={() => setShowGoalTracker(true)}
            onWinLoss={() => setShowWinLossReport(true)}
            onHealth={() => setShowPipelineHealth(true)}
            onCompare={() => setShowLeadCompare(true)}
            onColumns={() => setShowColumnPicker(true)}
            onImport={() => setShowBulkImport(true)}
          />

          {/* View toggle */}
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 7, padding: 2, gap: 1 }}>
            {[
              { id: "table",  icon: "ti-layout-rows" },
              { id: "kanban", icon: "ti-layout-columns" },
            ].map(v => (
              <button key={v.id} onClick={() => setDisplayMode(v.id)} style={{
                width: 28, height: 26, borderRadius: 5, border: "none",
                background: displayMode === v.id ? "#fff" : "none",
                color: displayMode === v.id ? "#1d4ed8" : "#94a3b8",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: displayMode === v.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.12s",
              }}>
                <i className={`ti ${v.icon}`} aria-hidden style={{ fontSize: 13 }} />
              </button>
            ))}
          </div>

          <button onClick={() => setAddModal(true)} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 13px", background: "#2563eb", color: "#fff",
            border: "none", borderRadius: 7, fontWeight: 600, fontSize: 12,
            cursor: "pointer", flexShrink: 0,
          }}>
            <i className="ti ti-plus" aria-hidden style={{ fontSize: 13 }} />
            {!isPhone && "Add lead"}
          </button>
        </div>

        {/* Bulk action bar */}
        {bulkSelected.size > 0 && (
          <div style={{ display: "flex", gap: 5, alignItems: "center", background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 8, padding: "7px 11px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginRight: 3 }}>{bulkSelected.size} selected</span>
            <div style={{ width: "1.5px", height: 16, background: "#bfdbfe" }} />
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Move to…</option>
              {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
            <button onClick={handleBulkMove} disabled={!bulkTarget} style={{ padding: "3px 9px", fontSize: 11, background: bulkTarget ? "#2563eb" : "#e8ecf1", color: bulkTarget ? "#fff" : "#94a3b8", border: "none", borderRadius: 5, cursor: bulkTarget ? "pointer" : "default", fontWeight: 600 }}>Move</button>
            <select value={bulkAssign} onChange={e => setBulkAssign(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Assign to…</option>
              {STAFF_OPTIONS.filter(Boolean).map(s => <option key={s}>{s}</option>)}
            </select>
            <button onClick={handleBulkAssign} disabled={!bulkAssign} style={{ padding: "3px 9px", fontSize: 11, background: bulkAssign ? "#059669" : "#e8ecf1", color: bulkAssign ? "#fff" : "#94a3b8", border: "none", borderRadius: 5, cursor: bulkAssign ? "pointer" : "default", fontWeight: 600 }}>Assign</button>
            <select value={bulkTag} onChange={e => setBulkTag(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e8ecf1", borderRadius: 6, padding: "3px 7px", fontFamily: "inherit", background: "#fff", outline: "none" }}>
              <option value="">Tag…</option>
              {TAG_OPTIONS.map(t => <option key={t}>{t}</option>)}
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

      {/* Search + suggestions */}
      <div style={{ position:"relative" }}>
        <input
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          placeholder="Search leads… (e.g. status:Won priority:High source:Referral)"
          style={{ width:"100%", padding:"7px 12px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, outline:"none", boxSizing:"border-box" }}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:400, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, boxShadow:"0 4px 16px rgba(0,0,0,0.10)", maxHeight:200, overflowY:"auto" }}>
            {suggestions.map((s, i) => (
              <div key={i} onClick={() => onSuggestionSelect(s)} style={{ padding:"7px 12px", fontSize:12, cursor:"pointer", borderBottom:`1px solid ${B.border}` }}
                onMouseEnter={e=>e.currentTarget.style.background=B.light}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {s}
              </div>
            ))}
          </div>
        )}
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
        <SectionCard title={`Leads — ${rows.length} record${rows.length !== 1 ? "s" : ""}`} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {viewMode === "excel" ? (
            <>
              <div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div>
              <div className="excel-table-wrap">
                <ExcelTable cols={cols} rows={leadPageData} onChange={handleChange} onDelete={handleDelete} />
              </div>
            </>
          ) : isPhone ? (
            /* ── Mobile card list ── */
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px" }}>
              {rows.length === 0 && <div style={{ color: B.muted, textAlign: "center", padding: 32, fontSize: 13 }}>No leads found</div>}
              {leadPageData.map((r, ri) => {
                const fu = getFollowUpStatus(r.followUpDate);
                const sc = scoreLead(r); const sl = scoreLabel(sc);
                const na = getNextAction(r);
                const stageColor = STAGE_COLORS[r.status] || "#64748b";
                return (
                  <div key={r.id} onClick={() => setDetailLead(r)}
                    style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "12px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer", borderLeft: `4px solid ${stageColor}` }}>
                    {/* Row 1: name + status */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{r.name}</div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                        <span style={pill(stageColor, stageColor + "18")}>{r.status}</span>
                        <span style={pill(SCORE_COLORS[sl], SCORE_COLORS[sl] + "18")}>{sc} {sl}</span>
                      </div>
                    </div>
                    {/* Row 2: service + value */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>💼 {r.service || "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>{aed(r.value)}</span>
                    </div>
                    {/* Row 3: source + follow-up */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: fu || na ? 8 : 0 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>📣 {r.source || "—"} · {r.date || "—"}</span>
                      {fu && <span style={pill(fu.color, fu.bg)}>{fu.icon} {fu.label}</span>}
                    </div>
                    {/* Row 4: next action */}
                    {na && <div style={{ fontSize: 11, color: "#334155", marginBottom: 8 }}>{na.icon} {na.text}</div>}
                    {/* Row 5: actions */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => setEditLead(r)} style={actionBtn(B.blue, B.blue + "12")}>✏️ Edit</button>
                      {r.phone && (
                        <button onClick={() => window.open(`https://wa.me/${r.phone.replace(/\D/g,"")}`, "_blank")} style={actionBtn("#25d366", "#25d36612")}>💬 WA</button>
                      )}
                      {r.status === "Won" && (
                        <button onClick={() => handleConvertToClient(r)} style={actionBtn(B.green, B.green + "12")}>↗ Convert</button>
                      )}
                      <button onClick={() => setShowAIAssist(r)} style={actionBtn("#8b5cf6", "#ede9fe")}>✨ AI</button>
                    </div>
                  </div>
                );
              })}
              {/* Mobile pagination */}
              {leadPageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted, justifyContent:"center" }}>
                  <button onClick={() => setLeadPage(p => Math.max(0,p-1))} disabled={leadPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                  <span>Page {leadPage+1} / {leadPageCount}</span>
                  <button onClick={() => setLeadPage(p => Math.min(leadPageCount-1,p+1))} disabled={leadPage===leadPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                </div>
              )}
            </div>
          ) : (
            /* NTable — desktop/tablet */
            <>
              <NTable cols={cols} rows={leadPageData} onChange={handleChange} onDelete={handleDelete} dense maxHeight="calc(100vh - 380px)" />
              {leadPageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
                  <button onClick={() => setLeadPage(p => Math.max(0,p-1))} disabled={leadPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                  <span>Page {leadPage+1} / {leadPageCount}</span>
                  <button onClick={() => setLeadPage(p => Math.min(leadPageCount-1,p+1))} disabled={leadPage===leadPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                  <select value={leadPageSize} onChange={e=>{ setLeadPageSize(Number(e.target.value)); setLeadPage(0); }} style={{ marginLeft:"auto", padding:"3px 6px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:5 }}>
                    {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
              )}
            </>
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

      {/* ── Add Modal (3-step) ── */}
      {addModal && (
        <AddLeadModal
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

      {/* ── Toast stack ── */}
      <LeadToastStack toasts={toasts} />

      {/* ── Speed Dial FAB ── */}
      <SpeedDialFAB
        onAddLead={() => setAddModal(true)}
        onReminders={() => setShowReminderCenter(true)}
        onFunnel={() => setShowFunnel(true)}
        onGoals={() => setShowGoalTracker(true)}
        onImport={() => setShowBulkImport(true)}
      />

      {/* ── NEW MODALS ── */}
      {showGoalTracker && <GoalTrackerModal leads={leads} onClose={() => setShowGoalTracker(false)} />}
      {showWinLossReport && <WinLossReportModal leads={leads} onClose={() => setShowWinLossReport(false)} />}
      {showPipelineHealth && <PipelineHealthModal leads={leads} staleLeads={staleLeads} dupeIds={dupeIds} onClose={() => setShowPipelineHealth(false)} />}
      {showEmailComposer && <EmailComposerModal lead={showEmailComposer} onClose={() => setShowEmailComposer(null)} />}
      {showBulkImport && <BulkImportModal onImport={(newLeads) => { setData(d => ({ ...d, leads: [...d.leads, ...newLeads] })); setShowBulkImport(false); toast(`Imported ${newLeads.length} leads`, "success"); }} onClose={() => setShowBulkImport(false)} />}
      {showNotes && <QuickNoteModal lead={showNotes} onSave={(note) => { handleAddNote(showNotes.id, note); setShowNotes(null); }} onClose={() => setShowNotes(null)} />}
      {showCallScheduler && <CallSchedulerModal lead={showCallScheduler} onSave={(date, note) => { handleChange(rows.findIndex(r => r.id === showCallScheduler.id), "followUpDate", date); if (note) handleAddNote(showCallScheduler.id, `Call scheduled: ${note}`); setShowCallScheduler(null); toast("Call scheduled!", "success"); }} onClose={() => setShowCallScheduler(null)} />}
      {showLeadCompare && compareSelected.length === 2 && <LeadCompareModal leads={compareSelected} onClose={() => { setShowLeadCompare(false); setCompareSelected([]); }} />}
      {showColumnPicker && <ColumnPickerModal cols={allCols} visibility={columnVisibility} onChange={setColumnVisibility} onClose={() => setShowColumnPicker(false)} />}
    </div>
  );
}

// ─── Edit Lead Modal ───────────────────────────────────────────────────────────
function EditLeadModal({ lead, onSave, onClose, onConvert, onDelete }) {
  const [vals, setVals] = useState({
    name: lead.name || "", email: lead.email || "", phone: lead.phone || "",
    service: lead.service || "UAE Visa", status: lead.status || "New",
    priority: lead.priority || "", assignedTo: lead.assignedTo || "",
    value: lead.value || "", source: lead.source || "Other",
    lostReason: lead.lostReason || "", notes: lead.notes || "",
    followUpDate: lead.followUpDate || "", estimatedClose: lead.estimatedClose || "",
    tags: lead.tags || [],
  });
  const [tab, setTab] = useState("deal");
  const set = (k, v) => setVals(p => ({ ...p, [k]: v }));

  const handleSave = () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [];
    if (vals.status !== lead.status) entries.push({ date: today, text: `Status: ${lead.status} → ${vals.status}` });
    if (vals.assignedTo !== (lead.assignedTo || "")) entries.push({ date: today, text: `Assigned to ${vals.assignedTo || "nobody"}` });
    if (Number(vals.value) !== (lead.value || 0)) entries.push({ date: today, text: `Value: ${aed(lead.value)} → ${aed(Number(vals.value))}` });
    if (vals.notes !== (lead.notes || "")) entries.push({ date: today, text: "Notes updated" });
    onSave(vals, entries);
  };

  const hasChanges = Object.keys(vals).some(k => JSON.stringify(vals[k]) !== JSON.stringify(lead[k] ?? (k === "tags" ? [] : "")));
  const sc = STAGE_COLORS[vals.status] || "#64748b";

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
              <PillGroup options={STATUS_OPTIONS} value={vals.status} onSelect={v => set("status", v)} colorMap={STAGE_COLORS} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Service</span>
                <select value={vals.service} onChange={e => set("service", e.target.value)} style={F.sel}>{SERVICE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Value (AED)</span>
                <input type="number" value={vals.value} onChange={e => set("value", e.target.value)} style={F.inp} onFocus={fi} onBlur={fo} placeholder="0" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={F.wrap}>
                <span style={F.lbl}>Priority</span>
                <PillGroup options={PRIORITY_OPTIONS} value={vals.priority} onSelect={v => set("priority", v)} colorMap={PRIORITY_COLORS} />
              </div>
              <div style={F.wrap}>
                <span style={F.lbl}>Assigned to</span>
                <select value={vals.assignedTo} onChange={e => set("assignedTo", e.target.value)} style={F.sel}>{STAFF_OPTIONS.map(o => <option key={o||"u"} value={o}>{o||"— Unassigned —"}</option>)}</select>
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
            {vals.status === "Lost" && (
              <div style={F.wrap}>
                <span style={F.lbl}>Lost reason</span>
                <select value={vals.lostReason} onChange={e => set("lostReason", e.target.value)} style={F.sel}>{LOST_OPTIONS.map(o => <option key={o||"n"} value={o}>{o||"— None —"}</option>)}</select>
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
              <span style={F.lbl}>Source</span>
              <PillGroup options={SOURCE_OPTIONS} value={vals.source} onSelect={v => set("source", v)} />
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
                {TAG_OPTIONS.map(t => {
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


        {activeTab === "history" && (
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
    { label: "Pipeline", items: [
      { icon: "ti-bell",        label: "Reminders",       fn: onReminders },
      { icon: "ti-chart-dots",  label: "Funnel",          fn: onFunnel },
      { icon: "ti-target",      label: "Goals",           fn: onGoals },
      { icon: "ti-heart-rate-monitor", label: "Pipeline health", fn: onHealth },
    ]},
    { label: "Analytics", items: [
      { icon: "ti-currency-dollar", label: "Source ROI",  fn: onROI },
      { icon: "ti-users",        label: "Staff ROI",      fn: onStaffROI },
      { icon: "ti-chart-line",   label: "Forecast",       fn: onForecast },
      { icon: "ti-chart-bar",    label: "Win / Loss",     fn: onWinLoss },
      { icon: "ti-map-2",        label: "Heatmap",        fn: onHeatmap },
    ]},
    { label: "Tools", items: [
      { icon: "ti-scale",        label: "Compare leads",  fn: onCompare },
      { icon: "ti-columns",      label: "Columns",        fn: onColumns },
      { icon: "ti-adjustments",  label: "Custom fields",  fn: onFields },
      { icon: "ti-upload",       label: "Import CSV",     fn: onImport },
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
        <i className="ti ti-layout-grid" aria-hidden style={{ fontSize: 13 }} />
        {!isPhone && <span>Tools</span>}
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

// ─────────────────────────────────────────────────────────────────────────────
// Speed Dial FAB — floating action button with sub-actions
// ─────────────────────────────────────────────────────────────────────────────
function SpeedDialFAB({ onAddLead, onReminders, onFunnel, onGoals, onImport }) {
  const [open, setOpen] = useState(false);
  const actions = [
    { icon: "➕", label: "Add Lead",   color: "#3b82f6", fn: onAddLead },
    { icon: "🔔", label: "Reminders",  color: "#f59e0b", fn: onReminders },
    { icon: "📊", label: "Funnel",     color: "#8b5cf6", fn: onFunnel },
    { icon: "🎯", label: "Goals",      color: "#10b981", fn: onGoals },
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
      <button onClick={() => setOpen(o => !o)} style={{ width: 52, height: 52, borderRadius: "50%", background: open ? "#ef4444" : "#3b82f6", color: "#fff", border: "none", fontSize: 22, cursor: "pointer", boxShadow: "0 6px 20px rgba(59,130,246,0.45)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
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
  const defaults = { wonTarget: 10, revenueTarget: 100000, leadsTarget: 30 };
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
  const lost = leads.filter(l => l.status === "Lost");
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
        {Object.entries(bySource).sort((a,b) => (b[1].won/(b[1].won+b[1].lost)||0) - (a[1].won/(a[1].won+a[1].lost)||0)).map(([src, counts]) => {
          const rate = Math.round((counts.won / (counts.won + counts.lost)) * 100);
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
  const active    = leads.filter(l => !l.archived && !["Won","Lost"].includes(l.status));
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
    { label: "Proposal",     subject: `Proposal — ${lead.service}`,     body: `Hi ${lead.name},\n\nPlease find attached our proposal for ${lead.service}. We look forward to working with you.\n\nBest regards` },
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
  const [csv, setCsv]     = useState("Name,Email,Phone,Service,Status,Source,Value\nAhmed Ali,ahmed@test.com,0501234567,UAE Visa,New,Facebook,5000");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");

  const parse = () => {
    try {
      const lines = csv.trim().split("\n");
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const leads = lines.slice(1).map((line, i) => {
        const vals = line.split(",").map(v => v.trim());
        const obj = {};
        headers.forEach((h, j) => { obj[h] = vals[j] || ""; });
        return {
          id: `IMP_${Date.now()}_${i}`,
          name: obj.name || "Unknown",
          email: obj.email || "",
          phone: obj.phone || "",
          service: obj.service || "UAE Visa",
          status: obj.status || "New",
          source: obj.source || "Other",
          value: Number(obj.value) || 0,
          date: new Date().toISOString().slice(0,10),
          updatedAt: new Date().toISOString().slice(0,10),
          timeline: [{ date: new Date().toISOString().slice(0,10), text: "Imported via CSV" }],
          tags: [],
          callLog: [],
        };
      }).filter(l => l.name && l.name !== "Unknown");
      setPreview(leads);
      setError("");
    } catch(e) { setError("Invalid CSV format. Check your data."); setPreview([]); }
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
        <button onClick={() => note.trim() && onSave(note.trim())} disabled={!note.trim()}
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
      <button onClick={() => onSave(date, note ? `[${time}] ${note}` : `Call at ${time}`)}
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
    { label: "Notes",       fn: l => l.notes ? l.notes.slice(0,40)+"…" : "—" },
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
  const toggle = (key) => onChange(prev => ({ ...prev, [key]: prev[key] === false ? true : false }));
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
// Shared modal wrapper
// ─────────────────────────────────────────────────────────────────────────────
function ModalWrap({ title, onClose, width = 520, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }} />
      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
