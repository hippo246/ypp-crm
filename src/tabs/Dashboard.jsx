import { useMemo, useState, useCallback } from "react";
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

export default function Dashboard() {
  const { data, setData } = useAppData();
  const { accounting = [], clients = [], leads = [], tasks = [], inventory = [] } = data;

  const kpis = useMemo(() => getDashboardKPIs(data), [data]);
  const mom = useMemo(() => getMoMRevenue(accounting), [accounting]);
  const momLeads = useMemo(() => getMoMLeads(leads), [leads]);
  const pipelineStats = useMemo(() => getPipelineStats(leads), [leads]);
  const revenueByService = useMemo(() => getRevenueByService(accounting, clients), [accounting, clients]);
  const overdueList = useMemo(() => getOverdueInvoices(accounting), [accounting]);

  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5),
    [leads]);
  const pendingTaskList = useMemo(() =>
    tasks.filter((t) => t.status !== "Done").slice(0, 5),
    [tasks]);

  // ── New: KPI card collapse / order state ────────────────────────────────────
  const KPI_IDS = ["revenue","outstanding","clients","leads","tasks","collection","conversion","wonValue"];
  const [collapsed, setCollapsed] = useState({});
  const [cardOrder, setCardOrder] = useState(KPI_IDS);
  const [dragOver, setDragOver] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState(["progress","workload","delay","productivity"]);

  const toggleCollapse = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

  const onDragStart = (id) => setDragId(id);
  const onDragOver  = (e, id) => { e.preventDefault(); setDragOver(id); };
  const onDrop      = (targetId) => {
    if (!dragId || dragId === targetId) { setDragOver(null); setDragId(null); return; }
    const next = [...cardOrder];
    const from = next.indexOf(dragId), to = next.indexOf(targetId);
    next.splice(from, 1); next.splice(to, 0, dragId);
    setCardOrder(next);
    setDragOver(null); setDragId(null);
  };

  // ── New: progress analytics ──────────────────────────────────────────────────
  const progressData = useMemo(() => {
    const total = tasks.length || 1;
    const done  = tasks.filter(t => t.status === "Done").length;
    const pct   = Math.round((done / total) * 100);
    const byAssignee = [...new Set(tasks.map(t => t.assigned).filter(Boolean))].map(name => {
      const mt = tasks.filter(t => t.assigned === name);
      const d  = mt.filter(t => t.status === "Done").length;
      return { name, pct: mt.length ? Math.round((d/mt.length)*100) : 0, done: d, total: mt.length };
    }).sort((a,b) => b.pct - a.pct);
    const byPriority = ["High","Medium","Low"].map(p => {
      const pt = tasks.filter(t => t.priority === p);
      const pd = pt.filter(t => t.status === "Done").length;
      return { label: p, pct: pt.length ? Math.round((pd/pt.length)*100) : 0, done: pd, total: pt.length };
    });
    return { total, done, pct, byAssignee, byPriority };
  }, [tasks]);

  // ── New: workload mini data ──────────────────────────────────────────────────
  const workloadMini = useMemo(() => {
    const members = [...new Set(tasks.map(t => t.assigned).filter(Boolean))];
    const today = new Date().toISOString().slice(0,10);
    return members.map(name => ({
      name,
      open:    tasks.filter(t => t.assigned===name && t.status!=="Done").length,
      overdue: tasks.filter(t => t.assigned===name && t.status!=="Done" && t.due && t.due<today).length,
    })).sort((a,b) => b.open - a.open).slice(0,6);
  }, [tasks]);
  const maxWorkload = Math.max(...workloadMini.map(w=>w.open), 1);

  const delayData = useMemo(() => {
    const today = new Date().toISOString().slice(0,10);
    const overdueTasks = tasks.filter(t => t.status !== "Done" && t.due && t.due < today);
    const byAssignee = [...new Set(overdueTasks.map(t => t.assigned).filter(Boolean))].map(name => ({
      name,
      count: overdueTasks.filter(t => t.assigned === name).length,
    })).sort((a,b) => b.count - a.count);
    return { total: overdueTasks.length, byAssignee, items: overdueTasks.slice(0, 5) };
  }, [tasks]);

  const productivityData = useMemo(() => {
    const now = new Date();
    const weeks = Array.from({ length: 6 }, (_, i) => {
      const end   = new Date(now); end.setDate(end.getDate() - i * 7);
      const start = new Date(end); start.setDate(start.getDate() - 7);
      const label = `W-${i}`;
      const done = tasks.filter(t => {
        if (t.status !== "Done" || !t.due) return false;
        const d = new Date(t.due);
        return d >= start && d < end;
      }).length;
      return { label, done };
    }).reverse();
    return { weeks, sparkDone: weeks.map(w => w.done) };
  }, [tasks]);

  const maxServiceVal = Math.max(...revenueByService.map((r) => r.val), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QuickActionsBar data={data} setData={setData} />

      {/* Today's Summary Bar */}
      {(() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const dueTodayTasks = tasks.filter(t => t.due === todayStr && t.status !== "Done");
        const dueTodayInvoices = accounting.filter(i => i.due === todayStr && i.status !== "Paid");
        const renewingToday = clients.filter(c => c.renewal === todayStr);
        const items = [
          ...dueTodayTasks.map(t => ({ icon: "📋", text: t.title, color: B.orange, label: "Task due" })),
          ...dueTodayInvoices.map(i => ({ icon: "💸", text: `${i.client} — ${aed(i.amount)}`, color: B.red, label: "Invoice due" })),
          ...renewingToday.map(c => ({ icon: "🔄", text: c.name, color: B.accent, label: "Renewal" })),
        ];
        if (items.length === 0) return null;
        return (
          <div style={{ background: "linear-gradient(135deg, #1E40AF08, #7C3AED08)", border: `1px solid ${B.blue}20`, borderRadius: 10, padding: "10px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: B.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📅 Today — {new Date().toLocaleDateString("en-AE", { weekday: "long", month: "short", day: "numeric" })}</div>
            <div className="today-items" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {items.slice(0, 6).map((item, i) => (
                <div key={i} className="today-item" style={{ display: "flex", alignItems: "center", gap: 6, background: item.color + "10", border: `1px solid ${item.color}25`, borderRadius: 20, padding: "4px 10px", fontSize: 11 }}>
                  <span>{item.icon}</span>
                  <span style={{ fontWeight: 600, color: item.color, fontSize: 10 }}>{item.label}</span>
                  <span style={{ color: B.text, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.text}</span>
                </div>
              ))}
              {items.length > 6 && <div style={{ fontSize: 11, color: B.muted, padding: "4px 0" }}>+{items.length - 6} more</div>}
            </div>
          </div>
        );
      })()}
      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div style={{
          background: B.red + "0f", border: `1px solid ${B.red}40`,
          borderLeft: `4px solid ${B.red}`,
          borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
          boxShadow: `0 2px 8px ${B.red}18`,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: B.red, lineHeight: 1.3 }}>
              {overdueList.length} overdue invoice{overdueList.length > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 11, color: B.red, opacity: 0.75, marginTop: 2 }}>
              {aed(overdueList.reduce((s, i) => s + (i.amount - i.paid), 0))} outstanding — action required
            </div>
          </div>
        </div>
      )}

      {/* KPI cards — collapsible + reorderable */}
      <style>{`
        @media (max-width: 1100px) { .kpi-grid-5 { grid-template-columns: repeat(3,1fr) !important; } }
        @media (max-width: 700px)  { .kpi-grid-5 { grid-template-columns: repeat(2,1fr) !important; } .kpi-grid-3 { grid-template-columns: repeat(2,1fr) !important; } .dash-mid-row { grid-template-columns: 1fr !important; } .dash-bottom-row { grid-template-columns: 1fr !important; } .dash-widgets { grid-template-columns: 1fr !important; } }
        @media (max-width: 480px)  { .kpi-grid-5 { grid-template-columns: repeat(2,1fr) !important; } .kpi-grid-3 { grid-template-columns: repeat(2,1fr) !important; } .kpi-drag-card { min-height: 64px; } .fab-actions { flex-direction: column !important; align-items: flex-end !important; } .today-items { flex-direction: column !important; } .today-item { width: 100% !important; box-sizing: border-box; } }
        .kpi-drag-card { cursor: grab; transition: opacity 0.15s, box-shadow 0.15s; }
        .kpi-drag-card:active { cursor: grabbing; }
      `}</style>

      {/* Primary KPI grid */}
      {(() => {
        const primary = ["revenue","outstanding","clients","leads","tasks"];
        const kpiDefs = {
          revenue:     { label:"Total Revenue",    value:`AED ${(kpis.totalRevenue/1000).toFixed(1)}K`, sub:<Delta delta={mom.delta} />, color:B.blue, sparkData:mom.history, trend:mom.delta },
          outstanding: { label:"Outstanding",      value:`AED ${(kpis.outstanding/1000).toFixed(1)}K`,  sub:`${kpis.overdueCount} overdue`, color:B.red, sparkData:null, trend:null },
          clients:     { label:"Active Clients",   value:kpis.activeClients, sub:kpis.expiringClients>0?`⚠ ${kpis.expiringClients} renewing soon`:"all good", color:B.green, sparkData:null, trend:null },
          leads:       { label:"Open Leads",       value:kpis.openLeads,     sub:<Delta delta={momLeads.delta} suffix=" vs last mo" />, color:B.yellow, sparkData:momLeads.history, trend:momLeads.delta },
          tasks:       { label:"Pending Tasks",    value:kpis.pendingTasks,  sub:kpis.highPriorityTasks>0?`${kpis.highPriorityTasks} high priority`:"no urgent items", color:B.orange, sparkData:null, trend:null },
          collection:  { label:"Collection Rate",  value:`${kpis.collectionRate}%`, sub:"of invoiced amount", color:B.accent, small:true, sparkData:null, trend:null },
          conversion:  { label:"Conversion Rate",  value:`${kpis.conversionRate}%`, sub:"leads → won", color:B.green, small:true, sparkData:null, trend:null },
          wonValue:    { label:"Won Value (Total)", value:aed(kpis.wonValue), sub:"all time", color:B.blue, small:true, sparkData:null, trend:null },
        };
        const orderedPrimary = cardOrder.filter(id => primary.includes(id));
        return (
          <div className="kpi-grid-5" style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
            {orderedPrimary.map(id => {
              const def = kpiDefs[id];
              return (
                <div key={id} className="kpi-drag-card"
                  draggable onDragStart={() => onDragStart(id)} onDragOver={e => onDragOver(e,id)} onDrop={() => onDrop(id)} onDragEnd={() => {setDragId(null);setDragOver(null);}}
                  style={{ opacity: dragId===id ? 0.5 : 1, outline: dragOver===id ? `2px dashed ${B.blue}` : "none", borderRadius:10 }}>
                  <CollapsibleKPI {...def} collapsed={collapsed[id]} onToggle={() => toggleCollapse(id)} />
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
          conversion: { label:"Conversion Rate",  value:`${kpis.conversionRate}%`, sub:"leads → won", color:B.green, small:true },
          wonValue:   { label:"Won Value (Total)", value:aed(kpis.wonValue), sub:"all time", color:B.blue, small:true },
        };
        const orderedSec = cardOrder.filter(id => secondary.includes(id));
        return (
          <div className="kpi-grid-3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            {orderedSec.map(id => {
              const def = kpiDefs[id];
              return (
                <div key={id} className="kpi-drag-card"
                  draggable onDragStart={() => onDragStart(id)} onDragOver={e => onDragOver(e,id)} onDrop={() => onDrop(id)} onDragEnd={() => {setDragId(null);setDragOver(null);}}
                  style={{ opacity: dragId===id?0.5:1, outline: dragOver===id?`2px dashed ${B.blue}`:"none", borderRadius:10 }}>
                  <CollapsibleKPI {...def} collapsed={collapsed[id]} onToggle={() => toggleCollapse(id)} />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Add Widget bar ── */}
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        <button onClick={() => setWidgetPickerOpen(true)}
          style={{ padding:"6px 16px", fontSize:12, fontWeight:700, background:B.white, border:`1px solid ${B.border}`, borderRadius:8, cursor:"pointer", color:B.muted, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:16 }}>⊞</span> Add Widget
        </button>
      </div>

      {/* Widget picker modal */}
      {widgetPickerOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setWidgetPickerOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:12, padding:24, width:"min(420px, 92vw)", boxShadow:"0 16px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>Add Widget</div>
              <button onClick={() => setWidgetPickerOpen(false)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:B.muted }}>×</button>
            </div>
            {[
              { id:"progress",     icon:"◎", label:"Task Progress",        desc:"Overall completion ring + by assignee/priority" },
              { id:"workload",     icon:"▤", label:"Workload Chart",        desc:"Horizontal bars per team member" },
              { id:"delay",        icon:"⏰", label:"Delay Report",         desc:"Overdue tasks grouped by owner" },
              { id:"productivity", icon:"📈", label:"Productivity Tracker", desc:"Tasks closed per week — last 6 weeks" },
            ].map(w => {
              const active = activeWidgets.includes(w.id);
              return (
                <div key={w.id} onClick={() => setActiveWidgets(aw => active ? aw.filter(x=>x!==w.id) : [...aw, w.id])}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:8, border:`1px solid ${active?B.blue:B.border}`, marginBottom:8, cursor:"pointer", background:active?B.blue+"0a":"#fff" }}>
                  <span style={{ fontSize:20, color:active?B.blue:B.muted }}>{w.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:active?B.blue:B.text }}>{w.label}</div>
                    <div style={{ fontSize:11, color:B.muted }}>{w.desc}</div>
                  </div>
                  <span style={{ fontSize:12, color:active?B.blue:B.muted }}>{active?"✓ On":"+ Add"}</span>
                </div>
              );
            })}
            <button onClick={() => setWidgetPickerOpen(false)} style={{ marginTop:8, width:"100%", padding:"9px 0", background:B.blue, color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer" }}>Done</button>
          </div>
        </div>
      )}

      {/* ── Optional Widgets row ── */}
      {activeWidgets.length > 0 && (
        <div className="dash-widgets" style={{ display:"grid", gridTemplateColumns: activeWidgets.length >= 2 ? "1fr 1fr" : "1fr", gap:14 }}>
          {activeWidgets.includes("progress") && (
            <SectionCard title="Task Progress Analytics">
              <div style={{ padding:"14px", display:"flex", gap:20, alignItems:"flex-start", flexWrap:"wrap" }}>
                {/* Completion ring */}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                  <svg viewBox="0 0 80 80" style={{ width:80, height:80 }}>
                    <circle cx="40" cy="40" r="30" fill="none" stroke={B.light} strokeWidth="10" />
                    <circle cx="40" cy="40" r="30" fill="none" stroke={B.green} strokeWidth="10"
                      strokeDasharray={`${progressData.pct * 1.885} 188.5`}
                      strokeLinecap="round" transform="rotate(-90 40 40)" />
                    <text x="40" y="45" textAnchor="middle" fontSize="14" fontWeight="800" fill={B.text}>{progressData.pct}%</text>
                  </svg>
                  <div style={{ fontSize:10, color:B.muted }}>{progressData.done}/{progressData.total} done</div>
                </div>
                {/* By assignee */}
                <div style={{ flex:1, minWidth:160 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:B.muted, marginBottom:6 }}>BY ASSIGNEE</div>
                  {progressData.byAssignee.slice(0,5).map(a => (
                    <div key={a.name} style={{ marginBottom:7 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                        <span style={{ color:B.text, fontWeight:500 }}>{a.name}</span>
                        <span style={{ color:B.muted }}>{a.done}/{a.total}</span>
                      </div>
                      <div style={{ height:6, background:B.light, borderRadius:3 }}>
                        <div style={{ width:`${a.pct}%`, height:"100%", background:a.pct>70?B.green:B.orange, borderRadius:3, transition:"width 0.5s" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* By priority */}
                <div style={{ minWidth:130 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:B.muted, marginBottom:6 }}>BY PRIORITY</div>
                  {progressData.byPriority.map((p,i) => (
                    <div key={p.label} style={{ marginBottom:7 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                        <span style={{ color:B.text, fontWeight:500 }}>{p.label}</span>
                        <span style={{ fontWeight:700, color:[B.red,B.yellow,B.green][i] }}>{p.pct}%</span>
                      </div>
                      <div style={{ height:6, background:B.light, borderRadius:3 }}>
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
                {workloadMini.map((w,i) => (
                  <div key={w.name} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                      <span style={{ fontWeight:600 }}>{w.name}</span>
                      <div style={{ display:"flex", gap:8, fontSize:11 }}>
                        <span style={{ color:B.blue }}>{w.open} open</span>
                        {w.overdue>0 && <span style={{ color:B.red, fontWeight:700 }}>⚠ {w.overdue}</span>}
                      </div>
                    </div>
                    <div style={{ display:"flex", height:10, background:B.light, borderRadius:5, overflow:"hidden" }}>
                      <div style={{ width:`${((w.open-w.overdue)/maxWorkload)*100}%`, background:B.blue, transition:"width 0.4s" }} />
                      <div style={{ width:`${(w.overdue/maxWorkload)*100}%`, background:B.red, opacity:0.8 }} />
                    </div>
                  </div>
                ))}
                {workloadMini.length===0 && <div style={{ fontSize:12, color:B.muted }}>No tasks assigned yet.</div>}
              </div>
            </SectionCard>
          )}
          {activeWidgets.includes("delay") && (
            <SectionCard title="Delay Report" accent={B.red}>
              <div style={{ padding:14 }}>
                {delayData.total === 0 ? (
                  <div style={{ fontSize:12, color:B.muted }}>🎉 No overdue tasks!</div>
                ) : (
                  <>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                      <span style={{ fontSize:28, fontWeight:800, color:B.red }}>{delayData.total}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:700, color:B.red }}>Overdue tasks</div>
                        <div style={{ fontSize:10, color:B.muted }}>Across {delayData.byAssignee.length} team member{delayData.byAssignee.length !== 1 ? "s" : ""}</div>
                      </div>
                    </div>
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:B.muted, letterSpacing:"0.6px", textTransform:"uppercase", marginBottom:6 }}>By assignee</div>
                      {delayData.byAssignee.map(a => (
                        <div key={a.name} style={{ marginBottom:6 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                            <span style={{ fontWeight:600 }}>{a.name}</span>
                            <span style={{ fontWeight:700, color:B.red }}>{a.count} overdue</span>
                          </div>
                          <div style={{ height:5, background:B.light, borderRadius:3, overflow:"hidden" }}>
                            <div style={{ width:`${(a.count/delayData.total)*100}%`, height:"100%", background:B.red, borderRadius:3 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6 }}>Recent overdue</div>
                    {delayData.items.map(t => {
                      const daysLate = Math.floor((new Date() - new Date(t.due)) / 86_400_000);
                      return (
                        <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:`1px solid ${B.border}` }}>
                          <div style={{ width:6, height:6, borderRadius:"50%", background:B.red, flexShrink:0 }} />
                          <div style={{ flex:1, fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.title}</div>
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
                <div style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:10 }}>Tasks completed per week (last 6)</div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:72 }}>
                  {productivityData.weeks.map((w,i) => {
                    const max = Math.max(...productivityData.weeks.map(x => x.done), 1);
                    const pct = (w.done / max) * 100;
                    const isLast = i === productivityData.weeks.length - 1;
                    return (
                      <div key={w.label} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3, height:"100%", justifyContent:"flex-end" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:isLast?B.blue:B.text }}>{w.done}</div>
                        <div style={{ width:"100%", borderRadius:"4px 4px 0 0", height:`${Math.max(pct,4)}%`, background:isLast?`linear-gradient(180deg,${B.blue},${B.accent})`:B.border, transition:"height 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
                        <div style={{ fontSize:9, color:B.muted }}>{w.label}</div>
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const last2 = productivityData.weeks.slice(-2);
                  if (last2.length < 2 || last2[0].done === 0) return null;
                  const change = last2[1].done - last2[0].done;
                  if (change === 0) return <div style={{ marginTop:12, fontSize:11, color:B.muted }}>No change vs last week</div>;
                  const pct = Math.round(Math.abs(change / last2[0].done) * 100);
                  return (
                    <div style={{ marginTop:12, fontSize:11 }}>
                      {change > 0
                        ? <span style={{ color:B.green, fontWeight:700 }}>▲ {pct}% vs last week</span>
                        : <span style={{ color:B.red, fontWeight:700 }}>▼ {pct}% vs last week</span>}
                    </div>
                  );
                })()}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* Mid row */}
      <div className="dash-mid-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionCard title="Recent Leads">
          <RecentLeadsList leads={recentLeads} />
        </SectionCard>

        <SectionCard title="Pending Tasks">
          <div style={{ padding: "4px 0" }}>
            {pendingTaskList.map((t) => {
              const statusCycle = { "Pending": "In Progress", "In Progress": "Done", "Done": "Pending" };
              const statusColor = { "Pending": B.muted, "In Progress": B.blue, "Done": B.green };
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${B.border}`, minHeight: 44 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.priority === "High" ? B.red : t.priority === "Medium" ? B.yellow : B.green, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12 }}>{t.title}</div>
                  <button
                    onClick={() => {
                      const next = statusCycle[t.status] || "Pending";
                      setData(d => ({ ...d, tasks: d.tasks.map(x => x.id === t.id ? { ...x, status: next } : x) }));
                    }}
                    style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 12, border: `1px solid ${statusColor[t.status] || B.muted}40`, background: (statusColor[t.status] || B.muted) + "15", color: statusColor[t.status] || B.muted, cursor: "pointer", whiteSpace: "nowrap", minHeight: 28 }}
                  >{t.status || "Pending"}</button>
                  <span style={{ fontSize: 11, color: B.muted }}>{t.due}</span>
                </div>
              );
            })}
            {pendingTaskList.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>All tasks complete 🎉</div>}
          </div>
        </SectionCard>
      </div>

      {/* Bottom row */}
      <div className="dash-bottom-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Inventory alerts */}
        <SectionCard title="Inventory Alerts">
          {inventory.filter((i) => i.status !== "In Stock").length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>All items in stock</div>
          ) : (
            inventory.filter((i) => i.status !== "In Stock").map((i) => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${B.border}` }}>
                <span style={{ fontSize: 12 }}>{i.name}</span>
                <Badge label={i.status} />
              </div>
            ))
          )}
        </SectionCard>

        {/* Revenue by service — LIVE */}
        <SectionCard title="Revenue by Service">
          {revenueByService.slice(0, 5).map((r) => (
            <div key={r.label} style={{ padding: "8px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: B.muted }}>{r.label}</span>
                <span style={{ fontWeight: 600 }}>{aed(r.val)}</span>
              </div>
              <div style={{ height: 6, background: B.light, borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${(r.val / maxServiceVal) * 100}%`,
                  background: `linear-gradient(90deg, ${B.blue}, ${B.accent})`,
                  borderRadius: 3,
                  transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>
            </div>
          ))}
          {revenueByService.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>No revenue data yet</div>}
        </SectionCard>

        {/* Lead pipeline — LIVE */}
        <SectionCard title="Lead Pipeline">
          {pipelineStats.map((s) => (
            <div key={s.stage} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${B.border}` }}>
              <Badge label={s.stage} />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.count}</span>
                <span style={{ fontSize: 11, color: B.muted }}>{aed(s.value)}</span>
              </div>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Quick Actions Floating Bar ────────────────────────────────────────────────

function QuickActionsBar({ data, setData }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null); // "lead" | "invoice" | "task"
  const [vals, setVals] = useState({});

  const submit = () => {
    if (form === "lead") {
      setData({ ...data, leads: [...data.leads, { id: `L${Date.now()}`, name: vals.name || "New Lead", service: vals.service || "", status: "New", value: Number(vals.value) || 0, source: "Other", date: new Date().toISOString().slice(0,10), updatedAt: new Date().toISOString().slice(0,10) }] });
    } else if (form === "invoice") {
      setData({ ...data, accounting: [...data.accounting, { id: `INV${Date.now()}`, client: vals.client || "Client", desc: vals.desc || "", amount: Number(vals.amount) || 0, vatRate: 5, paid: 0, status: "Unpaid", date: new Date().toISOString().slice(0,10), due: vals.due || "" }] });
    } else if (form === "task") {
      setData({ ...data, tasks: [...data.tasks, { id: `T${Date.now()}`, title: vals.title || "New Task", assigned: "", priority: "Medium", status: "Pending", due: vals.due || "", ref: "" }] });
    }
    setForm(null); setVals({});
  };

  const fields = {
    lead: [{ k: "name", p: "Lead name", t: "text" }, { k: "service", p: "Service", t: "text" }, { k: "value", p: "Value (AED)", t: "number" }],
    invoice: [{ k: "client", p: "Client name", t: "text" }, { k: "desc", p: "Description", t: "text" }, { k: "amount", p: "Amount (AED)", t: "number" }, { k: "due", p: "Due date", t: "date" }],
    task: [{ k: "title", p: "Task title", t: "text" }, { k: "due", p: "Due date", t: "date" }],
  };

  const actionBtns = [
    { id: "lead", label: "+ Lead", color: B.blue },
    { id: "invoice", label: "+ Invoice", color: B.green },
    { id: "task", label: "+ Task", color: B.orange },
  ];

  return (
    <>
      {/* Floating trigger */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 500, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        <style>{`
          @keyframes fab-pulse {
            0%, 100% { box-shadow: 0 4px 14px rgba(59,130,246,0.45); }
            50%       { box-shadow: 0 4px 24px rgba(59,130,246,0.75); }
          }
        `}</style>
        {open && (
          <div className="fab-actions" style={{ display: "flex", gap: 8, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 12, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
            {actionBtns.map(btn => (
              <button key={btn.id} onClick={() => { setForm(btn.id); setVals({}); setOpen(false); }}
                style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, background: btn.color, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                {btn.label}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setOpen(o => !o)}
          style={{ width: 48, height: 48, borderRadius: "50%", background: B.blue, color: "#fff", border: "none", fontSize: 22, cursor: "pointer", boxShadow: "0 4px 14px rgba(59,130,246,0.45)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.18s", transform: open ? "rotate(45deg)" : "none", animation: open ? "none" : "fab-pulse 2.5s ease-in-out infinite" }}>
          +
        </button>
      </div>

      {/* Quick-add form modal */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setForm(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(360px, 92vw)", boxShadow: "0 16px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Quick Add {form.charAt(0).toUpperCase() + form.slice(1)}</div>
              <button onClick={() => setForm(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: B.muted }}>×</button>
            </div>
            {fields[form].map(f => (
              <input key={f.k} type={f.t} placeholder={f.p} value={vals[f.k] || ""}
                onChange={e => setVals({ ...vals, [f.k]: e.target.value })}
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            ))}
            <button onClick={submit}
              style={{ padding: "9px 0", background: B.blue, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Collapsible KPI card (upgraded) ─────────────────────────────────────────

function CollapsibleKPI({ label, value, sub, color, small, collapsed, onToggle, sparkData, trend }) {
  const [hovered, setHovered] = useState(false);

  const SparkInline = ({ data, c }) => {
    if (!data?.length) return null;
    const w = 56, h = 22;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return (
      <svg width={w} height={h} style={{ opacity:0.6, overflow:"visible" }}>
        <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:"#fff", border:`1px solid #E2E8F0`, borderRadius:10,
        padding: small ? "10px 14px" : "14px 18px", borderTop:`3px solid ${color}`,
        minHeight: small ? 64 : 80,
        boxShadow: hovered ? "0 6px 20px rgba(0,0,0,0.09)" : "0 1px 3px rgba(0,0,0,0.04)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        transition:"box-shadow 0.18s, transform 0.18s",
        cursor:"default", userSelect:"none", position:"relative", overflow:"hidden",
      }}
    >
      {sparkData && !collapsed && (
        <div style={{ position:"absolute", right:8, bottom:8, pointerEvents:"none" }}>
          <SparkInline data={sparkData} c={color} />
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: collapsed ? 0 : 4 }}>
        <div style={{ fontSize:10, color:"#64748B", fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          {trend !== undefined && trend !== null && !collapsed && (
            <span style={{ fontSize:9, fontWeight:700, color:trend>=0?"#16A34A":"#E63946", background:(trend>=0?"#16A34A":"#E63946")+"15", borderRadius:20, padding:"1px 5px" }}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
          <button onClick={e => { e.stopPropagation(); onToggle(); }}
            style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#64748B", padding:"0 2px", lineHeight:1 }}
            title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={{ fontSize: small ? 18 : 22, fontWeight:800, color:"#1E293B", lineHeight:1, letterSpacing:"-0.5px" }}>{value}</div>
          {sub && <div style={{ fontSize:11, color:"#64748B", marginTop:5 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

// ─── Recent Leads — tap-to-expand list ───────────────────────────────────────

function RecentLeadsList({ leads }) {
  const [expanded, setExpanded] = useState(null);
  if (!leads.length) return <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>No leads yet</div>;
  return (
    <div>
      {leads.map(l => {
        const isOpen = expanded === l.id;
        return (
          <div key={l.id} style={{ borderBottom: `1px solid ${B.border}` }}>
            <div
              onClick={() => setExpanded(isOpen ? null : l.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", minHeight: 44, userSelect: "none" }}
            >
              <Avatar name={l.name} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                <div style={{ fontSize: 10, color: B.muted }}>{l.service || "—"}</div>
              </div>
              <Badge label={l.status} />
              <span style={{ fontSize: 11, fontWeight: 700, color: B.text, marginLeft: 4 }}>{aed(l.value)}</span>
              <span style={{ fontSize: 11, color: B.muted, marginLeft: 2 }}>{isOpen ? "▴" : "▾"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "8px 14px 12px 50px", display: "flex", gap: 16, flexWrap: "wrap", background: B.blue + "06" }}>
                {l.source && <div style={{ fontSize: 11 }}><span style={{ color: B.muted }}>Source </span><span style={{ fontWeight: 600 }}>{l.source}</span></div>}
                {l.date   && <div style={{ fontSize: 11 }}><span style={{ color: B.muted }}>Date </span><span style={{ fontWeight: 600 }}>{l.date}</span></div>}
                {l.assignee && <div style={{ fontSize: 11 }}><span style={{ color: B.muted }}>Owner </span><span style={{ fontWeight: 600 }}>{l.assignee}</span></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Local components ──────────────────────────────────────────────────────────

function StatKPI({ label, value, sub, color, small }) {
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${B.border}`,
      borderRadius: 10,
      padding: small ? "12px 16px" : "16px 20px",
      borderTop: `3px solid ${color}`,
      transition: "box-shadow 0.18s, transform 0.18s",
      cursor: "default",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 22, fontWeight: 800, color: B.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: B.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Delta({ delta, suffix = "" }) {
  if (delta === null) return <span style={{ color: B.muted }}>No prior month data</span>;
  const isPos = delta >= 0;
  const color = isPos ? B.green : B.red;
  const bg = isPos ? B.green + "18" : B.red + "18";
  const arrow = isPos ? "▲" : "▼";
  return (
    <span style={{
      color, fontWeight: 700, fontSize: 10,
      background: bg, borderRadius: 20, padding: "2px 7px",
      display: "inline-block", letterSpacing: 0.3,
    }}>
      {arrow} {Math.abs(delta)}%{suffix}
    </span>
  );
}
