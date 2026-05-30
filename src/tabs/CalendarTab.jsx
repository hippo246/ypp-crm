import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { B } from "../constants";
import { parseOperatorQuery } from "../helpers";
import { useSearchSuggestions } from "../hooks";
import { useAppData } from "../context/AppContext";
import workflowEngine from "../services/workflowEngine";
import { useMultiUserSync } from "../hooks/useMultiUserSync";
import { toast } from "../App";

// ─── Design tokens (extend B if needed) ──────────────────────────────────────
const T = {
  blue:    "#3B6EF8",
  blueDark:"#1D4ED8",
  violet:  "#8B5CF6",
  orange:  "#F97316",
  red:     "#F43F5E",
  green:   "#10B981",
  teal:    "#0D9488",
  amber:   "#F59E0B",
  slate50: "#f8fafc",
  slate100:"#f0f4f8",
  slate200:"#dde4ed",
  slate300:"#cbd5e1",
  slate400:"#8fa3b8",
  slate600:"#4a607a",
  slate700:"#334155",
  slate800:"#1a2a3a",
  slate900:"#0d1a26",
  white:   "#ffffff",
  radius:  12,
  radiusSm: 8,
  shadow:  "0 2px 12px rgba(13,26,38,0.08)",
  shadowMd:"0 6px 24px rgba(13,26,38,0.12)",
  shadowLg:"0 20px 60px rgba(13,26,38,0.20)",
  glass:   "rgba(255,255,255,0.85)",
};

const FONT = "'Sora', 'DM Sans', 'Segoe UI', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Fira Code', monospace";

// ─── Fun Layer: Calendar Edition ──────────────────────────────────────────────

const CAL_VIBES = [
  { hour: [6,11],  emoji: "🌅", msg: "Morning planning session. Map out the chaos before it maps you." },
  { hour: [11,14], emoji: "📅", msg: "Midday check-in. Half the deadlines are already screaming. Check the calendar." },
  { hour: [14,17], emoji: "🗓️", msg: "Afternoon schedule audit. Something important is due soon. Probably." },
  { hour: [17,20], emoji: "🌇", msg: "End-of-day review. Future you will thank present you. Or curse. Unclear." },
  { hour: [20,24], emoji: "🌙", msg: "Night calendar lurk. Nothing due right now. That you know of." },
  { hour: [0,6],   emoji: "🦉", msg: "3am deadline panic? The calendar has been trying to warn you for weeks." },
];

const QUICK_ADD_TOASTS = [
  "📅 Task dropped on the calendar. Future-you just groaned.",
  "✅ Event locked in. The schedule grows ever larger.",
  "🎯 Added to the timeline. Optimistic move.",
  "📌 Task placed. Hope that day wasn't supposed to be free.",
  "⚡ Scheduled. That week now looks *exciting*.",
  "🗓️ Calendar updated. Your future is now officially busy.",
  "🚀 Task queued up. The backlog appreciates the company.",
  "💼 Slot claimed. Productivity is theoretically imminent.",
  "📬 Event registered. The calendar sees all.",
  "🏷️ Logged. Your boss would be impressed if they could see this.",
];

const DONE_TOASTS = [
  "✅ Task marked done! One less thing haunting the calendar.",
  "🎉 Completed! The calendar finally has good news.",
  "🏆 Done! That one's been glowing red long enough.",
  "💪 Knocked it out. The overdue pile shrinks.",
  "🌟 Task complete! Timelines are meant to be met. Occasionally.",
  "✨ Done and clear. The calendar sighs with relief.",
  "🎯 Completed! Your on-time ratio is now technically higher.",
  "🥇 Finished! Someone out here is actually shipping things.",
  "⚡ Done! Today's hero move, right there.",
  "🦾 Complete. The red glow dims. Balance is restored.",
];

const NAV_TOASTS = [
  "📅 Time travel engaged. The calendar complies.",
  "🗓️ Month changed. The deadlines are still there.",
  "⏩ Jumped ahead. Hope the future looks less packed.",
  "⏪ Back in time. The past is calmer. Mostly.",
  "📆 New month. Same energy. Different disasters.",
];

const CAL_ACHIEVEMENTS = [
  { id: "cal_first_task",   icon: "📋", title: "First Event",       desc: "Added your first task to the calendar",                    check: (d) => (d.tasks||[]).length >= 1 },
  { id: "cal_done_task",    icon: "✅", title: "Calendar Win",       desc: "Marked a task done from the calendar view",               check: (d) => (d.tasks||[]).some(t => t.status === "Done") },
  { id: "cal_no_overdue",   icon: "🟢", title: "Clean Slate",        desc: "Zero overdue items on the calendar",                      check: (d) => { const today = new Date().toISOString().split("T")[0]; return (d.tasks||[]).filter(t => t.status !== "Done" && t.due && t.due < today).length === 0 && (d.tasks||[]).length > 0; } },
  { id: "cal_ten_tasks",    icon: "🏆", title: "Packed Schedule",    desc: "10+ tasks on the calendar",                               check: (d) => (d.tasks||[]).length >= 10 },
  { id: "cal_renewals",     icon: "🔁", title: "Renewal Radar",      desc: "3+ client renewals tracked",                              check: (d) => (d.clients||[]).filter(c => c.renewal).length >= 3 },
  { id: "cal_invoices",     icon: "💳", title: "Invoice Watcher",    desc: "5+ unpaid invoices on the calendar radar",                check: (d) => (d.accounting||[]).filter(i => i.status !== "Paid").length >= 5 },
  { id: "cal_milestone",    icon: "🏁", title: "Milestone Hunter",   desc: "A milestone task is on the calendar",                     check: (d) => (d.tasks||[]).some(t => t.milestone) },
  { id: "cal_twenty_tasks", icon: "🗺️", title: "Timeline Legend",   desc: "20+ events mapped — this calendar runs a country",       check: (d) => (d.tasks||[]).length >= 20 },
];

function spawnConfetti(x, y) {
  const colors = ["#3B6EF8","#8B5CF6","#10B981","#F59E0B","#F43F5E","#F97316","#06b6d4"];
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
    el.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${color};left:${x}px;top:${y}px;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};transform:rotate(${angle}deg);opacity:1;transition:none`;
    container.appendChild(el);
    const start = performance.now();
    const dur   = 900 + Math.random() * 600;
    const spin  = (Math.random() - 0.5) * 720;
    const animate = (now) => {
      const t = Math.min((now - start) / dur, 1);
      el.style.left      = `${x + vx * t}px`;
      el.style.top       = `${y + (vy * t + 300 * t * t)}px`;
      el.style.opacity   = String(1 - t);
      el.style.transform = `rotate(${angle + spin * t}deg)`;
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  setTimeout(() => document.body.removeChild(container), 1600);
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, icon = "📅", type = "add", title = null) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, msg, icon, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

function ToastStack({ toasts }) {
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:99998, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "achievement" ? "linear-gradient(135deg,#1e293b,#0f172a)" : "#1e293b",
          color:"#fff", padding:"12px 18px", borderRadius:12,
          fontSize:13, fontWeight:600, maxWidth:320,
          boxShadow:"0 8px 32px rgba(0,0,0,0.35)",
          borderLeft: t.type === "achievement" ? "4px solid #f59e0b" : "4px solid #3B6EF8",
          animation:"calSlideInRight 0.3s ease", display:"flex", alignItems:"center", gap:10,
        }}>
          <span style={{ fontSize:20 }}>{t.icon}</span>
          <div>
            {t.title && <div style={{ fontSize:11, fontWeight:700, color:"#f59e0b", textTransform:"uppercase", letterSpacing:0.5, marginBottom:2 }}>{t.title}</div>}
            {t.msg}
          </div>
        </div>
      ))}
      <style>{`@keyframes calSlideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

function useXP(storageKey = "calendar_xp") {
  const [xp, setXP] = useState(() => Number(localStorage.getItem(storageKey)) || 0);
  const gain = useCallback((amount) => {
    setXP(prev => {
      const next = prev + amount;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);
  return { xp, gain };
}

function XPBar({ xp }) {
  const level  = Math.floor(xp / 100) + 1;
  const pct    = xp % 100;
  const titles = ["Intern","Junior","Analyst","Senior","Manager","Director","VP","C-Suite","Legend","GOD MODE"];
  const title  = titles[Math.min(level - 1, titles.length - 1)];
  const colors = ["#94a3b8","#60a5fa","#34d399","#a78bfa","#f59e0b","#f97316","#ef4444","#ec4899","#06b6d4","#fbbf24"];
  const color  = colors[Math.min(level - 1, colors.length - 1)];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, background:T.white, border:`1px solid ${T.slate200}`, borderRadius:10, padding:"8px 14px" }}>
      <div style={{ textAlign:"center", minWidth:40 }}>
        <div style={{ fontSize:18, lineHeight:1 }}>📅</div>
        <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:0.5, textTransform:"uppercase" }}>Lv.{level}</div>
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:11, fontWeight:700, color }}>{title}</span>
          <span style={{ fontSize:10, color:T.slate400 }}>{xp} XP</span>
        </div>
        <div style={{ height:5, background:T.slate200, borderRadius:99, overflow:"hidden" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${color},${color}cc)`, borderRadius:99, transition:"width 0.6s ease" }} />
        </div>
        <div style={{ fontSize:9, color:T.slate400, marginTop:2 }}>{100 - pct} XP to next level</div>
      </div>
    </div>
  );
}

function AchievementShelf({ data, newlyUnlocked }) {
  return (
    <div style={{ background:T.white, border:`1px solid ${T.slate200}`, borderRadius:10, padding:"10px 14px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:T.slate400, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>🏆 Achievements</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {CAL_ACHIEVEMENTS.map(a => {
          const done  = a.check(data);
          const isNew = newlyUnlocked.includes(a.id);
          return (
            <div key={a.id} title={`${a.title}: ${a.desc}`} style={{
              width:38, height:38, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20, cursor:"default",
              background: done ? (isNew ? "#fef9c3" : T.slate100) : "#f8fafc",
              border:`1px solid ${done ? (isNew ? "#f59e0b" : T.slate200) : "#e2e8f0"}`,
              opacity: done ? 1 : 0.3, filter: done ? "none" : "grayscale(1)",
              transform: isNew ? "scale(1.15)" : "scale(1)",
              transition:"all 0.3s ease",
              boxShadow: isNew ? "0 0 0 3px #f59e0b40" : "none",
            }}>{a.icon}</div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:T.slate400, marginTop:6 }}>{CAL_ACHIEVEMENTS.filter(a => a.check(data)).length}/{CAL_ACHIEVEMENTS.length} unlocked — hover for details</div>
    </div>
  );
}

function DailyVibeBar() {
  const h    = new Date().getHours();
  const vibe = CAL_VIBES.find(v => h >= v.hour[0] && h < v.hour[1]) || CAL_VIBES[0];
  const day  = new Date().toLocaleDateString("en", { weekday:"long" });
  const isMonday = new Date().getDay() === 1;
  const isFriday = new Date().getDay() === 5;
  const bonus = isMonday ? " Monday: the week is full of promise and pending events." : isFriday ? " Friday! Check what's due. Then leave anyway." : "";
  return (
    <div style={{ background:`linear-gradient(135deg,#0f172a,#1e293b)`, borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:12 }}>
      <span style={{ fontSize:22 }}>{vibe.emoji}</span>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#fff", fontFamily:FONT }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:1, fontFamily:FONT }}>{day} · Your boss has no idea how much is in this calendar. Strategic advantage.</div>
      </div>
    </div>
  );
}

// ─── End Fun Layer ─────────────────────────────────────────────────────────────

// ─── Normalized event builder ─────────────────────────────────────────────────
const buildCalendarEvents = (data) => {
  const todayStr = new Date().toISOString().split("T")[0];

  const tasks = (data.tasks || []).map((t, idx) => {
    if (!t || !t.due) return null;
    const isOverdue = t.due < todayStr && t.status !== "Done";
    return {
      id: `task-due-${t.id ?? idx}`,
      type: "Task",
      title: t.title,
      date: t.due,
      priority: t.priority,
      status: t.status ?? null,
      assigned: t.assigned || "",
      milestone: t.milestone || false,
      isOverdue,
      refId: t.id,
      entityType: "task",
      color: T.blue,
      borderColor: isOverdue ? T.red : t.status === "Done" ? T.green : null,
    };
  }).filter(Boolean);

  const taskStarts = (data.tasks || [])
    .filter((t) => t && t.start && t.start !== t.due)
    .map((t, idx) => ({
      id: `task-start-${t.id ?? idx}`,
      type: "Task",
      title: `\u25B6 ${t.title}`,
      date: t.start,
      priority: t.priority,
      status: t.status ?? null,
      assigned: t.assigned || "",
      milestone: false,
      isOverdue: false,
      refId: t.id,
      entityType: "task",
      color: T.blue,
      borderColor: null,
    }));

  const invoices = (data.accounting || [])
    .filter((i) => i && i.status !== "Paid" && i.due)
    .map((i, idx) => {
      const isOverdue = i.due < todayStr;
      return {
        id: `invoice-${i.id ?? (i.client + "-" + idx)}`,
        type: "Invoice",
        title: i.client,
        date: i.due,
        priority: null,
        status: i.status ?? null,
        assigned: "",
        milestone: false,
        isOverdue,
        refId: i.id,
        entityType: "invoice",
        color: T.violet,
        borderColor: isOverdue ? T.red : null,
        amount: i.amount,
      };
    });

  const renewals = (data.clients || [])
    .filter((c) => c && c.renewal)
    .map((c, idx) => ({
      id: `renewal-${c.id ?? (c.name + "-" + idx)}`,
      type: "Renewal",
      title: c.name,
      date: c.renewal,
      priority: null,
      status: null,
      assigned: "",
      milestone: false,
      isOverdue: c.renewal < todayStr,
      refId: c.id,
      entityType: "client",
      color: T.orange,
      borderColor: c.renewal < todayStr ? T.red : null,
    }));

  return [...tasks, ...taskStarts, ...invoices, ...renewals];
};

// ─── Type config ──────────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  Task:    { color: T.blue,   label: "Tasks",    icon: "📋" },
  Invoice: { color: T.violet, label: "Invoices", icon: "💳" },
  Renewal: { color: T.orange, label: "Renewals", icon: "🔁" },
};

const PRIORITY_CONFIG = {
  High:   { color: T.red,   bg: "#FEF2F2" },
  Medium: { color: T.amber, bg: "#FFFBEB" },
  Low:    { color: T.green, bg: "#ECFDF5" },
};

const STATUS_OPTIONS = ["All", "Pending", "In Progress", "Done", "Overdue"];
const PRIORITY_OPTIONS = ["All", "High", "Medium", "Low"];

// ─── Overdue Alert Banner ─────────────────────────────────────────────────────
const OverdueBanner = ({ events, onDismiss }) => {
  const overdue = events.filter((e) => e.isOverdue);
  if (overdue.length === 0) return null;

  const byType = overdue.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "11px 16px",
      background: "linear-gradient(100deg, #fff1f3 0%, #fff5f5 60%, #fff 100%)",
      border: `1px solid #fda4af`,
      borderLeft: `4px solid ${T.red}`,
      borderRadius: T.radius,
      animation: "slideDown 0.3s cubic-bezier(0.22,1,0.36,1)",
      boxShadow: "0 2px 12px rgba(244,63,94,0.10)",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: T.red, display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 4px 10px ${T.red}44`,
      }}>
        <span style={{ fontSize: 15 }}>⚠️</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, color: T.red, fontSize: 13, lineHeight: 1 }}>
          {overdue.length} overdue item{overdue.length > 1 ? "s" : ""} need attention
        </div>
        <div style={{ fontSize: 11, color: T.slate600, marginTop: 3 }}>
          {Object.entries(byType).map(([type, n]) => (
            <span key={type} style={{ marginRight: 8, background: "#fff", padding: "1px 7px", borderRadius: 20, border: "1px solid #fecaca", color: T.red, fontWeight: 600 }}>
              {n} {type}{n > 1 ? "s" : ""}
            </span>
          ))}
        </div>
      </div>
      <button onClick={onDismiss} style={{
        background: "#fecaca", border: "none", cursor: "pointer",
        color: T.red, fontSize: 12, lineHeight: 1, padding: "5px 10px",
        borderRadius: 6, fontWeight: 700,
      }}>Dismiss</button>
    </div>
  );
};

// ─── Analytics Bar ────────────────────────────────────────────────────────────
const AnalyticsBar = ({ allEvents, data }) => {
  const todayStr = new Date().toISOString().split("T")[0];
  const todayEvents = allEvents.filter((e) => e.date === todayStr);
  const overdue = allEvents.filter((e) => e.isOverdue);
  const invoicesDue = allEvents.filter((e) => e.type === "Invoice" && e.date === todayStr);
  const invoiceTotal = invoicesDue.reduce((sum, e) => {
    const inv = (data.accounting || []).find((i) => i.id === e.refId);
    return sum + (inv?.amount || 0);
  }, 0);
  const renewalsThisWeek = (() => {
    const d = new Date();
    const start = new Date(d); start.setDate(d.getDate() - d.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return allEvents.filter((e) => {
      if (e.type !== "Renewal") return false;
      const dt = new Date(e.date + "T00:00:00");
      return dt >= start && dt <= end;
    }).length;
  })();

  const stats = [
    { label: "Today", value: todayEvents.length, color: T.blue, bg: "#EFF6FF", icon: "📋" },
    { label: "Overdue", value: overdue.length, color: overdue.length > 0 ? T.red : T.green, bg: overdue.length > 0 ? "#FEF2F2" : "#ECFDF5", icon: overdue.length > 0 ? "⚠️" : "✅" },
    { label: "Due Today", value: invoiceTotal > 0 ? `₹${(invoiceTotal / 1000).toFixed(0)}k` : invoicesDue.length, color: T.violet, bg: "#F5F3FF", icon: "💰" },
    { label: "Renewals/wk", value: renewalsThisWeek, color: T.orange, bg: "#FFF7ED", icon: "🔁" },
  ];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
      padding: "12px",
      background: "linear-gradient(135deg, #f0f4f8 0%, #f8fafc 100%)",
      borderRadius: T.radius,
      border: `1px solid ${T.slate200}`,
      boxShadow: T.shadow,
    }}>
      {stats.map(({ label, value, color, bg, icon }) => (
        <div key={label} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px",
          background: T.white,
          borderRadius: T.radiusSm,
          border: `1px solid ${T.slate200}`,
          boxShadow: "0 1px 4px rgba(13,26,38,0.06)",
          transition: "transform 0.15s, box-shadow 0.15s",
          cursor: "default",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = T.shadowMd; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 1px 4px rgba(13,26,38,0.06)"; }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: bg,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, flexShrink: 0,
            border: `1.5px solid ${color}22`,
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1, fontFamily: FONT }}>{value}</div>
            <div style={{ fontSize: 10, color: T.slate400, marginTop: 2, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Event pill ───────────────────────────────────────────────────────────────
const EventPill = ({ event, compact = false, onClick }) => (
  <div
    onClick={(e) => { e.stopPropagation(); onClick?.(event); }}
    style={{
      fontSize: compact ? 9 : 10,
      background: event.isOverdue ? "#fff1f2" : event.color + "12",
      color: event.isOverdue ? T.red : event.color,
      borderRadius: 5,
      padding: compact ? "1px 4px" : "3px 6px",
      marginBottom: 2,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      borderLeft: `3px solid ${event.isOverdue ? T.red : event.borderColor || event.color}`,
      boxShadow: event.isOverdue ? `0 0 0 1px #f4375e22` : "none",
      opacity: event.status === "Done" ? 0.45 : 1,
      fontWeight: event.priority === "High" ? 700 : 600,
      cursor: "pointer",
      transition: "all 0.12s",
      letterSpacing: "-0.01em",
      fontFamily: FONT,
      textDecoration: event.status === "Done" ? "line-through" : "none",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.9)"; e.currentTarget.style.transform = "translateX(1px)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}
  >
    {event.milestone ? "🏁 " : ""}
    {event.type === "Invoice" ? "💳 " : ""}
    {event.type === "Renewal" ? "🔁 " : ""}
    {event.isOverdue ? "⚠ " : ""}
    {event.title}
  </div>
);

// ─── Slide-in Side Panel ──────────────────────────────────────────────────────
const SidePanel = ({ selectedDay, events, data, setData, onClose, onQuickAdd, onDone }) => {
  const panelRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (selectedDay) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [selectedDay]);

  useEffect(() => {
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) onClose(); };
    if (selectedDay) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectedDay, onClose]);

  if (!selectedDay) return null;

  const dayEvents = events
    .filter((e) => e.date === selectedDay)
    .sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.priority === "High" && b.priority !== "High") return -1;
      if (a.priority !== "High" && b.priority === "High") return 1;
      return 0;
    });
  const overdueCount = dayEvents.filter((e) => e.isOverdue).length;
  const dayLabel = new Date(selectedDay + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long", month: "long", day: "numeric",
  });

  const markDone = (taskId, e) => {
    const updated = (data.tasks || []).map((t) =>
      t.id === taskId ? { ...t, status: "Done", progress: 100 } : t
    );
    setData({ ...data, tasks: updated });
    if (onDone && e) onDone(e);
  };

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.25)",
        zIndex: 300, transition: "opacity 0.25s",
        opacity: visible ? 1 : 0,
      }} />

      {/* Panel */}
      <div ref={panelRef} style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 420, maxWidth: "94vw",
        background: T.white,
        boxShadow: "-8px 0 50px rgba(13,26,38,0.22)",
        zIndex: 400,
        display: "flex", flexDirection: "column",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
        fontFamily: FONT,
      }}>

        {/* Header */}
        <div style={{
          padding: "22px 24px 18px",
          borderBottom: `1px solid ${T.slate200}`,
          background: "linear-gradient(135deg, #f0f6ff 0%, #f8fafc 60%, #fff 100%)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: -20, right: -20, width: 100, height: 100,
            borderRadius: "50%", background: `${T.blue}08`,
            pointerEvents: "none",
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.slate400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
                {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
              </div>
              <div style={{ fontWeight: 800, fontSize: 19, color: T.slate900, lineHeight: 1.2, letterSpacing: "-0.02em" }}>{dayLabel}</div>
              {overdueCount > 0 && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  marginTop: 9, padding: "4px 12px",
                  background: "#fff1f3", borderRadius: 20,
                  border: `1px solid #fda4af`,
                  boxShadow: "0 2px 8px rgba(244,63,94,0.12)",
                }}>
                  <span style={{ fontSize: 11 }}>⚠️</span>
                  <span style={{ fontSize: 11, color: T.red, fontWeight: 700 }}>{overdueCount} overdue</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { onClose(); onQuickAdd(selectedDay); }}
                style={{
                  padding: "8px 16px", fontSize: 12, fontWeight: 700,
                  background: `linear-gradient(135deg, ${T.blue} 0%, ${T.blueDark} 100%)`,
                  color: T.white,
                  border: "none", borderRadius: T.radiusSm, cursor: "pointer",
                  boxShadow: `0 3px 12px ${T.blue}55`,
                  fontFamily: FONT, letterSpacing: "-0.01em",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                + Add Task
              </button>
              <button onClick={onClose} style={{
                background: T.slate100, border: `1px solid ${T.slate200}`,
                width: 36, height: 36, borderRadius: T.radiusSm,
                cursor: "pointer", fontSize: 16, color: T.slate500,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = T.slate200; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = T.slate100; }}
              >×</button>
            </div>
          </div>
        </div>

        {/* Event list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          {dayEvents.length === 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              flex: 1, gap: 12, color: T.slate400, padding: "40px 20px",
            }}>
              <div style={{ fontSize: 40, filter: "grayscale(0.3)" }}>🗓</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.slate600 }}>Nothing scheduled</div>
              <div style={{ fontSize: 12, color: T.slate400, textAlign: "center" }}>Click "+ Add Task" to get started</div>
            </div>
          )}

          {dayEvents.map((ev) => {
            const task = ev.entityType === "task"
              ? (data.tasks || []).find((t) => t.id === ev.refId)
              : null;
            const pc = ev.priority ? PRIORITY_CONFIG[ev.priority] : null;

            return (
              <div key={ev.id} style={{
                padding: "14px 16px",
                background: ev.isOverdue ? "#fff8f8" : T.white,
                borderLeft: `4px solid ${ev.isOverdue ? T.red : ev.borderColor || ev.color}`,
                borderRadius: `0 ${T.radiusSm}px ${T.radiusSm}px 0`,
                border: `1px solid ${ev.isOverdue ? "#fda4af" : T.slate200}`,
                borderLeftWidth: 4,
                opacity: ev.status === "Done" ? 0.5 : 1,
                transition: "all 0.15s",
                boxShadow: "0 1px 4px rgba(13,26,38,0.04)",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = T.shadowMd; e.currentTarget.style.transform = "translateX(2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(13,26,38,0.04)"; e.currentTarget.style.transform = ""; }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9,
                    background: ev.isOverdue ? "#fff1f2" : ev.color + "15",
                    border: `1.5px solid ${ev.isOverdue ? "#fda4af" : ev.color + "30"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, flexShrink: 0,
                    boxShadow: ev.isOverdue ? "0 2px 8px rgba(244,63,94,0.15)" : "none",
                  }}>
                    {ev.milestone ? "🏁" : ev.type === "Invoice" ? "💳" : ev.type === "Renewal" ? "🔁" : "📋"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: ev.status === "Done" ? T.slate400 : T.slate800,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      letterSpacing: "-0.01em",
                      textDecoration: ev.status === "Done" ? "line-through" : "none",
                    }}>
                      {ev.title}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {/* Type badge */}
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: ev.color,
                        background: ev.color + "15", borderRadius: 20, padding: "2px 9px",
                        border: `1px solid ${ev.color}25`,
                      }}>{ev.type}</span>

                      {/* Priority badge */}
                      {ev.priority && pc && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: pc.color, background: pc.bg,
                          borderRadius: 20, padding: "2px 9px",
                          border: `1px solid ${pc.color}30`,
                        }}>{ev.priority}</span>
                      )}

                      {/* Status badge */}
                      {ev.status && (
                        <span style={{
                          fontSize: 10, color: ev.status === "Done" ? T.green : T.slate600,
                          fontWeight: ev.status === "Done" ? 700 : 500,
                          background: ev.status === "Done" ? "#ecfdf5" : T.slate100,
                          padding: "2px 8px", borderRadius: 20,
                        }}>{ev.status === "Done" ? "✓ Done" : ev.status}</span>
                      )}

                      {/* Overdue badge */}
                      {ev.isOverdue && (
                        <span style={{
                          fontSize: 10, color: T.red, fontWeight: 700,
                          background: "#fff1f3", borderRadius: 20, padding: "2px 9px",
                          border: `1px solid #fda4af`,
                        }}>⚠ Overdue</span>
                      )}

                      {/* Assigned */}
                      {ev.assigned && (
                        <span style={{
                          fontSize: 10, color: T.slate400,
                          display: "flex", alignItems: "center", gap: 3,
                        }}>👤 {ev.assigned}</span>
                      )}
                    </div>
                  </div>

                  {/* Mark done button */}
                  {task && task.status !== "Done" && (
                    <button
                      onClick={() => markDone(task.id)}
                      style={{
                        fontSize: 11, padding: "6px 12px",
                        background: `linear-gradient(135deg, ${T.green} 0%, ${T.teal} 100%)`,
                        color: T.white,
                        border: "none", borderRadius: T.radiusSm, cursor: "pointer",
                        fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                        fontFamily: FONT,
                        boxShadow: `0 2px 8px ${T.green}44`,
                        transition: "opacity 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      ✓ Done
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// ─── Agenda View ──────────────────────────────────────────────────────────────
const AgendaView = ({ allEvents, month, year, onEventClick }) => {
  const todayStr = new Date().toISOString().split("T")[0];
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const byDate = {};
  allEvents.forEach((e) => {
    if (!e.date || !e.date.startsWith(prefix)) return;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const sortedDates = Object.keys(byDate).sort();

  if (sortedDates.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "50px 20px", color: T.slate400, fontFamily: FONT }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.slate600 }}>No events this month</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>Try changing your filters or navigate to another month</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, fontFamily: FONT }}>
      {sortedDates.map((dateStr) => {
        const events = byDate[dateStr];
        const isToday = dateStr === todayStr;
        const isPast = dateStr < todayStr;
        const label = new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
          weekday: "short", month: "short", day: "numeric",
        });
        return (
          <div key={dateStr} style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.slate100}` }}>
            {/* Date column */}
            <div style={{
              width: 96, flexShrink: 0, padding: "16px 14px",
              borderRight: `2px solid ${isToday ? T.blue : isPast ? T.slate100 : T.slate200}`,
              background: isToday ? "#f0f6ff" : "transparent",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, letterSpacing: "-0.01em",
                color: isToday ? T.blue : isPast ? T.slate300 : T.slate700,
                lineHeight: 1.4,
              }}>{label}</div>
              {isToday && (
                <div style={{
                  fontSize: 9, fontWeight: 700, color: T.white,
                  background: T.blue, borderRadius: 10, padding: "2px 7px",
                  display: "inline-block", marginTop: 5,
                  boxShadow: `0 2px 6px ${T.blue}44`,
                }}>TODAY</div>
              )}
              <div style={{ fontSize: 10, color: T.slate400, marginTop: 4, fontWeight: 600 }}>
                {events.length} item{events.length !== 1 ? "s" : ""}
              </div>
            </div>
            {/* Events column */}
            <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, background: isToday ? "#fafcff" : "transparent" }}>
              {events.map((ev) => {
                const pc = ev.priority ? PRIORITY_CONFIG[ev.priority] : null;
                return (
                  <div
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 13px",
                      background: ev.isOverdue ? "#fff8f8" : T.white,
                      borderRadius: T.radiusSm,
                      border: `1px solid ${ev.isOverdue ? "#fda4af" : T.slate200}`,
                      borderLeft: `4px solid ${ev.isOverdue ? T.red : ev.borderColor || ev.color}`,
                      cursor: "pointer",
                      opacity: ev.status === "Done" ? 0.5 : 1,
                      transition: "all 0.12s",
                      boxShadow: "0 1px 3px rgba(13,26,38,0.04)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = T.shadowMd; e.currentTarget.style.transform = "translateX(2px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(13,26,38,0.04)"; e.currentTarget.style.transform = ""; }}
                  >
                    <span style={{ fontSize: 15, flexShrink: 0 }}>
                      {ev.milestone ? "🏁" : ev.type === "Invoice" ? "💳" : ev.type === "Renewal" ? "🔁" : "📋"}
                    </span>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: T.slate800, letterSpacing: "-0.01em", textDecoration: ev.status === "Done" ? "line-through" : "none" }}>
                      {ev.title}
                    </div>
                    {ev.isOverdue && <span style={{ fontSize: 10, color: T.red, fontWeight: 700, background: "#fff1f3", borderRadius: 20, padding: "2px 8px", border: "1px solid #fda4af", flexShrink: 0 }}>⚠ Overdue</span>}
                    {pc && <span style={{ fontSize: 10, fontWeight: 700, color: pc.color, background: pc.bg, borderRadius: 20, padding: "2px 8px", flexShrink: 0 }}>{ev.priority}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, color: ev.color, background: ev.color + "15", borderRadius: 20, padding: "2px 8px", border: `1px solid ${ev.color}25`, flexShrink: 0 }}>{ev.type}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Week View ────────────────────────────────────────────────────────────────
const WeekView = ({ allEvents, month, year, onDayClick }) => {
  const today = new Date();
  // Show current or first week of month
  const anchor = today.getMonth() === month && today.getFullYear() === year
    ? today
    : new Date(year, month, 1);
  const weekStart = new Date(anchor);
  weekStart.setDate(anchor.getDate() - anchor.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayStr = today.toISOString().split("T")[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: T.slate200, border: `1px solid ${T.slate200}`, borderRadius: T.radius, overflow: "hidden", fontFamily: FONT }}>
      {days.map((d, i) => {
        const dateStr = d.toISOString().split("T")[0];
        const events = allEvents.filter((e) => e.date === dateStr);
        const isToday = dateStr === todayStr;
        const isCurrentMonth = d.getMonth() === month;

        return (
          <div key={i}
            onClick={() => onDayClick(dateStr)}
            style={{
              background: T.white,
              minHeight: 120, padding: 8,
              opacity: isCurrentMonth ? 1 : 0.45,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#F0F7FF"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = T.white; }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: T.slate400, textTransform: "uppercase", letterSpacing: "0.06em" }}>{dayNames[i]}</div>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: isToday ? T.blue : "transparent",
                color: isToday ? T.white : T.slate800,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
              }}>{d.getDate()}</div>
            </div>
            {events.slice(0, 4).map((ev) => <EventPill key={ev.id} event={ev} compact onClick={() => onDayClick(dateStr)} />)}
            {events.length > 4 && <div style={{ fontSize: 9, color: T.blue, fontWeight: 700 }}>+{events.length - 4}</div>}
          </div>
        );
      })}
    </div>
  );
};

const DATE_RANGE_OPTIONS = ["All time", "Today", "This week", "This month"];

// ─── Filter Bar ───────────────────────────────────────────────────────────────
const FilterBar = ({ activeTypes, toggleType, filters, setFilters }) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const btnRef = useRef(null);
  const hasActiveFilters =
    filters.priority !== "All" || filters.status !== "All" ||
    filters.assignee || filters.dateRange !== "All time" || !filters.showDone;
  const activeCount = [
    filters.priority !== "All",
    filters.status !== "All",
    !!filters.assignee,
    filters.dateRange !== "All time",
    !filters.showDone,
  ].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontFamily: FONT }}>
      {/* Type toggles */}
      {Object.entries(TYPE_CONFIG).map(([type, { color, label, icon }]) => (
        <button key={type} onClick={() => toggleType(type)} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 20,
          border: `1.5px solid ${activeTypes.has(type) ? color : T.slate200}`,
          background: activeTypes.has(type) ? color + "15" : T.white,
          cursor: "pointer",
          color: activeTypes.has(type) ? color : T.slate400,
          fontWeight: activeTypes.has(type) ? 700 : 500,
          fontSize: 11, fontFamily: FONT,
          transition: "all 0.15s",
        }}>
          <span>{icon}</span> {type}
        </button>
      ))}

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: T.slate200 }} />

      {/* Smart filter button */}
      <div style={{ position: "relative" }}>
        <button ref={btnRef} onClick={() => setOpen((o) => !o)} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 20,
          border: `1.5px solid ${hasActiveFilters ? T.blue : T.slate200}`,
          background: hasActiveFilters ? "#EFF6FF" : T.white,
          cursor: "pointer", fontSize: 11, fontFamily: FONT,
          color: hasActiveFilters ? T.blue : T.slate600,
          fontWeight: hasActiveFilters ? 700 : 500,
          transition: "all 0.15s",
        }}>
          ⚙ Filters {activeCount > 0 && (
            <span style={{
              background: T.blue, color: T.white, borderRadius: "50%",
              width: 16, height: 16, fontSize: 9, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>{activeCount}</span>
          )}
        </button>

        {open && (
          <div ref={dropdownRef} style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            background: T.white, borderRadius: 12,
            border: `1px solid ${T.slate200}`,
            boxShadow: T.shadowLg,
            padding: 16, zIndex: 200, minWidth: 240,
            display: "flex", flexDirection: "column", gap: 14,
            fontFamily: FONT,
            animation: "slideDown 0.18s cubic-bezier(0.22,1,0.36,1)",
          }}>
            {/* Date Range */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.slate400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Date Range</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {DATE_RANGE_OPTIONS.map((r) => (
                  <button key={r} onClick={() => setFilters((f) => ({ ...f, dateRange: r }))} style={{
                    padding: "2px 9px", borderRadius: 20, fontSize: 11, fontFamily: FONT, cursor: "pointer",
                    border: `1.5px solid ${filters.dateRange === r ? T.blue : T.slate200}`,
                    background: filters.dateRange === r ? "#EFF6FF" : T.white,
                    color: filters.dateRange === r ? T.blue : T.slate600,
                    fontWeight: filters.dateRange === r ? 700 : 400,
                  }}>{r}</button>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.slate400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Priority</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PRIORITY_OPTIONS.map((p) => (
                  <button key={p} onClick={() => setFilters((f) => ({ ...f, priority: p }))} style={{
                    padding: "2px 9px", borderRadius: 20, fontSize: 11, fontFamily: FONT, cursor: "pointer",
                    border: `1.5px solid ${filters.priority === p ? T.blue : T.slate200}`,
                    background: filters.priority === p ? "#EFF6FF" : T.white,
                    color: filters.priority === p ? T.blue : T.slate600,
                    fontWeight: filters.priority === p ? 700 : 400,
                  }}>{p}</button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.slate400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Status</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {STATUS_OPTIONS.map((s) => (
                  <button key={s} onClick={() => setFilters((f) => ({ ...f, status: s }))} style={{
                    padding: "2px 9px", borderRadius: 20, fontSize: 11, fontFamily: FONT, cursor: "pointer",
                    border: `1.5px solid ${filters.status === s ? T.blue : T.slate200}`,
                    background: filters.status === s ? "#EFF6FF" : T.white,
                    color: filters.status === s ? T.blue : T.slate600,
                    fontWeight: filters.status === s ? 700 : 400,
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.slate400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Assignee</div>
              <input
                value={filters.assignee || ""}
                onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))}
                placeholder="Filter by name…"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "5px 10px", fontSize: 11, fontFamily: FONT,
                  border: `1.5px solid ${T.slate200}`, borderRadius: 6, outline: "none",
                }}
                onFocus={(e) => { e.target.style.borderColor = T.blue; }}
                onBlur={(e) => { e.target.style.borderColor = T.slate200; }}
              />
            </div>

            {/* Show Done toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.slate700 }}>Show completed</div>
              <button
                onClick={() => setFilters((f) => ({ ...f, showDone: !f.showDone }))}
                style={{
                  width: 36, height: 20, borderRadius: 20, border: "none", cursor: "pointer",
                  background: filters.showDone ? T.green : T.slate300,
                  position: "relative", transition: "background 0.2s",
                  padding: 0, flexShrink: 0,
                }}
              >
                <div style={{
                  position: "absolute", top: 2,
                  left: filters.showDone ? 18 : 2,
                  width: 16, height: 16, borderRadius: "50%", background: T.white,
                  transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                }} />
              </button>
            </div>

            {/* Clear */}
            {hasActiveFilters && (
              <button onClick={() => { setFilters({ priority: "All", status: "All", assignee: "", dateRange: "All time", showDone: true }); setOpen(false); }} style={{
                padding: "6px", borderRadius: 6, border: "none",
                background: "#FEF2F2", color: T.red, fontSize: 11, fontWeight: 700,
                cursor: "pointer", fontFamily: FONT,
              }}>
                ✕ Clear all filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const CalendarTab = ({ data, setData }) => {
  // Safe array refs — guard against undefined on first render
  data = { ...(data || {}) };
  data.leads      = data.leads      || [];
  data.clients    = data.clients    || [];
  data.tasks      = data.tasks      || [];
  data.accounting = data.accounting || [];
  data.inventory  = data.inventory  || [];
  data.suppliers  = data.suppliers  || [];
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Multi-user sync integration
  const currentUser = { userId: "user_1", userName: "Current User", userRole: "Admin" };
  const { activeUsers, tabLocks, requestLock, releaseLock, broadcastUpdate, broadcastTabChange } = useMultiUserSync(currentUser.userId, currentUser.userName, currentUser.userRole);

  // Workflow integration
  const calendarWorkflow = workflowEngine.getWorkflowByEntityType("calendar");
  const [slaAlerts, setSlaAlerts] = useState([]);
  const [workflowHistory, setWorkflowHistory] = useState([]);

  // Check SLA alerts
  useEffect(() => {
    if (calendarWorkflow) {
      const alerts = workflowEngine.getSLAAlerts(calendarWorkflow.id, data.tasks);
      setSlaAlerts(alerts);
    }
  }, [data.tasks, calendarWorkflow]);

  // Broadcast tab change
  useEffect(() => {
    broadcastTabChange("calendar");
  }, [broadcastTabChange]);

  // Mobile responsiveness
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isPhone = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth < 1100;
  const isDesktop = windowWidth >= 1100;

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [viewMode, setViewMode] = useState("month"); // "month" | "week" | "agenda"
  const [activeTypes, setActiveTypes] = useState(new Set(["Task", "Invoice", "Renewal"]));
  const [filters, setFilters] = useState({ priority: "All", status: "All", assignee: "", dateRange: "All time", showDone: true });
  const [search, setSearch] = useState("");
  const parsedCalQuery = useMemo(() => parseOperatorQuery(search), [search]);
  const CAL_SUGGESTION_FIELDS = ["status", "priority", "type", "assignee"];
  const { suggestions: calSuggestions, showSuggestions: calShowSuggestions, onSuggestionSelect: calOnSuggestionSelect } = useSearchSuggestions(search, CAL_SUGGESTION_FIELDS, setSearch);
  const [quickAdd, setQuickAdd] = useState(null);
  const [quickLabel, setQuickLabel] = useState("");
  const [selectedDay, setSelectedDay] = useState(null);
  const [hoveredDay, setHoveredDay] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [dismissedOverdue, setDismissedOverdue] = useState(false);

  // 15+ additional features for CalendarTab
  const [showEventReminders, setShowEventReminders] = useState(false);
  const [showRecurringEvents, setShowRecurringEvents] = useState(false);
  const [showCalendarSync, setShowCalendarSync] = useState(false);
  const [showEventTemplates, setShowEventTemplates] = useState(false);
  const [showTimeBlocking, setShowTimeBlocking] = useState(false);
  const [showCalendarSharing, setShowCalendarSharing] = useState(false);
  const [showEventCategories, setShowEventCategories] = useState(false);
  const [showCalendarAnalytics, setShowCalendarAnalytics] = useState(false);
  const [showEventHistory, setShowEventHistory] = useState(false);
  const [showCalendarExport, setShowCalendarExport] = useState(false);
  const [showMultiCalendar, setShowMultiCalendar] = useState(false);
  const [showEventCollaboration, setShowEventCollaboration] = useState(false);
  const [showCalendarIntegrations, setShowCalendarIntegrations] = useState(false);
  const [showEventAutomation, setShowEventAutomation] = useState(false);
  const [showCalendarCustomization, setShowCalendarCustomization] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ── Fun Layer hooks ──────────────────────────────────────────────────────
  const { xp, gain } = useXP("calendar_xp");
  const { toasts, push } = useToasts();
  const [newlyUnlocked, setNewlyUnlocked] = useState([]);
  const unlockedRef = useRef(new Set(
    (() => { try { return JSON.parse(localStorage.getItem("cal_achievements") || "[]"); } catch { return []; } })()
  ));

  // Achievement watcher
  useEffect(() => {
    const justUnlocked = [];
    CAL_ACHIEVEMENTS.forEach(a => {
      if (!unlockedRef.current.has(a.id) && a.check(data)) {
        unlockedRef.current.add(a.id);
        justUnlocked.push(a.id);
        gain(50);
        push(`${a.title} — ${a.desc}`, a.icon, "achievement", "Achievement Unlocked!");
      }
    });
    if (justUnlocked.length > 0) {
      localStorage.setItem("cal_achievements", JSON.stringify([...unlockedRef.current]));
      setNewlyUnlocked(prev => [...prev, ...justUnlocked]);
      setTimeout(() => setNewlyUnlocked(prev => prev.filter(id => !justUnlocked.includes(id))), 3000);
    }
  }, [data]);

  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // All events from data
  const rawEvents = useMemo(() => buildCalendarEvents(data), [data]);

  // Apply type + smart filters
  const allEvents = useMemo(() => {
    const todayD = new Date(todayStr + "T00:00:00");
    const weekStart = new Date(todayD); weekStart.setDate(todayD.getDate() - todayD.getDay());
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    return rawEvents.filter((e) => {
      if (!e) return false;
      if (!activeTypes.has(e.type)) return false;
      if (filters.priority !== "All" && e.priority !== filters.priority) return false;
      if (filters.status === "Overdue") {
        if (!e.isOverdue) return false;
      } else if (filters.status !== "All" && e.status !== filters.status) return false;
      if (filters.assignee && !e.assigned?.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
      if (!filters.showDone && e.status === "Done") return false;
      if (parsedCalQuery) {
        const { terms = [], operators = {} } = parsedCalQuery;
        if (operators.status && e.status !== operators.status) return false;
        if (operators.priority && e.priority !== operators.priority) return false;
        if (operators.type && e.type !== operators.type) return false;
        if (operators.assignee && !e.assigned?.toLowerCase().includes(operators.assignee.toLowerCase())) return false;
        if (terms.length && !terms.every(t => e.title.toLowerCase().includes(t.toLowerCase()))) return false;
      } else if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filters.dateRange === "Today" && e.date !== todayStr) return false;
      if (filters.dateRange === "This week") {
        const d = new Date(e.date + "T00:00:00");
        if (d < weekStart || d > weekEnd) return false;
      }
      if (filters.dateRange === "This month" && !e.date.startsWith(monthPrefix)) return false;
      return true;
    });
  }, [rawEvents, activeTypes, filters, search]);

  const getEvents = (d) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return allEvents
      .filter((e) => e.date === dateStr)
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        if (a.priority === "High" && b.priority !== "High") return -1;
        if (a.priority !== "High" && b.priority === "High") return 1;
        return 0;
      });
  };

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1);
    gain(1);
    push(NAV_TOASTS[Math.floor(Math.random() * NAV_TOASTS.length)], "📅", "nav");
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1);
    gain(1);
    push(NAV_TOASTS[Math.floor(Math.random() * NAV_TOASTS.length)], "📅", "nav");
  };
  const goToday = () => { setMonth(today.getMonth()); setYear(today.getFullYear()); };

  const isToday = (d) => d && today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;

  const makeDateStr = (d) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const handleDayClick = (d) => {
    const dateStr = typeof d === "string" ? d : makeDateStr(d);
    setSelectedDay(dateStr);
    setQuickAdd(null);
  };

  const handleQuickSave = (e) => {
    if (!quickLabel.trim()) { setQuickAdd(null); return; }
    const newTask = {
      id: `T-CAL-${Date.now()}`,
      title: quickLabel,
      assigned: "",
      priority: "Medium",
      status: "Pending",
      due: quickAdd.date,
      ref: "",
    };
    setData({ ...data, tasks: [...(data.tasks || []), newTask] });
    setQuickAdd(null);
    setQuickLabel("");
    gain(5);
    push(QUICK_ADD_TOASTS[Math.floor(Math.random() * QUICK_ADD_TOASTS.length)], "📅", "add");
  };

  const toggleType = (type) => {
    const next = new Set(activeTypes);
    next.has(type) ? next.delete(type) : next.add(type);
    setActiveTypes(next);
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: FONT, position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {/* ── Fun Layer UI ── */}
      <DailyVibeBar />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <XPBar xp={xp} />
        <AchievementShelf data={data} newlyUnlocked={newlyUnlocked} />
      </div>
      <ToastStack toasts={toasts} />

      {/* ── Overdue Alert ── */}
      {!dismissedOverdue && (
        <OverdueBanner events={rawEvents} onDismiss={() => setDismissedOverdue(true)} />
      )}

      {/* ── Analytics Bar ── */}
      <AnalyticsBar allEvents={allEvents} data={data} />

      {/* ── Header Row 1: Nav + View Toggle ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Nav */}
        <button onClick={prevMonth} style={{ padding: "5px 12px", border: `1px solid ${T.slate200}`, borderRadius: 7, background: T.white, cursor: "pointer", fontSize: 16, lineHeight: 1, color: T.slate600 }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 15, minWidth: 155, textAlign: "center", color: T.slate900, fontFamily: FONT }}>{months[month]} {year}</span>
        <button onClick={nextMonth} style={{ padding: "5px 12px", border: `1px solid ${T.slate200}`, borderRadius: 7, background: T.white, cursor: "pointer", fontSize: 16, lineHeight: 1, color: T.slate600 }}>›</button>
        <button onClick={goToday} style={{ padding: "5px 12px", border: `1.5px solid ${T.blue}`, borderRadius: 7, background: T.white, cursor: "pointer", fontSize: 11, fontWeight: 700, color: T.blue, fontFamily: FONT }}>Today</button>

        {/* View toggle */}
        <div style={{ display: "flex", background: T.slate100, borderRadius: 8, padding: 3, gap: 2, marginLeft: "auto" }}>
          {[["month", "📅"], ["week", "📆"], ["agenda", "☰"]].map(([mode, icon]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              padding: "4px 10px", borderRadius: 6, border: "none",
              background: viewMode === mode ? T.white : "transparent",
              boxShadow: viewMode === mode ? "0 1px 4px rgba(15,23,42,0.1)" : "none",
              cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: FONT,
              color: viewMode === mode ? T.slate900 : T.slate400,
              transition: "all 0.15s",
            }}>
              {icon} {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Header Row 2: Search + Filters ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Search bar */}
        <div style={{ position: "relative", flex: "1 1 180px", maxWidth: 280 }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, pointerEvents: "none", color: T.slate400 }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "5px 10px 5px 30px",
              fontSize: 12, fontFamily: FONT,
              border: `1.5px solid ${search ? T.blue : T.slate200}`,
              borderRadius: 20, outline: "none",
              background: search ? "#EFF6FF" : T.white,
              color: T.slate800,
              transition: "border-color 0.15s, background 0.15s",
            }}
            onFocus={(e) => { e.target.style.borderColor = T.blue; }}
            onBlur={(e) => { if (!search) e.target.style.borderColor = T.slate200; }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: T.slate300, border: "none", borderRadius: "50%",
              width: 16, height: 16, cursor: "pointer", fontSize: 9, color: T.white,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, padding: 0,
            }}>✕</button>
          )}
          {calShowSuggestions && calSuggestions.length > 0 && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:400, background:T.white, border:`1px solid ${T.slate200}`, borderRadius:8, boxShadow:"0 4px 16px rgba(0,0,0,0.10)", maxHeight:180, overflowY:"auto", marginTop:2 }}>
              {calSuggestions.map((s, i) => (
                <div key={i} onClick={() => calOnSuggestionSelect(s)} style={{ padding:"7px 12px", fontSize:12, cursor:"pointer", color:T.slate800, borderBottom:`1px solid ${T.slate100}` }}
                  onMouseEnter={e=>e.currentTarget.style.background=T.slate50}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <FilterBar
          activeTypes={activeTypes}
          toggleType={toggleType}
          filters={filters}
          setFilters={setFilters}
        />
      </div>

      {/* ── Month View ── */}
      {viewMode === "month" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: T.slate200, border: `1px solid ${T.slate200}`, borderRadius: T.radius, overflow: "hidden" }}>
          {dayNames.map((d) => (
            <div key={d} style={{ background: T.slate50, padding: "7px 8px", fontSize: 10, fontWeight: 700, color: T.slate400, textAlign: "center", letterSpacing: "0.06em", textTransform: "uppercase" }}>{d}</div>
          ))}

          {cells.map((d, i) => {
            const events = d ? getEvents(d) : [];
            const dateStr = d ? makeDateStr(d) : null;
            const isQuickAdd = quickAdd?.date === dateStr;
            const isHovered = hoveredDay === dateStr;
            const isExpanded = expandedDay === dateStr;
            const isTodayCell = isToday(d);
            const VISIBLE_LIMIT = 2;
            const overflow = events.length - VISIBLE_LIMIT;
            const hasOverdue = events.some((e) => e.isOverdue);
            const isSelected = selectedDay === dateStr;

            return (
              <div
                key={i}
                onClick={() => d && handleDayClick(d)}
                onMouseEnter={() => d && setHoveredDay(dateStr)}
                onMouseLeave={() => setHoveredDay(null)}
                style={{
                  background: d
                    ? isSelected
                      ? "#EFF6FF"
                      : isHovered
                        ? "#f8faff"
                        : T.white
                    : T.slate50,
                  minHeight: 86,
                  padding: 7,
                  opacity: d ? 1 : 0.3,
                  cursor: d ? "pointer" : "default",
                  transition: "background 0.1s",
                  outline: hasOverdue && d ? `1.5px solid #EF444428` : isSelected ? `1.5px solid ${T.blue}44` : "none",
                  outlineOffset: -1,
                  position: "relative",
                }}>
                {d && (
                  <>
                    <div style={{
                      fontSize: 11, fontWeight: 700, marginBottom: 4,
                      width: 22, height: 22, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isTodayCell ? T.blue : "transparent",
                      color: isTodayCell ? T.white : T.slate600,
                      fontFamily: FONT,
                    }}>{d}</div>

                    {isQuickAdd ? (
                      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <input
                          autoFocus
                          value={quickLabel}
                          onChange={(e) => setQuickLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleQuickSave();
                            if (e.key === "Escape") setQuickAdd(null);
                          }}
                          placeholder="Task title…"
                          style={{ fontSize: 10, padding: "2px 5px", border: `1.5px solid ${T.blue}`, borderRadius: 4, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: FONT }}
                        />
                        <div style={{ display: "flex", gap: 2 }}>
                          <button onClick={handleQuickSave} style={{ fontSize: 9, padding: "2px 5px", background: T.blue, color: T.white, border: "none", borderRadius: 4, cursor: "pointer", flex: 1, fontFamily: FONT }}>Add</button>
                          <button onClick={(e) => { e.stopPropagation(); setQuickAdd(null); }} style={{ fontSize: 9, padding: "2px 5px", background: T.slate100, border: `1px solid ${T.slate200}`, borderRadius: 4, cursor: "pointer", fontFamily: FONT }}>✕</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {(isExpanded ? events : events.slice(0, VISIBLE_LIMIT)).map((ev) => (
                          <EventPill key={ev.id} event={ev} onClick={() => handleDayClick(d)} />
                        ))}

                        {overflow > 0 && !isExpanded && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setExpandedDay(dateStr); }}
                            style={{
                              fontSize: 9, color: T.blue, fontWeight: 700,
                              cursor: "pointer", padding: "1px 5px",
                              borderRadius: 20,
                              background: T.blue + "12",
                              display: "inline-block", marginTop: 2,
                              fontFamily: FONT,
                            }}>
                            +{overflow} more
                          </div>
                        )}
                        {isExpanded && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setExpandedDay(null); }}
                            style={{ fontSize: 9, color: T.slate400, cursor: "pointer", marginTop: 2, fontFamily: FONT }}>
                            ↑ less
                          </div>
                        )}

                        {events.length === 0 && (
                          <div style={{ fontSize: 9, color: "rgba(0,0,0,0.10)", textAlign: "center", paddingTop: 6 }}>+</div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Week View ── */}
      {viewMode === "week" && (
        <WeekView allEvents={allEvents} month={month} year={year} onDayClick={handleDayClick} />
      )}

      {/* ── Agenda View ── */}
      {viewMode === "agenda" && (
        <div style={{
          border: `1px solid ${T.slate200}`, borderRadius: T.radius,
          overflow: "hidden", background: T.white,
        }}>
          <AgendaView allEvents={allEvents} month={month} year={year} onEventClick={(ev) => setSelectedDay(ev.date)} />
        </div>
      )}

      {/* ── Slide-in Side Panel ── */}
      <SidePanel
        selectedDay={selectedDay}
        events={allEvents}
        data={data}
        setData={setData}
        onClose={() => setSelectedDay(null)}
        onQuickAdd={(date) => { setQuickAdd({ date }); setQuickLabel(""); }}
        onDone={(e) => { gain(10); spawnConfetti(e.clientX, e.clientY); push(DONE_TOASTS[Math.floor(Math.random() * DONE_TOASTS.length)], "✅", "done"); }}
      />
    </div>
  );
};

export default CalendarTab;
