import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { B } from "../constants";
import { aed } from "../helpers";
import { useAppData } from "../context/AppContext";
import {
  getDashboardKPIs,
  getMoMRevenue,
  getMoMLeads,
  getPipelineStats,
  getRevenueByService,
} from "../services/analyticsEngine";
import { getOverdueInvoices } from "../services/accountingEngine";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";

export default function Dashboard({ dark = false }) {
  const { data: rawData, setData } = useAppData();
  const data = {
    ...(rawData || {}),
    leads:      (rawData?.leads      || []),
    clients:    (rawData?.clients    || []),
    tasks:      (rawData?.tasks      || []),
    accounting: (rawData?.accounting || []),
    inventory:  (rawData?.inventory  || []),
    suppliers:  (rawData?.suppliers  || []),
  };

  const { accounting = [], clients = [], leads = [], tasks = [], inventory = [] } = data;

  const kpis            = useMemo(() => getDashboardKPIs(data), [data]);
  const mom             = useMemo(() => getMoMRevenue(accounting), [accounting]);
  const momLeads        = useMemo(() => getMoMLeads(leads), [leads]);
  const pipelineStats   = useMemo(() => getPipelineStats(leads), [leads]);
  const revenueByService= useMemo(() => getRevenueByService(accounting, clients), [accounting, clients]);
  const overdueList     = useMemo(() => getOverdueInvoices(accounting), [accounting]);

  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5), [leads]);
  const pendingTaskList = useMemo(() =>
    tasks.filter(t => t.status !== "Done").slice(0, 5), [tasks]);

  // ── DM theme tokens ──────────────────────────────────────────────────────────
  const DM = dark
    ? { bg:"#0F172A", card:"#1E293B", border:"#334155", text:"#F1F5F9", muted:"#94A3B8", light:"#1E293B", input:"#0F172A", surface:"#253047" }
    : { bg:"transparent", card:"#fff", border:"#E2E8F0", text:"#1E293B", muted:"#64748B", light:"#F8FAFC", input:"#fff", surface:"#F1F5F9" };

  // ── KPI card order + collapse + pin ─────────────────────────────────────────
  const KPI_IDS = ["revenue","outstanding","clients","leads","tasks","collection","conversion","wonValue"];
  const [collapsed,  setCollapsed]  = useState({});
  const [cardOrder,  setCardOrder]  = useState(KPI_IDS);
  const [dragOver,   setDragOver]   = useState(null);
  const [dragId,     setDragId]     = useState(null);
  const [pinned,     setPinned]     = useState([]);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState(["progress","workload","delay","productivity"]);

  const toggleCollapse = id => setCollapsed(c => ({ ...c, [id]: !c[id] }));
  const togglePin      = id => setPinned(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-4), { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // ── Spotlight search (Cmd+K) ─────────────────────────────────────────────────
  const [spotlight, setSpotlight] = useState(false);
  const [spotQ,     setSpotQ]     = useState("");
  const spotInputRef = useRef(null);
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSpotlight(s => !s); setSpotQ(""); }
      if (e.key === "Escape") { setSpotlight(false); setShortcutsOpen(false); setNotesOpen(false); setActivityOpen(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (spotlight) setTimeout(() => spotInputRef.current?.focus(), 60); }, [spotlight]);
  const spotResults = useMemo(() => {
    if (!spotQ.trim()) return [];
    const q = spotQ.toLowerCase();
    const r = [];
    leads.filter(l => l.name?.toLowerCase().includes(q)).slice(0,3).forEach(l => r.push({ icon:"👤", label:l.name, sub:`Lead · ${l.status}`, color:B.blue }));
    clients.filter(c => c.name?.toLowerCase().includes(q)).slice(0,3).forEach(c => r.push({ icon:"🏢", label:c.name, sub:"Client", color:B.green }));
    tasks.filter(t => t.title?.toLowerCase().includes(q)).slice(0,3).forEach(t => r.push({ icon:"📋", label:t.title, sub:`Task · ${t.status}`, color:B.orange }));
    accounting.filter(i => i.client?.toLowerCase().includes(q)).slice(0,2).forEach(i => r.push({ icon:"💰", label:i.client, sub:`Invoice · ${aed(i.amount)}`, color:B.green }));
    return r.slice(0, 8);
  }, [spotQ, leads, clients, tasks, accounting]);

  // ── Date range filter ────────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState("month");
  const dateRangeStart = useMemo(() => {
    const now = new Date(); const d = new Date(now);
    if (dateRange === "week")    d.setDate(d.getDate() - 7);
    else if (dateRange === "month")   d.setMonth(d.getMonth() - 1);
    else if (dateRange === "quarter") d.setMonth(d.getMonth() - 3);
    else return null;
    return d.toISOString().slice(0, 10);
  }, [dateRange]);
  const filteredAccounting = useMemo(() => dateRangeStart ? accounting.filter(i => (i.date||"") >= dateRangeStart) : accounting, [accounting, dateRangeStart]);
  const filteredLeads      = useMemo(() => dateRangeStart ? leads.filter(l => (l.date||"") >= dateRangeStart) : leads, [leads, dateRangeStart]);

  // ── Revenue goal ─────────────────────────────────────────────────────────────
  const [revenueGoal,  setRevenueGoal]  = useState(() => { try { return Number(localStorage.getItem("dash-goal")) || 100000; } catch { return 100000; } });
  const [editingGoal,  setEditingGoal]  = useState(false);
  const [goalInput,    setGoalInput]    = useState("");
  const goalPct = Math.min(100, Math.round((kpis.totalRevenue / revenueGoal) * 100));

  // ── Live clock ───────────────────────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // ── Last refreshed ───────────────────────────────────────────────────────────
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const handleRefresh = useCallback(() => { setLastRefreshed(new Date()); addToast("Dashboard refreshed", "success"); }, [addToast]);

  // ── Keyboard shortcuts modal ─────────────────────────────────────────────────
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const h = e => { if (e.key === "?" && !e.ctrlKey && !e.metaKey && e.target.tagName !== "INPUT") setShortcutsOpen(s => !s); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  // ── Confetti when all tasks done ─────────────────────────────────────────────
  const allDone = tasks.length > 0 && tasks.every(t => t.status === "Done");
  const [confettiShown, setConfettiShown] = useState(false);
  useEffect(() => {
    if (allDone && !confettiShown) { addToast("🎉 All tasks complete!", "success"); setConfettiShown(true); }
    if (!allDone) setConfettiShown(false);
  }, [allDone, confettiShown, addToast]);

  // ── Inline task title edit ───────────────────────────────────────────────────
  const [editingTaskId,    setEditingTaskId]    = useState(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");

  // ── Client health ────────────────────────────────────────────────────────────
  const clientHealth = useMemo(() => clients.slice(0,5).map(c => {
    const inv    = accounting.filter(i => i.client === c.name);
    const paid   = inv.filter(i => i.status === "Paid").length;
    const payRate= Math.round((paid / (inv.length||1)) * 100);
    const open   = tasks.filter(t => t.status !== "Done" && (t.ref === c.id || t.assigned === c.name)).length;
    return { ...c, score: Math.max(0, Math.min(100, payRate - open*5)), payRate, openTasks: open };
  }).sort((a,b) => b.score - a.score), [clients, accounting, tasks]);

  // ── Top clients ──────────────────────────────────────────────────────────────
  const topClients = useMemo(() => {
    const map = {};
    accounting.forEach(i => { if (!map[i.client]) map[i.client]=0; map[i.client] += i.amount||0; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,val])=>({name,val}));
  }, [accounting]);
  const maxTopClient = Math.max(...topClients.map(c=>c.val), 1);
  const maxServiceVal= Math.max(...revenueByService.map(r=>r.val), 1);

  // ── Drag/drop KPIs ───────────────────────────────────────────────────────────
  const onDragStart = id => setDragId(id);
  const onDragOver  = (e, id) => { e.preventDefault(); setDragOver(id); };
  const onDrop      = targetId => {
    if (!dragId || dragId === targetId) { setDragOver(null); setDragId(null); return; }
    const next = [...cardOrder];
    const from = next.indexOf(dragId), to = next.indexOf(targetId);
    next.splice(from,1); next.splice(to,0,dragId);
    setCardOrder(next); setDragOver(null); setDragId(null);
  };

  // ── Progress / workload / delay / productivity data ──────────────────────────
  const progressData = useMemo(() => {
    const total  = tasks.length || 1;
    const done   = tasks.filter(t => t.status === "Done").length;
    const pct    = Math.round((done/total)*100);
    const byAssignee = [...new Set(tasks.map(t=>t.assigned).filter(Boolean))].map(name => {
      const mt = tasks.filter(t=>t.assigned===name);
      const d  = mt.filter(t=>t.status==="Done").length;
      return { name, pct: mt.length ? Math.round((d/mt.length)*100):0, done:d, total:mt.length };
    }).sort((a,b)=>b.pct-a.pct);
    const byPriority = ["High","Medium","Low"].map(p => {
      const pt = tasks.filter(t=>t.priority===p);
      const pd = pt.filter(t=>t.status==="Done").length;
      return { label:p, pct:pt.length?Math.round((pd/pt.length)*100):0, done:pd, total:pt.length };
    });
    return { total, done, pct, byAssignee, byPriority };
  }, [tasks]);

  const workloadMini = useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    return [...new Set(tasks.map(t=>t.assigned).filter(Boolean))].map(name => ({
      name,
      open:    tasks.filter(t=>t.assigned===name && t.status!=="Done").length,
      overdue: tasks.filter(t=>t.assigned===name && t.status!=="Done" && t.due && t.due<today).length,
    })).sort((a,b)=>b.open-a.open).slice(0,6);
  }, [tasks]);
  const maxWorkload = Math.max(...workloadMini.map(w=>w.open), 1);

  const delayData = useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    const ot    = tasks.filter(t=>t.status!=="Done" && t.due && t.due < today);
    const byA   = [...new Set(ot.map(t=>t.assigned).filter(Boolean))].map(name=>({ name, count:ot.filter(t=>t.assigned===name).length })).sort((a,b)=>b.count-a.count);
    return { total:ot.length, byAssignee:byA, items:ot.slice(0,5) };
  }, [tasks]);

  const productivityData = useMemo(() => {
    const n = new Date();
    const weeks = Array.from({length:6},(_,i)=>{
      const end=new Date(n); end.setDate(end.getDate()-i*7);
      const start=new Date(end); start.setDate(start.getDate()-7);
      const done=tasks.filter(t=>{if(t.status!=="Done"||!t.due)return false; const d=new Date(t.due); return d>=start&&d<end;}).length;
      return { label:`W-${i}`, done };
    }).reverse();
    return { weeks, sparkDone:weeks.map(w=>w.done) };
  }, [tasks]);

  // ── NEW FEATURE 1: Sticky notes / dashboard memo ─────────────────────────────
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteMemo, setNoteMemo]   = useState(() => { try { return localStorage.getItem("dash-memo") || ""; } catch { return ""; } });
  const saveMemo = v => { setNoteMemo(v); try { localStorage.setItem("dash-memo", v); } catch {} };

  // ── NEW FEATURE 2: Activity feed ─────────────────────────────────────────────
  const [activityOpen, setActivityOpen] = useState(false);
  const activityFeed = useMemo(() => {
    const events = [];
    [...leads].slice(0,4).forEach(l => events.push({ icon:"👤", text:`Lead "${l.name}" — ${l.status}`, time:l.date||"", color:B.blue }));
    [...accounting].filter(i=>i.status==="Paid").slice(0,3).forEach(i => events.push({ icon:"💰", text:`Invoice paid: ${i.client} — ${aed(i.amount)}`, time:i.date||"", color:B.green }));
    [...tasks].filter(t=>t.status==="Done").slice(0,3).forEach(t => events.push({ icon:"✅", text:`Task done: "${t.title}"`, time:t.due||"", color:B.green }));
    return events.sort((a,b)=>(b.time||"").localeCompare(a.time||"")).slice(0,12);
  }, [leads, accounting, tasks]);

  // ── NEW FEATURE 3: Win/loss ratio donut data ─────────────────────────────────
  const winLoss = useMemo(() => {
    const won  = leads.filter(l=>l.status==="Won").length;
    const lost = leads.filter(l=>l.status==="Lost").length;
    const total= won+lost||1;
    return { won, lost, rate: Math.round((won/total)*100) };
  }, [leads]);

  // ── NEW FEATURE 4: Invoice aging buckets ─────────────────────────────────────
  const agingBuckets = useMemo(() => {
    const today = new Date();
    const unpaid= accounting.filter(i=>i.status!=="Paid" && i.due);
    const buckets = [
      { label:"Current",  min:0,   max:30,  items:[], color:B.green  },
      { label:"31-60d",   min:31,  max:60,  items:[], color:B.yellow },
      { label:"61-90d",   min:61,  max:90,  items:[], color:B.orange },
      { label:"90d+",     min:91,  max:9999,items:[], color:B.red    },
    ];
    unpaid.forEach(i => {
      const days = Math.floor((today - new Date(i.due)) / 86_400_000);
      const b    = buckets.find(b => days >= b.min && days <= b.max);
      if (b) b.items.push(i);
    });
    return buckets.map(b => ({ ...b, total: b.items.reduce((s,i)=>s+(i.amount||0),0), count: b.items.length }));
  }, [accounting]);

  // ── NEW FEATURE 5: Avg deal size + close time ────────────────────────────────
  const dealStats = useMemo(() => {
    const won   = leads.filter(l => l.status === "Won" && l.value);
    const avgDeal = won.length ? Math.round(won.reduce((s,l)=>s+(l.value||0),0) / won.length) : 0;
    const convRate = leads.length ? Math.round((won.length / leads.length)*100) : 0;
    return { avgDeal, wonCount: won.length, convRate };
  }, [leads]);

  // ── NEW FEATURE 6: Inventory value tracker ───────────────────────────────────
  const inventoryValue = useMemo(() => {
    const total = inventory.reduce((s,i)=>s+((i.price||0)*(i.qty||0)),0);
    const low   = inventory.filter(i=>i.qty!=null && i.qty<=5 && i.qty>0).length;
    const out   = inventory.filter(i=>i.status==="Out of Stock").length;
    return { total, low, out };
  }, [inventory]);

  // ── NEW FEATURE 7: Daily target tracker (tasks due today completion) ──────────
  const dailyTarget = useMemo(() => {
    const today   = new Date().toISOString().slice(0,10);
    const dueToday= tasks.filter(t => t.due === today);
    const done    = dueToday.filter(t => t.status === "Done").length;
    const pct     = dueToday.length ? Math.round((done/dueToday.length)*100) : 100;
    return { total: dueToday.length, done, pct };
  }, [tasks]);

  // ── NEW FEATURE 8: Supplier risk flags ───────────────────────────────────────
  const supplierRisk = useMemo(() => {
    const supp = data.suppliers || [];
    const inactive = supp.filter(s => s.status === "Inactive").length;
    const noContact= supp.filter(s => !s.email && !s.phone).length;
    return { total: supp.length, inactive, noContact };
  }, [data.suppliers]);

  // ── NEW FEATURE 9: Notes-per-lead engagement score ───────────────────────────
  const engagementLeads = useMemo(() => {
    return [...leads]
      .map(l => ({ ...l, engScore: (l.notes?.length||0)/10 + (l.value||0)/5000 }))
      .sort((a,b)=>b.engScore-a.engScore)
      .slice(0,5);
  }, [leads]);

  // ── NEW FEATURE 10: Custom dashboard title / greeting ────────────────────────
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  // ── NEW FEATURE 11: Revenue forecast (simple linear projection) ───────────────
  const forecast = useMemo(() => {
    const hist = mom.history || [];
    if (hist.length < 2) return null;
    const last   = hist[hist.length-1];
    const prev   = hist[hist.length-2];
    const growth = prev > 0 ? (last-prev)/prev : 0;
    return Math.round(last * (1 + growth));
  }, [mom]);

  // ── NEW FEATURE 12: Lead source breakdown ────────────────────────────────────
  const leadSources = useMemo(() => {
    const map = {};
    leads.forEach(l => { const s=l.source||"Other"; if(!map[s])map[s]=0; map[s]++; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([label,count])=>({ label, count, pct: Math.round((count/leads.length||1)*100) }));
  }, [leads]);
  const maxSource = Math.max(...leadSources.map(s=>s.count),1);

  // ── NEW FEATURE 13: Mini heatmap of tasks by day-of-week ─────────────────────
  const taskHeatmap = useMemo(() => {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const counts= new Array(7).fill(0);
    tasks.forEach(t => { if(t.due){ const d=new Date(t.due); if(!isNaN(d)) counts[d.getDay()]++; } });
    const max = Math.max(...counts,1);
    return days.map((d,i) => ({ day:d, count:counts[i], pct:Math.round((counts[i]/max)*100) }));
  }, [tasks]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, overflowY:"auto", height:"100%", background:DM.bg, transition:"background 0.2s" }}>
      <style>{`
        @keyframes dash-confetti-fall { 0%{transform:translateY(-40px) rotate(0deg);opacity:1} 100%{transform:translateY(120px) rotate(720deg);opacity:0} }
        @keyframes dash-toast-in { from{transform:translateX(120px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes dash-count-up { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dash-slide-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dash-ring-fill { from{stroke-dasharray:0 188.5} }
        .dash-toolbar-btn:hover { background:${DM.light} !important; }
        .dash-range-btn { padding:4px 10px;border-radius:6px;border:1px solid ${DM.border};background:${DM.card};color:${DM.muted};font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s; }
        .dash-range-btn.active { background:${B.blue};color:#fff;border-color:${B.blue}; }
        .dash-range-btn:hover { border-color:${B.blue};color:${B.blue}; }
        .dash-section-title { color:${DM.text} !important; }
        @media (max-width: 1100px) { .kpi-grid-5 { grid-template-columns: repeat(3,1fr) !important; } }
        @media (max-width: 700px)  { .kpi-grid-5,.kpi-grid-3 { grid-template-columns: repeat(2,1fr) !important; } .dash-mid-row,.dash-bottom-row,.dash-widgets { grid-template-columns:1fr !important; } }
        @media (max-width: 480px)  { .kpi-grid-5,.kpi-grid-3 { grid-template-columns: repeat(2,1fr) !important; } .fab-actions { flex-direction:column !important; align-items:flex-end !important; } }
        .kpi-drag-card { cursor:grab; transition:opacity 0.15s,box-shadow 0.15s; }
        .kpi-drag-card:active { cursor:grabbing; }
        .dash-heatmap-cell { border-radius:3px; transition:transform 0.12s,box-shadow 0.12s; cursor:default; }
        .dash-heatmap-cell:hover { transform:scale(1.2); box-shadow:0 2px 8px rgba(0,0,0,0.18); }
        .dash-source-bar { transition:width 0.6s cubic-bezier(0.4,0,0.2,1); }
        .dash-activity-item { animation: dash-slide-in 0.3s ease both; }
        .dash-note-textarea { resize:vertical; font-family:inherit; }
        .dash-note-textarea:focus { outline:none; border-color:${B.blue}; box-shadow:0 0 0 2px ${B.blue}22; }
        .dash-forecast-bar { background:linear-gradient(90deg,${B.blue},${B.accent}); border-radius:4px; transition:width 0.8s cubic-bezier(0.4,0,0.2,1); }
      `}</style>

      {/* ═══════════════════════════════════════════════════════
          GREETING + TOOLBAR
      ═══════════════════════════════════════════════════════ */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", padding:"8px 0 0" }}>
        {/* NEW FEATURE 10: Greeting */}
        <div style={{ fontSize:13, fontWeight:700, color:DM.text }}>
          {greeting} 👋
          <span style={{ fontSize:11, fontWeight:400, color:DM.muted, marginLeft:10, fontVariantNumeric:"tabular-nums" }}>
            {now.toLocaleTimeString("en-AE",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            <span style={{ marginLeft:6, opacity:0.6 }}>· Refreshed {lastRefreshed.toLocaleTimeString("en-AE",{hour:"2-digit",minute:"2-digit"})}</span>
          </span>
        </div>
        <div style={{ flex:1 }} />
        {[["week","7D"],["month","1M"],["quarter","3M"],["all","All"]].map(([v,l]) => (
          <button key={v} className={`dash-range-btn${dateRange===v?" active":""}`} onClick={() => { setDateRange(v); addToast(`Range: ${l}`, "info"); }}>{l}</button>
        ))}
        <div style={{ width:1, height:20, background:DM.border, margin:"0 2px" }} />
        {/* Spotlight */}
        <button className="dash-toolbar-btn" onClick={() => { setSpotlight(true); setSpotQ(""); }}
          style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${DM.border}`, background:DM.card, color:DM.muted, fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
          🔍 <span>Search</span> <kbd style={{ fontSize:9, background:DM.light, border:`1px solid ${DM.border}`, borderRadius:3, padding:"1px 4px" }}>⌘K</kbd>
        </button>
        {/* NEW FEATURE 1: Sticky notes button */}
        <button className="dash-toolbar-btn" onClick={() => setNotesOpen(n => !n)}
          style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${DM.border}`, background: notesOpen ? B.yellow+"22" : DM.card, color: notesOpen ? B.yellow : DM.muted, fontSize:14, cursor:"pointer", position:"relative" }}
          title="Dashboard memo">
          📝
          {noteMemo && <div style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:"50%", background:B.yellow }} />}
        </button>
        {/* NEW FEATURE 2: Activity feed button */}
        <button className="dash-toolbar-btn" onClick={() => setActivityOpen(a => !a)}
          style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${DM.border}`, background: activityOpen ? B.blue+"22" : DM.card, color: activityOpen ? B.blue : DM.muted, fontSize:14, cursor:"pointer" }}
          title="Activity feed">⚡</button>
        {/* Refresh */}
        <button className="dash-toolbar-btn" onClick={handleRefresh}
          style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${DM.border}`, background:DM.card, color:DM.muted, fontSize:14, cursor:"pointer" }} title="Refresh">↻</button>
        {/* Shortcuts */}
        <button className="dash-toolbar-btn" onClick={() => setShortcutsOpen(true)}
          style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${DM.border}`, background:DM.card, color:DM.muted, fontSize:11, fontWeight:700, cursor:"pointer" }} title="Keyboard shortcuts">?</button>
        {/* Export CSV */}
        <button className="dash-toolbar-btn" onClick={() => {
          const rows = [["Metric","Value"],["Revenue",kpis.totalRevenue],["Outstanding",kpis.outstanding],["Clients",kpis.activeClients],["Leads",kpis.openLeads],["Tasks",kpis.pendingTasks],["Win Rate",winLoss.rate+"%"],["Avg Deal",dealStats.avgDeal],["Forecast",forecast||0]];
          const a = document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(rows.map(r=>r.join(",")).join("\n")); a.download=`dashboard-${new Date().toISOString().slice(0,10)}.csv`; a.click();
          addToast("CSV exported!", "success");
        }} style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${DM.border}`, background:DM.card, color:DM.muted, fontSize:11, fontWeight:700, cursor:"pointer" }}>⬇ CSV</button>
      </div>

      {/* NEW FEATURE 1: Sticky memo panel */}
      {notesOpen && (
        <div style={{ background: dark?"#1A1A2E":B.yellow+"18", border:`1px solid ${B.yellow}44`, borderRadius:10, padding:14, animation:"dash-slide-in 0.2s ease" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div style={{ fontSize:11, fontWeight:700, color:B.yellow, textTransform:"uppercase", letterSpacing:1 }}>📝 Dashboard Memo</div>
            <button onClick={() => setNotesOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:DM.muted, fontSize:14 }}>×</button>
          </div>
          <textarea className="dash-note-textarea" value={noteMemo} onChange={e => saveMemo(e.target.value)}
            placeholder="Jot down anything you need to remember…"
            rows={3}
            style={{ width:"100%", background:"transparent", border:`1px solid ${B.yellow}44`, borderRadius:7, padding:"8px 10px", fontSize:12, color:DM.text, boxSizing:"border-box" }} />
          <div style={{ fontSize:10, color:DM.muted, marginTop:4 }}>Auto-saved locally · {noteMemo.length} chars</div>
        </div>
      )}

      {/* NEW FEATURE 2: Activity feed panel */}
      {activityOpen && (
        <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, animation:"dash-slide-in 0.2s ease", overflow:"hidden" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", borderBottom:`1px solid ${DM.border}` }}>
            <div style={{ fontSize:12, fontWeight:700, color:DM.text }}>⚡ Recent Activity</div>
            <button onClick={() => setActivityOpen(false)} style={{ background:"none", border:"none", cursor:"pointer", color:DM.muted, fontSize:14 }}>×</button>
          </div>
          <div style={{ maxHeight:260, overflowY:"auto" }}>
            {activityFeed.length === 0 && <div style={{ padding:"16px", fontSize:12, color:DM.muted }}>No activity yet.</div>}
            {activityFeed.map((ev,i) => (
              <div key={i} className="dash-activity-item"
                style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 16px", borderBottom:`1px solid ${DM.border}`, animationDelay:`${i*0.04}s` }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{ev.icon}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, color:DM.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ev.text}</div>
                  {ev.time && <div style={{ fontSize:10, color:DM.muted, marginTop:1 }}>{ev.time}</div>}
                </div>
                <div style={{ width:6, height:6, borderRadius:"50%", background:ev.color, flexShrink:0, marginTop:4 }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revenue goal tracker */}
      <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <div style={{ fontSize:10, fontWeight:800, color:B.blue, textTransform:"uppercase", letterSpacing:1, whiteSpace:"nowrap" }}>🎯 Revenue Goal</div>
        <div style={{ flex:1, minWidth:200 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
            <span style={{ color:DM.muted }}>{aed(kpis.totalRevenue)} earned</span>
            <span style={{ fontWeight:700, color:goalPct>=100?B.green:B.blue }}>{goalPct}% of {aed(revenueGoal)}</span>
          </div>
          <div style={{ height:8, background:DM.light, borderRadius:4, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${goalPct}%`, background:`linear-gradient(90deg,${B.blue},${goalPct>=100?B.green:B.accent})`, borderRadius:4, transition:"width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
          </div>
        </div>
        {/* NEW FEATURE 11: Forecast */}
        {forecast && (
          <div style={{ fontSize:11, color:DM.muted, whiteSpace:"nowrap", borderLeft:`1px solid ${DM.border}`, paddingLeft:14 }}>
            📈 Forecast <span style={{ fontWeight:700, color:B.accent }}>{aed(forecast)}</span>
          </div>
        )}
        {editingGoal ? (
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <input autoFocus value={goalInput} onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => { if(e.key==="Enter"){ const v=Number(goalInput.replace(/[^0-9]/g,"")); if(v>0){setRevenueGoal(v); try{localStorage.setItem("dash-goal",v);}catch{} addToast("Goal updated!","success");} setEditingGoal(false); } if(e.key==="Escape") setEditingGoal(false); }}
              style={{ width:100, padding:"4px 8px", border:`1px solid ${B.blue}`, borderRadius:6, fontSize:12, background:DM.input, color:DM.text, outline:"none" }} placeholder="e.g. 150000" />
            <button onClick={() => setEditingGoal(false)} style={{ background:"none", border:"none", cursor:"pointer", color:DM.muted, fontSize:16 }}>×</button>
          </div>
        ) : (
          <button onClick={() => { setGoalInput(String(revenueGoal)); setEditingGoal(true); }}
            style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${DM.border}`, borderRadius:6, background:"none", color:DM.muted, cursor:"pointer" }}>Edit</button>
        )}
      </div>

      {/* NEW FEATURE 7: Daily target bar */}
      {dailyTarget.total > 0 && (
        <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:10, fontWeight:800, color:B.orange, textTransform:"uppercase", letterSpacing:1, whiteSpace:"nowrap" }}>📅 Today's Tasks</div>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
              <span style={{ color:DM.muted }}>{dailyTarget.done}/{dailyTarget.total} done</span>
              <span style={{ fontWeight:700, color:dailyTarget.pct===100?B.green:B.orange }}>{dailyTarget.pct}%</span>
            </div>
            <div style={{ height:6, background:DM.light, borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${dailyTarget.pct}%`, background:dailyTarget.pct===100?B.green:B.orange, borderRadius:3, transition:"width 0.6s" }} />
            </div>
          </div>
        </div>
      )}

      {/* Spotlight modal */}
      {spotlight && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:9000, display:"flex", alignItems:"flex-start", justifyContent:"center", paddingTop:"15vh" }} onClick={() => setSpotlight(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:DM.card, borderRadius:14, width:"min(540px,92vw)", boxShadow:"0 24px 60px rgba(0,0,0,0.3)", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 18px", borderBottom:`1px solid ${DM.border}` }}>
              <span style={{ fontSize:16 }}>🔍</span>
              <input ref={spotInputRef} autoFocus value={spotQ} onChange={e=>setSpotQ(e.target.value)}
                placeholder="Search leads, clients, tasks, invoices…"
                style={{ flex:1, border:"none", outline:"none", fontSize:14, background:"transparent", color:DM.text, fontFamily:"inherit" }} />
              <kbd style={{ fontSize:10, background:DM.light, border:`1px solid ${DM.border}`, borderRadius:4, padding:"2px 6px", color:DM.muted }}>ESC</kbd>
            </div>
            {spotResults.length > 0 ? (
              <div style={{ maxHeight:320, overflowY:"auto" }}>
                {spotResults.map((r,i)=>(
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 18px", borderBottom:`1px solid ${DM.border}`, cursor:"pointer" }}
                    onMouseEnter={e=>e.currentTarget.style.background=DM.light} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <span style={{ fontSize:16 }}>{r.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:DM.text }}>{r.label}</div>
                      <div style={{ fontSize:11, color:DM.muted }}>{r.sub}</div>
                    </div>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:r.color }} />
                  </div>
                ))}
              </div>
            ) : spotQ ? (
              <div style={{ padding:"24px 18px", textAlign:"center", color:DM.muted, fontSize:13 }}>No results for "{spotQ}"</div>
            ) : (
              <div style={{ padding:"16px 18px" }}>
                <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Quick Stats</div>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                  {[{icon:"👤",label:`${leads.length} Leads`},{icon:"🏢",label:`${clients.length} Clients`},{icon:"📋",label:`${tasks.length} Tasks`},{icon:"💰",label:`${accounting.length} Invoices`}].map((s,i)=>(
                    <div key={i} style={{ fontSize:12, color:DM.muted }}>{s.icon} {s.label}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Keyboard shortcuts */}
      {shortcutsOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:9000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setShortcutsOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:DM.card, borderRadius:12, padding:24, width:"min(420px,92vw)", boxShadow:"0 16px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15, color:DM.text }}>⌨️ Keyboard Shortcuts</div>
              <button onClick={()=>setShortcutsOpen(false)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:DM.muted }}>×</button>
            </div>
            {[["⌘K","Open search spotlight"],["?","Toggle shortcuts"],["Esc","Close any panel"],["📝","Dashboard memo"],["⚡","Activity feed"],["Drag KPI","Reorder cards"],["Dbl-click title","Rename task"],["↻","Refresh data"],["⬇ CSV","Export summary"]].map(([k,d])=>(
              <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:`1px solid ${DM.border}` }}>
                <span style={{ fontSize:12, color:DM.muted }}>{d}</span>
                <kbd style={{ fontSize:11, background:DM.light, border:`1px solid ${DM.border}`, borderRadius:4, padding:"2px 7px", color:DM.text, fontWeight:700 }}>{k}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position:"fixed", bottom:80, right:24, zIndex:8000, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
        {toasts.map(t=>(
          <div key={t.id} style={{ animation:"dash-toast-in 0.25s ease", background:t.type==="success"?B.green:t.type==="error"?B.red:B.blue, color:"#fff", borderRadius:8, padding:"8px 14px", fontSize:12, fontWeight:600, boxShadow:"0 4px 16px rgba(0,0,0,0.2)", whiteSpace:"nowrap" }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Confetti */}
      {allDone && (
        <div style={{ position:"fixed", top:0, left:0, right:0, pointerEvents:"none", zIndex:7000 }}>
          {Array.from({length:20}).map((_,i)=>(
            <div key={i} style={{ width:8, height:8, borderRadius:i%3===0?"50%":"2px", background:["#F59E0B","#3B82F6","#10B981","#EF4444","#8B5CF6"][i%5], animation:`dash-confetti-fall ${1+Math.random()*1.2}s ${Math.random()*0.8}s ease-in forwards`, position:"absolute", left:`${4+i*4.8}%` }} />
          ))}
        </div>
      )}

      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div style={{ background:B.red+"0f", border:`1px solid ${B.red}40`, borderLeft:`4px solid ${B.red}`, borderRadius:8, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:`0 2px 8px ${B.red}18` }}>
          <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:B.red }}>{overdueList.length} overdue invoice{overdueList.length>1?"s":""}</div>
            <div style={{ fontSize:11, color:B.red, opacity:0.75, marginTop:2 }}>{aed(overdueList.reduce((s,i)=>s+(i.amount-i.paid),0))} outstanding — action required</div>
          </div>
        </div>
      )}

      <QuickActionsBar data={data} setData={setData} addToast={addToast} />

      {/* Today's summary */}
      {(() => {
        const todayStr = new Date().toISOString().slice(0,10);
        const items = [
          ...tasks.filter(t=>t.due===todayStr && t.status!=="Done").map(t=>({ icon:"📋", text:t.title, color:B.orange, label:"Task due" })),
          ...accounting.filter(i=>i.due===todayStr && i.status!=="Paid").map(i=>({ icon:"💸", text:`${i.client} — ${aed(i.amount)}`, color:B.red, label:"Invoice due" })),
          ...clients.filter(c=>c.renewal===todayStr).map(c=>({ icon:"🔄", text:c.name, color:B.accent, label:"Renewal" })),
        ];
        if (!items.length) return null;
        return (
          <div style={{ background:"linear-gradient(135deg,#1E40AF08,#7C3AED08)", border:`1px solid ${B.blue}20`, borderRadius:10, padding:"10px 16px" }}>
            <div style={{ fontSize:10, fontWeight:800, color:B.blue, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>📅 Today — {new Date().toLocaleDateString("en-AE",{weekday:"long",month:"short",day:"numeric"})}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {items.slice(0,6).map((item,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6, background:item.color+"10", border:`1px solid ${item.color}25`, borderRadius:20, padding:"4px 10px", fontSize:11 }}>
                  <span>{item.icon}</span>
                  <span style={{ fontWeight:600, color:item.color, fontSize:10 }}>{item.label}</span>
                  <span style={{ color:DM.text, maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.text}</span>
                </div>
              ))}
              {items.length>6 && <div style={{ fontSize:11, color:DM.muted, padding:"4px 0" }}>+{items.length-6} more</div>}
            </div>
          </div>
        );
      })()}

      {/* Primary KPI grid */}
      {(() => {
        const primary = ["revenue","outstanding","clients","leads","tasks"];
        const kpiDefs = {
          revenue:     { label:"Total Revenue",    value:`AED ${(kpis.totalRevenue/1000).toFixed(1)}K`, sub:<Delta delta={mom.delta} />,                      color:B.blue,   sparkData:mom.history,      trend:mom.delta   },
          outstanding: { label:"Outstanding",      value:`AED ${(kpis.outstanding/1000).toFixed(1)}K`,  sub:`${kpis.overdueCount} overdue`,                   color:B.red,    sparkData:null,              trend:null        },
          clients:     { label:"Active Clients",   value:kpis.activeClients,                            sub:kpis.expiringClients>0?`⚠ ${kpis.expiringClients} renewing`:"all good", color:B.green, sparkData:null, trend:null },
          leads:       { label:"Open Leads",       value:kpis.openLeads,                                sub:<Delta delta={momLeads.delta} suffix=" vs last mo" />, color:B.yellow, sparkData:momLeads.history, trend:momLeads.delta },
          tasks:       { label:"Pending Tasks",    value:kpis.pendingTasks,                             sub:kpis.highPriorityTasks>0?`${kpis.highPriorityTasks} high priority`:"no urgent items", color:B.orange, sparkData:null, trend:null },
        };
        return (
          <div className="kpi-grid-5" style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
            {cardOrder.filter(id=>primary.includes(id)).map(id=>{
              const def=kpiDefs[id];
              return (
                <div key={id} className="kpi-drag-card"
                  draggable onDragStart={()=>onDragStart(id)} onDragOver={e=>onDragOver(e,id)} onDrop={()=>onDrop(id)} onDragEnd={()=>{setDragId(null);setDragOver(null);}}
                  style={{ opacity:dragId===id?0.5:1, outline:dragOver===id?`2px dashed ${B.blue}`:"none", borderRadius:10 }}>
                  <CollapsibleKPI {...def} collapsed={collapsed[id]} onToggle={()=>toggleCollapse(id)} pinned={pinned.includes(id)} onPin={()=>{togglePin(id);addToast(pinned.includes(id)?"Unpinned":"Pinned","info");}} darkMode={dark} DM={DM} />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Secondary KPI grid */}
      {(() => {
        const secondary = ["collection","conversion","wonValue"];
        const kpiDefs = {
          collection: { label:"Collection Rate",  value:`${kpis.collectionRate}%`, sub:"of invoiced amount", color:B.accent, small:true },
          conversion: { label:"Conversion Rate",  value:`${kpis.conversionRate}%`, sub:"leads → won",        color:B.green,  small:true },
          wonValue:   { label:"Won Value (Total)", value:aed(kpis.wonValue),        sub:"all time",           color:B.blue,   small:true },
        };
        return (
          <div className="kpi-grid-3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            {cardOrder.filter(id=>secondary.includes(id)).map(id=>{
              const def=kpiDefs[id];
              return (
                <div key={id} className="kpi-drag-card"
                  draggable onDragStart={()=>onDragStart(id)} onDragOver={e=>onDragOver(e,id)} onDrop={()=>onDrop(id)} onDragEnd={()=>{setDragId(null);setDragOver(null);}}
                  style={{ opacity:dragId===id?0.5:1, outline:dragOver===id?`2px dashed ${B.blue}`:"none", borderRadius:10 }}>
                  <CollapsibleKPI {...def} collapsed={collapsed[id]} onToggle={()=>toggleCollapse(id)} pinned={pinned.includes(id)} onPin={()=>{togglePin(id);addToast(pinned.includes(id)?"Unpinned":"Pinned","info");}} darkMode={dark} DM={DM} />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* NEW FEATURE 3+5: Win/Loss + Deal stats row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }} className="kpi-grid-3">
        {/* Win/Loss donut */}
        <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
          <svg viewBox="0 0 80 80" style={{ width:64, height:64, flexShrink:0 }}>
            <circle cx="40" cy="40" r="28" fill="none" stroke={DM.light} strokeWidth="10" />
            <circle cx="40" cy="40" r="28" fill="none" stroke={B.green} strokeWidth="10"
              strokeDasharray={`${winLoss.rate*1.759} 175.9`} strokeLinecap="round"
              transform="rotate(-90 40 40)" style={{ animation:"dash-ring-fill 1s ease" }} />
            <text x="40" y="44" textAnchor="middle" fontSize="13" fontWeight="800" fill={DM.text}>{winLoss.rate}%</text>
          </svg>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Win Rate</div>
            <div style={{ fontSize:12, color:B.green }}>{winLoss.won} Won</div>
            <div style={{ fontSize:12, color:B.red }}>{winLoss.lost} Lost</div>
          </div>
        </div>
        {/* Avg deal */}
        <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"14px 16px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Avg Deal Size</div>
          <div style={{ fontSize:22, fontWeight:800, color:DM.text, letterSpacing:"-0.5px" }}>{aed(dealStats.avgDeal)}</div>
          <div style={{ fontSize:11, color:DM.muted, marginTop:4 }}>from {dealStats.wonCount} closed deals</div>
        </div>
        {/* Inventory value */}
        <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"14px 16px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Inventory Value</div>
          <div style={{ fontSize:22, fontWeight:800, color:DM.text, letterSpacing:"-0.5px" }}>{aed(inventoryValue.total)}</div>
          <div style={{ fontSize:11, color:DM.muted, marginTop:4 }}>
            {inventoryValue.low>0 && <span style={{ color:B.orange, marginRight:8 }}>⚠ {inventoryValue.low} low stock</span>}
            {inventoryValue.out>0 && <span style={{ color:B.red }}>✗ {inventoryValue.out} out</span>}
            {inventoryValue.low===0 && inventoryValue.out===0 && <span style={{ color:B.green }}>All stocked</span>}
          </div>
        </div>
      </div>

      {/* NEW FEATURE 4: Invoice aging buckets */}
      <div style={{ background:DM.card, border:`1px solid ${DM.border}`, borderRadius:10, padding:"14px 16px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:DM.text, marginBottom:12 }}>💳 Invoice Aging</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }} className="kpi-grid-3">
          {agingBuckets.map(b=>(
            <div key={b.label} style={{ textAlign:"center", padding:"10px 8px", background:`${b.color}0d`, border:`1px solid ${b.color}30`, borderRadius:8 }}>
              <div style={{ fontSize:10, fontWeight:700, color:b.color, marginBottom:4 }}>{b.label}</div>
              <div style={{ fontSize:18, fontWeight:800, color:DM.text }}>{b.count}</div>
              <div style={{ fontSize:10, color:DM.muted }}>{aed(b.total)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Widget bar */}
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        <button onClick={() => setWidgetPickerOpen(true)}
          style={{ padding:"6px 16px", fontSize:12, fontWeight:700, background:DM.card, border:`1px solid ${DM.border}`, borderRadius:8, cursor:"pointer", color:DM.muted, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:16 }}>⊞</span> Add Widget
        </button>
      </div>

      {/* Widget picker modal */}
      {widgetPickerOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setWidgetPickerOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:DM.card, borderRadius:12, padding:24, width:"min(420px,92vw)", boxShadow:"0 16px 40px rgba(0,0,0,0.18)", maxHeight:"85vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15, color:DM.text }}>Add Widget</div>
              <button onClick={()=>setWidgetPickerOpen(false)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:DM.muted }}>×</button>
            </div>
            {[
              { id:"progress",    icon:"◎", label:"Task Progress",      desc:"Completion ring + by assignee/priority" },
              { id:"workload",    icon:"▤", label:"Workload Chart",      desc:"Horizontal bars per team member" },
              { id:"delay",       icon:"⏰", label:"Delay Report",       desc:"Overdue tasks by owner" },
              { id:"productivity",icon:"📈", label:"Productivity",       desc:"Tasks closed per week — last 6 weeks" },
              { id:"clienthealth",icon:"💚", label:"Client Health",      desc:"Payment rate + open tasks per client" },
              { id:"topclients",  icon:"🏆", label:"Top Clients",        desc:"Ranked by revenue" },
              { id:"funnel",      icon:"🔻", label:"Pipeline Funnel",    desc:"Visual lead stage funnel" },
              { id:"leadsources", icon:"🎯", label:"Lead Sources",       desc:"Where your leads come from" },
              { id:"heatmap",     icon:"🔥", label:"Task Heatmap",       desc:"Tasks by day-of-week" },
              { id:"engagement",  icon:"💬", label:"Engagement Scores",  desc:"Leads ranked by engagement" },
            ].map(w=>{
              const active=activeWidgets.includes(w.id);
              return (
                <div key={w.id} onClick={()=>setActiveWidgets(aw=>active?aw.filter(x=>x!==w.id):[...aw,w.id])}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:8, border:`1px solid ${active?B.blue:DM.border}`, marginBottom:8, cursor:"pointer", background:active?B.blue+"0a":DM.card }}>
                  <span style={{ fontSize:20, color:active?B.blue:DM.muted }}>{w.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:active?B.blue:DM.text }}>{w.label}</div>
                    <div style={{ fontSize:11, color:DM.muted }}>{w.desc}</div>
                  </div>
                  <span style={{ fontSize:12, color:active?B.blue:DM.muted }}>{active?"✓ On":"+ Add"}</span>
                </div>
              );
            })}
            <button onClick={()=>setWidgetPickerOpen(false)} style={{ marginTop:8, width:"100%", padding:"9px 0", background:B.blue, color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer" }}>Done</button>
          </div>
        </div>
      )}

      {/* Optional Widgets grid */}
      {activeWidgets.length > 0 && (
        <div className="dash-widgets" style={{ display:"grid", gridTemplateColumns:activeWidgets.length>=2?"1fr 1fr":"1fr", gap:14 }}>

          {activeWidgets.includes("progress") && (
            <SectionCard title="Task Progress Analytics">
              <div style={{ padding:"14px", display:"flex", gap:20, alignItems:"flex-start", flexWrap:"wrap" }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                  <svg viewBox="0 0 80 80" style={{ width:80, height:80 }}>
                    <circle cx="40" cy="40" r="30" fill="none" stroke={DM.light} strokeWidth="10" />
                    <circle cx="40" cy="40" r="30" fill="none" stroke={B.green} strokeWidth="10"
                      strokeDasharray={`${progressData.pct*1.885} 188.5`} strokeLinecap="round"
                      transform="rotate(-90 40 40)" style={{ animation:"dash-ring-fill 1s ease" }} />
                    <text x="40" y="45" textAnchor="middle" fontSize="14" fontWeight="800" fill={DM.text}>{progressData.pct}%</text>
                  </svg>
                  <div style={{ fontSize:10, color:DM.muted }}>{progressData.done}/{progressData.total} done</div>
                </div>
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:DM.muted, marginBottom:6 }}>BY ASSIGNEE</div>
                  {progressData.byAssignee.slice(0,5).map(a=>(
                    <div key={a.name} style={{ marginBottom:7 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                        <span style={{ color:DM.text, fontWeight:500 }}>{a.name}</span>
                        <span style={{ color:DM.muted }}>{a.done}/{a.total}</span>
                      </div>
                      <div style={{ height:6, background:DM.light, borderRadius:3 }}>
                        <div style={{ width:`${a.pct}%`, height:"100%", background:a.pct>70?B.green:B.orange, borderRadius:3, transition:"width 0.5s" }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ minWidth:130 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:DM.muted, marginBottom:6 }}>BY PRIORITY</div>
                  {progressData.byPriority.map((p,i)=>(
                    <div key={p.label} style={{ marginBottom:7 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                        <span style={{ color:DM.text, fontWeight:500 }}>{p.label}</span>
                        <span style={{ fontWeight:700, color:[B.red,B.yellow,B.green][i] }}>{p.pct}%</span>
                      </div>
                      <div style={{ height:6, background:DM.light, borderRadius:3 }}>
                        <div style={{ width:`${p.pct}%`, height:"100%", background:[B.red,B.yellow,B.green][i], borderRadius:3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("workload") && (
            <SectionCard title="Workload">
              <div style={{ padding:"14px" }}>
                {workloadMini.map(w=>(
                  <div key={w.name} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                      <span style={{ fontWeight:600, color:DM.text }}>{w.name}</span>
                      <div style={{ display:"flex", gap:8, fontSize:11 }}>
                        <span style={{ color:B.blue }}>{w.open} open</span>
                        {w.overdue>0 && <span style={{ color:B.red, fontWeight:700 }}>⚠ {w.overdue}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", height:10, background:DM.light, borderRadius:5, overflow:"hidden" }}>
                      <div style={{ width:`${((w.open-w.overdue)/maxWorkload)*100}%`, background:B.blue, transition:"width 0.4s" }} />
                      <div style={{ width:`${(w.overdue/maxWorkload)*100}%`, background:B.red, opacity:0.8 }} />
                    </div>
                  </div>
                ))}
                {workloadMini.length===0 && <div style={{ fontSize:12, color:DM.muted }}>No tasks assigned yet.</div>}
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("delay") && (
            <SectionCard title="Delay Report" accent={B.red}>
              <div style={{ padding:14 }}>
                {delayData.total===0 ? <div style={{ fontSize:12, color:DM.muted }}>🎉 No overdue tasks!</div> : (
                  <>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                      <span style={{ fontSize:28, fontWeight:800, color:B.red }}>{delayData.total}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:B.red }}>Overdue tasks</div>
                        <div style={{ fontSize:10, color:DM.muted }}>Across {delayData.byAssignee.length} member{delayData.byAssignee.length!==1?"s":""}</div>
                      </div>
                    </div>
                    {delayData.byAssignee.map(a=>(
                      <div key={a.name} style={{ marginBottom:6 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                          <span style={{ fontWeight:600, color:DM.text }}>{a.name}</span>
                          <span style={{ fontWeight:700, color:B.red }}>{a.count} overdue</span>
                        </div>
                        <div style={{ height:5, background:DM.light, borderRadius:3, overflow:"hidden" }}>
                          <div style={{ width:`${(a.count/delayData.total)*100}%`, height:"100%", background:B.red, borderRadius:3 }} />
                        </div>
                      </div>
                    ))}
                    <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:"0.5px", margin:"10px 0 6px" }}>Recent overdue</div>
                    {delayData.items.map(t=>{
                      const daysLate=Math.floor((new Date()-new Date(t.due))/86_400_000);
                      return (
                        <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:`1px solid ${DM.border}` }}>
                          <div style={{ width:6, height:6, borderRadius:"50%", background:B.red, flexShrink:0 }} />
                          <div style={{ flex:1, fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:DM.text }}>{t.title}</div>
                          <span style={{ fontSize:10, fontWeight:700, color:B.red, flexShrink:0 }}>+{daysLate}d</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("productivity") && (
            <SectionCard title="Productivity Tracker">
              <div style={{ padding:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>Tasks completed per week (last 6)</div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:72 }}>
                  {productivityData.weeks.map((w,i)=>{
                    const max=Math.max(...productivityData.weeks.map(x=>x.done),1);
                    const pct=(w.done/max)*100;
                    const isLast=i===productivityData.weeks.length-1;
                    return (
                      <div key={w.label} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3, height:"100%", justifyContent:"flex-end" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:isLast?B.blue:DM.text }}>{w.done}</div>
                        <div style={{ width:"100%", borderRadius:"4px 4px 0 0", height:`${Math.max(pct,4)}%`, background:isLast?`linear-gradient(180deg,${B.blue},${B.accent})`:DM.border, transition:"height 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
                        <div style={{ fontSize:9, color:DM.muted }}>{w.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("clienthealth") && (
            <SectionCard title="Client Health Scores">
              <div style={{ padding:14 }}>
                {clientHealth.length===0 ? <div style={{ fontSize:12, color:DM.muted }}>No clients yet</div> : clientHealth.map(c=>(
                  <div key={c.id||c.name} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <Avatar name={c.name} size={22} />
                        <span style={{ fontSize:12, fontWeight:600, color:DM.text }}>{c.name}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {c.openTasks>0 && <span style={{ fontSize:10, color:B.orange }}>📋 {c.openTasks}</span>}
                        <span style={{ fontSize:12, fontWeight:800, color:c.score>=80?B.green:c.score>=50?B.yellow:B.red }}>{c.score}</span>
                      </div>
                    </div>
                    <div style={{ height:5, background:DM.light, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ width:`${c.score}%`, height:"100%", background:c.score>=80?B.green:c.score>=50?B.yellow:B.red, borderRadius:3, transition:"width 0.6s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("topclients") && (
            <SectionCard title="🏆 Top Clients by Revenue">
              <div style={{ padding:14 }}>
                {topClients.length===0 ? <div style={{ fontSize:12, color:DM.muted }}>No revenue data</div> : topClients.map((c,i)=>(
                  <div key={c.name} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <div style={{ width:20, fontSize:12, fontWeight:800, color:["#F59E0B","#9CA3AF","#B45309","#64748B","#64748B"][i], textAlign:"center" }}>{i+1}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                        <span style={{ fontWeight:600, color:DM.text }}>{c.name}</span>
                        <span style={{ fontWeight:700, color:B.blue }}>{aed(c.val)}</span>
                      </div>
                      <div style={{ height:5, background:DM.light, borderRadius:3, overflow:"hidden" }}>
                        <div style={{ width:`${(c.val/maxTopClient)*100}%`, height:"100%", background:i===0?`linear-gradient(90deg,#F59E0B,#FCD34D)`:B.blue, borderRadius:3, transition:"width 0.6s" }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {activeWidgets.includes("funnel") && (
            <SectionCard title="🔻 Pipeline Funnel">
              <div style={{ padding:14 }}>
                {pipelineStats.length===0 ? <div style={{ fontSize:12, color:DM.muted }}>No pipeline data</div> : (() => {
                  const maxCount=Math.max(...pipelineStats.map(s=>s.count),1);
                  const colors=[B.blue,B.accent,B.yellow,B.orange,B.green,B.red];
                  return pipelineStats.map((s,i)=>{
                    const w=Math.max(20,(s.count/maxCount)*100);
                    return (
                      <div key={s.stage} style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:4 }}>
                        <div style={{ width:`${w}%`, background:colors[i%colors.length], borderRadius:4, padding:"5px 10px", display:"flex", justifyContent:"space-between", transition:"width 0.6s", minWidth:120 }}>
                          <span style={{ fontSize:11, fontWeight:700, color:"#fff" }}>{s.stage}</span>
                          <span style={{ fontSize:11, color:"rgba(255,255,255,0.85)" }}>{s.count} · {aed(s.value)}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </SectionCard>
          )}

          {/* NEW FEATURE 12: Lead source breakdown widget */}
          {activeWidgets.includes("leadsources") && (
            <SectionCard title="🎯 Lead Sources">
              <div style={{ padding:14 }}>
                {leadSources.length===0 ? <div style={{ fontSize:12, color:DM.muted }}>No leads yet</div> : leadSources.map((s,i)=>(
                  <div key={s.label} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                      <span style={{ fontWeight:600, color:DM.text }}>{s.label}</span>
                      <span style={{ color:DM.muted }}>{s.count} leads · {s.pct}%</span>
                    </div>
                    <div style={{ height:6, background:DM.light, borderRadius:3, overflow:"hidden" }}>
                      <div className="dash-source-bar" style={{ width:`${(s.count/maxSource)*100}%`, height:"100%", background:[B.blue,B.green,B.orange,B.accent,B.yellow][i%5], borderRadius:3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* NEW FEATURE 13: Task heatmap widget */}
          {activeWidgets.includes("heatmap") && (
            <SectionCard title="🔥 Task Heatmap (by day)">
              <div style={{ padding:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:DM.muted, textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:12 }}>Tasks due by day of week</div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:60 }}>
                  {taskHeatmap.map(d=>(
                    <div key={d.day} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, height:"100%", justifyContent:"flex-end" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:d.pct>60?B.red:d.pct>30?B.orange:DM.muted }}>{d.count}</div>
                      <div className="dash-heatmap-cell" style={{ width:"100%", height:`${Math.max(d.pct,6)}%`, borderRadius:"3px 3px 0 0",
                        background:d.pct>80?B.red:d.pct>50?B.orange:d.pct>20?B.yellow:DM.light }} title={`${d.day}: ${d.count} tasks`} />
                      <div style={{ fontSize:9, color:DM.muted }}>{d.day}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:12, marginTop:10, fontSize:10, color:DM.muted }}>
                  {[{color:B.red,label:"Heavy"},{color:B.orange,label:"Moderate"},{color:B.yellow,label:"Light"},{color:DM.light,label:"None"}].map(l=>(
                    <span key={l.label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:l.color, display:"inline-block" }} />{l.label}
                    </span>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}

          {/* NEW FEATURE 9: Engagement scores */}
          {activeWidgets.includes("engagement") && (
            <SectionCard title="💬 Lead Engagement Scores">
              <div style={{ padding:14 }}>
                {engagementLeads.length===0 ? <div style={{ fontSize:12, color:DM.muted }}>No leads yet</div> : engagementLeads.map((l,i)=>{
                  const score=Math.min(100,Math.round(l.engScore*20));
                  return (
                    <div key={l.id||l.name} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                      <div style={{ width:18, fontSize:11, fontWeight:800, color:DM.muted, textAlign:"center" }}>{i+1}</div>
                      <Avatar name={l.name} size={22} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:DM.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.name}</div>
                        <div style={{ height:4, background:DM.light, borderRadius:2, marginTop:4 }}>
                          <div style={{ width:`${score}%`, height:"100%", background:score>70?B.green:score>40?B.yellow:B.muted, borderRadius:2, transition:"width 0.5s" }} />
                        </div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:DM.muted, flexShrink:0 }}>{score}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

        </div>
      )}

      {/* Mid row */}
      <div className="dash-mid-row" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <SectionCard title="Recent Leads">
          <RecentLeadsList leads={recentLeads} dark={dark} DM={DM} />
        </SectionCard>
        <SectionCard title="Pending Tasks">
          <div style={{ padding:"4px 0" }}>
            {pendingTaskList.map(t=>{
              const statusCycle = { "Pending":"In Progress", "In Progress":"Done", "Done":"Pending" };
              const statusColor = { "Pending":B.muted, "In Progress":B.blue, "Done":B.green };
              return (
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderBottom:`1px solid ${DM.border}`, minHeight:44 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:t.priority==="High"?B.red:t.priority==="Medium"?B.yellow:B.green, flexShrink:0 }} />
                  {editingTaskId===t.id ? (
                    <input autoFocus value={editingTaskTitle} onChange={e=>setEditingTaskTitle(e.target.value)}
                      onBlur={()=>{ if(editingTaskTitle.trim()){ setData(d=>({...d,tasks:d.tasks.map(x=>x.id===t.id?{...x,title:editingTaskTitle.trim()}:x)})); addToast("Task renamed","success"); } setEditingTaskId(null); }}
                      onKeyDown={e=>{ if(e.key==="Enter")e.target.blur(); if(e.key==="Escape")setEditingTaskId(null); }}
                      style={{ flex:1, fontSize:12, border:`1px solid ${B.blue}`, borderRadius:4, padding:"2px 6px", outline:"none", fontFamily:"inherit", background:DM.input, color:DM.text }} />
                  ) : (
                    <div style={{ flex:1, fontSize:12, color:DM.text }} onDoubleClick={()=>{ setEditingTaskId(t.id); setEditingTaskTitle(t.title); }} title="Double-click to rename">{t.title}</div>
                  )}
                  <button onClick={()=>{ const next=statusCycle[t.status]||"Pending"; setData(d=>({...d,tasks:d.tasks.map(x=>x.id===t.id?{...x,status:next}:x)})); }}
                    style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:12, border:`1px solid ${statusColor[t.status]||B.muted}40`, background:(statusColor[t.status]||B.muted)+"15", color:statusColor[t.status]||B.muted, cursor:"pointer", whiteSpace:"nowrap", minHeight:28 }}>
                    {t.status||"Pending"}
                  </button>
                  <span style={{ fontSize:11, color:DM.muted }}>{t.due}</span>
                </div>
              );
            })}
            {pendingTaskList.length===0 && <div style={{ padding:"12px 14px", fontSize:12, color:DM.muted }}>All tasks complete 🎉</div>}
          </div>
        </SectionCard>
      </div>

      {/* Bottom row */}
      <div className="dash-bottom-row" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
        <SectionCard title="Inventory Alerts">
          {inventory.filter(i=>i.status!=="In Stock").length===0
            ? <div style={{ padding:"12px 14px", fontSize:12, color:DM.muted }}>All items in stock</div>
            : inventory.filter(i=>i.status!=="In Stock").map(i=>(
              <div key={i.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 14px", borderBottom:`1px solid ${DM.border}` }}>
                <span style={{ fontSize:12, color:DM.text }}>{i.name}</span>
                <Badge label={i.status} />
              </div>
            ))}
        </SectionCard>

        <SectionCard title="Revenue by Service">
          {revenueByService.slice(0,5).map(r=>(
            <div key={r.label} style={{ padding:"8px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
                <span style={{ color:DM.muted }}>{r.label}</span>
                <span style={{ fontWeight:600, color:DM.text }}>{aed(r.val)}</span>
              </div>
              <div style={{ height:6, background:DM.light, borderRadius:3, overflow:"hidden" }}>
                <div className="dash-forecast-bar" style={{ width:`${(r.val/maxServiceVal)*100}%`, height:"100%" }} />
              </div>
            </div>
          ))}
          {revenueByService.length===0 && <div style={{ padding:"12px 14px", fontSize:12, color:DM.muted }}>No revenue data yet</div>}
        </SectionCard>

        <SectionCard title="Lead Pipeline">
          {pipelineStats.map(s=>(
            <div key={s.stage} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 14px", borderBottom:`1px solid ${DM.border}` }}>
              <Badge label={s.stage} />
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontWeight:600, fontSize:13, color:DM.text }}>{s.count}</span>
                <span style={{ fontSize:11, color:DM.muted }}>{aed(s.value)}</span>
              </div>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

// ── QuickActionsBar ────────────────────────────────────────────────────────────
function QuickActionsBar({ data, setData, addToast }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [vals, setVals] = useState({});

  const submit = () => {
    if (form==="lead")    setData({...data, leads:[...data.leads,{id:`L${Date.now()}`,name:vals.name||"New Lead",service:vals.service||"",status:"New",value:Number(vals.value)||0,source:"Other",date:new Date().toISOString().slice(0,10),updatedAt:new Date().toISOString().slice(0,10)}]});
    if (form==="invoice") setData({...data, accounting:[...data.accounting,{id:`INV${Date.now()}`,client:vals.client||"Client",desc:vals.desc||"",amount:Number(vals.amount)||0,vatRate:5,paid:0,status:"Unpaid",date:new Date().toISOString().slice(0,10),due:vals.due||""}]});
    if (form==="task")    setData({...data, tasks:[...data.tasks,{id:`T${Date.now()}`,title:vals.title||"New Task",assigned:"",priority:"Medium",status:"Pending",due:vals.due||"",ref:""}]});
    setForm(null); setVals({});
    if (addToast) addToast(`${form.charAt(0).toUpperCase()+form.slice(1)} added!`, "success");
  };

  const fields = {
    lead:    [{k:"name",p:"Lead name",t:"text"},{k:"service",p:"Service",t:"text"},{k:"value",p:"Value (AED)",t:"number"}],
    invoice: [{k:"client",p:"Client name",t:"text"},{k:"desc",p:"Description",t:"text"},{k:"amount",p:"Amount (AED)",t:"number"},{k:"due",p:"Due date",t:"date"}],
    task:    [{k:"title",p:"Task title",t:"text"},{k:"due",p:"Due date",t:"date"}],
  };

  return (
    <>
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:500, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:10 }}>
        <style>{`@keyframes fab-pulse { 0%,100%{box-shadow:0 4px 14px rgba(59,130,246,0.45)} 50%{box-shadow:0 4px 24px rgba(59,130,246,0.75)} }`}</style>
        {open && (
          <div className="fab-actions" style={{ display:"flex", gap:8, background:"#fff", border:`1px solid ${B.border}`, borderRadius:12, padding:"8px 12px", boxShadow:"0 4px 20px rgba(0,0,0,0.12)" }}>
            {[{id:"lead",label:"+ Lead",color:B.blue},{id:"invoice",label:"+ Invoice",color:B.green},{id:"task",label:"+ Task",color:B.orange}].map(btn=>(
              <button key={btn.id} onClick={()=>{setForm(btn.id);setVals({});setOpen(false);}}
                style={{ padding:"7px 14px", fontSize:12, fontWeight:700, background:btn.color, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", whiteSpace:"nowrap" }}>
                {btn.label}
              </button>
            ))}
          </div>
        )}
        <button onClick={()=>setOpen(o=>!o)}
          style={{ width:48, height:48, borderRadius:"50%", background:B.blue, color:"#fff", border:"none", fontSize:22, cursor:"pointer", boxShadow:"0 4px 14px rgba(59,130,246,0.45)", display:"flex", alignItems:"center", justifyContent:"center", transition:"transform 0.18s", transform:open?"rotate(45deg)":"none", animation:open?"none":"fab-pulse 2.5s ease-in-out infinite" }}>
          +
        </button>
      </div>
      {form && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setForm(null)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:12, padding:24, width:"min(360px,92vw)", boxShadow:"0 16px 40px rgba(0,0,0,0.18)", display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontWeight:700, fontSize:15 }}>Quick Add {form.charAt(0).toUpperCase()+form.slice(1)}</div>
              <button onClick={()=>setForm(null)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:B.muted }}>×</button>
            </div>
            {fields[form].map(f=>(
              <input key={f.k} type={f.t} placeholder={f.p} value={vals[f.k]||""} onChange={e=>setVals({...vals,[f.k]:e.target.value})}
                style={{ border:`1px solid ${B.border}`, borderRadius:6, padding:"8px 10px", fontSize:13, fontFamily:"inherit", outline:"none" }} />
            ))}
            <button onClick={submit} style={{ padding:"9px 0", background:B.blue, color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer" }}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── CollapsibleKPI ─────────────────────────────────────────────────────────────
function CollapsibleKPI({ label, value, sub, color, small, collapsed, onToggle, sparkData, trend, pinned, onPin, DM }) {
  const dm = DM || { card:"#fff", border:"#E2E8F0", text:"#1E293B", muted:"#64748B", light:"#F1F5F9" };
  const [hovered, setHovered] = useState(false);

  const SparkInline = ({ data, c }) => {
    if (!data?.length) return null;
    const w=56, h=22, max=Math.max(...data,1), min=Math.min(...data,0), range=max-min||1;
    const pts=data.map((v,i)=>{ const x=(i/(data.length-1))*w; const y=h-((v-min)/range)*(h-4)-2; return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
    return (
      <svg width={w} height={h} style={{ opacity:0.6, overflow:"visible" }}>
        <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  };

  return (
    <div onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{ background:dm.card, border:`1px solid ${dm.border}`, borderRadius:10, padding:small?"10px 14px":"14px 18px", borderTop:`3px solid ${color}`, minHeight:small?64:80, boxShadow:hovered?"0 6px 20px rgba(0,0,0,0.09)":"0 1px 3px rgba(0,0,0,0.04)", transform:hovered?"translateY(-2px)":"translateY(0)", transition:"box-shadow 0.18s,transform 0.18s", cursor:"default", userSelect:"none", position:"relative", overflow:"hidden" }}>
      {sparkData && !collapsed && (
        <div style={{ position:"absolute", right:8, bottom:8, pointerEvents:"none" }}>
          <SparkInline data={sparkData} c={color} />
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:collapsed?0:4 }}>
        <div style={{ fontSize:10, color:dm.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          {trend!==undefined && trend!==null && !collapsed && (
            <span style={{ fontSize:9, fontWeight:700, color:trend>=0?"#16A34A":"#E63946", background:(trend>=0?"#16A34A":"#E63946")+"15", borderRadius:20, padding:"1px 5px" }}>
              {trend>=0?"▲":"▼"} {Math.abs(trend)}%
            </span>
          )}
          {onPin && (
            <button onClick={e=>{e.stopPropagation();onPin();}}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:pinned?color:dm.muted, padding:"0 1px", lineHeight:1, opacity:hovered||pinned?1:0.4, transition:"opacity 0.15s" }}
              title={pinned?"Unpin":"Pin to top"}>📌</button>
          )}
          <button onClick={e=>{e.stopPropagation();onToggle();}}
            style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:dm.muted, padding:"0 2px", lineHeight:1 }}
            title={collapsed?"Expand":"Collapse"}>
            {collapsed?"▸":"▾"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={{ fontSize:small?18:22, fontWeight:800, color:dm.text, lineHeight:1, letterSpacing:"-0.5px", animation:"dash-count-up 0.35s ease" }}>{value}</div>
          {sub && <div style={{ fontSize:11, color:dm.muted, marginTop:5 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

// ── RecentLeadsList ────────────────────────────────────────────────────────────
function RecentLeadsList({ leads, DM }) {
  const [expanded, setExpanded] = useState(null);
  const dm = DM || { border:"#E2E8F0", muted:"#64748B", text:"#1E293B" };
  if (!leads.length) return <div style={{ padding:"12px 14px", fontSize:12, color:dm.muted }}>No leads yet</div>;
  return (
    <div>
      {leads.map(l=>{
        const isOpen=expanded===l.id;
        return (
          <div key={l.id} style={{ borderBottom:`1px solid ${dm.border}` }}>
            <div onClick={()=>setExpanded(isOpen?null:l.id)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", cursor:"pointer", minHeight:44, userSelect:"none" }}>
              <Avatar name={l.name} size={26} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:dm.text }}>{l.name}</div>
                <div style={{ fontSize:10, color:dm.muted }}>{l.service||"—"}</div>
              </div>
              <Badge label={l.status} />
              <span style={{ fontSize:11, fontWeight:700, color:dm.text, marginLeft:4 }}>{aed(l.value)}</span>
              <span style={{ fontSize:11, color:dm.muted, marginLeft:2 }}>{isOpen?"▴":"▾"}</span>
            </div>
            {isOpen && (
              <div style={{ padding:"8px 14px 12px 50px", display:"flex", gap:16, flexWrap:"wrap", background:B.blue+"06" }}>
                {l.source && <div style={{ fontSize:11 }}><span style={{ color:dm.muted }}>Source </span><span style={{ fontWeight:600, color:dm.text }}>{l.source}</span></div>}
                {l.date   && <div style={{ fontSize:11 }}><span style={{ color:dm.muted }}>Date </span><span style={{ fontWeight:600, color:dm.text }}>{l.date}</span></div>}
                {l.assignee && <div style={{ fontSize:11 }}><span style={{ color:dm.muted }}>Owner </span><span style={{ fontWeight:600, color:dm.text }}>{l.assignee}</span></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Delta({ delta, suffix="" }) {
  if (delta===null) return <span style={{ color:B.muted }}>No prior data</span>;
  const isPos=delta>=0, color=isPos?B.green:B.red, bg=(isPos?B.green:B.red)+"18";
  return (
    <span style={{ color, fontWeight:700, fontSize:10, background:bg, borderRadius:20, padding:"2px 7px", display:"inline-block" }}>
      {isPos?"▲":"▼"} {Math.abs(delta)}%{suffix}
    </span>
  );
}
