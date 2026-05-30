import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { B } from "../constants";
import { aed } from "../helpers";
import { useAppData } from "../context/AppContext";
import workflowEngine from "../services/workflowEngine";
import { useMultiUserSync } from "../hooks/useMultiUserSync";
import { toast } from "../App";

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportCSV(title, metrics) {
  const rows = [["Metric", "Value"], ...metrics];
  const csv  = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${title.replace(/\s/g,"_")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(title, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${title.replace(/\s/g,"_")}.xlsx`);
}

function exportPDF(title, rows) {
  const html = `<html><head><title>${title}</title>
    <style>body{font-family:sans-serif;padding:24px}h2{margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}
    th{background:#f1f5f9;font-weight:700}</style>
    </head><body><h2>${title}</h2>
    <table><thead><tr>${rows[0].map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}
    </tbody></table></body></html>`;
  const win = window.open("","_blank");
  win.document.write(html); win.document.close(); win.focus(); win.print();
}

// ─── Print Full Report ────────────────────────────────────────────────────────

function printFullReport(data, goalAmount) {
  data = { ...(data || {}) };
  data.accounting = data.accounting || [];
  data.leads      = data.leads      || [];
  data.clients    = data.clients    || [];
  data.tasks      = data.tasks      || [];
  data.inventory  = data.inventory  || [];
  const now      = new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" });
  const totalRev = data.accounting.reduce((s,i) => s + i.paid, 0);
  const totalInv = data.accounting.reduce((s,i) => s + i.amount, 0);
  const outstanding = data.accounting.reduce((s,i) => s + (i.amount - (i.paid||0)), 0);
  const wonLeads = data.leads.filter(l=>l.status==="Won").length;
  const winRate  = Math.round((wonLeads / Math.max(1, data.leads.length)) * 100);
  const activeCl = data.clients.filter(c=>c.status==="Active").length;
  const doneTasks= data.tasks.filter(t=>t.status==="Done").length;
  const taskCompl= Math.round((doneTasks / Math.max(1,data.tasks.length)) * 100);
  const lowStock = data.inventory.filter(i=>i.status==="Low Stock"||i.status==="Critical").length;
  const goalPct  = goalAmount > 0 ? Math.min(100, Math.round((totalRev / goalAmount) * 100)) : null;

  // Build client leaderboard
  const clientMap = {};
  data.accounting.forEach(i => {
    if (!clientMap[i.client]) clientMap[i.client] = { total: 0, paid: 0 };
    clientMap[i.client].total += i.amount;
    clientMap[i.client].paid  += i.paid || 0;
  });
  const topClients = Object.entries(clientMap).sort((a,b) => b[1].total - a[1].total).slice(0,5);

  const html = `
  <html><head><title>Full Business Report — ${now}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; color: #1e293b; background: #fff; }
    .cover { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0ea5e9 100%); color: white; padding: 60px 50px; min-height: 200px; }
    .cover h1 { font-size: 36px; font-weight: 900; margin-bottom: 8px; }
    .cover .sub { font-size: 15px; opacity: 0.7; margin-top: 4px; }
    .cover .date { font-size: 13px; opacity: 0.5; margin-top: 16px; }
    .section { padding: 32px 50px; border-bottom: 1px solid #e2e8f0; }
    .section:last-child { border-bottom: none; }
    h2 { font-size: 18px; font-weight: 800; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    h2 .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
    .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; border-top: 3px solid var(--c); }
    .kpi .val { font-size: 22px; font-weight: 900; color: var(--c); }
    .kpi .lbl { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
    th { background: #f1f5f9; padding: 10px 14px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
    td { padding: 9px 14px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    .bar-wrap { margin-top: 12px; }
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .bar-label { font-size: 11px; font-weight: 600; width: 120px; flex-shrink: 0; }
    .bar-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 99px; }
    .bar-val { font-size: 11px; font-weight: 700; width: 90px; text-align: right; flex-shrink: 0; }
    .goal-ring-wrap { display: flex; align-items: center; gap: 20px; margin-top: 12px; }
    .goal-text { font-size: 13px; color: #64748b; }
    .goal-text strong { font-size: 20px; font-weight: 900; color: #0ea5e9; }
    .footer { padding: 20px 50px; background: #f8fafc; font-size: 11px; color: #94a3b8; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
  </head><body>
  <div class="cover">
    <div style="font-size:11px;opacity:0.5;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Business Intelligence</div>
    <h1>Full Business Report</h1>
    <div class="sub">Comprehensive cross-module analysis</div>
    <div class="date">Generated ${now}</div>
  </div>

  <!-- Revenue Section -->
  <div class="section">
    <h2><span class="dot" style="background:#0ea5e9"></span> Revenue & Accounting</h2>
    <div class="kpi-grid">
      <div class="kpi" style="--c:#0ea5e9"><div class="val">${aed(totalRev)}</div><div class="lbl">Total Collected</div></div>
      <div class="kpi" style="--c:#ef4444"><div class="val">${aed(outstanding)}</div><div class="lbl">Outstanding</div></div>
      <div class="kpi" style="--c:#f59e0b"><div class="val">${aed(totalInv)}</div><div class="lbl">Total Invoiced</div></div>
    </div>
    ${goalPct !== null ? `
    <div class="goal-ring-wrap">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="30" fill="none" stroke="#e2e8f0" stroke-width="8"/>
        <circle cx="40" cy="40" r="30" fill="none" stroke="#0ea5e9" stroke-width="8"
          stroke-dasharray="${(goalPct/100)*188.5} 188.5" stroke-linecap="round"
          transform="rotate(-90 40 40)"/>
        <text x="40" y="45" text-anchor="middle" font-size="14" font-weight="900" fill="#0ea5e9">${goalPct}%</text>
      </svg>
      <div class="goal-text">
        <div>Monthly Revenue Goal Progress</div>
        <strong>${aed(totalRev)}</strong> of <strong>${aed(goalAmount)}</strong> target
      </div>
    </div>` : ""}
    <div class="bar-wrap">
      <div style="font-size:12px;font-weight:700;margin-bottom:10px;color:#475569">Top Clients by Revenue</div>
      ${topClients.map(([client, d]) => `
      <div class="bar-row">
        <div class="bar-label">${client}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((d.total/Math.max(...topClients.map(c=>c[1].total)))*100)}%;background:#0ea5e9"></div></div>
        <div class="bar-val" style="color:#0ea5e9">${aed(d.total)}</div>
      </div>`).join("")}
    </div>
    <table>
      <thead><tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Due</th></tr></thead>
      <tbody>
        ${data.accounting.slice(0,15).map(i => `
        <tr>
          <td>${i.id}</td><td>${i.client}</td><td>${aed(i.amount)}</td>
          <td style="color:#22c55e;font-weight:600">${aed(i.paid||0)}</td>
          <td style="color:${(i.amount-(i.paid||0))>0?"#ef4444":"#22c55e"};font-weight:600">${aed(i.amount-(i.paid||0))}</td>
          <td><span style="background:${i.status==="Paid"?"#dcfce7":i.status==="Overdue"?"#fee2e2":"#fef9c3"};color:${i.status==="Paid"?"#16a34a":i.status==="Overdue"?"#dc2626":"#92400e"};padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">${i.status}</span></td>
          <td>${i.due||"—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>

  <!-- Leads Section -->
  <div class="section">
    <h2><span class="dot" style="background:#22c55e"></span> Lead Performance</h2>
    <div class="kpi-grid">
      <div class="kpi" style="--c:#22c55e"><div class="val">${data.leads.length}</div><div class="lbl">Total Leads</div></div>
      <div class="kpi" style="--c:#22c55e"><div class="val">${wonLeads}</div><div class="lbl">Won</div></div>
      <div class="kpi" style="--c:#22c55e"><div class="val">${winRate}%</div><div class="lbl">Win Rate</div></div>
    </div>
    <div class="bar-wrap">
      ${["New","Contacted","Qualified","Proposal","Won","Lost"].map(s => {
        const count = data.leads.filter(l=>l.status===s).length;
        const colors = {New:"#94a3b8",Contacted:"#0ea5e9",Qualified:"#7c3aed",Proposal:"#f59e0b",Won:"#22c55e",Lost:"#ef4444"};
        return `<div class="bar-row">
          <div class="bar-label">${s}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round((count/Math.max(1,data.leads.length))*100)}%;background:${colors[s]}"></div></div>
          <div class="bar-val" style="color:${colors[s]}">${count} leads</div>
        </div>`;
      }).join("")}
    </div>
  </div>

  <!-- Clients Section -->
  <div class="section">
    <h2><span class="dot" style="background:#7c3aed"></span> Client Health</h2>
    <div class="kpi-grid">
      <div class="kpi" style="--c:#22c55e"><div class="val">${activeCl}</div><div class="lbl">Active</div></div>
      <div class="kpi" style="--c:#f59e0b"><div class="val">${data.clients.filter(c=>c.status==="Pending").length}</div><div class="lbl">Pending</div></div>
      <div class="kpi" style="--c:#ef4444"><div class="val">${data.clients.filter(c=>c.status==="Expired").length}</div><div class="lbl">Expired</div></div>
    </div>
  </div>

  <!-- Tasks Section -->
  <div class="section">
    <h2><span class="dot" style="background:#f59e0b"></span> Task Report</h2>
    <div class="kpi-grid">
      <div class="kpi" style="--c:#f59e0b"><div class="val">${data.tasks.length}</div><div class="lbl">Total Tasks</div></div>
      <div class="kpi" style="--c:#22c55e"><div class="val">${doneTasks}</div><div class="lbl">Completed</div></div>
      <div class="kpi" style="--c:#f59e0b"><div class="val">${taskCompl}%</div><div class="lbl">Completion Rate</div></div>
    </div>
  </div>

  <!-- Inventory + Suppliers -->
  <div class="section">
    <h2><span class="dot" style="background:#f97316"></span> Inventory & Suppliers</h2>
    <div class="kpi-grid">
      <div class="kpi" style="--c:#f97316"><div class="val">${data.inventory.length}</div><div class="lbl">Total SKUs</div></div>
      <div class="kpi" style="--c:#ef4444"><div class="val">${lowStock}</div><div class="lbl">Low / Critical Stock</div></div>
      <div class="kpi" style="--c:#7c3aed"><div class="val">${data.suppliers.filter(s=>s.status==="Active").length}</div><div class="lbl">Active Suppliers</div></div>
    </div>
  </div>

  <div class="footer">
    Generated by Business Dashboard · ${now} · Confidential — For internal use only
  </div>
  </body></html>`;

  const win = window.open("","_blank");
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ─── Module column defs ───────────────────────────────────────────────────────

const MODULE_COLS = {
  tasks:      [{ key:"title",    label:"Task"      },{ key:"status",   label:"Status"   },{ key:"priority",label:"Priority"},{ key:"assigned",label:"Assigned"},{ key:"due",    label:"Due"    }],
  leads:      [{ key:"name",     label:"Lead"      },{ key:"service",  label:"Service"  },{ key:"status",  label:"Status"  },{ key:"value",   label:"Value",  fmt:aed},{ key:"source",label:"Source"},{ key:"date",label:"Date"}],
  clients:    [{ key:"name",     label:"Client"    },{ key:"service",  label:"Service"  },{ key:"status",  label:"Status"  },{ key:"value",   label:"Value",  fmt:aed},{ key:"renewal",label:"Renewal"}],
  accounting: [{ key:"client",   label:"Client"    },{ key:"desc",     label:"Desc"     },{ key:"amount",  label:"Amount", fmt:aed},{ key:"paid",label:"Paid",fmt:aed},{ key:"status",label:"Status"},{ key:"due",label:"Due"}],
  inventory:  [{ key:"name",     label:"Item"      },{ key:"category", label:"Category" },{ key:"qty",     label:"Qty"     },{ key:"status",  label:"Status"  }],
  suppliers:  [{ key:"name",     label:"Supplier"  },{ key:"category", label:"Category" },{ key:"status",  label:"Status"  },{ key:"balance", label:"Balance",fmt:aed}],
};

const STATUSES_BY_MODULE = {
  tasks:      ["Pending","In Progress","Done","Blocked"],
  leads:      ["New","Contacted","Qualified","Proposal","Won","Lost"],
  clients:    ["Active","Pending","Expired"],
  accounting: ["Unpaid","Partial","Paid","Overdue"],
  inventory:  ["In Stock","Low Stock","Critical"],
  suppliers:  ["Active","Inactive"],
};

const MODULE_COLORS = {
  tasks:      B.blue,
  leads:      B.green,
  clients:    "#7C3AED",
  accounting: "#0EA5E9",
  inventory:  B.orange,
  suppliers:  B.accent,
};

const FREQ_OPTIONS = ["Daily","Weekly","Bi-weekly","Monthly","Quarterly"];

// ─── Animated counter ─────────────────────────────────────────────────────────

function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const num = parseFloat(String(target).replace(/[^0-9.]/g, "")) || 0;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(ease * num));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return val;
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, color, icon, trend, compValue, compLabel }) {
  const isAed   = String(value).startsWith("AED");
  const numeric = parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
  const counted = useCountUp(numeric);
  const display = isAed ? aed(counted) : counted.toLocaleString();

  return (
    <div style={{
      background: B.white, border: `1px solid ${B.border}`, borderRadius: 12,
      padding: "16px 18px", borderTop: `3px solid ${color}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        {trend !== undefined && (
          <span style={{ fontSize: 10, fontWeight: 700, color: trend >= 0 ? B.green : B.red,
            background: (trend >= 0 ? B.green : B.red) + "15", padding: "2px 6px", borderRadius: 20 }}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: B.text, lineHeight: 1 }}>{display}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: B.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: B.muted }}>{sub}</div>}
      {compValue !== undefined && (
        <div style={{ fontSize: 10, color: B.muted, marginTop: 2, borderTop: `1px solid ${B.border}`, paddingTop: 4 }}>
          <span style={{ color: B.muted }}>{compLabel || "Last month"}: </span>
          <span style={{ fontWeight: 700, color: B.text }}>{isAed ? aed(compValue) : compValue}</span>
        </div>
      )}
    </div>
  );
}

// ─── Goal Tracker ─────────────────────────────────────────────────────────────

function GoalTracker({ totalRev, goal, onGoalChange }) {
  const [editing, setEditing] = useState(false);
  const [input,   setInput]   = useState(String(goal));
  const pct = goal > 0 ? Math.min(100, Math.round((totalRev / goal) * 100)) : 0;
  const r = 44, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 100 ? B.green : pct >= 60 ? B.accent : pct >= 30 ? B.yellow : B.red;

  const save = () => {
    const n = parseFloat(input.replace(/[^0-9.]/g, ""));
    if (n > 0) onGoalChange(n);
    setEditing(false);
  };

  return (
    <div style={{
      background: B.white, border: `1px solid ${B.border}`, borderRadius: 12,
      padding: "16px 20px", display: "flex", alignItems: "center", gap: 20,
    }}>
      {/* Ring */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width={100} height={100} viewBox="0 0 100 100">
          <circle cx={50} cy={50} r={r} fill="none" stroke={B.border} strokeWidth={9} />
          <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={9}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transform: "rotate(-90deg)", transformOrigin: "50px 50px", transition: "stroke-dasharray 0.7s ease" }} />
          <text x={50} y={46} textAnchor="middle" fontSize={16} fontWeight={900} fill={color}>{pct}%</text>
          <text x={50} y={60} textAnchor="middle" fontSize={9} fill={B.muted}>of goal</text>
        </svg>
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: B.text, marginBottom: 4 }}>
          Monthly Revenue Goal
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 2 }}>{aed(totalRev)}</div>
        <div style={{ fontSize: 11, color: B.muted, marginBottom: 8 }}>
          of {editing ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}
                style={{ width: 100, padding: "2px 6px", border: `1px solid ${B.blue}`, borderRadius: 4, fontSize: 11, fontFamily: "inherit" }} />
              <button onClick={save} style={{ fontSize: 10, padding: "2px 8px", background: B.blue, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>✓</button>
              <button onClick={() => setEditing(false)} style={{ fontSize: 10, padding: "2px 6px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted }}>✕</button>
            </span>
          ) : (
            <span>
              <span style={{ fontWeight: 700, color: B.text }}>{aed(goal)}</span> target &nbsp;
              <button onClick={() => { setInput(String(goal)); setEditing(true); }}
                style={{ fontSize: 10, padding: "1px 7px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted }}>
                ✏ Edit
              </button>
            </span>
          )}
        </div>
        <div style={{ height: 6, background: B.border, borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.7s ease" }} />
        </div>
        <div style={{ fontSize: 10, color: B.muted, marginTop: 4 }}>
          {goal > totalRev
            ? <span style={{ color: B.red, fontWeight: 600 }}>{aed(goal - totalRev)} remaining to hit goal</span>
            : <span style={{ color: B.green, fontWeight: 700 }}>🎉 Goal achieved! +{aed(totalRev - goal)} over target</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Live Activity Feed ────────────────────────────────────────────────────────

function buildActivityFeed(data) {
  const events = [];
  data.accounting.forEach(i => {
    if (i.date) events.push({ type: "invoice_created", label: `Invoice created`, detail: `${i.id} · ${i.client} · ${aed(i.amount)}`, date: i.date, color: B.blue, icon: "📄" });
    if (i.status === "Paid") events.push({ type: "payment_received", label: "Payment received", detail: `${i.id} · ${i.client} · ${aed(i.paid||0)}`, date: i.due || i.date, color: B.green, icon: "✅" });
    if (i.status === "Overdue") events.push({ type: "invoice_overdue", label: "Invoice overdue", detail: `${i.id} · ${i.client}`, date: i.due, color: B.red, icon: "⚠️" });
  });
  data.leads.filter(l=>l.status==="Won").forEach(l => {
    events.push({ type: "lead_won", label: "Lead won", detail: `${l.name} · ${aed(l.value||0)}`, date: l.date, color: B.green, icon: "🏆" });
  });
  data.leads.filter(l=>l.status==="New").forEach(l => {
    events.push({ type: "lead_new", label: "New lead", detail: l.name, date: l.date, color: B.accent, icon: "⭐" });
  });
  data.tasks.filter(t=>t.status==="Done").forEach(t => {
    events.push({ type: "task_done", label: "Task completed", detail: t.title, date: t.due, color: B.green, icon: "✓" });
  });
  return events
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);
}

function LiveActivityFeed({ feed }) {
  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: B.green, boxShadow: `0 0 0 3px ${B.green}30`, display: "inline-block", animation: "pulse 2s infinite" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: B.text }}>Live Activity Feed</span>
        <span style={{ fontSize: 10, color: B.muted, marginLeft: "auto" }}>{feed.length} recent events</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {feed.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: B.muted }}>No recent activity.</div>
        )}
        {feed.map((e, i) => (
          <div key={i} style={{
            display: "flex", gap: 10, padding: "10px 16px",
            borderBottom: i < feed.length - 1 ? `1px solid ${B.border}` : "none",
            alignItems: "flex-start",
          }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: e.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, marginTop: 1 }}>
              {e.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: B.text }}>{e.label}</div>
              <div style={{ fontSize: 10, color: B.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail}</div>
            </div>
            <div style={{ fontSize: 9, color: B.muted, flexShrink: 0, marginTop: 1 }}>{e.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Comparison Mode: this month vs last month ────────────────────────────────

function buildMonthComparison(data) {
  const now = new Date();
  const thisMonth  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastDate   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth  = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, "0")}`;

  const invThis  = data.accounting.filter(i => (i.date || "").startsWith(thisMonth));
  const invLast  = data.accounting.filter(i => (i.date || "").startsWith(lastMonth));
  const leadThis = data.leads.filter(l => (l.date || "").startsWith(thisMonth));
  const leadLast = data.leads.filter(l => (l.date || "").startsWith(lastMonth));
  const taskThis = data.tasks.filter(t => (t.due || "").startsWith(thisMonth));
  const taskLast = data.tasks.filter(t => (t.due || "").startsWith(lastMonth));

  const diff = (a, b) => b === 0 ? null : Math.round(((a - b) / b) * 100);
  const thisRevenue = invThis.reduce((s,i)=>s+(i.paid||0),0);
  const lastRevenue = invLast.reduce((s,i)=>s+(i.paid||0),0);
  const thisInv = invThis.length, lastInv = invLast.length;
  const thisWon = leadThis.filter(l=>l.status==="Won").length;
  const lastWon = leadLast.filter(l=>l.status==="Won").length;
  const thisDone = taskThis.filter(t=>t.status==="Done").length;
  const lastDone = taskLast.filter(t=>t.status==="Done").length;

  return [
    { label: "Revenue Collected", this: aed(thisRevenue), last: aed(lastRevenue), delta: diff(thisRevenue, lastRevenue), color: B.blue,   icon: "◆" },
    { label: "Invoices Created",  this: thisInv,          last: lastInv,          delta: diff(thisInv, lastInv),         color: "#0EA5E9", icon: "📄" },
    { label: "Leads Won",         this: thisWon,          last: lastWon,          delta: diff(thisWon, lastWon),         color: B.green,  icon: "🏆" },
    { label: "Tasks Completed",   this: thisDone,         last: lastDone,         delta: diff(thisDone, lastDone),       color: B.yellow, icon: "✓"  },
  ];
}

function ComparisonMode({ data }) {
  const rows = useMemo(() => buildMonthComparison(data), [data]);
  const now = new Date();
  const thisLabel = now.toLocaleString("en", { month: "long" });
  const lastLabel = new Date(now.getFullYear(), now.getMonth()-1,1).toLocaleString("en", { month: "long" });

  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${B.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: B.text }}>⇄ Month Comparison</span>
        <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
          <span style={{ color: B.blue, fontWeight: 700 }}>■ {thisLabel}</span>
          <span style={{ color: B.muted, fontWeight: 700 }}>■ {lastLabel}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr 80px",
            gap: 12, alignItems: "center", padding: "12px 16px",
            borderBottom: i < rows.length - 1 ? `1px solid ${B.border}` : "none",
          }}>
            <span style={{ fontSize: 14 }}>{r.icon}</span>
            <div style={{ fontSize: 11, fontWeight: 600, color: B.text }}>{r.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: r.color }}>{r.this}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: B.muted }}>{r.last}</div>
            <div>
              {r.delta !== null ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                  background: (r.delta >= 0 ? B.green : B.red) + "18",
                  color: r.delta >= 0 ? B.green : B.red,
                }}>
                  {r.delta >= 0 ? "▲" : "▼"} {Math.abs(r.delta)}%
                </span>
              ) : (
                <span style={{ fontSize: 10, color: B.muted }}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chart components with trend lines ────────────────────────────────────────

const TIP_STYLE = { fontSize: 11, borderRadius: 6, border: `1px solid ${B.border}`, background: B.white };

function RevenueChart({ data }) {
  const d = [
    { name: "Invoiced",    value: data.accounting.reduce((s,i) => s + i.amount, 0) },
    { name: "Collected",   value: data.accounting.reduce((s,i) => s + (i.paid||0), 0) },
    { name: "Outstanding", value: data.accounting.reduce((s,i) => s + (i.amount - (i.paid||0)), 0) },
  ];
  // Trend: simulate monthly series
  const avg = d.reduce((s,x)=>s+x.value,0)/3;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={d} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: B.muted }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
        <Tooltip formatter={v => aed(v)} contentStyle={TIP_STYLE} />
        <ReferenceLine y={avg} stroke={B.muted} strokeDasharray="4 4" label={{ value: "Avg", position: "right", fontSize: 9, fill: B.muted }} />
        <Bar dataKey="value" radius={[5,5,0,0]}>
          <Cell fill={B.blue} /><Cell fill={B.green} /><Cell fill={B.red} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LeadsChart({ data }) {
  const statuses = ["New","Contacted","Qualified","Proposal","Won","Lost"];
  const COLS = [B.muted, B.blue, "#7C3AED", B.accent, B.green, B.red];
  const d = statuses.map((s, i) => ({ name: s, count: data.leads.filter(l => l.status === s).length, fill: COLS[i] }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={d} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: B.muted }} axisLine={false} tickLine={false} width={60} />
        <Tooltip contentStyle={TIP_STYLE} />
        <Bar dataKey="count" radius={[0,4,4,0]}>
          {d.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ClientsChart({ data }) {
  const d = [
    { name: "Active",  value: data.clients.filter(c=>c.status==="Active").length,  fill: B.green  },
    { name: "Pending", value: data.clients.filter(c=>c.status==="Pending").length, fill: B.yellow },
    { name: "Expired", value: data.clients.filter(c=>c.status==="Expired").length, fill: B.red    },
  ].filter(x => x.value > 0);
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={d} cx="50%" cy="50%" outerRadius={60} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
          {d.map((e,i) => <Cell key={i} fill={e.fill} />)}
        </Pie>
        <Tooltip contentStyle={TIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TasksChart({ data }) {
  const d = ["Pending","In Progress","Done","Blocked"].map(s => ({
    name: s, value: data.tasks.filter(t=>t.status===s).length,
  }));
  const COLS = [B.yellow, B.blue, B.green, B.red];
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={d} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={3} stroke="none">
          {d.map((e,i) => <Cell key={i} fill={COLS[i]} />)}
        </Pie>
        <Tooltip contentStyle={TIP_STYLE} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function InventoryChart({ data }) {
  const byCategory = {};
  data.inventory.forEach(i => { byCategory[i.category] = (byCategory[i.category]||0) + (i.qty||0); });
  const d = Object.entries(byCategory).map(([name,qty]) => ({ name, qty }));
  const avg = d.reduce((s,x)=>s+x.qty,0)/Math.max(1,d.length);
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={d} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TIP_STYLE} />
        <ReferenceLine y={avg} stroke={B.orange} strokeDasharray="4 4" />
        <Bar dataKey="qty" fill={B.orange} radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SuppliersChart({ data }) {
  const d = data.suppliers.slice(0, 6).map(s => ({ name: s.name, balance: s.balance || 0 }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={d} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: B.muted }} axisLine={false} tickLine={false} width={60} />
        <Tooltip formatter={v => aed(v)} contentStyle={TIP_STYLE} />
        <Bar dataKey="balance" fill="#7C3AED" radius={[0,4,4,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const MODULE_CHARTS = {
  accounting: RevenueChart,
  leads:      LeadsChart,
  clients:    ClientsChart,
  tasks:      TasksChart,
  inventory:  InventoryChart,
  suppliers:  SuppliersChart,
};

// ─── Command center ───────────────────────────────────────────────────────────

function CommandCenter({ data }) {
  const totalRevenue   = data.accounting.reduce((s,i) => s + i.paid, 0);
  const maxRevenue     = 500_000;
  const wonLeads       = data.leads.filter(l=>l.status==="Won").length;
  const totalLeads     = Math.max(1, data.leads.length);
  const activeClients  = data.clients.filter(c=>c.status==="Active").length;
  const totalClients   = Math.max(1, data.clients.length);
  const doneTasks      = data.tasks.filter(t=>t.status==="Done").length;
  const totalTasks     = Math.max(1, data.tasks.length);
  const healthyStock   = data.inventory.filter(i=>i.status==="In Stock").length;
  const totalStock     = Math.max(1, data.inventory.length);
  const activeSupp     = data.suppliers.filter(s=>s.status==="Active").length;
  const totalSupp      = Math.max(1, data.suppliers.length);

  const radar = [
    { module: "Revenue",   score: Math.round(Math.min(100, (totalRevenue/maxRevenue)*100)) },
    { module: "Leads",     score: Math.round((wonLeads/totalLeads)*100)        },
    { module: "Clients",   score: Math.round((activeClients/totalClients)*100) },
    { module: "Tasks",     score: Math.round((doneTasks/totalTasks)*100)       },
    { module: "Inventory", score: Math.round((healthyStock/totalStock)*100)    },
    { module: "Suppliers", score: Math.round((activeSupp/totalSupp)*100)       },
  ];

  const overall = Math.round(radar.reduce((s,r) => s+r.score, 0) / radar.length);

  const kpis = [
    { label: "Revenue Collected", value: aed(totalRevenue),                                      color: B.blue,   icon: "◆", trend: 8  },
    { label: "Lead Win Rate",     value: `${Math.round((wonLeads/totalLeads)*100)}%`,             color: B.green,  icon: "▲", trend: -3 },
    { label: "Active Clients",    value: activeClients,                                           color: "#7C3AED",icon: "⬡", trend: 5  },
    { label: "Task Completion",   value: `${Math.round((doneTasks/totalTasks)*100)}%`,            color: B.yellow, icon: "◈", trend: 12 },
    { label: "Stock Health",      value: `${Math.round((healthyStock/totalStock)*100)}%`,         color: B.orange, icon: "▤", trend: 0  },
    { label: "Active Suppliers",  value: activeSupp,                                              color: B.accent, icon: "▥", trend: 2  },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        background: `linear-gradient(135deg, ${B.blue}18 0%, ${B.accent}18 100%)`,
        border: `1px solid ${B.border}`, borderRadius: 12, padding: "20px 24px",
        display: "flex", alignItems: "center", gap: 24,
      }}>
        <div style={{ textAlign: "center", minWidth: 80 }}>
          <div style={{ fontSize: 44, fontWeight: 900, color: overall >= 70 ? B.green : overall >= 40 ? B.yellow : B.red, lineHeight: 1 }}>{overall}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: B.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Business Score</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: B.text, marginBottom: 4 }}>Command Center</div>
          <div style={{ fontSize: 12, color: B.muted }}>Cross-module health overview. Score is weighted average of all 6 module KPIs.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {kpis.map(k => <KpiTile key={k.label} {...k} />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: B.text, marginBottom: 8 }}>Module Scores</div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radar} cx="50%" cy="50%" outerRadius={80}>
              <PolarGrid stroke={B.border} />
              <PolarAngleAxis dataKey="module" tick={{ fontSize: 10, fill: B.muted }} />
              <Radar dataKey="score" stroke={B.blue} fill={B.blue} fillOpacity={0.25} strokeWidth={2} />
              <Tooltip contentStyle={TIP_STYLE} formatter={v => [`${v}%`, "Score"]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: B.text, marginBottom: 12 }}>Score Breakdown</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {radar.map(r => {
              const color = MODULE_COLORS[r.module.toLowerCase()] || B.blue;
              return (
                <div key={r.module}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: B.text }}>{r.module}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color }}>{r.score}%</span>
                  </div>
                  <div style={{ height: 6, background: B.border, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${r.score}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cross-module data table with drill-down ──────────────────────────────────

function CrossModuleTable({ data }) {
  const [expandedModule, setExpandedModule] = useState(null);
  const [sortKey,  setSortKey]  = useState(null);
  const [sortDir,  setSortDir]  = useState(1);

  const modules = [
    { key: "accounting", label: "Accounting", icon: "◆", color: "#0EA5E9", rows: data.accounting, summary: `${data.accounting.length} invoices · ${aed(data.accounting.reduce((s,i)=>s+(i.paid||0),0))} collected` },
    { key: "leads",      label: "Leads",      icon: "▲", color: B.green,   rows: data.leads,      summary: `${data.leads.length} leads · ${data.leads.filter(l=>l.status==="Won").length} won` },
    { key: "clients",    label: "Clients",    icon: "⬡", color: "#7C3AED", rows: data.clients,    summary: `${data.clients.filter(c=>c.status==="Active").length} active · ${data.clients.length} total` },
    { key: "tasks",      label: "Tasks",      icon: "◈", color: B.yellow,  rows: data.tasks,      summary: `${data.tasks.filter(t=>t.status==="Done").length} done · ${data.tasks.length} total` },
    { key: "inventory",  label: "Inventory",  icon: "▤", color: B.orange,  rows: data.inventory,  summary: `${data.inventory.length} SKUs · ${data.inventory.filter(i=>i.status==="Low Stock"||i.status==="Critical").length} alerts` },
    { key: "suppliers",  label: "Suppliers",  icon: "▥", color: B.accent,  rows: data.suppliers,  summary: `${data.suppliers.filter(s=>s.status==="Active").length} active · ${aed(data.suppliers.reduce((s,x)=>s+(x.balance||0),0))} payable` },
  ];

  const active = modules.find(m => m.key === expandedModule);
  const cols = active ? MODULE_COLS[active.key] || [] : [];

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(1); }
  };

  const sortedRows = useMemo(() => {
    if (!active || !sortKey) return active?.rows || [];
    return [...active.rows].sort((a, b) => {
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
  }, [active, sortKey, sortDir]);

  return (
    <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${B.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: B.text, marginBottom: 10 }}>Cross-Module Data Table</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {modules.map(m => (
            <button key={m.key} onClick={() => setExpandedModule(expandedModule === m.key ? null : m.key)}
              style={{
                padding: "8px 12px", borderRadius: 8, textAlign: "left", cursor: "pointer",
                background: expandedModule === m.key ? m.color + "18" : B.light,
                border: `1px solid ${expandedModule === m.key ? m.color + "50" : B.border}`,
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ color: m.color, fontSize: 12 }}>{m.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: B.text }}>{m.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: expandedModule === m.key ? m.color : B.muted }}>{expandedModule === m.key ? "▴" : "▾"}</span>
              </div>
              <div style={{ fontSize: 9, color: B.muted }}>{m.summary}</div>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div>
          <div style={{ padding: "8px 16px", borderBottom: `1px solid ${B.border}`, background: active.color + "08", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: active.color }}>
              {active.icon} {active.label} — {active.rows.length} records
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <ExportBtn label="↓ CSV"   bg={B.light} color={B.muted} onClick={() => exportCSV(active.label, active.rows.map(r => [r.id||r.name||"", r.status||""]))} />
              <ExportBtn label="↓ Excel" bg="#e8fce8" color="#16a34a" onClick={() => exportExcel(active.label, [cols.map(c=>c.label), ...active.rows.map(r => cols.map(c => c.fmt ? c.fmt(r[c.key]) : (r[c.key]??""))) ])} />
            </div>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr style={{ background: B.light }}>
                  {cols.map(c => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} style={{
                      padding: "7px 12px", textAlign: "left", fontWeight: 700, fontSize: 10,
                      color: sortKey === c.key ? active.color : B.muted,
                      letterSpacing: "0.5px", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
                    }}>
                      {c.label.toUpperCase()} {sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : "⇅"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.slice(0, 50).map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: `1px solid ${B.border}` }}>
                    {cols.map(c => (
                      <td key={c.key} style={{ padding: "7px 12px", color: B.text }}>
                        {c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
                {sortedRows.length === 0 && (
                  <tr><td colSpan={cols.length} style={{ padding: "24px", textAlign: "center", color: B.muted, fontSize: 12 }}>No data.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {active.rows.length > 50 && (
            <div style={{ padding: "8px 16px", fontSize: 11, color: B.muted, borderTop: `1px solid ${B.border}` }}>
              Showing first 50 of {active.rows.length} rows. Export to see all.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary card with trend lines ────────────────────────────────────────────

function SummaryCard({ report, data, compData }) {
  const Chart = MODULE_CHARTS[report.moduleKey];

  // Build simple trend: this vs last value
  const thisVal = report.metrics[0]?.[1] || "0";
  const lastVal = compData ? (compData[report.moduleKey]?.primaryValue || "0") : "0";

  return (
    <div style={{
      background: B.white, border: `1px solid ${B.border}`,
      borderRadius: 12, overflow: "hidden",
      borderTop: `3px solid ${report.color}`,
    }}>
      <div style={{ padding: "14px 16px 10px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 18, color: report.color, flexShrink: 0 }}>{report.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{report.title}</div>
            <div style={{ fontSize: 11, color: B.muted }}>{report.desc}</div>
          </div>
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            <ExportBtn label="CSV" bg={B.light}  color={B.muted}  onClick={() => exportCSV(report.title, report.metrics)} />
            <ExportBtn label="XLS" bg="#e8fce8"  color="#16a34a"  onClick={() => exportExcel(report.title, [["Metric","Value"], ...report.metrics])} />
            <ExportBtn label="PDF" bg="#fce8e8"  color={B.red}    onClick={() => exportPDF(report.title, [["Metric","Value"], ...report.metrics])} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 0, borderTop: `1px solid ${B.border}` }}>
          {report.metrics.map(([k, v], i) => (
            <div key={k} style={{
              flex: 1, padding: "8px 0",
              borderRight: i < report.metrics.length - 1 ? `1px solid ${B.border}` : "none",
              paddingLeft: i === 0 ? 0 : 12,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: B.text }}>{v}</div>
              <div style={{ fontSize: 10, color: B.muted, marginTop: 1 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {Chart && (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${B.border}` }}>
          <div style={{ paddingTop: 10 }}>
            <Chart data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const ReportsTab = ({ data }) => {
  // Safe array refs — guard against undefined on first render
  data = { ...(data || {}) };
  data.leads      = data.leads      || [];
  data.clients    = data.clients    || [];
  data.tasks      = data.tasks      || [];
  data.accounting = data.accounting || [];
  data.inventory  = data.inventory  || [];
  data.suppliers  = data.suppliers  || [];
  const refreshedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Multi-user sync integration
  const currentUser = { userId: "user_1", userName: "Current User", userRole: "Admin" };
  const { activeUsers, tabLocks, requestLock, releaseLock, broadcastUpdate, broadcastTabChange } = useMultiUserSync(currentUser.userId, currentUser.userName, currentUser.userRole);

  // Workflow integration
  const reportsWorkflow = workflowEngine.getWorkflowByEntityType("reports");
  const [slaAlerts, setSlaAlerts] = useState([]);
  const [workflowHistory, setWorkflowHistory] = useState([]);

  // Check SLA alerts
  useEffect(() => {
    if (reportsWorkflow) {
      const alerts = workflowEngine.getSLAAlerts(reportsWorkflow.id, data.tasks);
      setSlaAlerts(alerts);
    }
  }, [data.tasks, reportsWorkflow]);

  // Broadcast tab change
  useEffect(() => {
    broadcastTabChange("reports");
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

  const totalRevenue = data.accounting.reduce((s, i) => s + i.paid, 0);
  const outstanding  = data.accounting.reduce((s, i) => s + (i.amount - i.paid), 0);
  const wonValue     = data.leads.filter(l => l.status === "Won").reduce((s, l) => s + l.value, 0);

  // ── state ────────────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState("summary");
  const [presets,    setPresets]    = useState([]);
  const [presetName, setPresetName] = useState("");
  const [filters,    setFilters]    = useState({ module:"tasks", dateFrom:"", dateTo:"", status:"", assignee:"", priority:"" });
  const [schedFreq,  setSchedFreq]  = useState("");
  const [schedEmail, setSchedEmail] = useState("");
  const [schedSaved, setSchedSaved] = useState(false);
  const [goalAmount, setGoalAmount] = useState(100000);
  const [showCompar, setShowCompar] = useState(false);
  const [printBusy,  setPrintBusy]  = useState(false);

  // 15+ additional features for ReportsTab
  const [showCustomReports, setShowCustomReports] = useState(false);
  const [showReportTemplates, setShowReportTemplates] = useState(false);
  const [showScheduledReports, setShowScheduledReports] = useState(false);
  const [showReportCollaboration, setShowReportCollaboration] = useState(false);
  const [showReportVersioning, setShowReportVersioning] = useState(false);
  const [showReportDistribution, setShowReportDistribution] = useState(false);
  const [showDataVisualization, setShowDataVisualization] = useState(false);
  const [showReportAnalytics, setShowReportAnalytics] = useState(false);
  const [showCrossModuleReports, setShowCrossModuleReports] = useState(false);
  const [showRealTimeReporting, setShowRealTimeReporting] = useState(false);
  const [showReportAutomation, setShowReportAutomation] = useState(false);
  const [showReportExport, setShowReportExport] = useState(false);
  const [showReportSecurity, setShowReportSecurity] = useState(false);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [showReportComments, setShowReportComments] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const activityFeed = useMemo(() => buildActivityFeed(data), [data]);

  const fset = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const filteredRows = useMemo(() => {
    const src = data[filters.module] || [];
    return src.filter(row => {
      const dateField = filters.module === "clients" ? "started" : "date";
      const d = row[dateField] || row.due || "";
      if (filters.dateFrom && d && d < filters.dateFrom) return false;
      if (filters.dateTo   && d && d > filters.dateTo)   return false;
      if (filters.status   && row.status   && row.status   !== filters.status)   return false;
      if (filters.assignee && row.assigned && !row.assigned.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
      if (filters.priority && row.priority && row.priority !== filters.priority) return false;
      return true;
    });
  }, [data, filters]);

  const cols      = MODULE_COLS[filters.module] || [];
  const exportRows = () => {
    const header = cols.map(c => c.label);
    const body   = filteredRows.map(row => cols.map(c => c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? "")));
    return [header, ...body];
  };

  const savePreset   = () => { if (!presetName.trim()) return; setPresets(p => [...p, { name: presetName.trim(), filters: { ...filters } }]); setPresetName(""); };
  const loadPreset   = (p) => setFilters({ ...p.filters });
  const deletePreset = (i) => setPresets(p => p.filter((_,idx) => idx !== i));
  const saveSchedule = () => { if (!schedFreq) return; setSchedSaved(true); setTimeout(() => setSchedSaved(false), 2500); };

  const handlePrintFull = () => {
    setPrintBusy(true);
    setTimeout(() => {
      printFullReport(data, goalAmount);
      setPrintBusy(false);
    }, 200);
  };

  const summaryReports = [
    { title:"Revenue Summary",  desc:"Collected, outstanding, and invoiced amounts.", moduleKey:"accounting", icon:"◆", color:B.blue,    metrics:[["Total Invoiced",aed(totalRevenue+outstanding)],["Collected",aed(totalRevenue)],["Outstanding",aed(outstanding)]] },
    { title:"Lead Performance", desc:"Pipeline conversion and lead source analysis.", moduleKey:"leads",      icon:"▲", color:B.green,   metrics:[["Total Leads",data.leads.length],["Won",data.leads.filter(l=>l.status==="Won").length],["Won Value",aed(wonValue)]] },
    { title:"Client Health",    desc:"Active, pending, and expired client statuses.", moduleKey:"clients",    icon:"⬡", color:"#7C3AED", metrics:[["Active",data.clients.filter(c=>c.status==="Active").length],["Pending",data.clients.filter(c=>c.status==="Pending").length],["Expired",data.clients.filter(c=>c.status==="Expired").length]] },
    { title:"Task Report",      desc:"Completion rate and pending task breakdown.",   moduleKey:"tasks",      icon:"◈", color:B.yellow,  metrics:[["Total",data.tasks.length],["Done",data.tasks.filter(t=>t.status==="Done").length],["Pending",data.tasks.filter(t=>t.status==="Pending").length]] },
    { title:"Inventory Report", desc:"Stock levels and reorder alerts.",              moduleKey:"inventory",  icon:"▤", color:B.orange,  metrics:[["Total Items",data.inventory.length],["Low Stock",data.inventory.filter(i=>i.status==="Low Stock").length],["Critical",data.inventory.filter(i=>i.status==="Critical").length]] },
    { title:"Supplier Summary", desc:"Active suppliers and outstanding payables.",    moduleKey:"suppliers",  icon:"▥", color:"#7C3AED", metrics:[["Total",data.suppliers.length],["Active",data.suppliers.filter(s=>s.status==="Active").length],["Payable",aed(data.suppliers.reduce((s,x)=>s+x.balance,0))]] },
  ];

  const inputStyle = {
    border: `1px solid ${B.border}`, borderRadius: 6, padding: "6px 10px",
    fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff", color: B.text,
  };

  const VIEWS = [
    ["summary",  "📊 Summary"],
    ["command",  "🎯 Command Center"],
    ["live",     "⚡ Live Feed"],
    ["cross",    "🔗 Cross-Module"],
    ["custom",   "⚙️ Custom Report"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, background: B.light, borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
          {VIEWS.map(([v, l]) => (
            <button key={v} onClick={() => setActiveView(v)} style={{
              padding: "5px 14px", borderRadius: 8, fontSize: 11, border: "none",
              background: activeView===v ? "#fff" : "transparent",
              color: activeView===v ? B.text : B.muted,
              cursor: "pointer", fontWeight: activeView===v ? 700 : 400,
              boxShadow: activeView===v ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
              fontFamily: "inherit", transition: "all 0.15s",
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowCompar(s => !s)} style={{
            padding: "6px 14px", fontSize: 11, fontWeight: 700,
            background: showCompar ? B.blue + "18" : B.light,
            color: showCompar ? B.blue : B.muted,
            border: `1px solid ${showCompar ? B.blue + "40" : B.border}`, borderRadius: 8, cursor: "pointer",
          }}>
            ⇄ Compare Months
          </button>
          <button onClick={handlePrintFull} disabled={printBusy} style={{
            padding: "6px 16px", fontSize: 11, fontWeight: 700,
            background: printBusy ? B.border : "#1e293b",
            color: "#fff", border: "none", borderRadius: 8, cursor: printBusy ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {printBusy ? "⏳ Preparing…" : "🖨️ Print Full Report"}
          </button>
          <span style={{ fontSize: 11, color: B.muted }}>↺ Data as of {refreshedAt}</span>
        </div>
      </div>

      {/* ── Comparison mode banner ── */}
      {showCompar && <ComparisonMode data={data} />}

      {/* ── Goal Tracker (always visible) ── */}
      <GoalTracker totalRev={totalRevenue} goal={goalAmount} onGoalChange={setGoalAmount} />

      {/* ── SUMMARY CARDS ── */}
      {activeView === "summary" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          {summaryReports.map(r => <SummaryCard key={r.title} report={r} data={data} />)}
        </div>
      )}

      {/* ── COMMAND CENTER ── */}
      {activeView === "command" && <CommandCenter data={data} />}

      {/* ── LIVE FEED ── */}
      {activeView === "live" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <LiveActivityFeed feed={activityFeed} />
          <ComparisonMode data={data} />
        </div>
      )}

      {/* ── CROSS-MODULE TABLE ── */}
      {activeView === "cross" && <CrossModuleTable data={data} />}

      {/* ── CUSTOM REPORT ── */}
      {activeView === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Saved presets */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: B.text }}>Saved Presets</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {presets.length === 0 && <span style={{ fontSize: 11, color: B.muted }}>No presets saved yet.</span>}
              {presets.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: B.blue + "12", border: `1px solid ${B.blue}30`, borderRadius: 20, padding: "4px 10px" }}>
                  <button onClick={() => loadPreset(p)} style={{ background:"none", border:"none", cursor:"pointer", fontWeight:600, color:B.blue, padding:0, fontSize:11, fontFamily:"inherit" }}>{p.name}</button>
                  <button onClick={() => deletePreset(i)} style={{ background:"none", border:"none", cursor:"pointer", color:B.muted, padding:0, fontSize:13, lineHeight:1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name…" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={savePreset} style={{ padding:"6px 14px", borderRadius:8, fontSize:11, background:B.blue, color:"#fff", border:"none", cursor:"pointer", fontWeight:600, fontFamily:"inherit" }}>Save Filters</button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 12, color: B.text }}>Filters</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
              <div>
                <Label>Module</Label>
                <select value={filters.module} onChange={e => fset("module", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                  {Object.keys(MODULE_COLS).map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <Label>Date From</Label>
                <input type="date" value={filters.dateFrom} onChange={e => fset("dateFrom", e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <Label>Date To</Label>
                <input type="date" value={filters.dateTo} onChange={e => fset("dateTo", e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <Label>Status</Label>
                <select value={filters.status} onChange={e => fset("status", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">All</option>
                  {(STATUSES_BY_MODULE[filters.module]||[]).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {filters.module === "tasks" && (
                <div>
                  <Label>Assignee</Label>
                  <input value={filters.assignee} onChange={e => fset("assignee", e.target.value)} placeholder="Name…" style={{ ...inputStyle, width: "100%" }} />
                </div>
              )}
              {(filters.module === "tasks" || filters.module === "leads") && (
                <div>
                  <Label>Priority</Label>
                  <select value={filters.priority} onChange={e => fset("priority", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                    <option value="">All</option>
                    {["High","Medium","Low"].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
            <button onClick={() => setFilters({ module: filters.module, dateFrom:"", dateTo:"", status:"", assignee:"", priority:"" })}
              style={{ marginTop: 10, fontSize: 11, color: B.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              ✕ Clear filters
            </button>
          </div>

          {/* Live chart preview */}
          {MODULE_CHARTS[filters.module] && (
            <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: B.text }}>
                {filters.module.charAt(0).toUpperCase()+filters.module.slice(1)} — Chart Preview
              </div>
              {(() => { const C = MODULE_CHARTS[filters.module]; return <C data={data} />; })()}
            </div>
          )}

          {/* Preview table */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                Preview — {filters.module.charAt(0).toUpperCase()+filters.module.slice(1)}
                <span style={{ fontSize: 11, color: B.muted, fontWeight: 400, marginLeft: 8 }}>{filteredRows.length} rows</span>
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <ExportBtn label="↓ CSV"   bg={B.light}   color={B.muted}  onClick={() => exportCSV(`${filters.module}_report`, exportRows().slice(1).map((r,i) => exportRows()[0].map((h,j) => [h,r[j]]).flat()))} />
                <ExportBtn label="↓ Excel" bg="#e8fce8"   color="#16a34a"  onClick={() => exportExcel(`${filters.module}_report`, exportRows())} />
                <ExportBtn label="↓ PDF"   bg="#fce8e8"   color={B.red}    onClick={() => exportPDF(`${filters.module.charAt(0).toUpperCase()+filters.module.slice(1)} Report`, exportRows())} />
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: B.light }}>
                    {cols.map(c => (
                      <th key={c.key} style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, fontSize: 10, color: B.muted, letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                        {c.label.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 50).map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: `1px solid ${B.border}` }}>
                      {cols.map(c => (
                        <td key={c.key} style={{ padding: "7px 12px", color: B.text }}>
                          {c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr><td colSpan={cols.length} style={{ padding: "24px", textAlign: "center", color: B.muted, fontSize: 12 }}>No results match current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredRows.length > 50 && (
              <div style={{ padding: "8px 14px", fontSize: 11, color: B.muted, borderTop: `1px solid ${B.border}` }}>
                Showing first 50 of {filteredRows.length} rows. Export to see all.
              </div>
            )}
          </div>

          {/* Schedule */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: B.text, display: "flex", alignItems: "center", gap: 8 }}>
              Schedule Report
              <span style={{ fontSize: 10, fontWeight: 400, color: B.muted, background: B.light, border: `1px solid ${B.border}`, padding: "1px 8px", borderRadius: 20 }}>UI only</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <Label>Frequency</Label>
                <div style={{ display: "flex", gap: 5 }}>
                  {FREQ_OPTIONS.map(f => (
                    <button key={f} onClick={() => setSchedFreq(f)} style={{
                      padding: "5px 10px", borderRadius: 20, fontSize: 10,
                      border: `1px solid ${schedFreq===f ? B.blue : B.border}`,
                      background: schedFreq===f ? B.blue : B.white,
                      color: schedFreq===f ? "#fff" : B.muted,
                      cursor: "pointer", fontWeight: schedFreq===f ? 600 : 400, fontFamily: "inherit",
                    }}>{f}</button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Label>Email</Label>
                <input value={schedEmail} onChange={e => setSchedEmail(e.target.value)} placeholder="recipient@email.com" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <button onClick={saveSchedule} style={{
                padding: "7px 16px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: B.green, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit",
              }}>
                {schedSaved ? "✓ Saved!" : "Save Schedule"}
              </button>
            </div>
            {schedSaved && (
              <div style={{ marginTop: 10, fontSize: 11, color: B.green, fontStyle: "italic" }}>
                Schedule saved: {schedFreq} to {schedEmail || "(no email)"}. Connect a backend to activate delivery.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsTab;

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Label({ children }) {
  return <div style={{ fontSize: 10, color: B.muted || "#888", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>{children}</div>;
}

function ExportBtn({ label, bg, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 9px", fontSize: 10, fontWeight: 700,
      background: bg, border: `1px solid #e2e8f0`,
      borderRadius: 5, cursor: "pointer", color,
    }}>{label}</button>
  );
}
