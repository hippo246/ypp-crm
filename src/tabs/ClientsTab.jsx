import { useState, useMemo } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId } from "../helpers";
import { useAppData } from "../context/AppContext";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "name", label: "Company Name", placeholder: "Company LLC" },
  { key: "contact", label: "Contact Person" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "service", label: "Service", type: "select", options: ["Business License", "Employment Visa", "Business Setup", "Freezone License", "UAE Visa"] },
  { key: "licenseNumber", label: "License / Visa Number", placeholder: "Optional" },
  { key: "status", label: "Status", type: "select", options: ["Active", "Pending", "Expired"] },
  { key: "value", label: "Contract Value (AED)", type: "number" },
  { key: "renewal", label: "Renewal Date", type: "date" },
  { key: "progress", label: "Progress %", type: "number", placeholder: "0-100" },
  { key: "notes", label: "Notes", placeholder: "Internal notes" },
];

function getRenewalStatus(renewal) {
  if (!renewal) return null;
  const diff = (new Date(renewal) - new Date()) / 86_400_000;
  if (diff < 0) return { label: "Expired", color: B.red };
  if (diff <= 14) return { label: "Renew Now", color: B.red };
  if (diff <= 30) return { label: "Renewing Soon", color: B.orange };
  return { label: "Active", color: B.green };
}

export default function ClientsTab({ viewMode, search }) {
  const { data, setData } = useAppData();
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [localView, setLocalView] = useState("table"); // "table" | "kanban" | "cards"
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set());
  const [dragKanban, setDragKanban] = useState(null);
  const statuses = ["All", "Active", "Pending", "Expired"];

  let rows = filter === "All" ? data.clients : data.clients.filter((c) => c.status === filter);
  rows = filterSearch(rows, search, ["name", "contact", "email", "phone", "service", "licenseNumber"]);
  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));

  const bulkApplyStatus = (status) => {
    setData({ ...data, clients: data.clients.map(c => selected.has(c.id) ? { ...c, status } : c) });
    setSelected(new Set());
  };
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} client(s)?`)) return;
    setData({ ...data, clients: data.clients.filter(c => !selected.has(c.id)) });
    setSelected(new Set());
  };

  const exportCSV = () => {
    const headers = ["ID","Name","Contact","Email","Phone","Service","License","Status","Value","Progress","Renewal","Notes"];
    const csvRows = [headers, ...rows.map(r => [r.id,r.name,r.contact,r.email,r.phone,r.service,r.licenseNumber,r.status,r.value,r.progress,r.renewal,r.notes].map(v => `"${v??""}"`))]
      .map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvRows], { type: "text/csv" }));
    a.download = `clients-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const getHealthScore = (client) => {
    const invs = data.accounting.filter(i => i.client === client.name);
    const billed = invs.reduce((s,i) => s + (i.amount??0), 0);
    const paid = invs.reduce((s,i) => s + (i.paid??0), 0);
    const payRate = billed > 0 ? paid / billed : 1;
    const renewal = getRenewalStatus(client.renewal);
    const renewalScore = renewal?.label === "Expired" ? 0 : renewal?.label === "Renew Now" ? 0.3 : renewal?.label === "Renewing Soon" ? 0.6 : 1;
    const progressScore = (client.progress ?? 0) / 100;
    const score = Math.round((payRate * 0.4 + renewalScore * 0.35 + progressScore * 0.25) * 100);
    const color = score >= 75 ? B.green : score >= 45 ? B.orange : B.red;
    const label = score >= 75 ? "Healthy" : score >= 45 ? "At Risk" : "Critical";
    return { score, color, label };
  };

  // Kanban drag handlers
  const onKanbanDrop = (status) => {
    if (!dragKanban) return;
    setData({ ...data, clients: data.clients.map(c => c.id === dragKanban ? { ...c, status } : c) });
    setDragKanban(null);
  };

  const expiringCount = useMemo(() =>
    data.clients.filter((c) => {
      const s = getRenewalStatus(c.renewal);
      return s && (s.label === "Renewing Soon" || s.label === "Renew Now");
    }).length, [data.clients]);

  const cols = [
    { key: "id", label: "ID", width: 70 },
    {
      key: "name", label: "Company", width: 190,
      render: (v, r) => (
        <button onClick={() => setProfileId(r.id)} style={{ background: "none", border: "none", color: B.blue, fontWeight: 600, cursor: "pointer", fontSize: 12, textAlign: "left", padding: 0 }}>
          {v}
        </button>
      ),
    },
    { key: "contact", label: "Contact", width: 140 },
    { key: "service", label: "Service", width: 140 },
    { key: "licenseNumber", label: "License/Visa #", width: 130, render: (v) => v || <span style={{ color: B.muted }}>—</span> },
    { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v} /> },
    { key: "value", label: "Value", width: 110, render: (v) => aed(v), xlRender: (v) => aed(v) },
    {
      key: "progress", label: "Progress", width: 140,
      render: (v) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: B.light, borderRadius: 3 }}>
            <div style={{ height: "100%", width: `${v}%`, background: v === 100 ? B.green : B.blue, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 11, color: B.muted }}>{v}%</span>
        </div>
      ),
      xlRender: (v) => `${v}%`,
    },
    {
      key: "renewal", label: "Renewal", width: 130,
      render: (v) => {
        const s = getRenewalStatus(v);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11 }}>{v || "—"}</span>
            {s && s.label !== "Active" && <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</span>}
          </div>
        );
      },
    },
    { key: "email", label: "Email", width: 180 },
    { key: "phone", label: "Phone", width: 150 },
    {
      key: "_edit", label: "", width: 70,
      render: (_, r) => (
        <button onClick={() => setEditModal(r)}
          style={{ padding: "3px 10px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
          ✏ Edit
        </button>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.clients];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, clients: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.clients];
    updated.splice(ri, 1);
    setData({ ...data, clients: updated });
  };

  const handleAdd = (vals) => {
    setData({
      ...data,
      clients: [...data.clients, {
        id: nextId("C"),
        ...vals,
        value: Number(vals.value) || 0,
        progress: Number(vals.progress) || 0,
        started: new Date().toISOString().slice(0, 10),
      }],
    });
  };

  const handleEdit = (vals) => {
    const updated = data.clients.map(c =>
      c.id === editModal.id
        ? { ...c, ...vals, value: Number(vals.value) || 0, progress: Number(vals.progress) || 0 }
        : c
    );
    setData({ ...data, clients: updated });
    setEditModal(null);
  };

  const profileClient = profileId ? data.clients.find((c) => c.id === profileId) : null;
  const linkedInvoices = profileClient ? data.accounting.filter((i) => i.client === profileClient.name) : [];
  const linkedTasks = profileClient ? (data.tasks || []).filter((t) => t.clientId === profileClient.id || t.client === profileClient.name) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: viewMode === "excel" ? 0 : 12, height: "100%", minHeight: 0 }}>
      {/* Renewal alert banner */}
      {expiringCount > 0 && (
        <div style={{ background: B.orange + "15", border: `1px solid ${B.orange}40`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: B.orange, fontWeight: 600 }}>
          ⚠️ {expiringCount} client{expiringCount > 1 ? "s" : ""} with renewal due in the next 30 days
        </div>
      )}

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {["Active","Pending","Expired"].map(s => {
          const cnt = data.clients.filter(c => c.status === s).length;
          const val = data.clients.filter(c => c.status === s).reduce((sum,c) => sum + (c.value||0), 0);
          const col = s === "Active" ? B.green : s === "Pending" ? B.orange : B.red;
          return (
            <div key={s} onClick={() => setFilter(f => f === s ? "All" : s)} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:8, border:`1px solid ${col}30`, background: filter===s ? col+"18" : col+"08", cursor:"pointer", userSelect:"none" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:col }} />
              <span style={{ fontSize:12, fontWeight:700, color:col }}>{cnt}</span>
              <span style={{ fontSize:11, color:B.muted }}>{s}</span>
              <span style={{ fontSize:11, color:col, fontWeight:600 }}>{aed(val)}</span>
            </div>
          );
        })}
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          {/* View switcher */}
          {[["table","☰"],["kanban","⬛"],["cards","⊞"]].map(([v,icon]) => (
            <button key={v} onClick={() => setLocalView(v)} style={{ width:30, height:30, border:`1px solid ${localView===v?B.blue:B.border}`, background:localView===v?B.blue+"15":"#fff", borderRadius:6, cursor:"pointer", fontSize:14, color:localView===v?B.blue:B.muted }}>
              {icon}
            </button>
          ))}
          <button onClick={exportCSV} style={{ padding:"5px 12px", fontSize:11, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", color:B.muted, display:"flex", alignItems:"center", gap:4 }}>
            ↓ CSV
          </button>
          <button onClick={() => setModal(true)} style={{ padding:"6px 14px", background:B.blue, color:"#fff", border:"none", borderRadius:6, fontWeight:600, fontSize:12, cursor:"pointer" }}>+ Add Client</button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", background:B.blue+"0d", border:`1px solid ${B.blue}25`, borderRadius:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, fontWeight:700, color:B.blue }}>{selected.size} selected</span>
          {["Active","Pending","Expired"].map(s => (
            <button key={s} onClick={() => bulkApplyStatus(s)} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${B.border}`, borderRadius:5, background:"#fff", cursor:"pointer" }}>→ {s}</button>
          ))}
          <button onClick={bulkDelete} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${B.red}40`, borderRadius:5, background:B.red+"10", color:B.red, cursor:"pointer" }}>🗑 Delete</button>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft:"auto", fontSize:11, background:"none", border:"none", cursor:"pointer", color:B.muted }}>✕ Clear</button>
        </div>
      )}

      {/* Table */}
      {localView === "table" && (
      <SectionCard title={`Clients — ${rows.length} records${sortKey ? ` · sorted by ${sortKey} ${sortDir==="asc"?"↑":"↓"}` : ""}`} style={viewMode === "excel" ? { flex: 1, minHeight: 0 } : {}}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap"><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></>
          : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:`2px solid ${B.border}` }}>
                    <th style={{ width:32, padding:"8px 10px" }}>
                      <input type="checkbox" checked={selected.size===rows.length && rows.length>0} onChange={selectAll} style={{ cursor:"pointer" }} />
                    </th>
                    {[["name","Company"],["service","Service"],["status","Status"],["value","Value"],["progress","Progress"],["renewal","Renewal"],["_health","Health"]].map(([k,l]) => (
                      <th key={k} onClick={() => k !== "_health" && toggleSort(k)} style={{ padding:"8px 10px", textAlign:"left", fontWeight:700, fontSize:11, color:B.muted, textTransform:"uppercase", letterSpacing:0.4, cursor:k!=="—"?"pointer":"default", whiteSpace:"nowrap", userSelect:"none" }}>
                        {l}{sortKey===k ? (sortDir==="asc"?" ↑":" ↓") : ""}
                      </th>
                    ))}
                    <th style={{ width:60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const health = getHealthScore(r);
                    const rs = getRenewalStatus(r.renewal);
                    return (
                      <tr key={r.id} style={{ borderBottom:`1px solid ${B.border}`, background: selected.has(r.id) ? B.blue+"08" : "transparent" }}
                        onMouseEnter={e=>e.currentTarget.style.background=selected.has(r.id)?B.blue+"08":B.light}
                        onMouseLeave={e=>e.currentTarget.style.background=selected.has(r.id)?B.blue+"08":"transparent"}>
                        <td style={{ padding:"8px 10px" }}><input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSelect(r.id)} style={{ cursor:"pointer" }} /></td>
                        <td style={{ padding:"8px 10px" }}>
                          <button onClick={() => setProfileId(r.id)} style={{ background:"none", border:"none", color:B.blue, fontWeight:700, cursor:"pointer", fontSize:12, padding:0 }}>{r.name}</button>
                          <div style={{ fontSize:10, color:B.muted }}>{r.contact}</div>
                        </td>
                        <td style={{ padding:"8px 10px", fontSize:12, color:B.muted }}>{r.service}</td>
                        <td style={{ padding:"8px 10px" }}><Badge label={r.status} /></td>
                        <td style={{ padding:"8px 10px", fontWeight:700, color:B.blue }}>{aed(r.value)}</td>
                        <td style={{ padding:"8px 10px", minWidth:100 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ flex:1, height:5, background:B.light, borderRadius:3 }}>
                              <div style={{ height:"100%", width:`${r.progress||0}%`, background:(r.progress||0)===100?B.green:B.blue, borderRadius:3 }} />
                            </div>
                            <span style={{ fontSize:10, color:B.muted }}>{r.progress||0}%</span>
                          </div>
                        </td>
                        <td style={{ padding:"8px 10px" }}>
                          <div style={{ fontSize:11 }}>{r.renewal||"—"}</div>
                          {rs && rs.label !== "Active" && <div style={{ fontSize:10, color:rs.color, fontWeight:600 }}>{rs.label}</div>}
                        </td>
                        <td style={{ padding:"8px 10px" }}>
                          <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:health.color+"18", color:health.color }}>{health.label} {health.score}</span>
                        </td>
                        <td style={{ padding:"8px 10px" }}>
                          <button onClick={() => setEditModal(r)} style={{ padding:"3px 8px", fontSize:10, fontWeight:700, background:B.blue+"12", color:B.blue, border:`1px solid ${B.blue}30`, borderRadius:4, cursor:"pointer" }}>Edit</button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={9} style={{ padding:"24px", textAlign:"center", color:B.muted, fontSize:12 }}>No clients found</td></tr>}
                </tbody>
              </table>
            </div>
          )}
      </SectionCard>
      )}

      {/* Kanban view */}
      {localView === "kanban" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          {["Active","Pending","Expired"].map(col => {
            const colColor = col==="Active"?B.green:col==="Pending"?B.orange:B.red;
            const colClients = data.clients.filter(c => {
              if (filter !== "All" && c.status !== filter) return false;
              if (search) { const s = search.toLowerCase(); return [c.name,c.contact,c.service].some(v=>(v||"").toLowerCase().includes(s)); }
              return c.status === col;
            });
            return (
              <div key={col}
                onDragOver={e=>e.preventDefault()}
                onDrop={()=>onKanbanDrop(col)}
                style={{ background:colColor+"08", border:`2px dashed ${colColor}30`, borderRadius:10, padding:10, minHeight:200 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:colColor }} />
                  <span style={{ fontSize:11, fontWeight:800, color:colColor, textTransform:"uppercase", letterSpacing:0.5 }}>{col}</span>
                  <span style={{ fontSize:11, color:B.muted, marginLeft:"auto" }}>{colClients.length}</span>
                </div>
                {colClients.map(c => {
                  const health = getHealthScore(c);
                  return (
                    <div key={c.id} draggable onDragStart={()=>setDragKanban(c.id)}
                      onClick={()=>setProfileId(c.id)}
                      style={{ background:"#fff", border:`1px solid ${B.border}`, borderRadius:8, padding:"10px 12px", marginBottom:8, cursor:"grab", userSelect:"none" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:B.text }}>{c.name}</span>
                        <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:8, background:health.color+"18", color:health.color }}>{health.score}</span>
                      </div>
                      <div style={{ fontSize:11, color:B.muted, marginBottom:6 }}>{c.service}</div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:11, fontWeight:700, color:B.blue }}>{aed(c.value)}</span>
                        <div style={{ width:60, height:4, background:B.light, borderRadius:2 }}>
                          <div style={{ width:`${c.progress||0}%`, height:"100%", background:B.blue, borderRadius:2 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Cards view */}
      {localView === "cards" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:12 }}>
          {rows.map(c => {
            const health = getHealthScore(c);
            const rs = getRenewalStatus(c.renewal);
            const colColor = c.status==="Active"?B.green:c.status==="Pending"?B.orange:B.red;
            return (
              <div key={c.id} onClick={()=>setProfileId(c.id)} style={{ background:"#fff", border:`1px solid ${B.border}`, borderRadius:10, padding:16, cursor:"pointer", borderTop:`3px solid ${colColor}`, position:"relative" }}
                onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:B.text }}>{c.name}</div>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:health.color+"18", color:health.color }}>{health.label}</span>
                </div>
                <div style={{ fontSize:11, color:B.muted, marginBottom:10 }}>{c.contact} · {c.service}</div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:13, fontWeight:800, color:B.blue }}>{aed(c.value)}</span>
                  {rs && rs.label !== "Active" && <span style={{ fontSize:10, color:rs.color, fontWeight:600 }}>{rs.label} {c.renewal}</span>}
                </div>
                <div style={{ height:5, background:B.light, borderRadius:3 }}>
                  <div style={{ height:"100%", width:`${c.progress||0}%`, background:(c.progress||0)===100?B.green:B.blue, borderRadius:3 }} />
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                  <span style={{ fontSize:10, color:B.muted }}>{c.progress||0}% complete</span>
                  <button onClick={e=>{e.stopPropagation();setEditModal(c);}} style={{ fontSize:10, padding:"2px 8px", border:`1px solid ${B.border}`, borderRadius:4, background:"#fff", cursor:"pointer", color:B.muted }}>Edit</button>
                </div>
              </div>
            );
          })}
          {rows.length===0 && <div style={{ gridColumn:"1/-1", textAlign:"center", padding:32, fontSize:12, color:B.muted }}>No clients found</div>}
        </div>
      )}

      {/* Client profile drawer */}
      {profileClient && (
        <ProfileDrawer
          client={profileClient}
          invoices={linkedInvoices}
          tasks={linkedTasks}
          onClose={() => setProfileId(null)}
          onUpdate={(updated) => {
            setData(d => ({ ...d, clients: d.clients.map(c => c.id === updated.id ? updated : c) }));
          }}
        />
      )}

      {modal && <FormModal title="Add Client" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
      {editModal && (
        <FormModal
          title={`Edit Client — ${editModal.name}`}
          fields={FIELDS}
          initialValues={editModal}
          onSave={handleEdit}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}

// ─── Profile Drawer ────────────────────────────────────────────────────────────

function ProfileDrawer({ client, invoices, tasks, onClose, onUpdate }) {
  const renewalStatus = getRenewalStatus(client.renewal);
  const totalBilled = invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.paid ?? 0), 0);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressVal, setProgressVal] = useState(client.progress ?? 0);
  const [noteVal, setNoteVal] = useState("");
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`client-notes-${client.id}`) || "[]"); } catch { return []; }
  });

  const saveProgress = () => {
    onUpdate({ ...client, progress: Number(progressVal) });
    setEditingProgress(false);
  };

  const cycleStatus = () => {
    const cycle = { Active: "Pending", Pending: "Expired", Expired: "Active" };
    onUpdate({ ...client, status: cycle[client.status] || "Active" });
  };

  const addNote = () => {
    if (!noteVal.trim()) return;
    const updated = [{ text: noteVal.trim(), date: new Date().toLocaleString() }, ...notes];
    setNotes(updated);
    try { localStorage.setItem(`client-notes-${client.id}`, JSON.stringify(updated)); } catch {}
    setNoteVal("");
  };

  // Fake but structured timeline from real data
  const timeline = [
    ...invoices.map(i => ({ type: "invoice", label: `Invoice ${i.id} — ${aed(i.amount)}`, sub: i.status, date: i.date || "", color: i.status === "Paid" ? B.green : B.red })),
    ...tasks.map(t => ({ type: "task", label: t.title, sub: t.status, date: t.due || "", color: t.status === "Done" ? B.green : B.orange })),
    { type: "client", label: "Client added", sub: "", date: client.started || "", color: B.blue },
  ].filter(e => e.date).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 10);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end",
      background: "rgba(0,0,0,0.35)",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 96vw)", background: "#fff", height: "100%", overflow: "auto",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", padding: 28, display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{client.name}</div>
            <div style={{ fontSize: 12, color: B.muted }}>{client.contact} · {client.service}</div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={cycleStatus} style={{ padding:"4px 10px", fontSize:11, fontWeight:700, border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", background:"#fff" }}>
              Cycle Status →
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: B.muted }}>×</button>
          </div>
        </div>

        {/* Status & renewal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <InfoBlock label="Status"><Badge label={client.status} /></InfoBlock>
          <InfoBlock label="Renewal Date">
            <span style={{ fontWeight: 600, color: renewalStatus?.color ?? B.text }}>{client.renewal || "—"}</span>
            {renewalStatus && renewalStatus.label !== "Active" && (
              <span style={{ marginLeft: 8, fontSize: 11, color: renewalStatus.color, fontWeight: 600 }}>({renewalStatus.label})</span>
            )}
          </InfoBlock>
          <InfoBlock label="License / Visa #"><span style={{ fontWeight: 600 }}>{client.licenseNumber || "—"}</span></InfoBlock>
          <InfoBlock label="Contract Value"><span style={{ fontWeight: 700, color: B.blue }}>{aed(client.value)}</span></InfoBlock>
          <InfoBlock label="Email"><a href={`mailto:${client.email}`} style={{ color: B.blue, fontSize: 12 }}>{client.email}</a></InfoBlock>
          <InfoBlock label="Phone">{client.phone}</InfoBlock>
        </div>

        {/* Progress — inline editable */}
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <div style={{ fontSize: 11, color: B.muted, fontWeight: 600 }}>PROGRESS</div>
            {editingProgress
              ? <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <input type="number" min={0} max={100} value={progressVal} onChange={e=>setProgressVal(e.target.value)}
                    style={{ width:52, padding:"2px 6px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:4 }} />
                  <button onClick={saveProgress} style={{ padding:"2px 8px", fontSize:11, background:B.blue, color:"#fff", border:"none", borderRadius:4, cursor:"pointer" }}>✓</button>
                  <button onClick={()=>setEditingProgress(false)} style={{ padding:"2px 8px", fontSize:11, background:"#fff", border:`1px solid ${B.border}`, borderRadius:4, cursor:"pointer" }}>✕</button>
                </div>
              : <button onClick={()=>{setProgressVal(client.progress??0);setEditingProgress(true);}} style={{ fontSize:11, padding:"2px 8px", border:`1px solid ${B.border}`, borderRadius:4, background:"#fff", cursor:"pointer", color:B.muted }}>Edit</button>
            }
          </div>
          <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
            <div style={{ height: "100%", width: `${client.progress}%`, background: client.progress === 100 ? B.green : B.blue, borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ fontSize: 11, color: B.muted, marginTop: 4 }}>{client.progress}% complete</div>
        </div>

        {/* Financial summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <MiniStat label="Billed" value={aed(totalBilled)} color={B.blue} />
          <MiniStat label="Paid" value={aed(totalPaid)} color={B.green} />
          <MiniStat label="Outstanding" value={aed(totalBilled - totalPaid)} color={totalBilled - totalPaid > 0 ? B.red : B.green} />
        </div>

        {/* Quick note input */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Quick Note</div>
          <div style={{ display:"flex", gap:6 }}>
            <input value={noteVal} onChange={e=>setNoteVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()}
              placeholder="Add a note and press Enter…"
              style={{ flex:1, padding:"7px 10px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, fontFamily:"inherit", outline:"none" }} />
            <button onClick={addNote} style={{ padding:"7px 12px", background:B.blue, color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontSize:12 }}>Add</button>
          </div>
          {notes.length > 0 && (
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
              {notes.slice(0,5).map((n,i) => (
                <div key={i} style={{ fontSize:11, padding:"6px 10px", background:B.light, borderRadius:6, display:"flex", justifyContent:"space-between", gap:8 }}>
                  <span>{n.text}</span>
                  <span style={{ color:B.muted, flexShrink:0 }}>{n.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity timeline */}
        {timeline.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Activity Timeline</div>
            <div style={{ position:"relative", paddingLeft:16 }}>
              <div style={{ position:"absolute", left:4, top:0, bottom:0, width:1, background:B.border }} />
              {timeline.map((e,i) => (
                <div key={i} style={{ marginBottom:10, position:"relative" }}>
                  <div style={{ position:"absolute", left:-16, top:3, width:8, height:8, borderRadius:"50%", background:e.color, border:"2px solid #fff" }} />
                  <div style={{ fontSize:12, fontWeight:600 }}>{e.label}</div>
                  <div style={{ fontSize:10, color:B.muted }}>{e.sub} · {e.date}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked invoices */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Invoices ({invoices.length})</div>
          {invoices.length === 0 ? (
            <div style={{ fontSize: 12, color: B.muted }}>No invoices linked</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: B.light, borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{inv.id}</div>
                    <div style={{ fontSize: 11, color: B.muted }}>{inv.desc}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{aed(inv.amount)}</div>
                    <Badge label={inv.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked tasks */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Tasks ({tasks.length})</div>
          {tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: B.muted }}>No tasks linked</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tasks.map((task) => (
                <div key={task.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: B.light, borderRadius: 8 }}>
                  <span style={{ fontSize: 12 }}>{task.title}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge label={task.priority} />
                    <Badge label={task.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {client.notes && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Notes</div>
            <div style={{ fontSize: 12, color: B.text, lineHeight: 1.6, background: B.light, borderRadius: 8, padding: "10px 12px" }}>{client.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBlock({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background: B.light, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: B.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
