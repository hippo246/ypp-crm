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
  const [activeWidgets, setActiveWidgets] = useState(["progress","workload"]);

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

  const maxServiceVal = Math.max(...revenueByService.map((r) => r.val), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QuickActionsBar data={data} setData={setData} />
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
        @media (max-width: 700px)  { .kpi-grid-5 { grid-template-columns: repeat(2,1fr) !important; } .kpi-grid-3 { grid-template-columns: 1fr !important; } .dash-mid-row { grid-template-columns: 1fr !important; } .dash-bottom-row { grid-template-columns: 1fr !important; } }
        .kpi-drag-card { cursor: grab; transition: opacity 0.15s, box-shadow 0.15s; }
        .kpi-drag-card:active { cursor: grabbing; }
      `}</style>

      {/* Primary KPI grid */}
      {(() => {
        const primary = ["revenue","outstanding","clients","leads","tasks"];
        const kpiDefs = {
          revenue:     { label:"Total Revenue",    value:`AED ${(kpis.totalRevenue/1000).toFixed(1)}K`, sub:<Delta delta={mom.delta} />, color:B.blue },
          outstanding: { label:"Outstanding",      value:`AED ${(kpis.outstanding/1000).toFixed(1)}K`,  sub:`${kpis.overdueCount} overdue`, color:B.red },
          clients:     { label:"Active Clients",   value:kpis.activeClients, sub:kpis.expiringClients>0?`⚠ ${kpis.expiringClients} renewing soon`:"all good", color:B.green },
          leads:       { label:"Open Leads",       value:kpis.openLeads,     sub:<Delta delta={momLeads.delta} suffix=" vs last mo" />, color:B.yellow },
          tasks:       { label:"Pending Tasks",    value:kpis.pendingTasks,  sub:kpis.highPriorityTasks>0?`${kpis.highPriorityTasks} high priority`:"no urgent items", color:B.orange },
          collection:  { label:"Collection Rate",  value:`${kpis.collectionRate}%`, sub:"of invoiced amount", color:B.accent, small:true },
          conversion:  { label:"Conversion Rate",  value:`${kpis.conversionRate}%`, sub:"leads → won", color:B.green, small:true },
          wonValue:    { label:"Won Value (Total)", value:aed(kpis.wonValue), sub:"all time", color:B.blue, small:true },
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
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:12, padding:24, width:420, boxShadow:"0 16px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>Add Widget</div>
              <button onClick={() => setWidgetPickerOpen(false)} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:B.muted }}>×</button>
            </div>
            {[
              { id:"progress",  icon:"◎", label:"Task Progress",       desc:"Overall completion ring + by assignee/priority" },
              { id:"workload",  icon:"▤", label:"Workload Mini-Chart",  desc:"Horizontal bars per team member" },
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
      {(activeWidgets.includes("progress") || activeWidgets.includes("workload")) && (
        <div style={{ display:"grid", gridTemplateColumns: activeWidgets.length===2?"1fr 1fr":"1fr", gap:14 }}>
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
        </div>
      )}

      {/* Mid row */}
      <div className="dash-mid-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionCard title="Recent Leads">
          <NTable
            cols={[
              { key: "name", label: "Name", render: (v) => <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={v} size={24} />{v}</div> },
              { key: "service", label: "Service" },
              { key: "status", label: "Status", render: (v) => <Badge label={v} /> },
              { key: "value", label: "Value", render: (v) => aed(v) },
            ]}
            rows={recentLeads}
          />
        </SectionCard>

        <SectionCard title="Pending Tasks">
          <div style={{ padding: "4px 0" }}>
            {pendingTaskList.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: `1px solid ${B.border}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.priority === "High" ? B.red : t.priority === "Medium" ? B.yellow : B.green, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 12 }}>{t.title}</div>
                <Badge label={t.priority} />
                <span style={{ fontSize: 11, color: B.muted }}>{t.due}</span>
              </div>
            ))}
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
        {open && (
          <div style={{ display: "flex", gap: 8, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 12, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
            {actionBtns.map(btn => (
              <button key={btn.id} onClick={() => { setForm(btn.id); setVals({}); setOpen(false); }}
                style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, background: btn.color, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
                {btn.label}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setOpen(o => !o)}
          style={{ width: 48, height: 48, borderRadius: "50%", background: B.blue, color: "#fff", border: "none", fontSize: 22, cursor: "pointer", boxShadow: "0 4px 14px rgba(59,130,246,0.45)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.18s", transform: open ? "rotate(45deg)" : "none" }}>
          +
        </button>
      </div>

      {/* Quick-add form modal */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setForm(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: 360, boxShadow: "0 16px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 12 }}>
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

// ─── Collapsible KPI card (new) ────────────────────────────────────────────────

function CollapsibleKPI({ label, value, sub, color, small, collapsed, onToggle }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${B.border}`, borderRadius: 10,
      padding: small ? "10px 14px" : "14px 18px", borderTop: `3px solid ${color}`,
      transition: "box-shadow 0.18s, transform 0.18s", cursor: "default",
      userSelect: "none",
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.08)"; e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; e.currentTarget.style.transform="translateY(0)"; }}
    >
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: collapsed ? 0 : 4 }}>
        <div style={{ fontSize:10, color:B.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
        <button onClick={e => { e.stopPropagation(); onToggle(); }}
          style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:B.muted, padding:"0 2px", lineHeight:1 }}
          title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div style={{ fontSize: small ? 18 : 22, fontWeight:800, color:B.text, lineHeight:1 }}>{value}</div>
          {sub && <div style={{ fontSize:11, color:B.muted, marginTop:5 }}>{sub}</div>}
        </>
      )}
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
