import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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

// ─── Tab view cache (persists display mode across tab switches) ────────────────
const VIEW_CACHE_KEY = "leadsTab_displayMode";
function getCachedView() {
  try { return sessionStorage.getItem(VIEW_CACHE_KEY) || "table"; } catch { return "table"; }
}
function setCachedView(v) {
  try { sessionStorage.setItem(VIEW_CACHE_KEY, v); } catch {}
}

// ─── Field definitions ─────────────────────────────────────────────────────────
const SERVICE_OPTIONS = ["UAE Visa", "Business License", "Employment Visa", "Business Setup", "Freezone License"];
const STATUS_OPTIONS  = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
const SOURCE_OPTIONS  = ["Facebook", "Google", "Referral", "Instagram", "Walk-in", "Other"];
const LOST_OPTIONS    = ["", "Price", "Competitor", "No response", "Changed mind", "Other"];

const ADD_FIELDS = [
  { key: "name",       label: "Name",                  placeholder: "Full name" },
  { key: "email",      label: "Email",    type: "email" },
  { key: "phone",      label: "Phone",                  placeholder: "+971 50 000 0000" },
  { key: "service",    label: "Service",  type: "select", options: SERVICE_OPTIONS, default: "UAE Visa" },
  { key: "status",     label: "Status",   type: "select", options: STATUS_OPTIONS,  default: "New" },
  { key: "value",      label: "Value (AED)", type: "number", placeholder: "0" },
  { key: "source",     label: "Source",   type: "select", options: SOURCE_OPTIONS,  default: "Other" },
  { key: "lostReason", label: "Lost Reason (if lost)", type: "select", options: LOST_OPTIONS, default: "" },
  { key: "notes",      label: "Notes",                  placeholder: "Optional notes" },
];

// Edit fields include all Add fields (same set)
const EDIT_FIELDS = ADD_FIELDS;

// ─── Color maps ────────────────────────────────────────────────────────────────
const SCORE_COLORS = { Hot: B.red, Warm: B.orange, Cold: B.blue };
const STAGE_COLORS = {
  New: "#6366f1", Contacted: "#f59e0b", Qualified: "#3b82f6",
  Proposal: "#8b5cf6", Won: "#10b981", Lost: "#ef4444",
};

// ─── Styles ────────────────────────────────────────────────────────────────────
const pill = (color, bg) => ({
  display: "inline-flex", alignItems: "center",
  padding: "2px 9px", borderRadius: 20, fontSize: 10, fontWeight: 700,
  color: color, background: bg,
  letterSpacing: 0.3, whiteSpace: "nowrap",
});

const inlineSelect = (accent) => ({
  fontSize: 11, border: `1.5px solid ${accent}40`,
  borderRadius: 6, padding: "3px 6px",
  fontFamily: "inherit", background: accent + "0d",
  color: accent, fontWeight: 600, cursor: "pointer",
  width: "100%", outline: "none",
  transition: "border-color 0.15s",
});

const actionBtn = (color, bg) => ({
  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
  border: `1px solid ${color}40`, background: bg,
  color: color, cursor: "pointer", fontFamily: "inherit",
  transition: "opacity 0.15s",
  whiteSpace: "nowrap",
});

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ viewMode, search }) {
  const { data, setData } = useAppData();

  const [filter,       setFilter]       = useState("All");
  const [displayMode,  setDisplayModeRaw]  = useState(() => getCachedView());
  const setDisplayMode = useCallback((v) => { setCachedView(v); setDisplayModeRaw(v); }, []);
  const [addModal,     setAddModal]     = useState(false);
  const [editLead,     setEditLead]     = useState(null);
  const [detailLead,   setDetailLead]   = useState(null);
  const [showDupesOnly, setShowDupesOnly] = useState(false);
  const [showStaleOnly, setShowStaleOnly] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkTarget,   setBulkTarget]   = useState("");
  // Hover card state
  const [hoverLead,    setHoverLead]    = useState(null);
  const [hoverPos,     setHoverPos]     = useState({ x: 0, y: 0 });

  const leads        = data.leads;
  const statuses     = ["All", ...PIPELINE_STAGES];
  const dupeIds      = useMemo(() => findDuplicates(leads),    [leads]);
  const staleLeads   = useMemo(() => getStaleLeads(leads),     [leads]);
  const pipelineStats= useMemo(() => getPipelineStats(leads),  [leads]);
  const lostReasons  = useMemo(() => getLostReasons(leads),    [leads]);

  // ── Filtered rows ────────────────────────────────────────────────────────────
  let rows = filter === "All" ? leads : leads.filter((l) => l.status === filter);
  if (showDupesOnly) rows = rows.filter((l) => dupeIds.has(l.id));
  if (showStaleOnly) rows = rows.filter((l) => staleLeads.some((s) => s.id === l.id));
  rows = filterSearch(rows, search, ["name", "email", "phone", "service", "source", "notes"]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  /** Update a single field on a lead by its row index within the current filtered view */
  const handleChange = (ri, key, val) => {
    const leadId = rows[ri]?.id;
    if (!leadId) return;
    const updated = data.leads.map(l =>
      l.id === leadId ? { ...l, [key]: val, updatedAt: new Date().toISOString().slice(0, 10) } : l
    );
    setData({ ...data, leads: updated });
  };

  const handleDelete = (ri) => {
    const leadId = rows[ri]?.id;
    if (!leadId) return;
    if (!window.confirm("Delete this lead?")) return;
    setData({ ...data, leads: data.leads.filter(l => l.id !== leadId) });
  };

  /** Add new lead — always honour the form values for status & service */
  const handleAdd = (vals) => {
    const newLead = {
      id:         nextId("L"),
      lostReason: "",
      // defaults — overwritten by whatever the form submitted
      status:  "New",
      service: "UAE Visa",
      source:  "Other",
      ...vals,                                    // ← form values WIN (incl. status, service)
      value:   Number(vals.value) || 0,
      date:    new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setData({ ...data, leads: [...data.leads, newLead] });
  };

  /** Save all edits from the edit modal */
  const handleEditSave = (vals) => {
    if (!editLead) return;
    const updated = data.leads.map(l =>
      l.id === editLead.id
        ? { ...l, ...vals, value: Number(vals.value) || 0, updatedAt: new Date().toISOString().slice(0, 10) }
        : l
    );
    setData({ ...data, leads: updated });
    setEditLead(null);
  };

  const handleConvertToClient = (lead) => {
    const already = data.clients?.some(c => c.name === lead.name || c.email === lead.email);
    if (already) { alert(`${lead.name} is already a client.`); return; }
    const newClient = {
      id:            nextId("C"),
      name:          lead.name,
      contact:       lead.name,
      email:         lead.email  || "",
      phone:         lead.phone  || "",
      service:       lead.service || "",
      licenseNumber: "",
      status:        "Active",
      value:         lead.value  || 0,
      renewal:       "",
      progress:      0,
      notes:         `Converted from lead ${lead.id} on ${new Date().toISOString().slice(0,10)}`,
      started:       new Date().toISOString().slice(0,10),
    };
    const updatedLeads = data.leads.map(l =>
      l.id === lead.id ? { ...l, status: "Won", updatedAt: new Date().toISOString().slice(0,10) } : l
    );
    setData({ ...data, clients: [...(data.clients || []), newClient], leads: updatedLeads });
    alert(`✅ ${lead.name} converted to client successfully!`);
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
    if (!window.confirm(`Remove ${toRemove.size} duplicate lead(s)?`)) return;
    setData({ ...data, leads: data.leads.filter(l => !toRemove.has(l.id)) });
  };

  const handleKanbanDrop = (leadId, newStatus) => {
    const updated = data.leads.map((l) =>
      l.id === leadId ? { ...l, status: newStatus, updatedAt: new Date().toISOString().slice(0, 10) } : l
    );
    setData({ ...data, leads: updated });
  };

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

  // ── Table columns ─────────────────────────────────────────────────────────────
  const cols = [
    {
      key: "_sel", label: "", width: 36,
      render: (_, r) => (
        <input type="checkbox" checked={bulkSelected.has(r.id)} onChange={() => toggleBulkSelect(r.id)}
          style={{ accentColor: B.blue, cursor: "pointer", width: 14, height: 14 }} />
      ),
    },
    { key: "id", label: "ID", width: 68 },
    {
      key: "name", label: "Name", width: 155,
      render: (v, r) => (
        <div
          style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }}
          onMouseEnter={e => { setHoverLead(r); setHoverPos({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={e => setHoverPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoverLead(null)}
        >
          {dupeIds.has(r.id) && (
            <span title="Potential duplicate" style={{ color: B.orange, fontWeight: 700, fontSize: 10 }}>⚠</span>
          )}
          <span
            style={{ color: B.blue, cursor: "pointer", fontWeight: 600, fontSize: 12, textDecoration: "underline dotted" }}
            onClick={e => { e.stopPropagation(); setDetailLead(r); setHoverLead(null); }}
          >{v}</span>
        </div>
      ),
    },
    {
      key: "service", label: "Service", width: 165,
      render: (v, r, ri) => (
        <select
          value={v || "UAE Visa"}
          onClick={e => e.stopPropagation()}
          onChange={e => handleChange(ri, "service", e.target.value)}
          style={inlineSelect("#64748b")}
        >
          {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ),
    },
    {
      key: "status", label: "Status", width: 130,
      render: (v, r, ri) => {
        const color = STAGE_COLORS[v] || B.border;
        return (
          <select
            value={v || "New"}
            onClick={e => e.stopPropagation()}
            onChange={e => handleChange(ri, "status", e.target.value)}
            style={inlineSelect(color)}
          >
            {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    {
      key: "score", label: "Score", width: 82,
      render: (_, r) => {
        const s = scoreLead(r);
        const label = scoreLabel(s);
        return (
          <span style={pill(SCORE_COLORS[label], SCORE_COLORS[label] + "18")}>
            {s} {label}
          </span>
        );
      },
      xlRender: (_, r) => scoreLead(r),
    },
    { key: "value",  label: "Value",   width: 105, render: (v) => <span style={{ fontWeight: 600, fontSize: 12 }}>{aed(v)}</span>, xlRender: (v) => aed(v) },
    { key: "source", label: "Source",  width: 95 },
    { key: "date",   label: "Date",    width: 95 },
    {
      key: "stale", label: "Follow-up", width: 95,
      render: (_, r) => {
        const isStale = staleLeads.some((s) => s.id === r.id);
        return isStale
          ? <span style={pill(B.orange, B.orange + "15")}>⏰ Due</span>
          : <span style={{ color: B.muted, fontSize: 11 }}>✓ OK</span>;
      },
    },
    { key: "lostReason", label: "Lost Reason", width: 115, render: (v) => v ? <span style={{ fontSize: 11 }}>{v}</span> : <span style={{ color: B.muted, fontSize: 11 }}>—</span> },
    { key: "email", label: "Email",  width: 175 },
    { key: "phone", label: "Phone",  width: 140 },
    { key: "notes", label: "Notes",  width: 195 },
    {
      // ── EDIT BUTTON COLUMN ──
      key: "_actions", label: "", width: 110,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 5 }}>
          <button
            onClick={e => { e.stopPropagation(); setEditLead(r); }}
            style={actionBtn(B.blue, B.blue + "12")}
            title="Edit lead"
          >✏️ Edit</button>
          {r.status === "Won" && (
            <button
              onClick={e => { e.stopPropagation(); handleConvertToClient(r); }}
              style={actionBtn(B.green, B.green + "12")}
              title="Convert to client"
            >↗</button>
          )}
        </div>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0 }}>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 }} className="stat-grid-6">
        {pipelineStats.slice(0, 5).map((s) => (
          <StatCard key={s.stage} label={s.stage} value={s.count} sub={aed(s.value)} color={STAGE_COLORS[s.stage]} />
        ))}
        <StatCard
          label="Dupes" value={dupeIds.size}
          color={dupeIds.size > 0 ? B.orange : B.green}
          sub={dupeIds.size > 0 ? "review needed" : "clean"}
        />
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>

        {/* Left: filters */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {statuses.map((s) => (
            <FilterBtn key={s} active={filter === s} label={`${s}${s !== "All" ? ` (${leads.filter(l=>l.status===s).length})` : ""}`} onClick={() => setFilter(s)} />
          ))}
          <div style={{ width: 1, height: 20, background: B.border, margin: "0 4px" }} />
          <FilterBtn active={showDupesOnly} label={`⚠ Dupes (${dupeIds.size})`}      onClick={() => { setShowDupesOnly(!showDupesOnly); setShowStaleOnly(false); }} danger />
          <FilterBtn active={showStaleOnly} label={`⏰ Stale (${staleLeads.length})`} onClick={() => { setShowStaleOnly(!showStaleOnly); setShowDupesOnly(false); }} warn />
        </div>

        {/* Right: actions + view toggles */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

          {/* Bulk move bar */}
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
            <button onClick={handleMergeDupes} style={actionBtn(B.orange, B.orange + "10")}>
              ⚡ Merge dupes ({dupeIds.size})
            </button>
          )}

          <ModeBtn active={displayMode === "table"}  label="⊞ Table"  onClick={() => setDisplayMode("table")} />
          <ModeBtn active={displayMode === "kanban"} label="⬛ Kanban" onClick={() => setDisplayMode("kanban")} />

          <button
            onClick={() => setAddModal(true)}
            style={{ padding: "6px 16px", background: B.blue, color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: 0.2, boxShadow: `0 2px 6px ${B.blue}40` }}
          >+ Add Lead</button>
        </div>
      </div>

      {/* ── Content ── */}
      {displayMode === "kanban" ? (
        <KanbanBoard
          leads={rows}
          onDrop={handleKanbanDrop}
          dupeIds={dupeIds}
          staleLeads={staleLeads}
          onConvert={handleConvertToClient}
          onEdit={setEditLead}
          onDetail={(lead) => { setDetailLead(lead); setHoverLead(null); }}
          onHover={(lead, pos) => { setHoverLead(lead); setHoverPos(pos); }}
          onHoverEnd={() => setHoverLead(null)}
          onSetFollowUp={(lead, date) => {
            const updated = data.leads.map(l => l.id === lead.id ? { ...l, followUpDate: date, updatedAt: new Date().toISOString().slice(0,10) } : l);
            setData({ ...data, leads: updated });
          }}
        />
      ) : (
        <SectionCard title={`Leads — ${rows.length} record${rows.length !== 1 ? "s" : ""}`} style={{ flex: 1, minHeight: 0 }}>
          {viewMode === "excel" ? (
            <>
              <div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div>
              <div className="excel-table-wrap">
                <ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} />
              </div>
            </>
          ) : (
            /* NTable — pass onChange + onDelete so inline selects work */
            <NTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} />
          )}
        </SectionCard>
      )}

      {/* ── Lost Reasons footer ── */}
      {lostReasons.length > 0 && (
        <SectionCard title="Lost Reasons Breakdown">
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

      {/* ── Hover Detail Card (follows cursor — table & kanban) ── */}
      {hoverLead && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "none" }}
        >
          <LeadHoverCard
            lead={hoverLead}
            pos={hoverPos}
            staleLeads={staleLeads}
            dupeIds={dupeIds}
            onClose={() => setHoverLead(null)}
            onEdit={() => { setEditLead(hoverLead); setHoverLead(null); }}
            onDetail={() => { setDetailLead(hoverLead); setHoverLead(null); }}
          />
        </div>
      )}

      {/* ── Add Modal ── */}
      {addModal && (
        <FormModal
          title="Add New Lead"
          fields={ADD_FIELDS}
          onSave={handleAdd}
          onClose={() => setAddModal(false)}
        />
      )}

      {/* ── Edit Modal ── */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onSave={handleEditSave}
          onClose={() => setEditLead(null)}
          onConvert={handleConvertToClient}
          onDelete={() => {
            if (!window.confirm("Delete this lead?")) return;
            setData({ ...data, leads: data.leads.filter(l => l.id !== editLead.id) });
            setEditLead(null);
          }}
        />
      )}

      {/* ── Detail Drawer ── */}
      {detailLead && (
        <LeadDetailDrawer
          lead={detailLead}
          staleLeads={staleLeads}
          dupeIds={dupeIds}
          onClose={() => setDetailLead(null)}
          onEdit={() => { setEditLead(detailLead); setDetailLead(null); }}
          onConvert={handleConvertToClient}
        />
      )}
    </div>
  );
}

// ─── Edit Lead Modal ────────────────────────────────────────────────────────────
function EditLeadModal({ lead, onSave, onClose, onConvert, onDelete }) {
  const [vals, setVals] = useState({
    name:       lead.name       || "",
    email:      lead.email      || "",
    phone:      lead.phone      || "",
    service:    lead.service    || "UAE Visa",
    status:     lead.status     || "New",
    value:      lead.value      || "",
    source:     lead.source     || "Other",
    lostReason: lead.lostReason || "",
    notes:      lead.notes      || "",
    followUpDate: lead.followUpDate || "",
  });

  const set = (k, v) => setVals(prev => ({ ...prev, [k]: v }));

  const labelStyle = { fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3, display: "block", letterSpacing: 0.3 };
  const inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" };
  const selectStyle = { ...inputStyle, background: "#fff", cursor: "pointer" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} />
      <div
        style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Edit Lead</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{lead.id} · Added {lead.date}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
        </div>

        {/* Form grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
          {[
            { k: "name",  label: "Full Name",    type: "text" },
            { k: "email", label: "Email",         type: "email" },
            { k: "phone", label: "Phone",         type: "text" },
            { k: "value", label: "Value (AED)",   type: "number" },
          ].map(({ k, label, type }) => (
            <div key={k}>
              <label style={labelStyle}>{label}</label>
              <input type={type} value={vals[k]} onChange={e => set(k, e.target.value)} style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#3b82f6"}
                onBlur={e => e.target.style.borderColor = "#e2e8f0"}
              />
            </div>
          ))}

          <div>
            <label style={labelStyle}>Service</label>
            <select value={vals.service} onChange={e => set("service", e.target.value)} style={selectStyle}>
              {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select value={vals.status} onChange={e => set("status", e.target.value)}
              style={{ ...selectStyle, color: STAGE_COLORS[vals.status] || "#0f172a", fontWeight: 700 }}>
              {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Source</label>
            <select value={vals.source} onChange={e => set("source", e.target.value)} style={selectStyle}>
              {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Lost Reason</label>
            <select value={vals.lostReason} onChange={e => set("lostReason", e.target.value)} style={selectStyle}>
              {LOST_OPTIONS.map(o => <option key={o} value={o}>{o || "— None —"}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Follow-up Date</label>
            <input type="date" value={vals.followUpDate} onChange={e => set("followUpDate", e.target.value)} style={inputStyle}
              onFocus={e => e.target.style.borderColor = "#3b82f6"}
              onBlur={e => e.target.style.borderColor = "#e2e8f0"}
            />
          </div>
        </div>

        {/* Notes full width */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={vals.notes} onChange={e => set("notes", e.target.value)} rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            onFocus={e => e.target.style.borderColor = "#3b82f6"}
            onBlur={e => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onDelete}
              style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #fca5a5", background: "#fff5f5", color: "#ef4444", cursor: "pointer" }}>
              🗑 Delete
            </button>
            {vals.status === "Won" && (
              <button onClick={() => { onConvert({ ...lead, ...vals }); onClose(); }}
                style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #6ee7b7", background: "#f0fdf4", color: "#10b981", cursor: "pointer" }}>
                ↗ Convert to Client
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: "7px 18px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={() => onSave(vals)}
              style={{ padding: "7px 22px", borderRadius: 7, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px #3b82f640" }}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lead Detail Drawer ─────────────────────────────────────────────────────────
function LeadDetailDrawer({ lead, staleLeads, dupeIds, onClose, onEdit, onConvert }) {
  const score = scoreLead(lead);
  const label = scoreLabel(score);
  const isStale = staleLeads.some(s => s.id === lead.id);
  const isDupe  = dupeIds.has(lead.id);

  const row = (icon, k, v) => v ? (
    <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#334155" }}>
      <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: "#94a3b8", minWidth: 80 }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </div>
  ) : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(1px)" }} />
      <div style={{ position: "relative", zIndex: 1, width: 360, maxWidth: "95vw", background: "#fff", height: "100%", overflowY: "auto", padding: 24, boxShadow: "-8px 0 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 18 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>{lead.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={pill(STAGE_COLORS[lead.status] || "#64748b", (STAGE_COLORS[lead.status] || "#64748b") + "18")}>{lead.status}</span>
              <span style={pill(SCORE_COLORS[label], SCORE_COLORS[label] + "18")}>{score} {label}</span>
              {isStale && <span style={pill("#f59e0b", "#fef3c7")}>⏰ Stale</span>}
              {isDupe  && <span style={pill("#f59e0b", "#fef3c7")}>⚠ Dupe</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>

        {/* Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#f8fafc", borderRadius: 10, padding: "14px 16px" }}>
          {row("💼", "Service",   lead.service)}
          {row("📅", "Date",      lead.date)}
          {row("💰", "Value",     aed(lead.value))}
          {row("📣", "Source",    lead.source)}
          {row("✉️", "Email",     lead.email)}
          {row("📱", "Phone",     lead.phone)}
          {lead.followUpDate && row("🗓", "Follow-up", lead.followUpDate)}
          {lead.lostReason && row("❌", "Lost Reason", lead.lostReason)}
        </div>

        {/* Notes */}
        {lead.notes && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, letterSpacing: 0.5 }}>NOTES</div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.6, background: "#f8fafc", borderRadius: 8, padding: "10px 12px" }}>{lead.notes}</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onEdit}
            style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>
            ✏️ Edit Lead
          </button>
          {lead.status === "Won" && (
            <button onClick={() => { onConvert(lead); onClose(); }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "#10b981", color: "#fff", border: "none", cursor: "pointer" }}>
              ↗ Convert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lead Hover Card (follows cursor — table + kanban) ──────────────────────────
function LeadHoverCard({ lead, pos, staleLeads, dupeIds, onClose, onEdit, onDetail }) {
  const ref = useRef(null);
  const score  = scoreLead(lead);
  const sLabel = scoreLabel(score);
  const isStale = staleLeads.some(s => s.id === lead.id);
  const isDupe  = dupeIds.has(lead.id);

  // Position the card so it never overflows viewport
  const [style, setStyle] = useState({ top: 0, left: 0, opacity: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const { innerWidth: W, innerHeight: H } = window;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const MARGIN = 12, OFFSET = 16;
    let x = pos.x + OFFSET;
    let y = pos.y + OFFSET;
    if (x + w > W - MARGIN) x = pos.x - w - OFFSET;
    if (y + h > H - MARGIN) y = pos.y - h - OFFSET;
    setStyle({ position: "fixed", top: y, left: x, zIndex: 9999, opacity: 1, transition: "opacity 0.12s" });
  }, [pos]);

  return (
    <div ref={ref} style={{
      ...style,
      background: "#fff",
      borderRadius: 12,
      padding: "14px 16px",
      width: 260,
      boxShadow: "0 8px 32px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08)",
      border: "1.5px solid #e2e8f0",
      pointerEvents: "none",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", marginBottom: 6 }}>{lead.name}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={pill(STAGE_COLORS[lead.status] || "#64748b", (STAGE_COLORS[lead.status] || "#64748b") + "18")}>{lead.status}</span>
        <span style={pill(SCORE_COLORS[sLabel], SCORE_COLORS[sLabel] + "18")}>{score} {sLabel}</span>
        {isStale && <span style={pill("#f59e0b", "#fef3c7")}>⏰ Stale</span>}
        {isDupe  && <span style={pill("#f59e0b", "#fef3c7")}>⚠ Dupe</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
        {lead.service && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>💼 Service</span><span style={{ fontWeight: 500, color: "#334155" }}>{lead.service}</span></div>}
        {lead.value   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>💰 Value</span><span style={{ fontWeight: 600, color: "#10b981" }}>{aed(lead.value)}</span></div>}
        {lead.email   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>✉️ Email</span><span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.email}</span></div>}
        {lead.phone   && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>📱 Phone</span><span style={{ color: "#334155" }}>{lead.phone}</span></div>}
        {lead.source  && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>📣 Source</span><span style={{ color: "#334155" }}>{lead.source}</span></div>}
        {lead.followUpDate && <div style={{ display: "flex", gap: 6 }}><span style={{ color: "#94a3b8", width: 70 }}>🗓 Follow-up</span><span style={{ color: "#3b82f6", fontWeight: 600 }}>{lead.followUpDate}</span></div>}
      </div>
      {lead.notes && (
        <div style={{ marginTop: 8, padding: "7px 9px", background: "#f8fafc", borderRadius: 7, fontSize: 11, color: "#64748b", lineHeight: 1.5, borderLeft: "3px solid #e2e8f0" }}>
          {lead.notes.length > 90 ? lead.notes.slice(0, 90) + "…" : lead.notes}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10, color: "#cbd5e1", textAlign: "center", fontStyle: "italic" }}>Click to open full details</div>
    </div>
  );
}

// ─── Kanban Board ────────────────────────────────────────────────────────────────
function KanbanBoard({ leads, onDrop, dupeIds, staleLeads, onConvert, onEdit, onSetFollowUp, onHover, onHoverEnd, onDetail }) {
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [editFollowUp, setEditFollowUp] = useState(null);

  const handleDragOver = (e, stage) => { e.preventDefault(); setDragOver(stage); };
  const handleDrop = (e, stage) => {
    e.preventDefault();
    if (dragId) onDrop(dragId, stage);
    setDragId(null); setDragOver(null);
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(150px, 1fr))`,
      gap: 10, flex: 1, minHeight: 0, overflow: "auto",
    }}>
      {PIPELINE_STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.status === stage);
        const stageValue = stageLeads.reduce((a, l) => a + (l.value || 0), 0);
        const isOver = dragOver === stage;
        return (
          <div
            key={stage}
            onDragOver={e => handleDragOver(e, stage)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, stage)}
            style={{
              background: isOver ? STAGE_COLORS[stage] + "10" : "#f8fafc",
              borderRadius: 12,
              padding: "10px 8px",
              minWidth: 150,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: `2px solid ${isOver ? STAGE_COLORS[stage] + "60" : "transparent"}`,
              transition: "all 0.15s",
            }}
          >
            {/* Column header */}
            <div style={{ padding: "4px 4px 8px", borderBottom: `2px solid ${STAGE_COLORS[stage]}30` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: STAGE_COLORS[stage], textTransform: "uppercase", letterSpacing: 1 }}>{stage}</span>
                <span style={{ fontSize: 11, background: STAGE_COLORS[stage], color: "#fff", borderRadius: 10, padding: "1px 8px", fontWeight: 700 }}>{stageLeads.length}</span>
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{aed(stageValue)}</div>
            </div>

            {/* Cards */}
            <div style={{ overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              {stageLeads.length === 0 && (
                <div style={{ textAlign: "center", padding: "18px 0", color: "#cbd5e1", fontSize: 11, fontStyle: "italic" }}>Drop here</div>
              )}
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
                    onDragStart={() => { setDragId(lead.id); onHoverEnd && onHoverEnd(); }}
                    onClick={(e) => { e.stopPropagation(); onDetail && onDetail(lead); }}
                    onMouseEnter={e => { onHover && onHover(lead, { x: e.clientX, y: e.clientY }); }}
                    onMouseMove={e => { onHover && onHover(lead, { x: e.clientX, y: e.clientY }); }}
                    onMouseLeave={() => { onHoverEnd && onHoverEnd(); }}
                    style={{
                      background: "#fff",
                      borderRadius: 9,
                      padding: "10px 11px",
                      cursor: "pointer",
                      border: `1.5px solid ${isDupe ? "#f59e0b40" : "#e2e8f0"}`,
                      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      transition: "box-shadow 0.15s, transform 0.1s",
                    }}
                    onMouseOver={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseOut={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = ""; }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                      <span style={{ lineHeight: 1.3 }}>{lead.name}</span>
                      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                        {isDupe && <span title="Duplicate" style={{ fontSize: 9, color: "#f59e0b" }}>⚠</span>}
                        <button onClick={() => onEdit(lead)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#94a3b8", padding: 0, lineHeight: 1 }} title="Edit">✏️</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6 }}>{lead.service}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isStale ? 4 : 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>{aed(lead.value)}</span>
                      <span style={pill(SCORE_COLORS[sLabel], SCORE_COLORS[sLabel] + "15")}>{sLabel}</span>
                    </div>
                    {isStale && <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>⏰ Follow up needed</div>}

                    {/* Follow-up setter */}
                    <div style={{ marginTop: 7, borderTop: "1px solid #f1f5f9", paddingTop: 6 }}>
                      {isEditingFU ? (
                        <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                          <input type="date" defaultValue={lead.followUpDate || ""}
                            onBlur={e => { onSetFollowUp(lead, e.target.value); setEditFollowUp(null); }}
                            autoFocus
                            style={{ fontSize: 10, border: "1px solid #3b82f6", borderRadius: 4, padding: "2px 4px", flex: 1, fontFamily: "inherit" }} />
                          <button onClick={() => setEditFollowUp(null)} style={{ fontSize: 10, background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setEditFollowUp(lead.id); }}
                          style={{ fontSize: 10, color: lead.followUpDate ? "#3b82f6" : "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                          📅 {lead.followUpDate ? `Follow up: ${lead.followUpDate}` : "Set follow-up"}
                        </button>
                      )}
                    </div>

                    {stage === "Won" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onConvert(lead); }}
                        style={{ marginTop: 7, width: "100%", fontSize: 10, fontWeight: 700, padding: "4px 0", background: "#f0fdf4", color: "#10b981", border: "1px solid #6ee7b740", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
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

// ─── Tiny UI helpers ────────────────────────────────────────────────────────────
function FilterBtn({ active, label, onClick, danger, warn }) {
  const color = danger ? "#ef4444" : warn ? "#f59e0b" : B.blue;
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11,
      border: `1.5px solid ${active ? color : B.border}`,
      background: active ? color : "#fff",
      color: active ? "#fff" : B.muted,
      cursor: "pointer", fontWeight: active ? 700 : 400,
      transition: "all 0.15s",
    }}>{label}</button>
  );
}

function ModeBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 13px", borderRadius: 7, fontSize: 11, fontWeight: 600,
      border: `1.5px solid ${active ? B.blue : B.border}`,
      background: active ? B.blue + "15" : "#fff",
      color: active ? B.blue : B.muted,
      cursor: "pointer", transition: "all 0.15s",
    }}>{label}</button>
  );
}
