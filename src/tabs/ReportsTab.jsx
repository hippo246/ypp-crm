import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { B } from "../constants";
import { aed } from "../helpers";

// ─── CSV export (existing, preserved) ────────────────────────────────────────
function exportCSV(title, metrics) {
  const rows = [["Metric","Value"], ...metrics];
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${title.replace(/\s/g,"_")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Excel export (SheetJS) ───────────────────────────────────────────────────
function exportExcel(title, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${title.replace(/\s/g,"_")}.xlsx`);
}

// ─── PDF export (print stylesheet) ───────────────────────────────────────────
function exportPDF(title, rows) {
  const html = `
    <html><head><title>${title}</title>
    <style>body{font-family:sans-serif;padding:24px}h2{margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f1f5f9;font-weight:700}</style>
    </head><body><h2>${title}</h2>
    <table><thead><tr>${rows[0].map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></body></html>`;
  const win = window.open("","_blank");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

// ─── Dynamic columns per module ───────────────────────────────────────────────
const MODULE_COLS = {
  tasks:      [{ key:"title",    label:"Task"       },{ key:"status",   label:"Status"   },{ key:"priority", label:"Priority" },{ key:"assigned", label:"Assigned" },{ key:"due", label:"Due" }],
  leads:      [{ key:"name",     label:"Lead"       },{ key:"service",  label:"Service"  },{ key:"status",   label:"Status"   },{ key:"value",    label:"Value",   fmt: aed },{ key:"source", label:"Source" },{ key:"date", label:"Date" }],
  clients:    [{ key:"name",     label:"Client"     },{ key:"service",  label:"Service"  },{ key:"status",   label:"Status"   },{ key:"value",    label:"Value",   fmt: aed },{ key:"renewal", label:"Renewal" }],
  accounting: [{ key:"client",   label:"Client"     },{ key:"desc",     label:"Desc"     },{ key:"amount",   label:"Amount",  fmt: aed },{ key:"paid", label:"Paid", fmt: aed },{ key:"status", label:"Status" },{ key:"due", label:"Due" }],
  inventory:  [{ key:"name",     label:"Item"       },{ key:"category", label:"Category" },{ key:"qty",      label:"Qty"      },{ key:"status",   label:"Status"  }],
  suppliers:  [{ key:"name",     label:"Supplier"   },{ key:"category", label:"Category" },{ key:"status",   label:"Status"   },{ key:"balance",  label:"Balance", fmt: aed }],
};

const STATUSES_BY_MODULE = {
  tasks:      ["Pending","In Progress","Done","Blocked"],
  leads:      ["New","Contacted","Qualified","Proposal","Won","Lost"],
  clients:    ["Active","Pending","Expired"],
  accounting: ["Unpaid","Partial","Paid","Overdue"],
  inventory:  ["In Stock","Low Stock","Critical"],
  suppliers:  ["Active","Inactive"],
};

const FREQ_OPTIONS = ["Daily","Weekly","Bi-weekly","Monthly","Quarterly"];
const PRESET_DEFAULTS = [];

const ReportsTab = ({ data }) => {
  const refreshedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // ── existing summary cards data ──────────────────────────────────────────────
  const totalRevenue = data.accounting.reduce((s, i) => s + i.paid, 0);
  const outstanding  = data.accounting.reduce((s, i) => s + (i.amount - i.paid), 0);
  const wonValue     = data.leads.filter((l) => l.status === "Won").reduce((s, l) => s + l.value, 0);

  const summaryReports = [
    { title: "Revenue Summary",  desc: "Total collected, outstanding, and invoiced amounts.", icon: "◆", color: B.blue,   metrics: [["Total Invoiced", aed(totalRevenue+outstanding)],["Collected",aed(totalRevenue)],["Outstanding",aed(outstanding)]] },
    { title: "Lead Performance", desc: "Pipeline conversion and lead source analysis.",       icon: "▲", color: B.green,  metrics: [["Total Leads",data.leads.length],["Won",data.leads.filter(l=>l.status==="Won").length],["Won Value",aed(wonValue)]] },
    { title: "Client Health",    desc: "Active, pending, and expired client statuses.",       icon: "⬡", color: B.accent, metrics: [["Active",data.clients.filter(c=>c.status==="Active").length],["Pending",data.clients.filter(c=>c.status==="Pending").length],["Expired",data.clients.filter(c=>c.status==="Expired").length]] },
    { title: "Task Report",      desc: "Completion rate and pending task breakdown.",         icon: "◈", color: B.yellow, metrics: [["Total",data.tasks.length],["Done",data.tasks.filter(t=>t.status==="Done").length],["Pending",data.tasks.filter(t=>t.status==="Pending").length]] },
    { title: "Inventory Report", desc: "Stock levels and reorder alerts.",                   icon: "▤", color: B.orange, metrics: [["Total Items",data.inventory.length],["Low Stock",data.inventory.filter(i=>i.status==="Low Stock").length],["Critical",data.inventory.filter(i=>i.status==="Critical").length]] },
    { title: "Supplier Summary", desc: "Active suppliers and outstanding payables.",          icon: "▥", color: "#7C3AED",metrics: [["Total",data.suppliers.length],["Active",data.suppliers.filter(s=>s.status==="Active").length],["Payable",aed(data.suppliers.reduce((s,x)=>s+x.balance,0))]] },
  ];

  // ── custom report state ──────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState("summary"); // "summary" | "custom"
  const [presets, setPresets] = useState(PRESET_DEFAULTS);
  const [presetName, setPresetName] = useState("");
  const [filters, setFilters] = useState({ module: "tasks", dateFrom: "", dateTo: "", status: "", assignee: "", priority: "" });
  const [schedFreq, setSchedFreq] = useState("");
  const [schedEmail, setSchedEmail] = useState("");
  const [schedSaved, setSchedSaved] = useState(false);

  const fset = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  // ── filtered rows ─────────────────────────────────────────────────────────────
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

  const cols = MODULE_COLS[filters.module] || [];

  // ── build rows for export ────────────────────────────────────────────────────
  const exportRows = () => {
    const header = cols.map(c => c.label);
    const body   = filteredRows.map(row => cols.map(c => c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? "")));
    return [header, ...body];
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    setPresets(p => [...p, { name: presetName.trim(), filters: { ...filters } }]);
    setPresetName("");
  };

  const loadPreset = (p) => setFilters({ ...p.filters });
  const deletePreset = (i) => setPresets(p => p.filter((_, idx) => idx !== i));

  const saveSchedule = () => {
    if (!schedFreq) return;
    setSchedSaved(true);
    setTimeout(() => setSchedSaved(false), 2500);
  };

  const inputStyle = {
    border: `1px solid ${B.border}`, borderRadius: 6, padding: "6px 10px",
    fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff",
  };
  const btnStyle = (active, color = B.blue) => ({
    padding: "5px 12px", borderRadius: 20, fontSize: 11, border: `1px solid ${active ? color : B.border}`,
    background: active ? color : B.white, color: active ? "#fff" : B.muted, cursor: "pointer", fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Top bar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, background: B.light, borderRadius: 8, padding: 3 }}>
          {[["summary","Summary Cards"],["custom","Custom Report"]].map(([v,l]) => (
            <button key={v} onClick={() => setActiveView(v)}
              style={{ padding: "5px 14px", borderRadius: 6, fontSize: 11, border: "none", background: activeView===v?"#fff":"transparent", color: activeView===v?B.text:B.muted, cursor: "pointer", fontWeight: activeView===v?700:400, boxShadow: activeView===v?"0 1px 4px rgba(0,0,0,0.08)":"none", fontFamily: "inherit" }}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: B.muted }}>↺ Data as of {refreshedAt}</span>
      </div>

      {/* ── SUMMARY CARDS (existing) ── */}
      {activeView === "summary" && (
        <div className="reports-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          {summaryReports.map((r) => (
            <div key={r.title} style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 16, borderTop: `3px solid ${r.color}` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16, color: r.color, flexShrink: 0 }}>{r.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: B.muted }}>{r.desc}</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => exportCSV(r.title, r.metrics)} title="Export CSV"
                    style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted }}>
                    ↓ CSV
                  </button>
                  <button onClick={() => exportExcel(r.title, [["Metric","Value"], ...r.metrics])} title="Export Excel"
                    style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: "#e8fce8", border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: "#16a34a" }}>
                    ↓ XLS
                  </button>
                  <button onClick={() => exportPDF(r.title, [["Metric","Value"], ...r.metrics])} title="Export PDF"
                    style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: "#fce8e8", border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.red }}>
                    ↓ PDF
                  </button>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${B.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {r.metrics.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: B.muted }}>{k}</span>
                    <span style={{ fontWeight: 700, color: B.text }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CUSTOM REPORT ── */}
      {activeView === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Saved presets */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: B.text }}>Saved Presets</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {presets.length === 0 && <span style={{ fontSize: 11, color: B.muted }}>No presets saved yet.</span>}
              {presets.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: B.light, borderRadius: 20, padding: "4px 10px", fontSize: 11 }}>
                  <button onClick={() => loadPreset(p)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 600, color: B.blue, padding: 0, fontSize: 11, fontFamily: "inherit" }}>{p.name}</button>
                  <button onClick={() => deletePreset(i)} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name…" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={savePreset} style={{ ...btnStyle(true), borderRadius: 6 }}>Save Current Filters</button>
            </div>
          </div>

          {/* Filters */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 12, color: B.text }}>Filters</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
              {/* Module */}
              <div>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>MODULE</div>
                <select value={filters.module} onChange={e => fset("module", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                  {Object.keys(MODULE_COLS).map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
                </select>
              </div>
              {/* Date from */}
              <div>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>DATE FROM</div>
                <input type="date" value={filters.dateFrom} onChange={e => fset("dateFrom", e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              {/* Date to */}
              <div>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>DATE TO</div>
                <input type="date" value={filters.dateTo} onChange={e => fset("dateTo", e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              {/* Status */}
              <div>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>STATUS</div>
                <select value={filters.status} onChange={e => fset("status", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">All</option>
                  {(STATUSES_BY_MODULE[filters.module] || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* Assignee */}
              {(filters.module === "tasks") && (
                <div>
                  <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>ASSIGNEE</div>
                  <input value={filters.assignee} onChange={e => fset("assignee", e.target.value)} placeholder="Name…" style={{ ...inputStyle, width: "100%" }} />
                </div>
              )}
              {/* Priority */}
              {(filters.module === "tasks" || filters.module === "leads") && (
                <div>
                  <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>PRIORITY</div>
                  <select value={filters.priority} onChange={e => fset("priority", e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                    <option value="">All</option>
                    {["High","Medium","Low"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setFilters({ module: filters.module, dateFrom: "", dateTo: "", status: "", assignee: "", priority: "" })}
                style={{ fontSize: 11, color: B.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                ✕ Clear filters
              </button>
            </div>
          </div>

          {/* Preview table */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                Preview — {filters.module.charAt(0).toUpperCase()+filters.module.slice(1)}
                <span style={{ fontSize: 11, color: B.muted, fontWeight: 400, marginLeft: 8 }}>{filteredRows.length} rows</span>
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => exportCSV(`${filters.module}_report`, exportRows().slice(1).map((r,i) => exportRows()[0].map((h,j) => [h, r[j]]).flat()))}
                  style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted }}>
                  ↓ CSV
                </button>
                <button onClick={() => exportExcel(`${filters.module}_report`, exportRows())}
                  style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: "#e8fce8", border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: "#16a34a" }}>
                  ↓ Excel
                </button>
                <button onClick={() => exportPDF(`${filters.module.charAt(0).toUpperCase()+filters.module.slice(1)} Report`, exportRows())}
                  style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, background: "#fce8e8", border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.red }}>
                  ↓ PDF
                </button>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: B.light }}>
                    {cols.map(c => (
                      <th key={c.key} style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, fontSize: 10, color: B.muted, letterSpacing: "0.5px", whiteSpace: "nowrap" }}>{c.label.toUpperCase()}</th>
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

          {/* Scheduled report UI */}
          <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: B.text }}>
              Schedule Report
              <span style={{ fontSize: 10, fontWeight: 400, color: B.muted, marginLeft: 8 }}>UI only — no backend</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>FREQUENCY</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {FREQ_OPTIONS.map(f => (
                    <button key={f} onClick={() => setSchedFreq(f)} style={{ ...btnStyle(schedFreq === f), fontSize: 10 }}>{f}</button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, marginBottom: 4 }}>EMAIL</div>
                <input value={schedEmail} onChange={e => setSchedEmail(e.target.value)} placeholder="recipient@email.com" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <button onClick={saveSchedule} style={{ ...btnStyle(true, B.green), borderRadius: 6, padding: "7px 14px" }}>
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
