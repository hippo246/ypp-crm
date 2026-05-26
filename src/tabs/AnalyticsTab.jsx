import { useState, useMemo, useRef } from "react";
import { B } from "../constants";
import { aed } from "../helpers";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";

// ── Helpers ───────────────────────────────────────────────────────────────────
function filterByRange(items, dateField, range) {
  if (range === "all") return items;
  const now = new Date();
  const cutoff = new Date();
  if (range === "thisMonth") { cutoff.setDate(1); }
  else if (range === "lastMonth") {
    cutoff.setMonth(cutoff.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return items.filter(i => { const d = new Date(i[dateField]); return d >= cutoff && d < end; });
  }
  else if (range === "thisQuarter") { const q = Math.floor(now.getMonth() / 3); cutoff.setMonth(q * 3, 1); }
  return items.filter(i => new Date(i[dateField]) >= cutoff);
}

function linReg(pts) {
  const n = pts.length; if (n < 2) return pts.map((_, i) => ({ x: i, y: pts[i] || 0 }));
  const xm = (n - 1) / 2, ym = pts.reduce((a, b) => a + b, 0) / n;
  const num = pts.reduce((a, y, x) => a + (x - xm) * (y - ym), 0);
  const den = pts.reduce((a, _, x) => a + (x - xm) ** 2, 0) || 1;
  const m = num / den, b2 = ym - m * xm;
  return pts.map((_, i) => ({ x: i, y: Math.max(0, m * i + b2) }));
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const CHART_COLORS = [B.blue, B.accent, B.green, B.orange, B.yellow, "#7C3AED", "#EC4899"];

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────
function BarChart({ data, height = 160, color = B.blue, label = "value" }) {
  if (!data.length) return <div style={{ textAlign: "center", color: B.muted, fontSize: 12, padding: 24 }}>No data</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 500, H = height, pad = 36, barW = Math.max(8, (W - pad * 2) / data.length - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H + 28}`} style={{ width: "100%", height: H + 28 }}>
      {[0, 0.5, 1].map(r => (
        <line key={r} x1={pad} x2={W - pad} y1={H - r * (H - 20)} y2={H - r * (H - 20)} stroke={B.border} strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const x = pad + i * ((W - pad * 2) / data.length) + ((W - pad * 2) / data.length - barW) / 2;
        const bh = Math.max(2, ((d.value / max) * (H - 20)));
        const y = H - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={3} fill={color} opacity={0.85} />
            <text x={x + barW / 2} y={H + 16} textAnchor="middle" fontSize={9} fill={B.muted}>{d.label}</text>
            {d.value > 0 && <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill={B.text} fontWeight="600">{typeof d.value === "number" && d.value > 999 ? (d.value/1000).toFixed(1)+"k" : d.value}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── SVG Line Chart ─────────────────────────────────────────────────────────────
function LineChart({ series, height = 160, showDots = true }) {
  if (!series.length || !series[0].data.length) return <div style={{ textAlign: "center", color: B.muted, fontSize: 12, padding: 24 }}>No data</div>;
  const allVals = series.flatMap(s => s.data.map(d => d.value));
  const max = Math.max(...allVals, 1), min = 0;
  const W = 500, H = height, pad = 36;
  const toX = (i, len) => pad + (i / (len - 1 || 1)) * (W - pad * 2);
  const toY = (v) => H - 16 - ((v - min) / (max - min || 1)) * (H - 32);
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} style={{ width: "100%", height: H + 24 }}>
      {[0, 0.5, 1].map(r => (
        <line key={r} x1={pad} x2={W - pad} y1={H - 16 - r * (H - 32)} y2={H - 16 - r * (H - 32)} stroke={B.border} strokeWidth={1} />
      ))}
      {series.map((s, si) => {
        const pts = s.data.map((d, i) => `${toX(i, s.data.length)},${toY(d.value)}`).join(" ");
        const fill = s.data.map((d, i) => `${toX(i, s.data.length)},${toY(d.value)}`);
        const areaPath = `M${fill[0]} L${fill.join(" L")} L${toX(s.data.length - 1, s.data.length)},${H - 16} L${pad},${H - 16} Z`;
        return (
          <g key={si}>
            <path d={areaPath} fill={CHART_COLORS[si % CHART_COLORS.length]} opacity={0.08} />
            <polyline points={pts} fill="none" stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth={2.5} strokeLinejoin="round" />
            {showDots && s.data.map((d, i) => (
              <circle key={i} cx={toX(i, s.data.length)} cy={toY(d.value)} r={3.5} fill={CHART_COLORS[si % CHART_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
            ))}
            {s.data.map((d, i) => i % Math.ceil(s.data.length / 7) === 0 && (
              <text key={i} x={toX(i, s.data.length)} y={H + 14} textAnchor="middle" fontSize={9} fill={B.muted}>{d.label}</text>
            ))}
          </g>
        );
      })}
      {series.length > 1 && series.map((s, si) => (
        <g key={si}>
          <rect x={W - 90 + si * 0} y={12 + si * 14} width={8} height={8} rx={2} fill={CHART_COLORS[si % CHART_COLORS.length]} />
          <text x={W - 78 + si * 0} y={20 + si * 14} fontSize={9} fill={B.muted}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ── SVG Donut / Pie ───────────────────────────────────────────────────────────
function DonutChart({ slices, size = 140 }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  let angle = -Math.PI / 2;
  const cx = size / 2, cy = size / 2, r = size * 0.38, ri = size * 0.22;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      {slices.map((s, i) => {
        const sweep = (s.value / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
        const xi1 = cx + ri * Math.cos(angle), yi1 = cy + ri * Math.sin(angle);
        const xi2 = cx + ri * Math.cos(angle + sweep), yi2 = cy + ri * Math.sin(angle + sweep);
        const large = sweep > Math.PI ? 1 : 0;
        const path = `M${xi1} ${yi1} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1} Z`;
        angle += sweep;
        return <path key={i} d={path} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={0.9} />;
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight="700" fill={B.text}>{Math.round(slices[0]?.value / total * 100)}%</text>
    </svg>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function Heatmap({ data }) {
  // data: { "YYYY-WW-D": count }
  const max = Math.max(...Object.values(data), 1);
  const weeks = [...new Set(Object.keys(data).map(k => k.slice(0, 7)))].sort().slice(-12);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 4 }}>
          {DAYS.map(d => <div key={d} style={{ fontSize: 9, color: B.muted, height: 14, lineHeight: "14px" }}>{d}</div>)}
        </div>
        {weeks.map(wk => (
          <div key={wk} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 8, color: B.muted, textAlign: "center", marginBottom: 2 }}>{wk.slice(5)}</div>
            {[0,1,2,3,4,5,6].map(d => {
              const key = `${wk}-${d}`;
              const v = data[key] || 0;
              const intensity = v / max;
              return <div key={d} title={`${v} tasks`} style={{ width: 14, height: 14, borderRadius: 2, background: v === 0 ? B.light : `rgba(29,53,87,${0.15 + intensity * 0.85})`, transition: "background 0.2s" }} />;
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8, fontSize: 10, color: B.muted }}>
        <span>Less</span>
        {[0.1,0.3,0.5,0.7,0.9].map(v => <div key={v} style={{ width: 12, height: 12, borderRadius: 2, background: `rgba(29,53,87,${v})` }} />)}
        <span>More</span>
      </div>
    </div>
  );
}

// ── Mini sparkline ────────────────────────────────────────────────────────────
function Sparkline({ values, color = B.blue, width = 80, height = 28 }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const toX = (i) => (i / (values.length - 1)) * width;
  const toY = (v) => height - ((v - min) / (max - min || 1)) * height;
  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

// ── KPI Delta Card ────────────────────────────────────────────────────────────
function KPICard({ label, value, prev, color, sparkValues, format = v => v }) {
  const delta = prev ? Math.round(((value - prev) / (prev || 1)) * 100) : null;
  const up = delta >= 0;
  return (
    <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: B.muted, letterSpacing: "0.4px", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{format(value)}</div>
        {sparkValues && <Sparkline values={sparkValues} color={color} />}
      </div>
      {delta !== null && (
        <div style={{ fontSize: 10, fontWeight: 600, color: up ? B.green : B.red }}>
          {up ? "▲" : "▼"} {Math.abs(delta)}% vs prev period
        </div>
      )}
    </div>
  );
}

// ── Pivot table ───────────────────────────────────────────────────────────────
function PivotTable({ rows, groupBy, valueField, aggFn = "count" }) {
  const groups = {};
  rows.forEach(r => {
    const key = r[groupBy] || "—";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  const entries = Object.entries(groups).map(([k, items]) => {
    const val = aggFn === "sum" ? items.reduce((a, r) => a + (Number(r[valueField]) || 0), 0)
      : aggFn === "avg" ? Math.round(items.reduce((a, r) => a + (Number(r[valueField]) || 0), 0) / items.length)
      : items.length;
    return { key: k, val, count: items.length };
  }).sort((a, b) => b.val - a.val);
  const maxVal = Math.max(...entries.map(e => e.val), 1);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: B.light }}>
            <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: B.muted, fontSize: 10, letterSpacing: "0.5px" }}>{groupBy.toUpperCase()}</th>
            <th style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: B.muted, fontSize: 10 }}>COUNT</th>
            <th style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: B.muted, fontSize: 10 }}>{aggFn.toUpperCase()}</th>
            <th style={{ padding: "7px 12px", width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${B.border}` }}>
              <td style={{ padding: "7px 12px", color: B.text, fontWeight: 500 }}>{e.key}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", color: B.muted }}>{e.count}</td>
              <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: B.text }}>{typeof e.val === "number" && e.val > 999 ? aed(e.val) : e.val}</td>
              <td style={{ padding: "4px 12px" }}>
                <div style={{ height: 6, background: B.border, borderRadius: 3 }}>
                  <div style={{ height: "100%", width: `${(e.val / maxVal) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SUBTABS = [["overview","Overview"],["charts","Charts"],["workload","Workload"],["team","Team"],["trends","Trends"],["heatmap","Heatmap"],["forecast","Forecast"]];

const AnalyticsTab = ({ data }) => {
  const [range, setRange] = useState("all");
  const [subTab, setSubTab] = useState("overview");
  const [chartType, setChartType] = useState("bar");
  const [chartMetric, setChartMetric] = useState("revenue");
  const [pivotGroup, setPivotGroup] = useState("assigned");
  const [pivotAgg, setPivotAgg] = useState("count");
  const [viewMode, setViewMode] = useState("normal"); // "normal" | "compact" | "focus"
  const [collapsed, setCollapsed] = useState({});
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, items }
  const [hoverCard, setHoverCard] = useState(null); // { data, x, y }
  const toggleCollapse = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));
  const openCtx = (e, items) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items }); };
  const ranges = [["all","All Time"],["thisMonth","This Month"],["lastMonth","Last Month"],["thisQuarter","This Quarter"]];

  const { leads = [], clients = [], tasks = [], accounting = [] } = data;

  const filteredLeads = useMemo(() => filterByRange(leads, "date", range), [leads, range]);
  const filteredClients = useMemo(() => filterByRange(clients, "started", range), [clients, range]);
  const filteredTasks = useMemo(() => filterByRange(tasks, "due", range), [tasks, range]);
  const filteredAccounting = useMemo(() => filterByRange(accounting, "date", range), [accounting, range]);

  // ── Core KPIs ───────────────────────────────────────────────────────────────
  const totalLeads = filteredLeads.length;
  const wonLeads = filteredLeads.filter(l => l.status === "Won").length;
  const convRate = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;
  const avgDeal = Math.round(filteredLeads.filter(l => l.status === "Won").reduce((s, l) => s + l.value, 0) / (wonLeads || 1));
  const totalRevenue = filteredAccounting.filter(i => i.status === "Paid").reduce((s, i) => s + i.amount, 0);

  // prev period for deltas
  const prevLeads = filterByRange(leads, "date", range === "thisMonth" ? "lastMonth" : "all");
  const prevConv = prevLeads.length ? Math.round((prevLeads.filter(l => l.status === "Won").length / prevLeads.length) * 100) : 0;

  // ── Service revenue ─────────────────────────────────────────────────────────
  const serviceRevenue = useMemo(() => {
    const m = {};
    filteredClients.forEach(c => { m[c.service] = (m[c.service] || 0) + c.value; });
    return m;
  }, [filteredClients]);

  const sourceLeads = useMemo(() => {
    const m = {};
    filteredLeads.forEach(l => { m[l.source] = (m[l.source] || 0) + 1; });
    return m;
  }, [filteredLeads]);

  // ── Task stats ──────────────────────────────────────────────────────────────
  const doneTasks = filteredTasks.filter(t => t.status === "Done").length;
  const overdueTasks = filteredTasks.filter(t => t.status !== "Done" && t.due && new Date(t.due) < new Date()).length;
  const completionPct = filteredTasks.length ? Math.round((doneTasks / filteredTasks.length) * 100) : 0;
  const recurringTasks = filteredTasks.filter(t => t.recurring && t.recurring !== "none" && t.recurring !== "").length;
  const pendingApprovals = filteredTasks.filter(t => t.approvalStatus === "pending").length;
  const templateCount = filteredTasks.filter(t => t.isTemplate).length;
  const avgAttachments = filteredTasks.length ? (filteredTasks.reduce((a, t) => a + (t.attachments?.length || 0), 0) / filteredTasks.length).toFixed(1) : 0;
  const reviewPending = filteredTasks.filter(t => t.reviewAssignee && t.status !== "Done").length;

  // ── Team performance ────────────────────────────────────────────────────────
  const teamStats = useMemo(() => {
    const members = [...new Set(tasks.map(t => t.assigned).filter(Boolean))];
    return members.map(m => {
      const mt = tasks.filter(t => t.assigned === m);
      const done = mt.filter(t => t.status === "Done").length;
      const overdue = mt.filter(t => t.status !== "Done" && t.due && new Date(t.due) < new Date()).length;
      const avgProgress = mt.length ? Math.round(mt.reduce((a, t) => a + (t.progress || 0), 0) / mt.length) : 0;
      const subtaskTotal = mt.reduce((a, t) => a + (t.subtasks?.length || 0), 0);
      const subtaskDone = mt.reduce((a, t) => a + (t.subtasks?.filter(s => s.done)?.length || 0), 0);
      const delayDays = mt.filter(t => t.status === "Done" && t.due).map(t => {
        const diff = (new Date(t.due) - new Date()) / 86400000;
        return diff < 0 ? Math.abs(diff) : 0;
      });
      const avgDelay = delayDays.length ? Math.round(delayDays.reduce((a, b) => a + b, 0) / delayDays.length) : 0;
      return { name: m, total: mt.length, done, overdue, avgProgress, avgDelay, completionPct: mt.length ? Math.round((done / mt.length) * 100) : 0, subtaskTotal, subtaskDone };
    }).sort((a, b) => b.done - a.done);
  }, [tasks]);

  // ── Workload ────────────────────────────────────────────────────────────────
  const workloadStats = useMemo(() => {
    const members = [...new Set(tasks.map(t => t.assigned).filter(Boolean))];
    return members.map(m => ({
      name: m,
      open: tasks.filter(t => t.assigned === m && t.status !== "Done").length,
      overdue: tasks.filter(t => t.assigned === m && t.status !== "Done" && t.due && new Date(t.due) < new Date()).length,
      blocked: tasks.filter(t => t.assigned === m && t.status === "Blocked").length,
      reviewLoad: tasks.filter(t => t.reviewAssignee === m && t.status !== "Done").length,
      approvalLoad: tasks.filter(t => t.approver === m && t.approvalStatus === "pending").length,
      recurring: tasks.filter(t => t.assigned === m && t.recurring && t.recurring !== "none").length,
      withAttachments: tasks.filter(t => t.assigned === m && t.attachments?.length > 0).length,
    })).sort((a, b) => b.open - a.open);
  }, [tasks]);
  const maxWorkload = Math.max(...workloadStats.map(w => w.open), 1);

  // ── Velocity (weekly completions) ───────────────────────────────────────────
  const velocityData = useMemo(() => {
    const weeks = {};
    tasks.filter(t => t.status === "Done" && t.due).forEach(t => {
      const d = new Date(t.due);
      const wk = `W${Math.ceil(d.getDate() / 7)} ${MONTHS[d.getMonth()]}`;
      weeks[wk] = (weeks[wk] || 0) + 1;
    });
    return Object.entries(weeks).slice(-8).map(([label, value]) => ({ label, value }));
  }, [tasks]);

  // ── MoM trend ───────────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const months = {};
    leads.forEach(l => {
      if (!l.date) return;
      const m = l.date.slice(0, 7);
      months[m] = months[m] || { leads: 0, won: 0, revenue: 0 };
      months[m].leads++;
      if (l.status === "Won") { months[m].won++; months[m].revenue += l.value; }
    });
    return Object.entries(months).sort().slice(-6).map(([m, v]) => ({ label: m.slice(5), ...v }));
  }, [leads]);

  // ── Heatmap ─────────────────────────────────────────────────────────────────
  const heatmapData = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      const d = t.due ? new Date(t.due) : null;
      if (!d) return;
      const week = `${d.getFullYear()}-${String(Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)).padStart(2, "0")}`;
      const key = `${week}-${d.getDay()}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [tasks]);

  // ── Forecast (linear regression on monthly revenue) ─────────────────────────
  const forecastData = useMemo(() => {
    const vals = trendData.map(d => d.revenue);
    const historical = vals.map((v, i) => ({ label: trendData[i]?.label || `M${i+1}`, value: v, type: "actual" }));
    if (vals.length < 2) return historical;
    const reg = linReg(vals);
    const lastIdx = vals.length;
    const projected = [1, 2, 3].map(i => {
      const mo = new Date(); mo.setMonth(mo.getMonth() + i);
      return { label: MONTHS[mo.getMonth()], value: Math.max(0, Math.round(reg[lastIdx - 1]?.y * (1 + (reg[lastIdx - 1]?.y - reg[0]?.y) / (vals.length * (reg[0]?.y || 1))) + (i * ((reg[lastIdx-1]?.y - reg[0]?.y) / (vals.length || 1))))), type: "forecast" };
    });
    return [...historical, ...projected];
  }, [trendData]);

  // ── Delay report ────────────────────────────────────────────────────────────
  const delayReport = useMemo(() => {
    return filteredTasks.filter(t => t.due).map(t => {
      const diff = (new Date() - new Date(t.due)) / 86400000;
      const delayDays = t.status === "Done" ? 0 : diff > 0 ? Math.round(diff) : 0;
      const delayReason = t.delayReason || (t.status === "Blocked" ? "Blocked" : t.approvalStatus === "pending" ? "Awaiting approval" : t.reviewAssignee && t.status !== "Done" ? "Awaiting review" : "Overdue");
      return { ...t, delayDays, delayReason };
    }).filter(t => t.delayDays > 0).sort((a, b) => b.delayDays - a.delayDays);
  }, [filteredTasks]);

  // ── Chart builder data ───────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (chartMetric === "revenue") return Object.entries(serviceRevenue).map(([label, value]) => ({ label, value }));
    if (chartMetric === "leads") return Object.entries(sourceLeads).map(([label, value]) => ({ label, value }));
    if (chartMetric === "tasks") return ["Pending","In Progress","Done","Blocked"].map(s => ({ label: s, value: filteredTasks.filter(t => t.status === s).length }));
    if (chartMetric === "priority") return ["High","Medium","Low"].map(p => ({ label: p, value: filteredTasks.filter(t => t.priority === p).length }));
    return [];
  }, [chartMetric, serviceRevenue, sourceLeads, filteredTasks]);

  const maxRev = Math.max(...Object.values(serviceRevenue), 1);
  const maxLeadsVal = Math.max(...Object.values(sourceLeads), 1);

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: viewMode === "compact" ? 8 : 14 }}
      onClick={() => { if (ctxMenu) setCtxMenu(null); }}
      className={viewMode === "focus" ? "analytics-focus" : ""}
      style={{ ...(viewMode === "focus" ? { maxWidth: 860, margin: "0 auto", paddingTop: 8 } : {}) }}>

      {/* Context menu */}
      {ctxMenu && (
        <div style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", zIndex: 9999, minWidth: 160, padding: 4 }}>
          {ctxMenu.items.map((item, i) => (
            <button key={i} onClick={() => { item.action(); setCtxMenu(null); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", fontSize: 12, background: "none", border: "none", cursor: "pointer", borderRadius: 5, color: item.danger ? B.red : B.text, fontFamily: "inherit" }}
              onMouseEnter={e => e.target.style.background = B.light}
              onMouseLeave={e => e.target.style.background = "none"}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Hover preview card */}
      {hoverCard && (
        <div style={{ position: "fixed", top: hoverCard.y + 12, left: hoverCard.x + 12, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 9998, padding: "12px 16px", minWidth: 180, pointerEvents: "none" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.text, marginBottom: 6 }}>{hoverCard.data.title}</div>
          {hoverCard.data.rows.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, gap: 16, color: B.muted, marginBottom: 2 }}>
              <span>{k}</span><span style={{ fontWeight: 600, color: B.text }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sticky toolbar */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${B.border}`, padding: "8px 0 8px", marginBottom: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {/* Sub-tabs */}
          <div style={{ display: "flex", gap: 2, background: B.light, borderRadius: 8, padding: 3 }}>
            {SUBTABS.map(([val, lbl]) => (
              <button key={val} onClick={() => setSubTab(val)}
                style={{ padding: viewMode === "compact" ? "3px 10px" : "5px 12px", borderRadius: 6, fontSize: 11, border: "none", background: subTab === val ? "#fff" : "transparent", color: subTab === val ? B.text : B.muted, cursor: "pointer", fontWeight: subTab === val ? 700 : 400, boxShadow: subTab === val ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s", fontFamily: "inherit" }}>
                {lbl}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Range pills */}
            {viewMode !== "focus" && ranges.map(([val, lbl]) => (
              <button key={val} onClick={() => setRange(val)}
                style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, border: `1px solid ${range === val ? B.blue : B.border}`, background: range === val ? B.blue : B.white, color: range === val ? "#fff" : B.muted, cursor: "pointer", fontWeight: range === val ? 600 : 400 }}>
                {lbl}
              </button>
            ))}
            {/* Mode toggles */}
            <div style={{ display: "flex", gap: 2, background: B.light, borderRadius: 6, padding: 2, marginLeft: 4 }}>
              {[["normal","⊞"],["compact","⊟"],["focus","◎"]].map(([m, icon]) => (
                <button key={m} title={m.charAt(0).toUpperCase()+m.slice(1)+" mode"} onClick={() => setViewMode(m)}
                  style={{ padding: "3px 7px", borderRadius: 4, fontSize: 13, border: "none", background: viewMode === m ? "#fff" : "transparent", cursor: "pointer", color: viewMode === m ? B.blue : B.muted, boxShadow: viewMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.15s" }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────────────── */}
      {subTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <KPICard label="Total Leads" value={totalLeads} prev={prevLeads.length} color={B.blue} sparkValues={trendData.map(d => d.leads)} />
            <KPICard label="Conversion Rate" value={convRate} prev={prevConv} color={B.green} format={v => `${v}%`} sparkValues={trendData.map(d => d.leads ? Math.round(d.won/d.leads*100) : 0)} />
            <KPICard label="Avg Deal Size" value={avgDeal} color={B.accent} format={aed} sparkValues={trendData.map(d => d.revenue)} />
            <KPICard label="Active Clients" value={filteredClients.filter(c => c.status === "Active").length} color={B.yellow} />
            <KPICard label="Tasks Done" value={doneTasks} color={B.green} format={v => `${v}/${filteredTasks.length}`} />
            <KPICard label="Completion" value={completionPct} color={completionPct > 70 ? B.green : B.orange} format={v => `${v}%`} />
            <KPICard label="Overdue Tasks" value={overdueTasks} color={overdueTasks > 0 ? B.red : B.green} />
            <KPICard label="Revenue (Paid)" value={totalRevenue} color={B.blue} format={aed} sparkValues={trendData.map(d => d.revenue)} />
            <KPICard label="Recurring Tasks" value={recurringTasks} color={B.accent} />
            <KPICard label="Pending Approvals" value={pendingApprovals} color={pendingApprovals > 0 ? B.orange : B.green} />
            <KPICard label="Awaiting Review" value={reviewPending} color={reviewPending > 0 ? B.yellow : B.green} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <SectionCard title="Revenue by Service" onContextMenu={e => openCtx(e, [{ label: "Copy data", action: () => {} }, { label: "Collapse section", action: () => toggleCollapse("revService") }])}
              headerRight={<button onClick={() => toggleCollapse("revService")} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, fontSize: 14, lineHeight: 1 }}>{collapsed.revService ? "▸" : "▾"}</button>}>
              {!collapsed.revService && <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.entries(serviceRevenue).length === 0 && <div style={{ fontSize: 12, color: B.muted }}>No data</div>}
                {Object.entries(serviceRevenue).map(([service, rev]) => (
                  <div key={service}
                    onMouseEnter={e => setHoverCard({ x: e.clientX, y: e.clientY, data: { title: service, rows: [["Revenue", aed(rev)], ["Share", `${Math.round(rev/maxRev*100)}%`]] } })}
                    onMouseLeave={() => setHoverCard(null)}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: B.muted }}>{service}</span><span style={{ fontWeight: 600 }}>{aed(rev)}</span>
                    </div>
                    <div style={{ height: 7, background: B.light, borderRadius: 4 }}>
                      <div style={{ height: "100%", width: `${(rev/maxRev)*100}%`, background: `linear-gradient(90deg,${B.blue},${B.accent})`, borderRadius: 4, transition: "width 0.5s" }} />
                    </div>
                  </div>
                ))}
              </div>}
            </SectionCard>
            <SectionCard title="Task Completion"
              headerRight={<button onClick={() => toggleCollapse("taskCompletion")} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, fontSize: 14, lineHeight: 1 }}>{collapsed.taskCompletion ? "▸" : "▾"}</button>}>
              <div style={{ padding: "14px", display: "flex", gap: 16, alignItems: "center" }}>
                <DonutChart slices={[{ value: doneTasks }, { value: filteredTasks.length - doneTasks }]} size={100} />
                <div style={{ flex: 1 }}>
                  {["Done","In Progress","Pending","Blocked"].map((s, i) => {
                    const cnt = filteredTasks.filter(t => t.status === s).length;
                    return (
                      <div key={s} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                          <span style={{ color: B.muted }}>{s}</span><span style={{ fontWeight: 600 }}>{cnt}</span>
                        </div>
                        <div style={{ height: 5, background: B.light, borderRadius: 3 }}>
                          <div style={{ height: "100%", width: `${filteredTasks.length ? (cnt/filteredTasks.length)*100 : 0}%`, background: CHART_COLORS[i], borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Lead Status Breakdown">
              <div style={{ padding: "4px 0" }}>
                {["New","Contacted","Qualified","Proposal","Won","Lost"].map(s => {
                  const cnt = filteredLeads.filter(l => l.status === s).length;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderBottom: `1px solid ${B.border}` }}>
                      <Badge label={s} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ height: 5, width: 80, background: B.light, borderRadius: 3 }}>
                          <div style={{ height: "100%", width: `${totalLeads ? (cnt/totalLeads)*100 : 0}%`, background: B.blue, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 12, minWidth: 16, textAlign: "right" }}>{cnt}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
            <SectionCard title="Task Velocity (weekly completions)">
              <div style={{ padding: "10px 14px" }}>
                <BarChart data={velocityData} color={B.green} height={130} />
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* ── CHARTS ────────────────────────────────────────────────────────────── */}
      {subTab === "charts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: B.muted, fontWeight: 600 }}>Metric:</span>
            {[["revenue","Revenue"],["leads","Leads by Source"],["tasks","Task Status"],["priority","By Priority"]].map(([v, l]) => (
              <button key={v} onClick={() => setChartMetric(v)} style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, border: `1px solid ${chartMetric === v ? B.blue : B.border}`, background: chartMetric === v ? B.blue : B.white, color: chartMetric === v ? "#fff" : B.muted, cursor: "pointer" }}>{l}</button>
            ))}
            <span style={{ fontSize: 11, color: B.muted, fontWeight: 600, marginLeft: 8 }}>Type:</span>
            {[["bar","Bar"],["line","Line"],["donut","Donut"]].map(([v, l]) => (
              <button key={v} onClick={() => setChartType(v)} style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, border: `1px solid ${chartType === v ? B.accent : B.border}`, background: chartType === v ? B.accent : B.white, color: chartType === v ? "#fff" : B.muted, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          <SectionCard title={`Chart — ${chartMetric}`}>
            <div style={{ padding: "16px" }}>
              {chartType === "bar" && <BarChart data={chartData} color={B.blue} height={180} />}
              {chartType === "line" && <LineChart series={[{ label: chartMetric, data: chartData.map(d => ({ label: d.label, value: d.value })) }]} height={180} />}
              {chartType === "donut" && (
                <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
                  <DonutChart slices={chartData} size={180} />
                  <div style={{ flex: 1 }}>
                    {chartData.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                        <span style={{ flex: 1, color: B.muted }}>{d.label}</span>
                        <span style={{ fontWeight: 700 }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
          <SectionCard title="Pivot Builder">
            <div style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: B.muted, fontWeight: 600, alignSelf: "center" }}>Group by:</span>
                {["assigned","priority","status","risk","recurring","approvalStatus","reviewAssignee","team"].map(f => (
                  <button key={f} onClick={() => setPivotGroup(f)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, border: `1px solid ${pivotGroup === f ? B.blue : B.border}`, background: pivotGroup === f ? B.blue : B.white, color: pivotGroup === f ? "#fff" : B.muted, cursor: "pointer" }}>{f}</button>
                ))}
                <span style={{ fontSize: 11, color: B.muted, fontWeight: 600, marginLeft: 8, alignSelf: "center" }}>Agg:</span>
                {[["count","Count"],["sum","Sum value"],["avg","Avg progress"]].map(([v, l]) => (
                  <button key={v} onClick={() => setPivotAgg(v)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, border: `1px solid ${pivotAgg === v ? B.accent : B.border}`, background: pivotAgg === v ? B.accent : B.white, color: pivotAgg === v ? "#fff" : B.muted, cursor: "pointer" }}>{l}</button>
                ))}
              </div>
              <PivotTable rows={filteredTasks} groupBy={pivotGroup} valueField={pivotAgg === "sum" ? "value" : "progress"} aggFn={pivotAgg} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── WORKLOAD ──────────────────────────────────────────────────────────── */}
      {subTab === "workload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionCard title="Workload Distribution" headerRight={<button onClick={() => toggleCollapse("workload")} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, fontSize: 14, lineHeight: 1 }}>{collapsed.workload ? "▸" : "▾"}</button>}>
            {!collapsed.workload && <div style={{ padding: "14px" }}>
              {workloadStats.map((w, i) => (
                <div key={w.name} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>{w.name[0]}</div>
                      <span style={{ fontWeight: 600 }}>{w.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                      <span style={{ color: B.blue }}>{w.open} open</span>
                      {w.overdue > 0 && <span style={{ color: B.red, fontWeight: 700 }}>⚠ {w.overdue} overdue</span>}
                      {w.blocked > 0 && <span style={{ color: B.orange }}>🚧 {w.blocked} blocked</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", height: 10, background: B.light, borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ width: `${((w.open - w.overdue) / maxWorkload) * 100}%`, background: B.blue, transition: "width 0.4s" }} />
                    <div style={{ width: `${(w.overdue / maxWorkload) * 100}%`, background: B.red, opacity: 0.8 }} />
                    <div style={{ width: `${(w.blocked / maxWorkload) * 100}%`, background: B.orange, opacity: 0.8 }} />
                    <div title="Review load" style={{ width: `${(w.reviewLoad / maxWorkload) * 100}%`, background: "#7C3AED", opacity: 0.7 }} />
                    <div title="Approval load" style={{ width: `${(w.approvalLoad / maxWorkload) * 100}%`, background: "#EC4899", opacity: 0.7 }} />
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, color: B.muted }}>
                    {w.reviewLoad > 0 && <span style={{ color: "#7C3AED" }}>👁 {w.reviewLoad} review</span>}
                    {w.approvalLoad > 0 && <span style={{ color: "#EC4899" }}>✓ {w.approvalLoad} approval</span>}
                    {w.recurring > 0 && <span>↺ {w.recurring} recurring</span>}
                    {w.withAttachments > 0 && <span>📎 {w.withAttachments} attachments</span>}
                  </div>
                </div>
              ))}
            </div>}
          </SectionCard>
          <SectionCard title="Delay Report">
            {delayReport.length === 0
              ? <div style={{ padding: 24, textAlign: "center", color: B.muted, fontSize: 12 }}>No delayed tasks 🎉</div>
              : <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: B.light }}>
                    {["ID","Task","Assigned","Priority","Due","Delay","Reason"].map(h => <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, fontSize: 10, color: B.muted, letterSpacing: "0.5px" }}>{h.toUpperCase()}</th>)}
                  </tr></thead>
                  <tbody>
                    {delayReport.slice(0, 15).map(t => (
                      <tr key={t.id} style={{ borderBottom: `1px solid ${B.border}` }}>
                        <td style={{ padding: "7px 12px", color: B.muted, fontSize: 11 }}>{t.id}</td>
                        <td style={{ padding: "7px 12px", fontWeight: 500 }}>{t.title}</td>
                        <td style={{ padding: "7px 12px", color: B.muted }}>{t.assigned || "—"}</td>
                        <td style={{ padding: "7px 12px" }}><Badge label={t.priority} /></td>
                        <td style={{ padding: "7px 12px", color: B.red }}>{t.due}</td>
                        <td style={{ padding: "7px 12px", fontWeight: 700, color: t.delayDays > 7 ? B.red : B.orange }}>+{t.delayDays}d</td>
                        <td style={{ padding: "7px 12px", fontSize: 11, color: B.muted, fontStyle: "italic" }}>{t.delayReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </SectionCard>
        </div>
      )}

      {/* ── TEAM ──────────────────────────────────────────────────────────────── */}
      {subTab === "team" && (
        <>
        <SectionCard title="Team Performance">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: B.light }}>
              {["Member","Total","Done","Overdue","Subtasks","Avg Progress","Avg Delay","Completion"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 10, color: B.muted, letterSpacing: "0.5px" }}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {teamStats.map((m, i) => (
                <tr key={m.name} style={{ borderBottom: `1px solid ${B.border}` }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: CHART_COLORS[i % CHART_COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{m.name[0]}</div>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", color: B.muted }}>{m.total}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: B.green }}>{m.done}</td>
                  <td style={{ padding: "10px 12px", fontWeight: m.overdue > 0 ? 700 : 400, color: m.overdue > 0 ? B.red : B.muted }}>{m.overdue}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11 }}>
                    {m.subtaskTotal > 0 ? <span style={{ color: m.subtaskDone === m.subtaskTotal ? B.green : B.muted }}>{m.subtaskDone}/{m.subtaskTotal}</span> : <span style={{ color: B.muted }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 60, height: 6, background: B.light, borderRadius: 3 }}>
                        <div style={{ width: `${m.avgProgress}%`, height: "100%", background: B.accent, borderRadius: 3 }} />
                      </div>
                      <span>{m.avgProgress}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", color: m.avgDelay > 3 ? B.red : B.muted }}>{m.avgDelay > 0 ? `+${m.avgDelay}d` : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 60, height: 6, background: B.light, borderRadius: 3 }}>
                        <div style={{ width: `${m.completionPct}%`, height: "100%", background: m.completionPct > 70 ? B.green : B.orange, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontWeight: 700, color: m.completionPct > 70 ? B.green : B.orange }}>{m.completionPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        {/* Workload legend */}
        <div style={{ display: "flex", gap: 14, fontSize: 10, color: B.muted, flexWrap: "wrap" }}>
          {[["Normal", B.blue], ["Overdue", B.red], ["Blocked", B.orange], ["Review", "#7C3AED"], ["Approval", "#EC4899"]].map(([lbl, col]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: col, opacity: 0.8 }} />
              <span>{lbl}</span>
            </div>
          ))}
        </div>
        </>
      )}

      {/* ── TRENDS ────────────────────────────────────────────────────────────── */}
      {subTab === "trends" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionCard title="Revenue Trend (MoM)">
            <div style={{ padding: "10px 14px" }}>
              <LineChart series={[{ label: "Revenue", data: trendData.map(d => ({ label: d.label, value: d.revenue })) }]} height={160} />
            </div>
          </SectionCard>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <SectionCard title="Lead Volume (MoM)">
              <div style={{ padding: "10px 14px" }}>
                <BarChart data={trendData.map(d => ({ label: d.label, value: d.leads }))} color={B.blue} height={130} />
              </div>
            </SectionCard>
            <SectionCard title="Conversion Rate (MoM)">
              <div style={{ padding: "10px 14px" }}>
                <LineChart series={[{ label: "Conv %", data: trendData.map(d => ({ label: d.label, value: d.leads ? Math.round(d.won/d.leads*100) : 0 })) }]} height={130} />
              </div>
            </SectionCard>
          </div>
          <SectionCard title="Task Velocity (rolling)">
            <div style={{ padding: "10px 14px" }}>
              <BarChart data={velocityData} color={B.green} height={130} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── HEATMAP ───────────────────────────────────────────────────────────── */}
      {subTab === "heatmap" && (
        <SectionCard title="Task Activity Heatmap — by day of week">
          <div style={{ padding: "16px" }}>
            <Heatmap data={heatmapData} />
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 10 }}>BUSIEST DAYS</div>
              {DAYS.map((day, d) => {
                const cnt = Object.entries(heatmapData).filter(([k]) => k.endsWith(`-${d}`)).reduce((a, [, v]) => a + v, 0);
                return (
                  <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, width: 32, color: B.muted }}>{day}</span>
                    <div style={{ flex: 1, height: 8, background: B.light, borderRadius: 4 }}>
                      <div style={{ height: "100%", width: `${(cnt / (Math.max(...DAYS.map((_, i) => Object.entries(heatmapData).filter(([k]) => k.endsWith(`-${i}`)).reduce((a, [, v]) => a + v, 0)), 1))) * 100}%`, background: B.blue, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: B.text, width: 24, textAlign: "right" }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── FORECAST ──────────────────────────────────────────────────────────── */}
      {subTab === "forecast" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <SectionCard title="Revenue Forecast — next 3 months (linear regression)">
            <div style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                {forecastData.filter(d => d.type === "forecast").map((d, i) => (
                  <div key={i} style={{ background: B.light, borderRadius: 8, padding: "10px 16px", border: `1px dashed ${B.border}` }}>
                    <div style={{ fontSize: 10, color: B.muted, marginBottom: 2 }}>{d.label} (projected)</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: B.accent }}>{aed(d.value)}</div>
                  </div>
                ))}
              </div>
              <LineChart
                series={[
                  { label: "Actual", data: forecastData.filter(d => d.type === "actual").map(d => ({ label: d.label, value: d.value })) },
                  { label: "Forecast", data: forecastData.map(d => ({ label: d.label, value: d.value })) },
                ]}
                height={180}
              />
              <div style={{ fontSize: 10, color: B.muted, marginTop: 8, fontStyle: "italic" }}>
                * Forecast based on linear regression of historical revenue data. For indicative purposes only.
              </div>
            </div>
          </SectionCard>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <SectionCard title="Lead Volume Forecast">
              <div style={{ padding: "12px 14px" }}>
                {(() => {
                  const vals = trendData.map(d => d.leads);
                  const reg = linReg(vals);
                  const projected = [1,2,3].map((i) => {
                    const mo = new Date(); mo.setMonth(mo.getMonth() + i);
                    return { label: MONTHS[mo.getMonth()], value: Math.max(0, Math.round((reg[reg.length-1]?.y || 0) + (i * ((reg[reg.length-1]?.y - reg[0]?.y) / (vals.length || 1))))) };
                  });
                  return (
                    <div style={{ display: "flex", gap: 10 }}>
                      {projected.map((p, i) => (
                        <div key={i} style={{ flex: 1, background: B.light, borderRadius: 8, padding: "10px", textAlign: "center", border: `1px dashed ${B.border}` }}>
                          <div style={{ fontSize: 10, color: B.muted }}>{p.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: B.blue }}>{p.value}</div>
                          <div style={{ fontSize: 9, color: B.muted }}>leads</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </SectionCard>
            <SectionCard title="Completion Forecast">
              <div style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 12, color: B.muted, marginBottom: 8 }}>At current velocity</div>
                {workloadStats.map((w, i) => {
                  const rate = teamStats.find(t => t.name === w.name)?.completionPct || 0;
                  const daysLeft = rate > 0 ? Math.round((w.open / (rate / 100)) * 7) : null;
                  return (
                    <div key={w.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${B.border}`, fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{w.name}</span>
                      <span style={{ color: B.muted }}>{w.open} open tasks</span>
                      <span style={{ fontWeight: 700, color: daysLeft && daysLeft < 14 ? B.green : B.orange }}>{daysLeft ? `~${daysLeft}d` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsTab;
