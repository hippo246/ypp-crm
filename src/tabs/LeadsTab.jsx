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

  // Kanban drag state
  const handleKanbanDrop = (leadId, newStatus) => {
    const updated = data.leads.map((l) =>
      l.id === leadId
        ? { ...l, status: newStatus, updatedAt: new Date().toISOString().slice(0, 10) }
        : l
    );
    setData({ ...data, leads: updated });
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
          <ModeBtn active={displayMode === "table"} label="Table" onClick={() => setDisplayMode("table")} />
          <ModeBtn active={displayMode === "kanban"} label="Kanban" onClick={() => setDisplayMode("kanban")} />
          <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Lead</button>
        </div>
      </div>

      {/* Content */}
      {displayMode === "kanban" ? (
        <KanbanBoard leads={rows} onDrop={handleKanbanDrop} dupeIds={dupeIds} staleLeads={staleLeads} />
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

function KanbanBoard({ leads, onDrop, dupeIds, staleLeads }) {
  const [dragId, setDragId] = useState(null);

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
