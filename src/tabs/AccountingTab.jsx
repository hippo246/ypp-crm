import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, ReferenceLine,
} from "recharts";
import { B } from "../constants";
import { aed, filterSearch, nextId, parseOperatorQuery } from "../helpers";
import { useTableFilterV2, useSortedData, usePagination, useSearchSuggestions } from "../hooks";
import { useAppData } from "../context/AppContext";
import {
  getTotalInvoiced, getTotalCollected, getTotalOutstanding,
  getCollectionRate, getOverdueInvoices, amountWithVAT,
  applyPartialPayment, calcOverduePenalty,
  createCreditNote, createDebitNote, generateNextRecurring,
} from "../services/accountingEngine";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

// ─── Field configs ────────────────────────────────────────────────────────────

const FIELDS = [
  { key: "client",            label: "Client Name",       placeholder: "Client or Company" },
  { key: "desc",              label: "Description",        placeholder: "Service description" },
  { key: "amount",            label: "Amount (AED)",       type: "number", placeholder: "0" },
  { key: "vatRate",           label: "VAT %",              type: "number", placeholder: "5", default: "5" },
  { key: "paid",              label: "Amount Paid (AED)",  type: "number", placeholder: "0", default: "0" },
  { key: "status",            label: "Status",             type: "select", options: ["Unpaid","Partial","Paid","Overdue"] },
  { key: "date",              label: "Invoice Date",       type: "date" },
  { key: "due",               label: "Due Date",           type: "date" },
  { key: "recurringInterval", label: "Recurring",          type: "select", options: ["None","monthly","quarterly","yearly"], default: "None" },
];

const PAYMENT_FIELDS = [{ key: "payment", label: "Payment Amount (AED)", type: "number", placeholder: "0" }];
const NOTE_FIELDS    = [
  { key: "noteAmount", label: "Amount (AED)", type: "number", placeholder: "0" },
  { key: "reason",     label: "Reason",       placeholder: "Reason for note" },
];

// ─── Color helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  Paid:    B.green,
  Partial: B.yellow,
  Unpaid:  B.red,
  Overdue: B.orange,
};

// ─── Fun layer: confetti, toasts, XP, vibes ──────────────────────────────────

const VIBES = [
  { hour: [6,11],  emoji: "☀️", msg: "Morning grind! Let's collect some money." },
  { hour: [11,14], emoji: "🔥", msg: "Midday hustle. You're on fire." },
  { hour: [14,17], emoji: "⚡", msg: "Afternoon power hour. Close those invoices." },
  { hour: [17,20], emoji: "🌆", msg: "Golden hour. Finish strong." },
  { hour: [20,24], emoji: "🌙", msg: "Night owl mode. Extra dedication noted." },
  { hour: [0,6],   emoji: "🦉", msg: "Can't sleep? Neither can your receivables." },
];

const PAYMENT_TOASTS = [
  "💸 Money secured! Your future self thanks you.",
  "🤑 Ka-ching! That's what we're here for.",
  "🏆 Payment collected. You absolute legend.",
  "🎯 Direct hit! Invoice down.",
  "💪 That's how it's done. Boss would be jealous.",
  "🚀 Revenue goes brrrr.",
  "✨ Another one bites the dust!",
  "🎉 Paid! Your bank account is smiling.",
  "😎 Effortless. Truly effortless.",
  "🦁 Collected like a pro. Respect.",
];

const INVOICE_TOASTS = [
  "📄 Invoice sent into the wild. Good luck out there.",
  "🎨 Beautiful invoice. They won't be able to resist.",
  "📬 Another one in the pipeline!",
  "🚀 Invoice launched. Orbit achieved.",
  "💼 Professional. Polished. Perfect.",
];

const ACHIEVEMENTS = [
  { id: "first_paid",    icon: "🥇", title: "First Blood",       desc: "Collected your first payment",          check: (inv) => inv.filter(i=>i.status==="Paid").length >= 1 },
  { id: "five_paid",     icon: "🏅", title: "On a Roll",          desc: "5 invoices fully paid",                 check: (inv) => inv.filter(i=>i.status==="Paid").length >= 5 },
  { id: "ten_paid",      icon: "🌟", title: "Collection Machine", desc: "10 invoices fully paid",                check: (inv) => inv.filter(i=>i.status==="Paid").length >= 10 },
  { id: "clean_sheet",   icon: "✨", title: "Clean Sheet",        desc: "Zero overdue invoices",                 check: (inv) => inv.length > 0 && inv.filter(i=>i.status==="Overdue").length === 0 },
  { id: "big_ticket",    icon: "💎", title: "Big Ticket",         desc: "Single invoice over AED 50,000",        check: (inv) => inv.some(i=>i.amount >= 50000) },
  { id: "five_clients",  icon: "👥", title: "People Person",      desc: "5+ unique clients billed",              check: (inv) => new Set(inv.map(i=>i.client)).size >= 5 },
  { id: "recurring_boss",icon: "🔄", title: "Recurring Revenue",  desc: "Set up a recurring invoice",            check: (inv) => inv.some(i=>i.recurringInterval && i.recurringInterval!=="None") },
  { id: "half_mil",      icon: "🚀", title: "Half a Mil",         desc: "Total collected exceeds AED 500,000",   check: (inv) => inv.reduce((s,i)=>s+(i.paid||0),0) >= 500000 },
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
      const ease = 1 - Math.pow(t, 2);
      el.style.left   = `${x + vx * t}px`;
      el.style.top    = `${y + (vy * t + 300 * t * t)}px`;
      el.style.opacity = String(1 - t);
      el.style.transform = `rotate(${angle + spin * t}deg)`;
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  setTimeout(() => document.body.removeChild(container), 1600);
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
          borderLeft: t.type === "achievement" ? "4px solid #f59e0b" : "4px solid #10b981",
          animation:"slideInRight 0.3s ease",
          display:"flex", alignItems:"center", gap:10,
        }}>
          <span style={{fontSize:20}}>{t.icon}</span>
          <div>
            {t.title && <div style={{fontSize:11,fontWeight:700,color:"#f59e0b",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>{t.title}</div>}
            {t.msg}
          </div>
        </div>
      ))}
      <style>{`@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, icon="💸", type="payment", title=null) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, msg, icon, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

function XPBar({ xp }) {
  const level    = Math.floor(xp / 100) + 1;
  const pct      = xp % 100;
  const titles   = ["Intern","Junior","Analyst","Senior","Manager","Director","VP","C-Suite","Legend","GOD MODE"];
  const title    = titles[Math.min(level - 1, titles.length - 1)];
  const colors   = ["#94a3b8","#60a5fa","#34d399","#a78bfa","#f59e0b","#f97316","#ef4444","#ec4899","#06b6d4","#fbbf24"];
  const color    = colors[Math.min(level - 1, colors.length - 1)];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:"8px 14px" }}>
      <div style={{ textAlign:"center", minWidth:40 }}>
        <div style={{ fontSize:18, lineHeight:1 }}>⚡</div>
        <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:0.5, textTransform:"uppercase" }}>Lv.{level}</div>
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:11, fontWeight:700, color }}>{title}</span>
          <span style={{ fontSize:10, color:B.muted }}>{xp} XP</span>
        </div>
        <div style={{ height:5, background:B.border, borderRadius:99, overflow:"hidden" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${color},${color}cc)`, borderRadius:99, transition:"width 0.6s ease" }} />
        </div>
        <div style={{ fontSize:9, color:B.muted, marginTop:2 }}>{100 - pct} XP to next level</div>
      </div>
    </div>
  );
}

function AchievementShelf({ invoices, newlyUnlocked }) {
  const unlocked = ACHIEVEMENTS.filter(a => a.check(invoices));
  return (
    <div style={{ background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:"10px 14px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>🏆 Achievements</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {ACHIEVEMENTS.map(a => {
          const done = a.check(invoices);
          const isNew = newlyUnlocked.includes(a.id);
          return (
            <div key={a.id} title={`${a.title}: ${a.desc}`} style={{
              width:38, height:38, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20, cursor:"default",
              background: done ? (isNew ? "#fef9c3" : B.light) : "#f8fafc",
              border: `1px solid ${done ? (isNew ? "#f59e0b" : B.border) : "#e2e8f0"}`,
              opacity: done ? 1 : 0.3,
              filter: done ? "none" : "grayscale(1)",
              transform: isNew ? "scale(1.15)" : "scale(1)",
              transition:"all 0.3s ease",
              boxShadow: isNew ? "0 0 0 3px #f59e0b40" : "none",
            }}>
              {a.icon}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:B.muted, marginTop:6 }}>{unlocked.length}/{ACHIEVEMENTS.length} unlocked — hover for details</div>
    </div>
  );
}

function DailyVibeBar() {
  const h    = new Date().getHours();
  const vibe = VIBES.find(v => h >= v.hour[0] && h < v.hour[1]) || VIBES[0];
  const day  = new Date().toLocaleDateString("en", { weekday:"long" });
  const isMonday = new Date().getDay() === 1;
  const isFriday = new Date().getDay() === 5;
  const bonus = isMonday ? " Monday? More like money-day." : isFriday ? " It's Friday! Close those invoices." : "";
  return (
    <div style={{
      background:`linear-gradient(135deg,#0f172a,#1e293b)`, borderRadius:10,
      padding:"10px 16px", display:"flex", alignItems:"center", gap:12,
    }}>
      <span style={{ fontSize:22 }}>{vibe.emoji}</span>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{day} · Keep going. Your boss is watching someone else's screen.</div>
      </div>
    </div>
  );
}

// ─── Cashflow sparkline data ──────────────────────────────────────────────────

function buildCashflowData(invoices) {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ month: d.toLocaleString("en", { month: "short" }), key, invoiced: 0, collected: 0 });
  }
  invoices.forEach(inv => {
    const m = (inv.date || "").slice(0, 7);
    const bucket = months.find(b => b.key === m);
    if (bucket) {
      bucket.invoiced  += amountWithVAT(inv.amount, inv.vatRate ?? 5);
      bucket.collected += inv.paid || 0;
    }
  });
  return months;
}

// ─── Forecast panel: next 3 months from recurring invoices ───────────────────

function buildForecast(invoices) {
  const recurring = invoices.filter(i => i.recurringInterval && i.recurringInterval !== "None");
  const now = new Date();
  const months = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      month: d.toLocaleString("en", { month: "short", year: "2-digit" }),
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      projected: 0,
      sources: [],
    });
  }
  recurring.forEach(inv => {
    const amt = amountWithVAT(inv.amount, inv.vatRate ?? 5);
    months.forEach(m => {
      // monthly always hits; quarterly hits every 3rd month; yearly hits once/year
      const mNum = parseInt(m.key.split("-")[1]);
      const baseMonth = inv.date ? parseInt(inv.date.slice(5, 7)) : 1;
      let hits = false;
      if (inv.recurringInterval === "monthly") hits = true;
      else if (inv.recurringInterval === "quarterly") hits = ((mNum - baseMonth + 12) % 3 === 0);
      else if (inv.recurringInterval === "yearly")    hits = (mNum === baseMonth);
      if (hits) {
        m.projected += amt;
        m.sources.push({ client: inv.client, amount: amt });
      }
    });
  });
  return months;
}

// ─── Client leaderboard: top 5 by total spend ────────────────────────────────

function buildLeaderboard(invoices) {
  const map = {};
  invoices.forEach(inv => {
    const total = amountWithVAT(inv.amount, inv.vatRate ?? 5);
    if (!map[inv.client]) map[inv.client] = { client: inv.client, total: 0, paid: 0, count: 0 };
    map[inv.client].total += total;
    map[inv.client].paid  += inv.paid || 0;
    map[inv.client].count += 1;
  });
  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
}

// ─── Duplicate invoice detector ───────────────────────────────────────────────

function findDuplicates(invoices) {
  const dupes = [];
  for (let i = 0; i < invoices.length; i++) {
    for (let j = i + 1; j < invoices.length; j++) {
      const a = invoices[i], b = invoices[j];
      if (
        a.client === b.client &&
        a.amount === b.amount &&
        a.date   === b.date
      ) {
        dupes.push({ a: a.id, b: b.id, client: a.client, amount: a.amount, date: a.date });
      }
    }
  }
  return dupes;
}

// ─── Due-soon alerts (≤7 days) ────────────────────────────────────────────────

function getDueSoon(invoices) {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  return invoices.filter(inv => {
    if (!inv.due || inv.status === "Paid") return false;
    const d = new Date(inv.due);
    return d >= now && d <= in7;
  }).sort((a, b) => new Date(a.due) - new Date(b.due));
}

// ─── Statement of account export ─────────────────────────────────────────────

function exportStatement(client, invoices) {
  const rows = invoices.filter(i => i.client === client);
  const total    = rows.reduce((s, i) => s + amountWithVAT(i.amount, i.vatRate ?? 5), 0);
  const paid     = rows.reduce((s, i) => s + (i.paid || 0), 0);
  const balance  = total - paid;
  const now      = new Date().toLocaleDateString("en-GB");

  const html = `
    <html><head><title>Statement — ${client}</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1e293b; }
      h1 { font-size: 24px; margin-bottom: 4px; }
      .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { background: #f1f5f9; padding: 10px 14px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      td { padding: 9px 14px; border-bottom: 1px solid #e2e8f0; }
      .summary { margin-top: 24px; display: flex; gap: 20px; justify-content: flex-end; }
      .summary div { text-align: right; }
      .summary .label { font-size: 11px; color: #64748b; text-transform: uppercase; }
      .summary .value { font-size: 18px; font-weight: 800; }
      .balance { color: ${balance > 0 ? "#ef4444" : "#22c55e"} }
    </style></head>
    <body>
      <h1>Statement of Account</h1>
      <div class="meta">Client: <strong>${client}</strong> &nbsp;·&nbsp; Generated: ${now}</div>
      <table>
        <thead><tr>
          <th>Invoice #</th><th>Description</th><th>Date</th><th>Due</th>
          <th>Total (incl VAT)</th><th>Paid</th><th>Balance</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${rows.map(i => {
            const t = amountWithVAT(i.amount, i.vatRate ?? 5);
            const b = t - (i.paid || 0);
            return `<tr>
              <td>${i.id}</td><td>${i.desc}</td><td>${i.date || "—"}</td><td>${i.due || "—"}</td>
              <td>${aed(t)}</td><td>${aed(i.paid || 0)}</td>
              <td style="color:${b > 0 ? "#ef4444" : "#22c55e"};font-weight:700">${aed(b)}</td>
              <td>${i.status}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <div class="summary">
        <div><div class="label">Total Invoiced</div><div class="value">${aed(total)}</div></div>
        <div><div class="label">Total Paid</div><div class="value" style="color:#22c55e">${aed(paid)}</div></div>
        <div><div class="label">Outstanding</div><div class="value balance">${aed(balance)}</div></div>
      </div>
    </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// ─── Health score ─────────────────────────────────────────────────────────────

function calcHealthScore(invoices) {
  if (!invoices.length) return 100;
  const overduePct = invoices.filter(i => i.status === "Overdue").length / invoices.length;
  const collRate   = invoices.reduce((s, i) => s + (i.paid || 0), 0) /
                     Math.max(1, invoices.reduce((s, i) => s + amountWithVAT(i.amount, i.vatRate ?? 5), 0));
  const paidPct    = invoices.filter(i => i.status === "Paid").length / invoices.length;
  const score = Math.round((1 - overduePct) * 40 + collRate * 40 + paidPct * 20);
  return Math.max(0, Math.min(100, score));
}

function healthLabel(score) {
  if (score >= 80) return { label: "Healthy",  color: B.green  };
  if (score >= 55) return { label: "Fair",      color: B.yellow };
  if (score >= 30) return { label: "At Risk",   color: B.orange };
  return             { label: "Critical", color: B.red    };
}

// ─── Mini donut ───────────────────────────────────────────────────────────────

function HealthRing({ score }) {
  const { color, label } = healthLabel(score);
  const r = 28, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={72} height={72} viewBox="0 0 72 72">
        <circle cx={36} cy={36} r={r} fill="none" stroke={B.border} strokeWidth={7} />
        <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transform: "rotate(-90deg)", transformOrigin: "36px 36px", transition: "stroke-dasharray 0.6s ease" }} />
        <text x={36} y={40} textAnchor="middle" fontSize={14} fontWeight={800} fill={color}>{score}</text>
      </svg>
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

// ─── Cashflow chart with trend line ──────────────────────────────────────────

function CashflowChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={90}>
      <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} />
        <YAxis tick={false} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v, name) => [aed(v), name === "invoiced" ? "Invoiced" : "Collected"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${B.border}`, background: B.white }} />
        <Bar dataKey="invoiced"  fill={B.blue   + "40"} radius={[3,3,0,0]} />
        <Bar dataKey="collected" fill={B.green} radius={[3,3,0,0]} />
        <Line type="monotone" dataKey="collected" stroke={B.green} strokeWidth={2} dot={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Status donut ─────────────────────────────────────────────────────────────

function StatusDonut({ invoices }) {
  const counts = ["Paid","Partial","Unpaid","Overdue"].map(s => ({
    name: s, value: invoices.filter(i => i.status === s).length, color: STATUS_COLORS[s],
  })).filter(d => d.value > 0);
  if (!counts.length) return null;
  return (
    <ResponsiveContainer width="100%" height={90}>
      <PieChart>
        <Pie data={counts} cx="50%" cy="50%" innerRadius={24} outerRadius={38}
          dataKey="value" paddingAngle={2} stroke="none">
          {counts.map((c, i) => <Cell key={i} fill={c.color} />)}
        </Pie>
        <Tooltip formatter={(v, name) => [v, name]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${B.border}`, background: B.white }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── Forecast Panel ───────────────────────────────────────────────────────────

function ForecastPanel({ forecast }) {
  const max = Math.max(...forecast.map(f => f.projected), 1);
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: B.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
        📈 Revenue Forecast — Next 3 Months
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {forecast.map(f => (
          <div key={f.month}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: B.text }}>{f.month}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: B.accent }}>{aed(f.projected)}</span>
            </div>
            <div style={{ height: 6, background: B.border, borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                width: `${(f.projected / max) * 100}%`, height: "100%",
                background: `linear-gradient(90deg, ${B.accent}, ${B.blue})`,
                borderRadius: 99, transition: "width 0.5s ease",
              }} />
            </div>
            {f.sources.length > 0 && (
              <div style={{ fontSize: 9, color: B.muted, marginTop: 2 }}>
                {f.sources.slice(0, 3).map(s => s.client).join(", ")}
                {f.sources.length > 3 && ` +${f.sources.length - 3} more`}
              </div>
            )}
          </div>
        ))}
        {forecast.every(f => f.projected === 0) && (
          <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic" }}>No recurring invoices — add recurring billing to see forecast.</div>
        )}
      </div>
    </div>
  );
}

// ─── Client Leaderboard ───────────────────────────────────────────────────────

function ClientLeaderboard({ leaderboard, invoices }) {
  const [statementClient, setStatementClient] = useState(null);
  const medals = ["🥇","🥈","🥉","4️⃣","5️⃣"];
  const max = leaderboard[0]?.total || 1;
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: B.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
        🏆 Client Leaderboard — Top 5 by Spend
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {leaderboard.map((c, i) => (
          <div key={c.client} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, minWidth: 20 }}>{medals[i]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: B.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.client}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: B.blue, flexShrink: 0, marginLeft: 6 }}>{aed(c.total)}</span>
              </div>
              <div style={{ height: 4, background: B.border, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${(c.total / max) * 100}%`, height: "100%", background: [B.yellow, B.muted, B.orange, B.blue, B.accent][i] || B.blue, borderRadius: 99 }} />
              </div>
              <div style={{ fontSize: 9, color: B.muted, marginTop: 2 }}>{c.count} invoices · {aed(c.paid)} paid</div>
            </div>
            <button onClick={() => exportStatement(c.client, invoices)} title="Export statement of account"
              style={{ fontSize: 9, padding: "2px 7px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted, fontWeight: 600, flexShrink: 0 }}>
              📄 SOA
            </button>
          </div>
        ))}
        {leaderboard.length === 0 && (
          <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic" }}>No client data yet.</div>
        )}
      </div>
    </div>
  );
}

// ─── Due-Soon Alert Banner ────────────────────────────────────────────────────

function DueSoonBanner({ dueSoon }) {
  const [dismissed, setDismissed] = useState(false);
  if (!dueSoon.length || dismissed) return null;
  return (
    <div style={{
      background: `${B.yellow}18`, border: `1px solid ${B.yellow}60`,
      borderRadius: 10, padding: "10px 14px",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>⏰</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: B.text, marginBottom: 4 }}>
          {dueSoon.length} invoice{dueSoon.length > 1 ? "s" : ""} due within 7 days
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {dueSoon.map(inv => {
            const daysLeft = Math.ceil((new Date(inv.due) - new Date()) / 86_400_000);
            const bal = amountWithVAT(inv.amount, inv.vatRate ?? 5) - (inv.paid || 0);
            return (
              <div key={inv.id} style={{
                background: B.white, border: `1px solid ${B.yellow}40`,
                borderRadius: 6, padding: "4px 10px", fontSize: 10,
              }}>
                <span style={{ fontWeight: 700, color: B.text }}>{inv.client}</span>
                <span style={{ color: B.muted, margin: "0 4px" }}>·</span>
                <span style={{ color: B.orange, fontWeight: 600 }}>{aed(bal)}</span>
                <span style={{ color: B.muted, margin: "0 4px" }}>·</span>
                <span style={{ color: daysLeft <= 2 ? B.red : B.orange, fontWeight: 700 }}>
                  {daysLeft === 0 ? "Due TODAY" : `${daysLeft}d left`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", color: B.muted, cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>✕</button>
    </div>
  );
}

// ─── Duplicate Invoice Warning Banner ────────────────────────────────────────

function DuplicateBanner({ dupes }) {
  const [dismissed, setDismissed] = useState(false);
  if (!dupes.length || dismissed) return null;
  return (
    <div style={{
      background: `${B.red}10`, border: `1px solid ${B.red}40`,
      borderRadius: 10, padding: "10px 14px",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: B.red, marginBottom: 4 }}>
          {dupes.length} potential duplicate invoice{dupes.length > 1 ? "s" : ""} detected
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {dupes.map((d, i) => (
            <div key={i} style={{
              background: B.white, border: `1px solid ${B.red}30`,
              borderRadius: 6, padding: "3px 10px", fontSize: 10, color: B.text,
            }}>
              <span style={{ fontWeight: 700 }}>{d.a}</span> &amp; <span style={{ fontWeight: 700 }}>{d.b}</span>
              <span style={{ color: B.muted }}> — {d.client} · {aed(d.amount)} · {d.date}</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", color: B.muted, cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>✕</button>
    </div>
  );
}

// ─── Timeline row with Quick-Pay Slider ───────────────────────────────────────

function TimelineRow({ inv, onPay, onEdit, onCredit, onDebit, onRecurring, onQuickPay, onExportSOA }) {
  const [showSlider, setShowSlider]   = useState(false);
  const [sliderVal,  setSliderVal]    = useState(0);
  const total   = amountWithVAT(inv.amount, inv.vatRate ?? 5);
  const bal     = total - (inv.paid || 0);
  const pct     = Math.min(100, Math.round(((inv.paid || 0) / total) * 100));
  const color   = STATUS_COLORS[inv.status] || B.muted;
  const penalty = calcOverduePenalty(inv);

  const handleSliderPay = () => {
    if (sliderVal > 0) {
      onQuickPay(sliderVal);
      setShowSlider(false);
      setSliderVal(0);
    }
  };

  return (
    <div style={{
      background: B.white, border: `1px solid ${B.border}`, borderRadius: 10,
      padding: "12px 16px", borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr 2fr 2fr auto", gap: 12, alignItems: "center" }}>
        {/* Client + desc */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: B.text }}>{inv.client}</div>
          <div style={{ fontSize: 11, color: B.muted, marginTop: 1 }}>{inv.desc}</div>
          <div style={{ fontSize: 10, color: B.muted, marginTop: 3 }}>
            {inv.id} · Due {inv.due || "—"}
            {inv.recurringInterval && inv.recurringInterval !== "None" &&
              <span style={{ marginLeft: 6, color: B.accent, fontWeight: 600 }}>↻ {inv.recurringInterval}</span>}
          </div>
        </div>

        {/* Amounts */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: B.text }}>{aed(total)}</div>
          <div style={{ fontSize: 10, color: B.muted }}>incl. VAT {inv.vatRate ?? 5}%</div>
          {penalty > 0 && <div style={{ fontSize: 10, color: B.orange, fontWeight: 600 }}>+{aed(penalty)} penalty</div>}
        </div>

        {/* Progress */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: B.muted, marginBottom: 4 }}>
            <span>{aed(inv.paid || 0)} paid</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 5, background: B.border, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ fontSize: 10, color: bal > 0 ? B.red : B.green, marginTop: 3, fontWeight: 600 }}>
            {bal > 0 ? `${aed(bal)} remaining` : "Fully paid"}
          </div>
        </div>

        {/* Status */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <Badge label={inv.status} />
          <span style={{ fontSize: 9, color: B.muted }}>{inv.date || "—"}</span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", gap: 3 }}>
            <TinyBtn label="✏" color={B.blue}   onClick={onEdit}   title="Edit" />
            <TinyBtn label="💳" color={B.green}  onClick={onPay}    title="Record payment" />
            <TinyBtn label="⚡" color={B.accent} onClick={() => setShowSlider(s => !s)} title="Quick-pay slider" />
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            <TinyBtn label="CR" color={B.blue}   onClick={onCredit} title="Credit note" />
            <TinyBtn label="DR" color={B.orange} onClick={onDebit}  title="Debit note" />
            {inv.recurringInterval && inv.recurringInterval !== "None" &&
              <TinyBtn label="↻" color={B.accent} onClick={onRecurring} title="Generate next" />}
            <TinyBtn label="📄" color={B.muted}  onClick={onExportSOA} title="Statement of account" />
          </div>
        </div>
      </div>

      {/* Quick-Pay Slider */}
      {showSlider && bal > 0 && (
        <div style={{
          marginTop: 12, padding: "12px 14px",
          background: `${B.green}08`, border: `1px solid ${B.green}30`,
          borderRadius: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: B.text, minWidth: 70 }}>Quick Pay</span>
            <input
              type="range" min={0} max={Math.ceil(bal)} step={Math.max(1, Math.ceil(bal / 100))}
              value={sliderVal}
              onChange={e => setSliderVal(Number(e.target.value))}
              style={{ flex: 1, accentColor: B.green }}
            />
            <span style={{ fontSize: 12, fontWeight: 800, color: B.green, minWidth: 90, textAlign: "right" }}>{aed(sliderVal)}</span>
            <button onClick={(e) => { if (sliderVal > 0) { onQuickPay(sliderVal, e.currentTarget); setShowSlider(false); setSliderVal(0); } }}
              style={{ padding: "4px 12px", background: B.green, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Apply
            </button>
            <button onClick={() => setShowSlider(false)}
              style={{ background: "none", border: "none", color: B.muted, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: B.muted, marginTop: 6 }}>
            <span>AED 0</span>
            <span style={{ color: sliderVal >= bal * 0.5 ? B.green : B.muted }}>50% — {aed(bal * 0.5)}</span>
            <span>Full — {aed(bal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sort hook ────────────────────────────────────────────────────────────────

function useSortable(rows) {
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const toggle = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir * -1 } : { key, dir: 1 });
  };

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sort.key] ?? "";
      const vb = b[sort.key] ?? "";
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, sort]);

  const SortIcon = ({ colKey }) => {
    if (sort.key !== colKey) return <span style={{ color: B.border, marginLeft: 3 }}>⇅</span>;
    return <span style={{ color: B.blue, marginLeft: 3 }}>{sort.dir === 1 ? "↑" : "↓"}</span>;
  };

  return { sorted, sort, toggle, SortIcon };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AccountingTab({ viewMode, search }) {
  const { data, setData } = useAppData();
  const invoices    = data.accounting;

  const [modal,        setModal]        = useState(false);
  const [editModal,    setEditModal]    = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [noteModal,    setNoteModal]    = useState(null);
  const [filter,       setFilter]       = useState("all");
  const [displayMode,  setDisplayMode]  = useState("table");
  const [selected,     setSelected]     = useState(new Set());
  const [bulkStatus,   setBulkStatus]   = useState("");
  const [showPanels,   setShowPanels]   = useState(true);
  const [xp,           setXp]           = useState(() => Number(localStorage.getItem("acc_xp") || 0));
  const [newlyUnlocked, setNewlyUnlocked] = useState([]);
  const prevAchievements = useRef(new Set());
  const { toasts, push: pushToast } = useToasts();

  // ── XP helper ───────────────────────────────────────────────────────────────
  const gainXp = useCallback((amount) => {
    setXp(prev => {
      const next = prev + amount;
      localStorage.setItem("acc_xp", String(next));
      return next;
    });
  }, []);

  // ── Achievement checker ─────────────────────────────────────────────────────
  useEffect(() => {
    const justUnlocked = ACHIEVEMENTS.filter(a => {
      const was = prevAchievements.current.has(a.id);
      const now = a.check(invoices);
      return !was && now;
    });
    justUnlocked.forEach(a => {
      prevAchievements.current.add(a.id);
      setNewlyUnlocked(prev => [...prev, a.id]);
      pushToast(`${a.desc}`, a.icon, "achievement", a.title);
      gainXp(50);
      setTimeout(() => setNewlyUnlocked(prev => prev.filter(id => id !== a.id)), 3000);
    });
    // also seed existing ones into ref on mount
    ACHIEVEMENTS.filter(a => a.check(invoices)).forEach(a => prevAchievements.current.add(a.id));
  }, [invoices]); // eslint-disable-line

  const total       = getTotalInvoiced(invoices);
  const collected   = getTotalCollected(invoices);
  const outstanding = getTotalOutstanding(invoices);
  const collRate    = getCollectionRate(invoices);
  const overdueList = getOverdueInvoices(invoices);
  const healthScore = useMemo(() => calcHealthScore(invoices), [invoices]);
  const cashflow    = useMemo(() => buildCashflowData(invoices), [invoices]);
  const forecast    = useMemo(() => buildForecast(invoices), [invoices]);
  const leaderboard = useMemo(() => buildLeaderboard(invoices), [invoices]);
  const dueSoon     = useMemo(() => getDueSoon(invoices), [invoices]);
  const dupes       = useMemo(() => findDuplicates(invoices), [invoices]);

  const filterMap = {
    all:      invoices,
    overdue:  overdueList,
    paid:     invoices.filter(i => i.status === "Paid"),
    unpaid:   invoices.filter(i => i.status === "Unpaid"),
    partial:  invoices.filter(i => i.status === "Partial"),
    duesoon:  dueSoon,
  };

  const [localSearch, setLocalSearch] = useState(search || "");
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const ACC_SUGGESTION_FIELDS = ["status", "client", "id"];
  const { suggestions: accSuggestions, showSuggestions: accShowSuggestions, onSuggestionSelect: accOnSuggestionSelect } = useSearchSuggestions(localSearch, ACC_SUGGESTION_FIELDS, setLocalSearch);

  let rows = filterMap[filter] || invoices;
  rows = useTableFilterV2(rows, parsedQuery, ["id","client","desc","status"]);

  const { sorted: sortedRows, toggle: sortToggle, SortIcon } = useSortable(rows);
  const { page: accPage, setPage: setAccPage, pageSize: accPageSize, setPageSize: setAccPageSize, pageData: accPageData, pageCount: accPageCount } = usePagination(sortedRows);

  // ── bulk select ─────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(rows.map(r => r.id)));
  const clearSel  = () => setSelected(new Set());

  const applyBulkStatus = () => {
    if (!bulkStatus || !selected.size) return;
    const updated = invoices.map(inv =>
      selected.has(inv.id) ? { ...inv, status: bulkStatus } : inv
    );
    setData({ ...data, accounting: updated });
    clearSel();
    setBulkStatus("");
  };

  // ── CRUD handlers ───────────────────────────────────────────────────────────

  const handleChange = (ri, key, val) => {
    const updated = [...data.accounting];
    updated[ri] = { ...updated[ri], [key]: isNaN(val) || val === "" ? val : Number(val) };
    setData({ ...data, accounting: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.accounting];
    updated.splice(ri, 1);
    setData({ ...data, accounting: updated });
  };

  const handleAdd = (vals) => {
    const amt = Number(vals.amount) || 0;
    const paid = Number(vals.paid) || 0;
    const vatRate = Number(vals.vatRate) || 5;
    const recurring = vals.recurringInterval !== "None" ? vals.recurringInterval : undefined;
    setData({
      ...data,
      accounting: [...data.accounting, {
        id: nextId("INV"), ...vals, amount: amt, paid, vatRate,
        recurringInterval: recurring,
        status: paid === 0 ? "Unpaid" : paid >= amountWithVAT(amt, vatRate) ? "Paid" : "Partial",
      }],
    });
    // 🎉 fun layer
    const msg = INVOICE_TOASTS[Math.floor(Math.random() * INVOICE_TOASTS.length)];
    pushToast(msg, "📄");
    gainXp(5);
  };

  const handleEdit = (vals) => {
    const amt = Number(vals.amount) || 0;
    const paid = Number(vals.paid) || 0;
    const vatRate = Number(vals.vatRate) || 5;
    const updated = data.accounting.map(inv =>
      inv.id === editModal.id
        ? { ...inv, ...vals, amount: amt, paid, vatRate,
            status: paid === 0 ? "Unpaid" : paid >= amountWithVAT(amt, vatRate) ? "Paid" : "Partial" }
        : inv
    );
    setData({ ...data, accounting: updated });
    setEditModal(null);
  };

  const handlePartialPayment = (vals) => {
    const payment = Number(vals.payment) || 0;
    const updated = [...data.accounting];
    updated[paymentModal] = applyPartialPayment(updated[paymentModal], payment);
    setData({ ...data, accounting: updated });
    setPaymentModal(null);
    // 🎉 fun layer
    const msg = PAYMENT_TOASTS[Math.floor(Math.random() * PAYMENT_TOASTS.length)];
    pushToast(msg);
    gainXp(10);
    const el = document.querySelector("[data-confetti-origin]");
    const rect = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
    spawnConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const handleNote = (vals) => {
    const { index, type } = noteModal;
    const invoice  = data.accounting[index];
    const noteAmt  = Number(vals.noteAmount) || 0;
    const note     = type === "credit"
      ? createCreditNote(invoice, noteAmt, vals.reason)
      : createDebitNote(invoice, noteAmt, vals.reason);
    setData({ ...data, accounting: [...data.accounting, { id: nextId("NOTE"), ...note }] });
    setNoteModal(null);
  };

  const handleGenerateRecurring = (ri) => {
    const next = generateNextRecurring(data.accounting[ri]);
    setData({ ...data, accounting: [...data.accounting, { id: nextId("INV"), ...next }] });
  };

  const handleQuickPay = (invId, amount, originEl) => {
    const updated = data.accounting.map(inv => {
      if (inv.id !== invId) return inv;
      return applyPartialPayment(inv, amount);
    });
    setData({ ...data, accounting: updated });
    const msg = PAYMENT_TOASTS[Math.floor(Math.random() * PAYMENT_TOASTS.length)];
    pushToast(msg);
    gainXp(10);
    const rect = originEl ? originEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    spawnConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const pushToTasks = () => {
    overdueList.forEach(inv => {
      const title = `Chase payment — ${inv.client} (${inv.id})`;
      const alreadyExists = (data.tasks || []).some(t => t.ref === inv.id && t.title.startsWith("Chase payment"));
      if (!alreadyExists) {
        setData(d => ({
          ...d,
          tasks: [...(d.tasks || []), {
            id: `T-AUTO-${Date.now()}-${inv.id}`,
            title, assigned: "Alex Reyes", priority: "High",
            status: "Pending",
            due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
            ref: inv.id,
          }],
        }));
      }
    });
  };

  // ── sortable table cols ──────────────────────────────────────────────────────

  const sortableHeader = (label, key) => (
    <span onClick={() => sortToggle(key)} style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center" }}>
      {label}<SortIcon colKey={key} />
    </span>
  );

  const cols = [
    {
      key: "_sel", label: "",  width: 36,
      render: (_, r) => (
        <input type="checkbox" checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          style={{ cursor: "pointer", accentColor: B.blue }} />
      ),
    },
    { key: "id",     label: sortableHeader("Invoice #", "id"),   width: 90 },
    { key: "client", label: sortableHeader("Client", "client"),   width: 160 },
    { key: "desc",   label: "Description",                        width: 190 },
    { key: "amount", label: sortableHeader("Excl. VAT", "amount"),width: 120, render: v => aed(v), xlRender: v => aed(v) },
    { key: "vatRate",label: "VAT",                                width: 60,  render: v => `${v ?? 5}%` },
    {
      key: "amountWithVAT", label: sortableHeader("Total incl VAT", "amount"), width: 130,
      render: (_, r) => <strong>{aed(amountWithVAT(r.amount, r.vatRate ?? 5))}</strong>,
      xlRender: (_, r) => aed(amountWithVAT(r.amount, r.vatRate ?? 5)),
    },
    {
      key: "paid", label: sortableHeader("Paid", "paid"), width: 110,
      render: v => <span style={{ color: B.green, fontWeight: 600 }}>{aed(v)}</span>,
      xlRender: v => aed(v),
    },
    {
      key: "_progress", label: "Progress", width: 100,
      render: (_, r) => {
        const pct = Math.min(100, Math.round(((r.paid || 0) / amountWithVAT(r.amount, r.vatRate ?? 5)) * 100));
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ flex: 1, height: 5, background: B.border, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: STATUS_COLORS[r.status] || B.muted, borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 9, color: B.muted, minWidth: 26 }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      key: "balance", label: sortableHeader("Balance", "paid"), width: 110,
      render: (_, r) => {
        const bal = amountWithVAT(r.amount, r.vatRate ?? 5) - r.paid;
        return <span style={{ color: bal > 0 ? B.red : B.green, fontWeight: 600 }}>{aed(bal)}</span>;
      },
      xlRender: (_, r) => aed(amountWithVAT(r.amount, r.vatRate ?? 5) - r.paid),
    },
    {
      key: "penalty", label: sortableHeader("Penalty", "penalty"), width: 90,
      render: (_, r) => {
        const p = calcOverduePenalty(r);
        return p > 0
          ? <span style={{ color: B.orange, fontWeight: 600 }}>{aed(p)}</span>
          : <span style={{ color: B.muted }}>—</span>;
      },
      xlRender: (_, r) => aed(calcOverduePenalty(r)),
    },
    {
      key: "status", label: sortableHeader("Status", "status"), width: 100,
      render: v => <Badge label={v} />,
    },
    {
      key: "recurring", label: "Recurring", width: 90,
      render: (_, r) => r.recurringInterval && r.recurringInterval !== "None"
        ? <Badge label={r.recurringInterval} />
        : <span style={{ color: B.muted }}>—</span>,
    },
    { key: "date", label: sortableHeader("Date", "date"),         width: 100 },
    { key: "due",  label: sortableHeader("Due Date", "due"),      width: 100 },
    {
      key: "actions", label: "Actions", width: 250,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          <ActionBtn label="✏ Edit"  color={B.blue}   onClick={() => setEditModal(r)} title="Edit" />
          <ActionBtn label="💳 Pay"  color={B.green}  onClick={() => setPaymentModal(ri)} />
          <ActionBtn label="CR"      color={B.blue}   onClick={() => setNoteModal({ index: ri, type: "credit" })} title="Credit Note" />
          <ActionBtn label="DR"      color={B.orange} onClick={() => setNoteModal({ index: ri, type: "debit"  })} title="Debit Note"  />
          <ActionBtn label="📄 SOA"  color={B.muted}  onClick={() => exportStatement(r.client, invoices)} title="Statement of Account" />
          {r.recurringInterval && r.recurringInterval !== "None" && (
            <ActionBtn label="↻" color={B.accent} onClick={() => handleGenerateRecurring(ri)} title="Generate next" />
          )}
        </div>
      ),
    },
  ];

  // ── aging buckets ────────────────────────────────────────────────────────────

  const aging = useMemo(() => {
    const now = new Date();
    const bucket = (lo, hi) => overdueList.filter(i => {
      const d = (now - new Date(i.due)) / 86_400_000;
      return hi === Infinity ? d > lo : d > lo && d <= hi;
    });
    return [
      { label: "0–30 days",  items: bucket(0,  30), color: B.yellow },
      { label: "31–60 days", items: bucket(30, 60), color: B.orange },
      { label: "60+ days",   items: bucket(60, Infinity), color: B.red },
    ];
  }, [overdueList]);

  // ── render ───────────────────────────────────────────────────────────────────

  const FILTER_TABS = [
    { key: "all",     label: `All (${invoices.length})` },
    { key: "unpaid",  label: `Unpaid (${invoices.filter(i=>i.status==="Unpaid").length})`,   danger: true },
    { key: "partial", label: `Partial (${invoices.filter(i=>i.status==="Partial").length})`, warn: true },
    { key: "overdue", label: `Overdue (${overdueList.length})`,                              danger: true },
    { key: "paid",    label: `Paid (${invoices.filter(i=>i.status==="Paid").length})`,       success: true },
    { key: "duesoon", label: `Due Soon (${dueSoon.length})`, warn: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Toast notifications ── */}
      <ToastStack toasts={toasts} />

      {/* ── Daily vibe bar ── */}
      <DailyVibeBar />

      {/* ── XP + Achievements row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <XPBar xp={xp} />
        <AchievementShelf invoices={invoices} newlyUnlocked={newlyUnlocked} />
      </div>

      {/* ── Smart Alert Banners ── */}
      <DueSoonBanner dueSoon={dueSoon} />
      <DuplicateBanner dupes={dupes} />

      {/* ── Analytics strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px 180px 180px", gap: 12, alignItems: "stretch" }}>
        <StatCard label="Total Invoiced"   value={aed(total)}        color={B.blue}   />
        <StatCard label="Collected"        value={aed(collected)}    color={B.green}  />
        <StatCard label="Outstanding"      value={aed(outstanding)}  color={B.red}    />

        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "10px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 10, color: B.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>AR Health</div>
          <HealthRing score={healthScore} />
        </div>

        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, color: B.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", gap: 10 }}>
            <span>Cashflow</span>
            <span style={{ color: B.blue   + "99" }}>■ Invoiced</span>
            <span style={{ color: B.green }}>■ Collected</span>
          </div>
          <CashflowChart data={cashflow} />
        </div>

        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, color: B.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 0 }}>Status Mix</div>
          <StatusDonut invoices={invoices} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", justifyContent: "center" }}>
            {["Paid","Partial","Unpaid","Overdue"].map(s => (
              <span key={s} style={{ fontSize: 9, color: STATUS_COLORS[s], fontWeight: 700 }}>
                ● {s} {invoices.filter(i=>i.status===s).length}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Insight Panels Row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: B.muted }}>Insights</span>
        <button onClick={() => setShowPanels(s => !s)} style={{ fontSize: 10, padding: "2px 9px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 20, cursor: "pointer", color: B.muted }}>
          {showPanels ? "▴ Hide" : "▾ Show"}
        </button>
      </div>
      {showPanels && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ForecastPanel forecast={forecast} />
          <ClientLeaderboard leaderboard={leaderboard} invoices={invoices} />
        </div>
      )}

      {/* ── AR Aging buckets ── */}
      {overdueList.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {aging.map(({ label, items, color }) => (
            <div key={label} style={{
              background: color + "0d", border: `1px solid ${color}30`,
              borderRadius: 10, padding: "12px 16px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label} overdue</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: B.text, marginTop: 2 }}>
                  {items.length} <span style={{ fontSize: 11, fontWeight: 400, color: B.muted }}>invoices</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color }}>{aed(items.reduce((s,i) => s + (amountWithVAT(i.amount, i.vatRate??5) - i.paid), 0))}</div>
                <div style={{ fontSize: 10, color: B.muted }}>outstanding</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 5, background: B.light, borderRadius: 22, padding: 3 }}>
          {FILTER_TABS.map(t => {
            const active = filter === t.key;
            return (
              <button key={t.key} onClick={() => setFilter(t.key)} style={{
                padding: "4px 13px", borderRadius: 20, fontSize: 11, border: "none",
                background: active ? (t.success ? B.green : t.danger ? B.red : t.warn ? B.yellow : B.blue) : "transparent",
                color: active ? "#fff" : B.muted,
                cursor: "pointer", fontWeight: active ? 700 : 400, fontFamily: "inherit",
                transition: "all 0.15s",
              }}>
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, background: B.light, borderRadius: 8, padding: 2 }}>
            {[["table","☰ Table"],["timeline","◫ Timeline"]].map(([v,l]) => (
              <button key={v} onClick={() => setDisplayMode(v)} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 10, border: "none",
                background: displayMode===v ? B.white : "transparent",
                color: displayMode===v ? B.text : B.muted,
                cursor: "pointer", fontWeight: displayMode===v ? 700 : 400, fontFamily: "inherit",
                boxShadow: displayMode===v ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}>{l}</button>
            ))}
          </div>

          {selected.size > 0 && (
            <div style={{ display: "flex", gap: 5, alignItems: "center", background: B.blue + "12", border: `1px solid ${B.blue}30`, borderRadius: 8, padding: "4px 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: B.blue }}>{selected.size} selected</span>
              <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
                style={{ fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5, padding: "2px 6px", background: B.white }}>
                <option value="">Set status…</option>
                {["Unpaid","Partial","Paid","Overdue"].map(s => <option key={s}>{s}</option>)}
              </select>
              <button onClick={applyBulkStatus} style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", background: B.blue, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}>Apply</button>
              <button onClick={clearSel} style={{ fontSize: 11, color: B.muted, background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
          )}

          {overdueList.length > 0 && (
            <button onClick={pushToTasks} style={{
              padding: "6px 12px", background: B.orange + "18", color: B.orange,
              border: `1px solid ${B.orange}40`, borderRadius: 8,
              fontWeight: 700, fontSize: 11, cursor: "pointer",
            }}>
              ⚡ Push overdue → Tasks
            </button>
          )}
          <button data-confetti-origin onClick={() => setModal(true)} style={{
            padding: "7px 16px", background: B.blue, color: "#fff",
            border: "none", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
          }}>
            + Add Invoice
          </button>
        </div>
      </div>

      {/* ── Search + suggestions ── */}
      <div style={{ position:"relative" }}>
        <input
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          placeholder="Search invoices… (e.g. status:Paid client:Acme)"
          style={{ width:"100%", padding:"7px 12px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, outline:"none", boxSizing:"border-box" }}
        />
        {accShowSuggestions && accSuggestions.length > 0 && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:400, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, boxShadow:"0 4px 16px rgba(0,0,0,0.10)", maxHeight:200, overflowY:"auto" }}>
            {accSuggestions.map((s, i) => (
              <div key={i} onClick={() => accOnSuggestionSelect(s)} style={{ padding:"7px 12px", fontSize:12, cursor:"pointer", borderBottom:`1px solid ${B.border}` }}
                onMouseEnter={e=>e.currentTarget.style.background=B.light}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Table / Timeline ── */}
      {displayMode === "table" ? (
        <SectionCard title={`Invoices — ${sortedRows.length} records`}>
          {viewMode === "excel"
            ? (
              <>
                <div className="excel-mobile-warning"><span style={{ fontSize: 24 }}>🖥️</span><span>Excel view is only available on desktop</span></div>
                <div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 320px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <ExcelTable cols={cols} rows={accPageData} onChange={handleChange} onDelete={handleDelete} />
                </div>
              </>
            )
            : (
              <>
                <NTable cols={cols} rows={accPageData} />
                {accPageCount > 1 && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
                    <button onClick={() => setAccPage(p => Math.max(0,p-1))} disabled={accPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                    <span>Page {accPage+1} / {accPageCount}</span>
                    <button onClick={() => setAccPage(p => Math.min(accPageCount-1,p+1))} disabled={accPage===accPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                    <select value={accPageSize} onChange={e=>{ setAccPageSize(Number(e.target.value)); setAccPage(0); }} style={{ marginLeft:"auto", padding:"3px 6px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:5 }}>
                      {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
        </SectionCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: B.muted, marginBottom: -4 }}>
            {sortedRows.length} invoices — timeline view
          </div>
          {sortedRows.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: B.muted, fontSize: 13 }}>No invoices match current filters.</div>
          )}
          {accPageData.map((inv) => (
            <TimelineRow key={inv.id} inv={inv}
              onEdit      ={() => setEditModal(inv)}
              onPay       ={() => {
                const ri = data.accounting.findIndex(i => i.id === inv.id);
                setPaymentModal(ri);
              }}
              onCredit    ={() => {
                const ri = data.accounting.findIndex(i => i.id === inv.id);
                setNoteModal({ index: ri, type: "credit" });
              }}
              onDebit     ={() => {
                const ri = data.accounting.findIndex(i => i.id === inv.id);
                setNoteModal({ index: ri, type: "debit" });
              }}
              onRecurring ={() => {
                const ri = data.accounting.findIndex(i => i.id === inv.id);
                handleGenerateRecurring(ri);
              }}
              onQuickPay  ={(amount, el) => handleQuickPay(inv.id, amount, el)}
              onExportSOA ={() => exportStatement(inv.client, invoices)}
            />
          ))}
          {accPageCount > 1 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
              <button onClick={() => setAccPage(p => Math.max(0,p-1))} disabled={accPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
              <span>Page {accPage+1} / {accPageCount}</span>
              <button onClick={() => setAccPage(p => Math.min(accPageCount-1,p+1))} disabled={accPage===accPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {modal && (
        <AddInvoiceModal
          existingClients={[...new Set(invoices.map(i => i.client).filter(Boolean))]}
          onSave={vals => { handleAdd(vals); setModal(false); }}
          onClose={() => setModal(false)}
        />
      )}
      {editModal && (
        <FormModal title={`Edit — ${editModal.id}`} fields={FIELDS} initialValues={editModal}
          onSave={handleEdit} onClose={() => setEditModal(null)} />
      )}
      {paymentModal !== null && (
        <FormModal title={`Record Payment — ${data.accounting[paymentModal]?.client}`}
          fields={PAYMENT_FIELDS} onSave={handlePartialPayment} onClose={() => setPaymentModal(null)} />
      )}
      {noteModal !== null && (
        <FormModal
          title={`${noteModal.type === "credit" ? "Credit" : "Debit"} Note — ${data.accounting[noteModal.index]?.client}`}
          fields={NOTE_FIELDS} onSave={handleNote} onClose={() => setNoteModal(null)} />
      )}
    </div>
  );
}

// ─── Advanced Add Invoice Modal ───────────────────────────────────────────────

const DUE_PRESETS = [
  { label: "7 days",  days: 7  },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "45 days", days: 45 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

const CURRENCIES = ["AED","USD","EUR","GBP","SAR","QAR","KWD","BHD"];

function AddInvoiceModal({ onSave, onClose, existingClients = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(1); // 1=details 2=line items 3=review
  const [currency,  setCurrency]  = useState("AED");
  const [client,    setClient]    = useState("");
  const [showClients, setShowClients] = useState(false);
  const [desc,      setDesc]      = useState("");
  const [notes,     setNotes]     = useState("");
  const [vatRate,   setVatRate]   = useState(5);
  const [date,      setDate]      = useState(today);
  const [due,       setDue]       = useState("");
  const [recurring, setRecurring] = useState("None");
  const [status,    setStatus]    = useState("Unpaid");
  const [lines,     setLines]     = useState([{ desc: "", qty: 1, rate: 0 }]);
  const [paid,      setPaid]      = useState(0);
  const [errors,    setErrors]    = useState({});
  const clientRef = useRef(null);

  // computed
  const subtotal  = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const vatAmt    = subtotal * ((Number(vatRate) || 0) / 100);
  const grandTotal= subtotal + vatAmt;
  const balance   = grandTotal - (Number(paid) || 0);
  const autoStatus= Number(paid) <= 0 ? "Unpaid" : Number(paid) >= grandTotal ? "Paid" : "Partial";

  // sync status to payment
  useEffect(() => { setStatus(autoStatus); }, [paid, grandTotal]);

  // due date preset
  const applyPreset = (days) => {
    const d = new Date(date || today);
    d.setDate(d.getDate() + days);
    setDue(d.toISOString().slice(0, 10));
  };

  // line item helpers
  const setLine  = (i, key, val) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  const addLine  = () => setLines(ls => [...ls, { desc: "", qty: 1, rate: 0 }]);
  const delLine  = (i) => setLines(ls => ls.filter((_, idx) => idx !== i));

  // filtered client suggestions
  const clientSuggestions = existingClients.filter(c =>
    c.toLowerCase().includes(client.toLowerCase()) && c !== client
  ).slice(0, 6);

  const validate = () => {
    const e = {};
    if (!client.trim())  e.client = "Required";
    if (!desc.trim() && lines.every(l => !l.desc.trim())) e.desc = "Add a description or line item";
    if (grandTotal <= 0) e.amount = "Total must be greater than 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const lineDesc = lines.filter(l => l.desc || l.rate).map(l => `${l.desc} (x${l.qty})`).join(", ");
    onSave({
      client:            client.trim(),
      desc:              desc.trim() || lineDesc,
      notes,
      amount:            subtotal,
      vatRate:           Number(vatRate) || 5,
      paid:              Number(paid) || 0,
      status,
      date,
      due,
      currency,
      recurringInterval: recurring,
      lines:             JSON.stringify(lines),
    });
  };

  const inp = (extra = {}) => ({
    style: {
      width: "100%", padding: "8px 11px", borderRadius: 7, fontSize: 13,
      border: `1px solid ${B.border}`, fontFamily: "inherit", outline: "none",
      background: "#fff", color: B.text, boxSizing: "border-box", ...extra,
    }
  });

  const lbl = (text, err) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: err ? B.red : B.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {text}{err && <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none" }}>{err}</span>}
    </div>
  );

  const STEPS = ["Details", "Line Items", "Review & Save"];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:680, maxHeight:"90vh", overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 24px 80px rgba(0,0,0,0.3)" }}>

        {/* Header */}
        <div style={{ padding:"20px 24px 0", borderBottom:`1px solid ${B.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:B.text }}>New Invoice</div>
              <div style={{ fontSize:12, color:B.muted, marginTop:2 }}>Fill in the details below to create a professional invoice</div>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:B.muted, padding:0, lineHeight:1 }}>×</button>
          </div>

          {/* Step pills */}
          <div style={{ display:"flex", gap:0, marginBottom:-1 }}>
            {STEPS.map((s, i) => {
              const n = i + 1;
              const active = step === n;
              const done   = step > n;
              return (
                <button key={s} onClick={() => done || active ? setStep(n) : null} style={{
                  padding:"8px 20px", fontSize:12, fontWeight:700, border:"none",
                  borderBottom: active ? `2px solid ${B.blue}` : "2px solid transparent",
                  background:"transparent", cursor: done ? "pointer" : "default",
                  color: active ? B.blue : done ? B.green : B.muted,
                  display:"flex", alignItems:"center", gap:6,
                }}>
                  <span style={{ width:18, height:18, borderRadius:"50%", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800,
                    background: done ? B.green : active ? B.blue : B.border,
                    color: done || active ? "#fff" : B.muted,
                  }}>{done ? "✓" : n}</span>
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>

          {/* ── STEP 1: Details ── */}
          {step === 1 && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

              {/* Client + Currency row */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 110px", gap:12 }}>
                <div style={{ position:"relative" }} ref={clientRef}>
                  {lbl("Client Name", errors.client)}
                  <input value={client} onChange={e => { setClient(e.target.value); setShowClients(true); }}
                    onFocus={() => setShowClients(true)}
                    onBlur={() => setTimeout(() => setShowClients(false), 150)}
                    placeholder="Start typing a client name…" {...inp()} />
                  {showClients && clientSuggestions.length > 0 && (
                    <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", border:`1px solid ${B.border}`, borderRadius:8, zIndex:10, boxShadow:"0 8px 24px rgba(0,0,0,0.12)", marginTop:2 }}>
                      {clientSuggestions.map(c => (
                        <div key={c} onMouseDown={() => { setClient(c); setShowClients(false); }}
                          style={{ padding:"8px 12px", fontSize:13, cursor:"pointer", color:B.text }}
                          onMouseEnter={e => e.currentTarget.style.background = B.light}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {c}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  {lbl("Currency")}
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    style={{ ...inp().style, padding:"8px 6px" }}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                {lbl("Description / Summary", errors.desc)}
                <input value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder="Brief description of goods or services…" {...inp()} />
              </div>

              {/* Notes */}
              <div>
                {lbl("Internal Notes (optional)")}
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Payment terms, references, anything the client doesn't see…"
                  rows={2}
                  style={{ ...inp().style, resize:"vertical", lineHeight:1.5 }} />
              </div>

              {/* Dates */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  {lbl("Invoice Date")}
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} {...inp()} />
                </div>
                <div>
                  {lbl("Due Date")}
                  <input type="date" value={due} onChange={e => setDue(e.target.value)} {...inp()} />
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:6 }}>
                    {DUE_PRESETS.map(p => (
                      <button key={p.label} onClick={() => applyPreset(p.days)} style={{
                        fontSize:10, padding:"2px 9px", borderRadius:20, cursor:"pointer",
                        background:B.light, border:`1px solid ${B.border}`, color:B.muted, fontFamily:"inherit",
                      }}>{p.label}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* VAT + Recurring */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  {lbl("VAT %")}
                  <div style={{ display:"flex", gap:6 }}>
                    {[0, 5, 10, 15, 20].map(v => (
                      <button key={v} onClick={() => setVatRate(v)} style={{
                        flex:1, padding:"7px 0", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer",
                        fontFamily:"inherit", border:`1px solid ${vatRate === v ? B.blue : B.border}`,
                        background: vatRate === v ? B.blue : "#fff",
                        color: vatRate === v ? "#fff" : B.muted,
                      }}>{v}%</button>
                    ))}
                    <input type="number" value={vatRate} onChange={e => setVatRate(Number(e.target.value))}
                      style={{ ...inp().style, width:60, textAlign:"center" }} placeholder="%" />
                  </div>
                </div>
                <div>
                  {lbl("Recurring Billing")}
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {["None","monthly","quarterly","yearly"].map(r => (
                      <button key={r} onClick={() => setRecurring(r)} style={{
                        padding:"6px 12px", borderRadius:7, fontSize:11, fontWeight:700, cursor:"pointer",
                        fontFamily:"inherit", border:`1px solid ${recurring === r ? B.accent : B.border}`,
                        background: recurring === r ? B.accent : "#fff",
                        color: recurring === r ? "#fff" : B.muted,
                        textTransform:"capitalize",
                      }}>{r === "None" ? "One-time" : r}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Line Items ── */}
          {step === 2 && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ fontSize:12, color:B.muted, marginBottom:4 }}>
                Break your invoice into individual line items. Totals calculate automatically.
              </div>

              {/* Column headers */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 110px 90px 28px", gap:8, alignItems:"center" }}>
                {["Description","Qty","Rate","Total",""].map(h => (
                  <div key={h} style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:0.4 }}>{h}</div>
                ))}
              </div>

              {lines.map((line, i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 70px 110px 90px 28px", gap:8, alignItems:"center",
                  background: i % 2 === 0 ? "#fafafa" : "#fff", borderRadius:8, padding:"8px 10px", border:`1px solid ${B.border}` }}>
                  <input value={line.desc} onChange={e => setLine(i,"desc",e.target.value)}
                    placeholder={`Item ${i + 1}…`} style={{ ...inp().style, fontSize:12 }} />
                  <input type="number" value={line.qty} onChange={e => setLine(i,"qty",e.target.value)}
                    min={1} style={{ ...inp().style, textAlign:"center", fontSize:12 }} />
                  <input type="number" value={line.rate} onChange={e => setLine(i,"rate",e.target.value)}
                    min={0} placeholder="0.00" style={{ ...inp().style, textAlign:"right", fontSize:12 }} />
                  <div style={{ fontSize:12, fontWeight:700, color:B.text, textAlign:"right" }}>
                    {((Number(line.qty)||0) * (Number(line.rate)||0)).toLocaleString("en", { minimumFractionDigits:2, maximumFractionDigits:2 })}
                  </div>
                  <button onClick={() => delLine(i)} disabled={lines.length === 1}
                    style={{ background:"none", border:"none", cursor:lines.length>1?"pointer":"default", color:B.red, fontSize:16, padding:0, opacity:lines.length>1?1:0.3 }}>×</button>
                </div>
              ))}

              <button onClick={addLine} style={{
                padding:"8px", background:B.light, border:`1px dashed ${B.border}`,
                borderRadius:8, fontSize:12, fontWeight:600, color:B.muted, cursor:"pointer", fontFamily:"inherit",
              }}>+ Add Line Item</button>

              {/* Totals summary */}
              <div style={{ marginTop:8, background:"#f8fafc", border:`1px solid ${B.border}`, borderRadius:10, padding:"14px 18px" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {[
                    ["Subtotal", subtotal],
                    [`VAT (${vatRate}%)`, vatAmt],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:B.muted }}>
                      <span>{label}</span>
                      <span style={{ fontWeight:600 }}>{currency} {val.toLocaleString("en",{minimumFractionDigits:2})}</span>
                    </div>
                  ))}
                  <div style={{ borderTop:`1px solid ${B.border}`, paddingTop:8, display:"flex", justifyContent:"space-between", fontSize:15, fontWeight:800, color:B.text }}>
                    <span>Grand Total</span>
                    <span style={{ color:B.blue }}>{currency} {grandTotal.toLocaleString("en",{minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>

              {/* Amount already paid */}
              <div>
                {lbl("Amount Already Paid")}
                <input type="number" value={paid} onChange={e => setPaid(e.target.value)}
                  placeholder="0.00" min={0} max={grandTotal} {...inp()} />
                <div style={{ fontSize:10, color:B.muted, marginTop:4 }}>
                  Status will auto-set to <strong style={{ color:STATUS_COLORS[autoStatus] }}>{autoStatus}</strong> · Balance: <strong>{currency} {balance.toLocaleString("en",{minimumFractionDigits:2})}</strong>
                </div>
              </div>

              {errors.amount && <div style={{ fontSize:12, color:B.red }}>{errors.amount}</div>}
            </div>
          )}

          {/* ── STEP 3: Review ── */}
          {step === 3 && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ background:`linear-gradient(135deg,${B.blue}12,${B.accent}08)`, border:`1px solid ${B.blue}25`, borderRadius:12, padding:"16px 20px" }}>
                <div style={{ fontSize:11, fontWeight:700, color:B.blue, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>Invoice Summary</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  {[
                    ["Client",   client    ],
                    ["Currency", currency  ],
                    ["Date",     date      ],
                    ["Due",      due || "—"],
                    ["Recurring",recurring === "None" ? "One-time" : recurring],
                    ["Status",   autoStatus],
                  ].map(([k,v]) => (
                    <div key={k}>
                      <div style={{ fontSize:10, color:B.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>{k}</div>
                      <div style={{ fontSize:13, fontWeight:700, color: k==="Status" ? STATUS_COLORS[v] : B.text, marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Line items mini table */}
              <div style={{ background:"#fff", border:`1px solid ${B.border}`, borderRadius:10, overflow:"hidden" }}>
                <div style={{ padding:"10px 14px", borderBottom:`1px solid ${B.border}`, fontSize:11, fontWeight:700, color:B.text }}>Line Items</div>
                {lines.filter(l => l.desc || l.rate).map((l, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"8px 14px", borderBottom:`1px solid ${B.border}`, fontSize:12 }}>
                    <span style={{ color:B.text }}>{l.desc || `Item ${i+1}`} × {l.qty}</span>
                    <span style={{ fontWeight:700, color:B.text }}>{currency} {((Number(l.qty)||1)*(Number(l.rate)||0)).toLocaleString("en",{minimumFractionDigits:2})}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 14px", background:"#f8fafc", fontSize:13, fontWeight:800 }}>
                  <span>Grand Total (incl. {vatRate}% VAT)</span>
                  <span style={{ color:B.blue }}>{currency} {grandTotal.toLocaleString("en",{minimumFractionDigits:2})}</span>
                </div>
              </div>

              {notes && (
                <div style={{ background:"#fffbeb", border:`1px solid #fde68a`, borderRadius:8, padding:"10px 14px", fontSize:12, color:"#92400e" }}>
                  <strong>Notes:</strong> {notes}
                </div>
              )}

              {Object.keys(errors).length > 0 && (
                <div style={{ background:`${B.red}10`, border:`1px solid ${B.red}30`, borderRadius:8, padding:"10px 14px", fontSize:12, color:B.red }}>
                  ⚠ Please fix the errors on previous steps before saving.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"14px 24px", borderTop:`1px solid ${B.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, background:"#fafafa" }}>
          <button onClick={onClose} style={{ padding:"8px 18px", borderRadius:8, fontSize:12, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, cursor:"pointer", color:B.muted, fontFamily:"inherit" }}>
            Cancel
          </button>
          <div style={{ display:"flex", gap:8 }}>
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} style={{ padding:"8px 18px", borderRadius:8, fontSize:12, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, cursor:"pointer", color:B.text, fontFamily:"inherit" }}>
                ← Back
              </button>
            )}
            {step < 3 ? (
              <button onClick={() => { if (step === 1 && !client.trim()) { setErrors({client:"Required"}); return; } setErrors({}); setStep(s => s + 1); }}
                style={{ padding:"8px 22px", borderRadius:8, fontSize:12, fontWeight:700, background:B.blue, color:"#fff", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                Next →
              </button>
            ) : (
              <button onClick={handleSave}
                style={{ padding:"8px 22px", borderRadius:8, fontSize:13, fontWeight:700, background:B.green, color:"#fff", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                ✓ Create Invoice
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ActionBtn({ label, color, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: "2px 8px", fontSize: 10, fontWeight: 700,
      background: color + "18", color, border: `1px solid ${color}40`,
      borderRadius: 4, cursor: "pointer",
    }}>{label}</button>
  );
}

function TinyBtn({ label, color, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: "3px 7px", fontSize: 10, fontWeight: 700,
      background: color + "18", color, border: `1px solid ${color}40`,
      borderRadius: 4, cursor: "pointer",
    }}>{label}</button>
  );
}
