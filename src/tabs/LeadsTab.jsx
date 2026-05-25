import { useState, useMemo } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId } from "../helpers";
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
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "name", label: "Name", placeholder: "Full name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", placeholder: "+971 50 000 0000" },
  { key: "service", label: "Service", type: "select", options: ["UAE Visa", "Business License", "Employment Visa", "Business Setup", "Freezone License"] },
  { key: "status", label: "Status", type: "select", options: ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"] },
  { key: "value", label: "Value (AED)", type: "number", placeholder: "0" },
  { key: "source", label: "Source", type: "select", options: ["Facebook", "Google", "Referral", "Instagram", "Walk-in", "Other"] },
  { key: "lostReason", label: "Lost Reason (if lost)", type: "select", options: ["Price", "Competitor", "No response", "Changed mind", "Other"], default: "" },
  { key: "notes", label: "Notes", placeholder: "Optional notes" },
];

const SCORE_COLORS = { Hot: B.red, Warm: B.orange, Cold: B.blue };
const STAGE_COLORS = {
  New: "#6366f1", Contacted: "#f59e0b", Qualified: "#3b82f6",
  Proposal: "#8b5cf6", Won: "#10b981", Lost: "#ef4444",
};

export default function LeadsTab({ viewMode, search }) {
  const { data, setData } = useAppData();
  const [filter, setFilter] = useState("All");
  const [displayMode, setDisplayMode] = useState("table"); // "table" | "kanban"
  const [modal, setModal] = useState(false);
  const [showDupesOnly, setShowDupesOnly] = useState(false);
  const [showStaleOnly, setShowStaleOnly] = useState(false);

  const statuses = ["All", ...PIPELINE_STAGES];
  const leads = data.leads;

  const dupeIds = useMemo(() => findDuplicates(leads), [leads]);
  const staleLeads = useMemo(() => getStaleLeads(leads), [leads]);
  const pipelineStats = useMemo(() => getPipelineStats(leads), [leads]);
  const lostReasons = useMemo(() => getLostReasons(leads), [leads]);

  let rows = filter === "All" ? leads : leads.filter((l) => l.status === filter);
  if (showDupesOnly) rows = rows.filter((l) => dupeIds.has(l.id));
  if (showStaleOnly) rows = rows.filter((l) => staleLeads.some((s) => s.id === l.id));
  rows = filterSearch(rows, search, ["name", "email", "phone", "service", "source", "notes"]);

  const cols = [
    {
      key: "_sel", label: "", width: 36,
      render: (_, r) => (
        <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={() => toggleBulkSelect(r.id)}
          style={{ accentColor: B.blue, cursor: "pointer" }} />
      ),
    },
    { key: "id", label: "ID", width: 70 },
    {
      key: "name", label: "Name", width: 160,
      render: (v, r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {dupeIds.has(r.id) && <span title="Potential duplicate" style={{ color: B.orange, fontWeight: 700, fontSize: 11 }}>⚠</span>}
          {v}
        </div>
      ),
    },
    { key: "service", label: "Service", width: 140 },
    { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} /> },
    {
      key: "score", label: "Score", width: 90,
      render: (_, r) => {
        const s = scoreLead(r);
        const label = scoreLabel(s);
        return (
          <span style={{ fontWeight: 700, fontSize: 12, color: SCORE_COLORS[label] }}>
            {s} <span style={{ fontWeight: 400, fontSize: 10 }}>{label}</span>
          </span>
        );
      },
      xlRender: (_, r) => scoreLead(r),
    },
    { key: "value", label: "Value", width: 110, render: (v) => aed(v), xlRender: (v) => aed(v) },
    { key: "source", label: "Source", width: 100 },
    { key: "date", label: "Date", width: 100 },
    {
      key: "stale", label: "Follow-up", width: 100,
      render: (_, r) => {
        const isStale = staleLeads.some((s) => s.id === r.id);
        return isStale
          ? <span style={{ color: B.orange, fontWeight: 600, fontSize: 11 }}>⏰ Due</span>
          : <span style={{ color: B.muted, fontSize: 11 }}>OK</span>;
      },
    },
    { key: "lostReason", label: "Lost Reason", width: 120, render: (v) => v || <span style={{ color: B.muted }}>—</span> },
    { key: "email", label: "Email", width: 180 },
    { key: "phone", label: "Phone", width: 150 },
    { key: "notes", label: "Notes", width: 200 },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.leads];
    updated[ri] = { ...updated[ri], [key]: val, updatedAt: new Date().toISOString().slice(0, 10) };
    setData({ ...data, leads: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.leads];
    updated.splice(ri, 1);
    setData({ ...data, leads: updated });
  };

  const handleAdd = (vals) => {
    setData({
      ...data,
      leads: [
        ...data.leads,
        {
          id: nextId("L"),
          ...vals,
          value: Number(vals.value) || 0,
          date: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      ],
    });
  };

  const handleConvertToClient = (lead) => {
    const already = data.clients.some(c => c.name === lead.name || c.email === lead.email);
    if (already) { alert(`${lead.name} is already a client.`); return; }
    const newClient = {
      id: nextId("C"),
      name: lead.name,
      contact: lead.name,
      email: lead.email || "",
      phone: lead.phone || "",
      service: lead.service || "",
      licenseNumber: "",
      status: "Active",
      value: lead.value || 0,
      renewal: "",
      progress: 0,
      notes: `Converted from lead ${lead.id} on ${new Date().toISOString().slice(0,10)}`,
      started: new Date().toISOString().slice(0,10),
    };
    const updatedLeads = data.leads.map(l => l.id === lead.id ? { ...l, status: "Won", updatedAt: new Date().toISOString().slice(0,10) } : l);
    setData({ ...data, clients: [...data.clients, newClient], leads: updatedLeads });
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
    setData({ ...data, leads: data.leads.filter(l => !toRemove.has(l.id)) });
  };

  const handleKanbanDrop = (leadId, newStatus) => {
    const updated = data.leads.map((l) =>
      l.id === leadId
        ? { ...l, status: newStatus, updatedAt: new Date().toISOString().slice(0, 10) }
        : l
    );
    setData({ ...data, leads: updated });
  };

  // Bulk stage-move: select multiple leads → move to a stage
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkTarget, setBulkTarget] = useState("");

  const handleBulkMove = () => {
    if (!bulkTarget || bulkSelected.size === 0) return;
    const updated = data.leads.map(l =>
      bulkSelected.has(l.id) ? { ...l, status: bulkTarget, updatedAt: new Date().toISOString().slice(0, 10) } : l
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      {/* Stats row */}
      <div className="stat-grid-6" style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }}>
        {pipelineStats.slice(0, 5).map((s) => (
          <StatCard
            key={s.stage}
            label={s.stage}
            value={s.count}
            sub={aed(s.value)}
            color={STAGE_COLORS[s.stage]}
          />
        ))}
        <StatCard label="Dupes" value={dupeIds.size} color={dupeIds.size > 0 ? B.orange : B.green} sub={dupeIds.size > 0 ? "review needed" : "clean"} />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {statuses.map((s) => (
            <FilterBtn key={s} active={filter === s} label={s} onClick={() => setFilter(s)} />
          ))}
          <div style={{ width: 1, height: 20, background: B.border, margin: "0 4px" }} />
          <FilterBtn active={showDupesOnly} label={`⚠ Dupes (${dupeIds.size})`} onClick={() => { setShowDupesOnly(!showDupesOnly); setShowStaleOnly(false); }} danger />
          <FilterBtn active={showStaleOnly} label={`⏰ Stale (${staleLeads.length})`} onClick={() => { setShowStaleOnly(!showStaleOnly); setShowDupesOnly(false); }} warn />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {bulkSelected.size > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", background: B.blue + "0d", border: `1px solid ${B.blue}30`, borderRadius: 8, padding: "4px 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: B.blue }}>{bulkSelected.size} selected</span>
              <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)}
                style={{ fontSize: 11, border: `1px solid ${B.border}`, borderRadius: 5, padding: "2px 6px", fontFamily: "inherit", background: "#fff" }}>
                <option value="">Move to…</option>
                {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={handleBulkMove} disabled={!bulkTarget}
                style={{ padding: "3px 10px", fontSize: 11, background: B.blue, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 700, opacity: bulkTarget ? 1 : 0.5 }}>
                Move
              </button>
              <button onClick={() => setBulkSelected(new Set())}
                style={{ padding: "3px 6px", fontSize: 11, background: "none", border: "none", cursor: "pointer", color: B.muted }}>✕</button>
            </div>
          )}
          {dupeIds.size > 0 && (
            <button onClick={handleMergeDupes} style={{ padding: "6px 12px", background: B.orange + "15", color: B.orange, border: `1px solid ${B.orange}40`, borderRadius: 6, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              ⚡ Merge dupes ({dupeIds.size})
            </button>
          )}
          {rows.some(l => l.status === "Won") && (
            <button onClick={() => {
              const wonLead = rows.find(l => l.status === "Won");
              if (wonLead) handleConvertToClient(wonLead);
            }} style={{ padding: "6px 12px", background: B.green + "15", color: B.green, border: `1px solid ${B.green}40`, borderRadius: 6, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              ↗ Convert Won → Client
            </button>
          )}
          <ModeBtn active={displayMode === "table"} label="Table" onClick={() => setDisplayMode("table")} />
          <ModeBtn active={displayMode === "kanban"} label="Kanban" onClick={() => setDisplayMode("kanban")} />
          <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Lead</button>
        </div>
      </div>

      {/* Content */}
      {displayMode === "kanban" ? (
        <KanbanBoard leads={rows} onDrop={handleKanbanDrop} dupeIds={dupeIds} staleLeads={staleLeads}
          onConvert={handleConvertToClient}
          onSetFollowUp={(lead, date) => {
            const updated = data.leads.map(l => l.id === lead.id ? { ...l, followUpDate: date, updatedAt: new Date().toISOString().slice(0,10) } : l);
            setData({ ...data, leads: updated });
          }}
        />
      ) : (
        <SectionCard title={`Leads — ${rows.length} records`} style={{ flex: 1, minHeight: 0 }}>
          {viewMode === "excel"
            ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap"><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></>
            : <NTable cols={cols} rows={rows} />}
        </SectionCard>
      )}

      {/* Lost reasons footer */}
      {lostReasons.length > 0 && (
        <SectionCard title="Lost Reasons">
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

      {modal && <FormModal title="Add Lead" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
    </div>
  );
}

// ─── Kanban ────────────────────────────────────────────────────────────────────

function KanbanBoard({ leads, onDrop, dupeIds, staleLeads, onConvert, onSetFollowUp }) {
  const [dragId, setDragId] = useState(null);
  const [editFollowUp, setEditFollowUp] = useState(null); // lead id

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e, stage) => {
    e.preventDefault();
    if (dragId) onDrop(dragId, stage);
    setDragId(null);
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, 1fr)`,
      gap: 10,
      flex: 1,
      minHeight: 0,
      overflow: "auto",
    }}>
      {PIPELINE_STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.status === stage);
        return (
          <div
            key={stage}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage)}
            style={{
              background: B.light,
              borderRadius: 10,
              padding: 10,
              minWidth: 160,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: STAGE_COLORS[stage], textTransform: "uppercase", letterSpacing: 0.5 }}>{stage}</span>
              <span style={{ fontSize: 11, background: STAGE_COLORS[stage] + "20", color: STAGE_COLORS[stage], borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>{stageLeads.length}</span>
            </div>
            <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
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
                    onDragStart={() => setDragId(lead.id)}
                    style={{
                      background: "#fff",
                      borderRadius: 8,
                      padding: "10px 12px",
                      cursor: "grab",
                      border: `1px solid ${isDupe ? B.orange + "80" : B.border}`,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                      <span>{lead.name}</span>
                      {isDupe && <span title="Duplicate" style={{ fontSize: 10, color: B.orange }}>⚠</span>}
                    </div>
                    <div style={{ fontSize: 11, color: B.muted, marginBottom: 6 }}>{lead.service}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{aed(lead.value)}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: SCORE_COLORS[sLabel] }}>{sLabel}</span>
                    </div>
                    {isStale && <div style={{ marginTop: 4, fontSize: 10, color: B.orange, fontWeight: 600 }}>⏰ Follow up needed</div>}

                    {/* Follow-up date setter */}
                    <div style={{ marginTop: 6, borderTop: `1px solid ${B.border}`, paddingTop: 6 }}>
                      {isEditingFU ? (
                        <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                          <input type="date" defaultValue={lead.followUpDate || ""}
                            onBlur={e => { onSetFollowUp(lead, e.target.value); setEditFollowUp(null); }}
                            autoFocus
                            style={{ fontSize: 10, border: `1px solid ${B.blue}`, borderRadius: 4, padding: "2px 4px", flex: 1, fontFamily: "inherit" }} />
                          <button onClick={() => setEditFollowUp(null)} style={{ fontSize: 10, background: "none", border: "none", cursor: "pointer", color: B.muted }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setEditFollowUp(lead.id); }}
                          style={{ fontSize: 10, color: lead.followUpDate ? B.blue : B.muted, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                          📅 {lead.followUpDate ? `Follow up: ${lead.followUpDate}` : "Set follow-up date"}
                        </button>
                      )}
                    </div>

                    {/* Convert to Client on Won cards */}
                    {stage === "Won" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onConvert(lead); }}
                        style={{ marginTop: 6, width: "100%", fontSize: 10, fontWeight: 700, padding: "3px 0", background: B.green + "18", color: B.green, border: `1px solid ${B.green}40`, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
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

// ─── Tiny UI helpers ───────────────────────────────────────────────────────────

function FilterBtn({ active, label, onClick, danger, warn }) {
  const color = danger ? B.red : warn ? B.orange : B.blue;
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11,
      border: `1px solid ${active ? color : B.border}`,
      background: active ? color : B.white,
      color: active ? "#fff" : B.muted,
      cursor: "pointer", fontWeight: active ? 600 : 400,
    }}>{label}</button>
  );
}

function ModeBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      border: `1px solid ${active ? B.blue : B.border}`,
      background: active ? B.blue + "15" : B.white,
      color: active ? B.blue : B.muted,
      cursor: "pointer",
    }}>{label}</button>
  );
}
