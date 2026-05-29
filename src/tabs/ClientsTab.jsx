import { useState, useMemo, useRef } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId, parseOperatorQuery } from "../helpers";
import { useTableFilterV2, useSortedData, usePagination, useSearchSuggestions } from "../hooks";
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
  const [selected, setSelected] = useState(new Set());
  const [dragKanban, setDragKanban] = useState(null);
  const [serviceFilter, setServiceFilter] = useState("All");
  const [valueMin, setValueMin] = useState("");
  const [valueMax, setValueMax] = useState("");
  const [visibleCols, setVisibleCols] = useState(new Set(["name","service","status","value","progress","renewal","health"]));
  const [showColPicker, setShowColPicker] = useState(false);
  const [showValueFilter, setShowValueFilter] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  // Fun layer state
  const [xp, setXp] = useState(() => { try { return Number(localStorage.getItem("xp_clients")||0); } catch { return 0; } });
  const [achievements, setAchievements] = useState(() => { try { return JSON.parse(localStorage.getItem("achievements_clients")||"[]"); } catch { return []; } });
  const [toasts, setToasts] = useState([]);
  const [confetti, setConfetti] = useState(false);
  const [stepModal, setStepModal] = useState(false);
  const [stepData, setStepData] = useState({});
  const [step, setStep] = useState(1);
  const statuses = ["All", "Active", "Pending", "Expired"];
  const allServices = useMemo(() => ["All", ...new Set(data.clients.map(c => c.service).filter(Boolean))], [data.clients]);
  const [localSearch, setLocalSearch] = useState(search || "");
  const searchRef = useRef(null);
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const CLIENT_SUGGESTION_FIELDS = ["status", "service", "name", "contact"];
  const { suggestions, showSuggestions, onSuggestionSelect } = useSearchSuggestions(localSearch, CLIENT_SUGGESTION_FIELDS, setLocalSearch);

  // Fun helpers
  const addToast = (msg, color = "#3B82F6") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, color }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };

  const gainXp = (amount) => {
    setXp(prev => {
      const next = prev + amount;
      try { localStorage.setItem("xp_clients", String(next)); } catch {}
      return next;
    });
  };

  const unlockAchievement = (key, label, emoji) => {
    setAchievements(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      try { localStorage.setItem("achievements_clients", JSON.stringify(next)); } catch {}
      addToast(`${emoji} Achievement unlocked: ${label}`, "#8B5CF6");
      return next;
    });
  };

  const fireConfetti = () => {
    setConfetti(true);
    setTimeout(() => setConfetti(false), 2200);
  };

  const checkAchievements = (clients) => {
    const total = clients.length;
    if (total >= 1) unlockAchievement("first_client", "First Client", "🎉");
    if (total >= 5) unlockAchievement("five_clients", "5 Clients", "⭐");
    if (total >= 10) unlockAchievement("ten_clients", "10 Clients", "🏆");
    if (clients.some(c => (c.progress||0) === 100)) unlockAchievement("full_progress", "100% Progress", "💯");
    if (clients.some(c => (c.value||0) >= 100000)) unlockAchievement("big_contract", "Big Contract (100K+)", "💰");
    if (clients.length > 0 && clients.every(c => c.status === "Active")) unlockAchievement("all_active", "All Active", "✅");
    const renewalClients = clients.filter(c => c.renewal);
    if (renewalClients.length >= 3 && renewalClients.every(c => { const s = getRenewalStatus(c.renewal); return s && s.label !== "Expired"; })) unlockAchievement("renewal_master", "Renewal Master", "📅");
    if (clients.length >= 5 && clients.every(c => c.contact && c.email && c.phone)) unlockAchievement("clean_sheet", "Clean Sheet", "🌟");
  };

  const baseRows = filter === "All" ? data.clients : data.clients.filter((c) => c.status === filter);
  const filteredBySearch = useTableFilterV2(baseRows, parsedQuery, ["name", "contact", "email", "phone", "service", "licenseNumber"]);
  let rows = filteredBySearch;

  // Feature 1: service + value range + stale filters applied to rows
  if (serviceFilter !== "All") rows = rows.filter(c => c.service === serviceFilter);
  if (valueMin !== "") rows = rows.filter(c => (c.value||0) >= Number(valueMin));
  if (valueMax !== "") rows = rows.filter(c => (c.value||0) <= Number(valueMax));
  // Feature 2: pinned clients float to top
  rows = [...rows].sort((a,b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || 0);

  const { sortedData: sortedRows, sortKey, sortDir, toggleSort: toggleSortKey } = useSortedData(rows);
  rows = sortedRows;
  const { page, setPage, pageSize, setPageSize, pageData, pageCount } = usePagination(rows);

  // Feature 3: stale clients (no invoice in 60 days)
  const today = new Date().toISOString().slice(0,10);
  const staleIds = useMemo(() => new Set(data.clients.filter(c => {
    const invs = data.accounting.filter(i => i.client === c.name);
    if (!invs.length) return false;
    const last = invs.map(i => i.date||"").sort().slice(-1)[0];
    return last && (new Date() - new Date(last)) / 86400000 > 60;
  }).map(c => c.id)), [data]);

  // Feature 4: renewal forecast (this month)
  const forecastVal = useMemo(() => {
    const m = new Date().toISOString().slice(0,7);
    return data.clients.filter(c => (c.renewal||"").startsWith(m)).reduce((s,c)=>s+(c.value||0),0);
  }, [data.clients]);

  // Feature 5: duplicate name detector
  const duplicateNames = useMemo(() => {
    const seen = {}; const dups = new Set();
    data.clients.forEach(c => { const k=(c.name||"").toLowerCase(); if(seen[k]) dups.add(k); seen[k]=true; });
    return dups;
  }, [data.clients]);

  const toggleSort = toggleSortKey;

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
  // Feature 6: pin toggle
  const togglePin = (id) => setData(d => ({ ...d, clients: d.clients.map(c => c.id===id ? {...c, pinned:!c.pinned} : c) }));
  // Feature 7: tag toggle (VIP / Follow-up / Escalated)
  const toggleTag = (id, tag) => setData(d => ({ ...d, clients: d.clients.map(c => {
    if (c.id !== id) return c;
    const tags = new Set(c.tags||[]); tags.has(tag) ? tags.delete(tag) : tags.add(tag);
    return { ...c, tags: [...tags] };
  })}));
  // Feature 8: bulk assign tag
  const bulkTag = (tag) => { selected.forEach(id => toggleTag(id, tag)); setSelected(new Set()); };

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
    const newClient = {
      id: nextId("C"),
      ...vals,
      value: Number(vals.value) || 0,
      progress: Number(vals.progress) || 0,
      started: new Date().toISOString().slice(0, 10),
    };
    const updated = [...data.clients, newClient];
    setData({ ...data, clients: updated });
    gainXp(50);
    addToast(`✅ ${newClient.name} added! +50 XP`);
    if (newClient.status === "Active" || (newClient.progress||0) === 100) fireConfetti();
    checkAchievements(updated);
    setStepModal(false);
    setStepData({});
    setStep(1);
  };

  const openAddModal = () => { setStepData({}); setStep(1); setStepModal(true); };

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
          <div style={{ position:"relative" }}>
            <button onClick={()=>setShowColPicker(v=>!v)} style={{ padding:"5px 10px", fontSize:11, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", color:B.muted }}>
              ⚙ Cols
            </button>
            {showColPicker && (
              <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", right:0, top:34, zIndex:300, background:"#fff", border:`1px solid ${B.border}`, borderRadius:8, padding:"10px 14px", boxShadow:"0 4px 20px rgba(0,0,0,0.12)", minWidth:160 }}>
                {[["name","Company"],["service","Service"],["status","Status"],["value","Value"],["progress","Progress"],["renewal","Renewal"],["health","Health"],["tags","Tags"],["pin","Pin"]].map(([k,l]) => (
                  <label key={k} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:12, cursor:"pointer" }}>
                    <input type="checkbox" checked={visibleCols.has(k)} onChange={()=>setVisibleCols(s=>{const n=new Set(s);n.has(k)?n.delete(k):n.add(k);return n;})} />
                    {l}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={exportCSV} style={{ padding:"5px 12px", fontSize:11, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", color:B.muted, display:"flex", alignItems:"center", gap:4 }}>
            ↓ CSV
          </button>
          <button onClick={openAddModal} style={{ padding:"6px 14px", background:B.blue, color:"#fff", border:"none", borderRadius:6, fontWeight:600, fontSize:12, cursor:"pointer" }}>+ Add Client</button>
        </div>
      </div>

      {/* Feature 9: Revenue forecast bar */}
      {showForecast && forecastVal > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", background:B.blue+"0a", border:`1px solid ${B.blue}20`, borderRadius:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:B.blue }}>📅 Renewals this month</span>
          <span style={{ fontSize:13, fontWeight:800, color:B.blue }}>{aed(forecastVal)}</span>
          <span style={{ fontSize:11, color:B.muted }}>in contract value up for renewal</span>
          <button onClick={()=>setShowForecast(false)} style={{ marginLeft:"auto", background:"none", border:"none", fontSize:12, cursor:"pointer", color:B.muted }}>✕</button>
        </div>
      )}

      {/* Feature 10: service filter pills */}
      {allServices.length > 2 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, color:B.muted, fontWeight:600 }}>Service:</span>
          {allServices.map(s => (
            <button key={s} onClick={()=>setServiceFilter(sv=>sv===s?"All":s)}
              style={{ padding:"3px 10px", borderRadius:20, fontSize:11, border:`1px solid ${serviceFilter===s?B.accent:B.border}`, background:serviceFilter===s?B.accent+"18":"#fff", color:serviceFilter===s?B.accent:B.muted, cursor:"pointer" }}>
              {s}
            </button>
          ))}
          {/* Feature 11: value range filter toggle */}
          <button onClick={()=>setShowValueFilter(v=>!v)} style={{ padding:"3px 10px", borderRadius:20, fontSize:11, border:`1px solid ${(valueMin||valueMax)?B.blue:B.border}`, background:(valueMin||valueMax)?B.blue+"15":"#fff", color:(valueMin||valueMax)?B.blue:B.muted, cursor:"pointer" }}>
            💰 Value range
          </button>
          {showValueFilter && (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <input type="number" placeholder="Min AED" value={valueMin} onChange={e=>setValueMin(e.target.value)}
                style={{ width:90, padding:"3px 8px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:6 }} />
              <span style={{ fontSize:11, color:B.muted }}>—</span>
              <input type="number" placeholder="Max AED" value={valueMax} onChange={e=>setValueMax(e.target.value)}
                style={{ width:90, padding:"3px 8px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:6 }} />
              {(valueMin||valueMax) && <button onClick={()=>{setValueMin("");setValueMax("");}} style={{ fontSize:11, color:B.red, background:"none", border:"none", cursor:"pointer" }}>Clear</button>}
            </div>
          )}
        </div>
      )}

      {/* Feature 12: duplicate warning */}
      {duplicateNames.size > 0 && (
        <div style={{ background:B.yellow+"18", border:`1px solid ${B.yellow}40`, borderRadius:8, padding:"6px 14px", fontSize:11, color:B.orange }}>
          ⚠ Duplicate client names detected: {[...duplicateNames].join(", ")}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", background:B.blue+"0d", border:`1px solid ${B.blue}25`, borderRadius:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, fontWeight:700, color:B.blue }}>{selected.size} selected</span>
          {["Active","Pending","Expired"].map(s => (
            <button key={s} onClick={() => bulkApplyStatus(s)} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${B.border}`, borderRadius:5, background:"#fff", cursor:"pointer" }}>→ {s}</button>
          ))}
          <button onClick={bulkDelete} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${B.red}40`, borderRadius:5, background:B.red+"10", color:B.red, cursor:"pointer" }}>🗑 Delete</button>
          {["VIP","Follow-up","Escalated"].map(tag => (
            <button key={tag} onClick={()=>bulkTag(tag)} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, border:`1px solid ${B.border}`, borderRadius:5, background:"#fff", cursor:"pointer" }}>🏷 {tag}</button>
          ))}
          <button onClick={() => setSelected(new Set())} style={{ marginLeft:"auto", fontSize:11, background:"none", border:"none", cursor:"pointer", color:B.muted }}>✕ Clear</button>
        </div>
      )}

      {/* Search + suggestions */}
      <div style={{ position:"relative" }}>
        <input
          ref={searchRef}
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          placeholder="Search clients… (e.g. status:Active service:Visa)"
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
                  {pageData.map((r) => {
                    const health = getHealthScore(r);
                    const rs = getRenewalStatus(r.renewal);
                    return (
                      <tr key={r.id} style={{ borderBottom:`1px solid ${B.border}`, background: selected.has(r.id) ? B.blue+"08" : "transparent" }}
                        onMouseEnter={e=>e.currentTarget.style.background=selected.has(r.id)?B.blue+"08":B.light}
                        onMouseLeave={e=>e.currentTarget.style.background=selected.has(r.id)?B.blue+"08":"transparent"}>
                        <td style={{ padding:"8px 10px" }}><input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSelect(r.id)} style={{ cursor:"pointer" }} /></td>
                        <td style={{ padding:"8px 10px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <button onClick={e=>{e.stopPropagation();togglePin(r.id);}} title={r.pinned?"Unpin":"Pin to top"} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, opacity:r.pinned?1:0.25, padding:0 }}>📌</button>
                            <div>
                              <button onClick={() => setProfileId(r.id)} style={{ background:"none", border:"none", color:B.blue, fontWeight:700, cursor:"pointer", fontSize:12, padding:0 }}>{r.name}</button>
                              <div style={{ display:"flex", gap:4, marginTop:2, flexWrap:"wrap" }}>
                                {staleIds.has(r.id) && <span style={{ fontSize:9, background:B.orange+"20", color:B.orange, borderRadius:4, padding:"1px 4px", fontWeight:700 }}>STALE</span>}
                                {(r.tags||[]).map(tag => <span key={tag} style={{ fontSize:9, background:B.accent+"20", color:B.accent, borderRadius:4, padding:"1px 4px", fontWeight:700 }}>{tag}</span>)}
                              </div>
                              <div style={{ fontSize:10, color:B.muted }}>{r.contact}</div>
                            </div>
                          </div>
                        </td>
                        {visibleCols.has("service") && <td style={{ padding:"8px 10px", fontSize:12, color:B.muted }}>{r.service}</td>}
                        {visibleCols.has("status") && <td style={{ padding:"8px 10px" }}><Badge label={r.status} /></td>}
                        {visibleCols.has("value") && <td style={{ padding:"8px 10px", fontWeight:700, color:B.blue }}>{aed(r.value)}</td>}
                        {visibleCols.has("progress") && <td style={{ padding:"8px 10px", minWidth:100 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ flex:1, height:5, background:B.light, borderRadius:3 }}>
                              <div style={{ height:"100%", width:`${r.progress||0}%`, background:(r.progress||0)===100?B.green:B.blue, borderRadius:3 }} />
                            </div>
                            <span style={{ fontSize:10, color:B.muted }}>{r.progress||0}%</span>
                          </div>
                        </td>}
                        {visibleCols.has("renewal") && <td style={{ padding:"8px 10px" }}>
                          <div style={{ fontSize:11 }}>{r.renewal||"—"}</div>
                          {rs && rs.label !== "Active" && <div style={{ fontSize:10, color:rs.color, fontWeight:600 }}>{rs.label}</div>}
                          {r.renewal && <div style={{ fontSize:10, color:B.muted }}>{Math.ceil((new Date(r.renewal)-new Date())/86400000)}d left</div>}
                        </td>}
                        {visibleCols.has("health") && <td style={{ padding:"8px 10px" }}>
                          <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:health.color+"18", color:health.color }}>{health.label} {health.score}</span>
                        </td>}
                        <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                          <button onClick={() => setEditModal(r)} style={{ padding:"3px 8px", fontSize:10, fontWeight:700, background:B.blue+"12", color:B.blue, border:`1px solid ${B.blue}30`, borderRadius:4, cursor:"pointer" }}>Edit</button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={9} style={{ padding:"24px", textAlign:"center", color:B.muted, fontSize:12 }}>No clients found</td></tr>}
                </tbody>
              </table>
              {/* Pagination */}
              {pageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
                  <button onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                  <span>Page {page+1} / {pageCount}</span>
                  <button onClick={() => setPage(p => Math.min(pageCount-1,p+1))} disabled={page===pageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                  <select value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)); setPage(0); }} style={{ marginLeft:"auto", padding:"3px 6px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:5 }}>
                    {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
              )}
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
                        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                          {c.pinned && <span style={{ fontSize:11 }}>📌</span>}
                          <span style={{ fontSize:12, fontWeight:700, color:B.text }}>{c.name}</span>
                        </div>
                        <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:8, background:health.color+"18", color:health.color }}>{health.score}</span>
                      </div>
                      {(c.tags||[]).length > 0 && <div style={{ display:"flex", gap:3, marginBottom:4, flexWrap:"wrap" }}>{(c.tags||[]).map(tag=><span key={tag} style={{ fontSize:9, background:B.accent+"20", color:B.accent, borderRadius:4, padding:"1px 4px", fontWeight:700 }}>{tag}</span>)}</div>}
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
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    {c.pinned && <span style={{ fontSize:12 }}>📌</span>}
                    <div style={{ fontSize:13, fontWeight:800, color:B.text }}>{c.name}</div>
                  </div>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:health.color+"18", color:health.color }}>{health.label}</span>
                </div>
                {(c.tags||[]).length > 0 && <div style={{ display:"flex", gap:4, marginBottom:6, flexWrap:"wrap" }}>{(c.tags||[]).map(tag=><span key={tag} style={{ fontSize:10, background:B.accent+"20", color:B.accent, borderRadius:4, padding:"2px 6px", fontWeight:700 }}>{tag}</span>)}</div>}
                {staleIds.has(c.id) && <div style={{ fontSize:10, color:B.orange, fontWeight:700, marginBottom:4 }}>⚠ Stale — no invoice in 60+ days</div>}
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
            const prev = data.clients.find(c => c.id === updated.id);
            setData(d => ({ ...d, clients: d.clients.map(c => c.id === updated.id ? updated : c) }));
            if (prev && prev.status !== updated.status) {
              addToast(`🔄 ${updated.name} → ${updated.status}`);
              if (updated.status === "Active") fireConfetti();
              gainXp(10);
              checkAchievements(data.clients.map(c => c.id === updated.id ? updated : c));
            }
            if (prev && prev.renewal !== updated.renewal && updated.renewal) {
              addToast(`📅 Renewal set for ${updated.name}`, "#F59E0B");
              gainXp(5);
            }
            if (prev && prev.progress !== updated.progress && (updated.progress||0) === 100) {
              fireConfetti();
              addToast(`💯 ${updated.name} hit 100%!`, "#10B981");
              gainXp(25);
              checkAchievements(data.clients.map(c => c.id === updated.id ? updated : c));
            }
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

      {/* 3-step Add Client Modal */}
      {stepModal && <StepAddModal stepData={stepData} setStepData={setStepData} step={step} setStep={setStep} onSave={handleAdd} onClose={() => { setStepModal(false); setStep(1); setStepData({}); }} />}

      {/* Vibe Bar */}
      <VibeBar xp={xp} achievements={achievements} />

      {/* Toast stack */}
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding:"10px 16px", background:t.color, color:"#fff", borderRadius:10, fontSize:13, fontWeight:600, boxShadow:"0 4px 20px rgba(0,0,0,0.18)", animation:"toast-in 0.3s ease", whiteSpace:"nowrap" }}>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Confetti */}
      {confetti && <ConfettiPop />}
    </div>
  );
}

// ─── 3-Step Add Client Modal ──────────────────────────────────────────────────
const STEP_LABELS = ["Company Info", "Service Details", "Review"];
const STEP1_KEYS = ["name","contact","email","phone"];
const STEP2_KEYS = ["service","licenseNumber","status","value","renewal","progress"];
const fieldMap = Object.fromEntries(FIELDS.map(f => [f.key, f]));

function StepAddModal({ stepData, setStepData, step, setStep, onSave, onClose }) {
  const keys = step === 1 ? STEP1_KEYS : step === 2 ? STEP2_KEYS : [];
  const iStyle = { width:"100%", padding:"8px 10px", fontSize:13, border:`1px solid ${B.border}`, borderRadius:7, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const canNext = step === 1 ? !!(stepData.name) : true;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:14, padding:28, width:"min(480px,95vw)", boxShadow:"0 8px 40px rgba(0,0,0,0.18)", display:"flex", flexDirection:"column", gap:20 }}>
        {/* Progress stepper */}
        <div style={{ display:"flex", alignItems:"center", gap:0 }}>
          {STEP_LABELS.map((l,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", flex:1 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:step>i?B.blue:step===i+1?B.blue:B.border, color:step>i||step===i+1?"#fff":B.muted, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, transition:"background 0.3s" }}>{step>i+1?"✓":i+1}</div>
                <span style={{ fontSize:10, fontWeight:600, color:step===i+1?B.blue:B.muted, whiteSpace:"nowrap" }}>{l}</span>
              </div>
              {i<2 && <div style={{ flex:1, height:2, background:step>i+1?B.blue:B.border, margin:"0 6px", marginBottom:18, transition:"background 0.3s" }} />}
            </div>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {step < 3 && keys.map(k => {
            const f = fieldMap[k];
            if (!f) return null;
            return (
              <div key={k}>
                <label style={{ fontSize:11, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:0.5, display:"block", marginBottom:5 }}>{f.label}{k==="name"&&<span style={{color:B.red}}>*</span>}</label>
                {f.type === "select"
                  ? <select value={stepData[k]||""} onChange={e=>setStepData(d=>({...d,[k]:e.target.value}))} style={iStyle}>
                      <option value="">Select…</option>
                      {f.options.map(o=><option key={o}>{o}</option>)}
                    </select>
                  : <input type={f.type||"text"} placeholder={f.placeholder||f.label} value={stepData[k]||""} onChange={e=>setStepData(d=>({...d,[k]:e.target.value}))} style={iStyle} />
                }
              </div>
            );
          })}
          {step === 3 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:B.text, marginBottom:4 }}>Ready to create this client?</div>
              {FIELDS.filter(f=>stepData[f.key]).map(f=>(
                <div key={f.key} style={{ display:"flex", justifyContent:"space-between", padding:"7px 12px", background:B.light, borderRadius:7, fontSize:12 }}>
                  <span style={{ color:B.muted, fontWeight:600 }}>{f.label}</span>
                  <span style={{ fontWeight:700 }}>{stepData[f.key]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
          <button onClick={step>1?()=>setStep(s=>s-1):onClose} style={{ padding:"8px 18px", fontSize:12, fontWeight:600, border:`1px solid ${B.border}`, borderRadius:7, background:"#fff", cursor:"pointer", color:B.muted }}>
            {step>1?"← Back":"Cancel"}
          </button>
          {step<3
            ? <button disabled={!canNext} onClick={()=>setStep(s=>s+1)} style={{ padding:"8px 20px", fontSize:12, fontWeight:700, background:canNext?B.blue:"#ccc", color:"#fff", border:"none", borderRadius:7, cursor:canNext?"pointer":"default" }}>
                Next →
              </button>
            : <button onClick={()=>onSave(stepData)} style={{ padding:"8px 20px", fontSize:12, fontWeight:700, background:B.green, color:"#fff", border:"none", borderRadius:7, cursor:"pointer" }}>
                ✓ Create Client
              </button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Vibe Bar ─────────────────────────────────────────────────────────────────
const ACHIEVEMENTS_META = {
  first_client:   { emoji:"🎉", label:"First Client" },
  five_clients:   { emoji:"⭐", label:"5 Clients" },
  ten_clients:    { emoji:"🏆", label:"10 Clients" },
  full_progress:  { emoji:"💯", label:"100% Progress" },
  big_contract:   { emoji:"💰", label:"Big Contract" },
  all_active:     { emoji:"✅", label:"All Active" },
  renewal_master: { emoji:"📅", label:"Renewal Master" },
  clean_sheet:    { emoji:"🌟", label:"Clean Sheet" },
};
const ALL_ACH_KEYS = Object.keys(ACHIEVEMENTS_META);

function VibeBar({ xp, achievements }) {
  const [open, setOpen] = useState(false);
  const level = Math.floor(xp / 100) + 1;
  const levelXp = xp % 100;
  return (
    <div style={{ marginTop:6 }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", background:"linear-gradient(90deg,#8B5CF608,#3B82F608)", border:`1px solid ${B.blue}20`, borderRadius:8, cursor:"pointer", userSelect:"none" }}>
        <span style={{ fontSize:14 }}>⚡</span>
        <span style={{ fontSize:12, fontWeight:700, color:B.blue }}>Level {level}</span>
        <div style={{ flex:1, height:6, background:B.border, borderRadius:3, maxWidth:120 }}>
          <div style={{ height:"100%", width:`${levelXp}%`, background:`linear-gradient(90deg,${B.blue},#8B5CF6)`, borderRadius:3, transition:"width 0.5s" }} />
        </div>
        <span style={{ fontSize:11, color:B.muted }}>{xp} XP</span>
        <span style={{ fontSize:11, color:B.blue, fontWeight:600 }}>{achievements.length}/{ALL_ACH_KEYS.length} 🏅</span>
        <span style={{ fontSize:10, color:B.muted, marginLeft:"auto" }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, padding:"12px 14px", background:"#fff", border:`1px solid ${B.border}`, borderTop:"none", borderRadius:"0 0 8px 8px" }}>
          {ALL_ACH_KEYS.map(k => {
            const meta = ACHIEVEMENTS_META[k];
            const unlocked = achievements.includes(k);
            return (
              <div key={k} title={meta.label} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 10px", borderRadius:20, background:unlocked?"#8B5CF618":B.light, border:`1px solid ${unlocked?"#8B5CF640":B.border}`, opacity:unlocked?1:0.45 }}>
                <span style={{ fontSize:14 }}>{meta.emoji}</span>
                <span style={{ fontSize:11, fontWeight:600, color:unlocked?"#8B5CF6":B.muted }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function ConfettiPop() {
  const pieces = Array.from({length:36},(_,i)=>({
    id:i, x:10+Math.random()*80, delay:Math.random()*0.5,
    color:["#3B82F6","#10B981","#F59E0B","#8B5CF6","#EF4444","#06B6D4"][i%6],
    rot:Math.random()*360, size:6+Math.random()*6,
  }));
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9998, pointerEvents:"none", overflow:"hidden" }}>
      <style>{`@keyframes confetti-fall{0%{transform:translateY(-10px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}`}</style>
      {pieces.map(p=>(
        <div key={p.id} style={{ position:"absolute", left:`${p.x}%`, top:"-10px", width:p.size, height:p.size, background:p.color, borderRadius:p.id%3===0?"50%":2, animation:`confetti-fall ${1.5+Math.random()*0.8}s ${p.delay}s ease-in forwards` }} />
      ))}
    </div>
  );
}

function ProfileDrawer({ client, invoices, tasks, onClose, onUpdate }) {
  const renewalStatus = getRenewalStatus(client.renewal);
  const totalBilled = invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.paid ?? 0), 0);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressVal, setProgressVal] = useState(client.progress ?? 0);
  const [noteVal, setNoteVal] = useState("");
  const [drawerTab, setDrawerTab] = useState("overview"); // overview | financials | tasks | notes | docs
  const [notes, setNotes] = useState(() => { try { return JSON.parse(localStorage.getItem(`client-notes-${client.id}`) || "[]"); } catch { return []; } });
  const [stars, setStars] = useState(() => { try { return Number(localStorage.getItem(`client-stars-${client.id}`)||0); } catch { return 0; } });
  const [reminder, setReminder] = useState(() => { try { return localStorage.getItem(`client-reminder-${client.id}`)||""; } catch { return ""; } });
  const [reminderSaved, setReminderSaved] = useState(false);
  const [docs, setDocs] = useState(() => { try { return JSON.parse(localStorage.getItem(`client-docs-${client.id}`)||JSON.stringify([{label:"Trade License",done:false},{label:"Visa Copy",done:false},{label:"Emirates ID",done:false},{label:"MOA",done:false},{label:"NOC Letter",done:false}])); } catch { return []; } });

  const saveProgress = () => { onUpdate({ ...client, progress: Number(progressVal) }); setEditingProgress(false); };
  const addNote = () => {
    if (!noteVal.trim()) return;
    const updated = [{ text: noteVal.trim(), date: new Date().toLocaleString() }, ...notes];
    setNotes(updated); try { localStorage.setItem(`client-notes-${client.id}`, JSON.stringify(updated)); } catch {} setNoteVal("");
  };
  const saveReminder = () => { try { localStorage.setItem(`client-reminder-${client.id}`, reminder); } catch {} setReminderSaved(true); setTimeout(()=>setReminderSaved(false),1500); };
  const toggleDoc = (i) => { const updated = docs.map((d,idx)=>idx===i?{...d,done:!d.done}:d); setDocs(updated); try { localStorage.setItem(`client-docs-${client.id}`,JSON.stringify(updated)); } catch {} };
  const setStarRating = (n) => { setStars(n); try { localStorage.setItem(`client-stars-${client.id}`,String(n)); } catch {} };
  const copyToClipboard = (val) => { try { navigator.clipboard.writeText(val); } catch {} };

  const clientSinceMonths = client.started ? Math.max(0, Math.round((new Date()-new Date(client.started))/2592000000)) : null;

  // Payment sparkline data
  const sparkInvoices = [...invoices].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).slice(-6);

  const timeline = [
    ...invoices.map(i => ({ label: `Invoice ${i.id} — ${aed(i.amount)}`, sub: i.status, date: i.date||"", color: i.status==="Paid"?B.green:B.red })),
    ...tasks.map(t => ({ label: t.title, sub: t.status, date: t.due||"", color: t.status==="Done"?B.green:B.orange })),
    { label: "Client added", sub: "", date: client.started||"", color: B.blue },
  ].filter(e=>e.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10);

  const tabStyle = (t) => ({ padding:"6px 14px", fontSize:11, fontWeight:700, border:"none", borderBottom:`2px solid ${drawerTab===t?B.blue:"transparent"}`, background:"none", color:drawerTab===t?B.blue:B.muted, cursor:"pointer" });

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", justifyContent:"flex-end", background:"rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"min(540px,96vw)", background:"#fff", height:"100%", overflow:"auto", boxShadow:"-4px 0 24px rgba(0,0,0,0.12)", display:"flex", flexDirection:"column" }}>

        {/* Header */}
        <div style={{ padding:"24px 28px 0", borderBottom:`1px solid ${B.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                {client.pinned && <span style={{ fontSize:14 }}>📌</span>}
                {client.escalated && <span style={{ fontSize:14, color:B.red }}>🚨</span>}
                <div style={{ fontWeight:800, fontSize:18 }}>{client.name}</div>
              </div>
              <div style={{ fontSize:12, color:B.muted }}>{client.contact} · {client.service}{clientSinceMonths !== null ? ` · Client for ${clientSinceMonths}mo` : ""}</div>
              {/* Feature 17: star rating */}
              <div style={{ display:"flex", gap:2, marginTop:6 }}>
                {[1,2,3,4,5].map(n=>(
                  <button key={n} onClick={()=>setStarRating(n)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:16, color:n<=stars?"#F59E0B":"#D1D5DB", padding:0 }}>★</button>
                ))}
                {stars > 0 && <span style={{ fontSize:11, color:B.muted, marginLeft:4, alignSelf:"center" }}>{stars}/5</span>}
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end" }}>
              {/* Feature 18: status dropdown */}
              <select value={client.status} onChange={e=>onUpdate({...client,status:e.target.value})}
                style={{ padding:"4px 8px", fontSize:12, fontWeight:700, border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", background:"#fff" }}>
                {["Active","Pending","Expired"].map(s=><option key={s}>{s}</option>)}
              </select>
              {/* Feature 19: escalate + close */}
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>onUpdate({...client,escalated:!client.escalated})}
                  style={{ padding:"4px 10px", fontSize:11, fontWeight:700, border:`1px solid ${client.escalated?B.red:B.border}`, borderRadius:6, cursor:"pointer", background:client.escalated?B.red+"15":"#fff", color:client.escalated?B.red:B.muted }}>
                  {client.escalated?"🚨 Escalated":"Escalate"}
                </button>
                <button onClick={onClose} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:B.muted }}>×</button>
              </div>
            </div>
          </div>
          {/* Feature 20: WhatsApp + email quick launch */}
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            {client.phone && <a href={`https://wa.me/${(client.phone||"").replace(/\D/g,"")}`} target="_blank" rel="noreferrer" style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", fontSize:11, fontWeight:600, background:"#25D36615", color:"#25D366", borderRadius:6, border:"1px solid #25D36630", textDecoration:"none" }}>💬 WhatsApp</a>}
            {client.email && <a href={`mailto:${client.email}`} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", fontSize:11, fontWeight:600, background:B.blue+"15", color:B.blue, borderRadius:6, border:`1px solid ${B.blue}30`, textDecoration:"none" }}>✉ Email</a>}
            {client.phone && <button onClick={()=>copyToClipboard(client.phone)} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", color:B.muted }}>📋 {client.phone}</button>}
            {client.email && <button onClick={()=>copyToClipboard(client.email)} style={{ padding:"4px 10px", fontSize:11, fontWeight:600, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, cursor:"pointer", color:B.muted }}>📋 Copy email</button>}
          </div>
          {/* Drawer tabs */}
          <div style={{ display:"flex", gap:0, borderTop:`1px solid ${B.border}`, marginLeft:-28, marginRight:-28, paddingLeft:28 }}>
            {[["overview","Overview"],["financials","Financials"],["tasks","Tasks"],["notes","Notes"],["docs","Docs"]].map(([t,l])=>(
              <button key={t} onClick={()=>setDrawerTab(t)} style={tabStyle(t)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ padding:"20px 28px", display:"flex", flexDirection:"column", gap:18, flex:1, overflow:"auto" }}>

          {drawerTab === "overview" && <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <InfoBlock label="Status"><Badge label={client.status} /></InfoBlock>
              <InfoBlock label="Renewal">
                <span style={{ fontWeight:600, color:renewalStatus?.color??B.text }}>{client.renewal||"—"}</span>
                {renewalStatus && renewalStatus.label!=="Active" && <span style={{ marginLeft:6, fontSize:11, color:renewalStatus.color, fontWeight:600 }}>({renewalStatus.label})</span>}
              </InfoBlock>
              <InfoBlock label="License / Visa #"><span style={{ fontWeight:600 }}>{client.licenseNumber||"—"}</span></InfoBlock>
              <InfoBlock label="Contract Value"><span style={{ fontWeight:700, color:B.blue }}>{aed(client.value)}</span></InfoBlock>
            </div>
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontSize:11, color:B.muted, fontWeight:600 }}>PROGRESS</div>
                {editingProgress
                  ? <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <input type="number" min={0} max={100} value={progressVal} onChange={e=>setProgressVal(e.target.value)} style={{ width:52, padding:"2px 6px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:4 }} />
                      <button onClick={saveProgress} style={{ padding:"2px 8px", fontSize:11, background:B.blue, color:"#fff", border:"none", borderRadius:4, cursor:"pointer" }}>✓</button>
                      <button onClick={()=>setEditingProgress(false)} style={{ padding:"2px 8px", fontSize:11, background:"#fff", border:`1px solid ${B.border}`, borderRadius:4, cursor:"pointer" }}>✕</button>
                    </div>
                  : <button onClick={()=>{setProgressVal(client.progress??0);setEditingProgress(true);}} style={{ fontSize:11, padding:"2px 8px", border:`1px solid ${B.border}`, borderRadius:4, background:"#fff", cursor:"pointer", color:B.muted }}>Edit</button>}
              </div>
              <div style={{ height:8, background:B.light, borderRadius:4 }}>
                <div style={{ height:"100%", width:`${client.progress||0}%`, background:(client.progress||0)===100?B.green:B.blue, borderRadius:4, transition:"width 0.4s" }} />
              </div>
              <div style={{ fontSize:11, color:B.muted, marginTop:4 }}>{client.progress||0}% complete</div>
            </div>
            {/* Feature: reminder setter */}
            <div>
              <div style={{ fontSize:11, color:B.muted, fontWeight:600, marginBottom:6 }}>FOLLOW-UP REMINDER</div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input type="date" value={reminder} onChange={e=>setReminder(e.target.value)} style={{ flex:1, padding:"6px 10px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6 }} />
                <button onClick={saveReminder} style={{ padding:"6px 12px", background:reminderSaved?B.green:B.blue, color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontSize:12 }}>{reminderSaved?"✓ Saved":"Save"}</button>
              </div>
              {reminder && <div style={{ fontSize:11, color:B.muted, marginTop:4 }}>Reminder set for {reminder}</div>}
            </div>
            {/* Activity timeline */}
            {timeline.length > 0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:B.muted, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Activity</div>
                <div style={{ position:"relative", paddingLeft:16 }}>
                  <div style={{ position:"absolute", left:4, top:0, bottom:0, width:1, background:B.border }} />
                  {timeline.map((e,i)=>(
                    <div key={i} style={{ marginBottom:10, position:"relative" }}>
                      <div style={{ position:"absolute", left:-16, top:3, width:8, height:8, borderRadius:"50%", background:e.color, border:"2px solid #fff" }} />
                      <div style={{ fontSize:12, fontWeight:600 }}>{e.label}</div>
                      <div style={{ fontSize:10, color:B.muted }}>{e.sub} · {e.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>}

          {drawerTab === "financials" && <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              <MiniStat label="Billed" value={aed(totalBilled)} color={B.blue} />
              <MiniStat label="Paid" value={aed(totalPaid)} color={B.green} />
              <MiniStat label="Outstanding" value={aed(totalBilled-totalPaid)} color={totalBilled-totalPaid>0?B.red:B.green} />
            </div>
            {/* Feature: payment sparkline */}
            {sparkInvoices.length > 1 && (
              <div>
                <div style={{ fontSize:11, color:B.muted, fontWeight:600, marginBottom:8 }}>INVOICE HISTORY</div>
                <svg width="100%" height={50} viewBox={`0 0 ${sparkInvoices.length*60} 50`} preserveAspectRatio="none">
                  {sparkInvoices.map((inv,i)=>{
                    const maxAmt = Math.max(...sparkInvoices.map(x=>x.amount||0),1);
                    const h = ((inv.amount||0)/maxAmt)*40;
                    return <g key={i}>
                      <rect x={i*60+4} y={50-h} width={48} height={h} rx={3} fill={inv.status==="Paid"?B.green:B.red} opacity={0.7} />
                      <text x={i*60+28} y={48} textAnchor="middle" fontSize={9} fill={B.muted}>{(inv.amount/1000).toFixed(0)}K</text>
                    </g>;
                  })}
                </svg>
              </div>
            )}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:B.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Invoices ({invoices.length})</div>
              {invoices.length===0 ? <div style={{ fontSize:12, color:B.muted }}>No invoices linked</div> : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {invoices.map(inv=>(
                    <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:B.light, borderRadius:8 }}>
                      <div><div style={{ fontSize:12, fontWeight:600 }}>{inv.id}</div><div style={{ fontSize:11, color:B.muted }}>{inv.desc}</div></div>
                      <div style={{ textAlign:"right" }}><div style={{ fontSize:12, fontWeight:600 }}>{aed(inv.amount)}</div><Badge label={inv.status} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>}

          {drawerTab === "tasks" && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:B.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Tasks ({tasks.length})</div>
              {tasks.length===0 ? <div style={{ fontSize:12, color:B.muted }}>No tasks linked</div> : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {tasks.map(task=>(
                    <div key={task.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:B.light, borderRadius:8 }}>
                      <span style={{ fontSize:12 }}>{task.title}</span>
                      <div style={{ display:"flex", gap:6 }}><Badge label={task.priority} /><Badge label={task.status} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {drawerTab === "notes" && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:B.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Notes</div>
              <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                <input value={noteVal} onChange={e=>setNoteVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()} placeholder="Add a note and press Enter…"
                  style={{ flex:1, padding:"7px 10px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, fontFamily:"inherit", outline:"none" }} />
                <button onClick={addNote} style={{ padding:"7px 12px", background:B.blue, color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontSize:12 }}>Add</button>
              </div>
              {client.notes && <div style={{ fontSize:12, color:B.text, lineHeight:1.6, background:B.light, borderRadius:8, padding:"10px 12px", marginBottom:8 }}>{client.notes}</div>}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {notes.map((n,i)=>(
                  <div key={i} style={{ fontSize:11, padding:"6px 10px", background:B.light, borderRadius:6, display:"flex", justifyContent:"space-between", gap:8 }}>
                    <span>{n.text}</span><span style={{ color:B.muted, flexShrink:0 }}>{n.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drawerTab === "docs" && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:B.muted, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Document Checklist</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {docs.map((doc,i)=>(
                  <div key={i} onClick={()=>toggleDoc(i)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:doc.done?B.green+"0a":B.light, border:`1px solid ${doc.done?B.green+"30":B.border}`, borderRadius:8, cursor:"pointer" }}>
                    <div style={{ width:18, height:18, borderRadius:4, border:`2px solid ${doc.done?B.green:B.border}`, background:doc.done?B.green:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {doc.done && <span style={{ color:"#fff", fontSize:11, fontWeight:800 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:13, fontWeight:500, color:doc.done?B.green:B.text, textDecoration:doc.done?"line-through":"none" }}>{doc.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:10, fontSize:11, color:B.muted }}>{docs.filter(d=>d.done).length}/{docs.length} documents collected</div>
            </div>
          )}

        </div>
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
