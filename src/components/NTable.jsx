import { useState, useCallback } from "react";
import { B } from "../constants";
import Avatar from "./Avatar";
import FormModal from "./FormModal";

/**
 * NTable — enhanced
 *
 * New props:
 *   sortable     boolean            — enable column sorting
 *   selectable   boolean            — checkbox row selection
 *   onSelection  fn(selectedRows)   — called when selection changes
 *   emptyText    string             — empty state message
 *   dense        boolean            — compact row padding
 *   stickyFirst  boolean            — freeze first column (name)
 *   maxHeight    string             — override scrollable area height
 *   onRowClick   fn(row)            — alias for onRow (both work)
 *   zebra        boolean            — alternating row shading
 */
const NTable = ({
  cols,
  rows,
  onRow,
  onRowClick,
  onDelete,
  onEdit,
  editFields,
  sortable    = true,
  selectable  = false,
  onSelection,
  emptyText   = "No records found",
  dense       = false,
  maxHeight   = "none",
  zebra       = false,
}) => {
  const [editModal, setEditModal] = useState(null);
  const [sortKey,   setSortKey]   = useState(null);
  const [sortDir,   setSortDir]   = useState("asc");
  const [selected,  setSelected]  = useState(new Set());
  const [hoveredRow, setHoveredRow] = useState(null);

  const handleSort = useCallback((key) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey, sortable]);

  const sortedRows = sortKey
    ? [...rows].sort((a, b) => {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        const cmp = typeof av === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : rows;

  const toggleRow = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      onSelection?.(sortedRows.filter(r => next.has(r.id || r)));
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
      onSelection?.([]);
    } else {
      const all = new Set(rows.map(r => r.id || r));
      setSelected(all);
      onSelection?.(rows);
    }
  };

  const handleEditSave = (vals) => {
    onEdit?.(editModal.index, vals);
    setEditModal(null);
  };

  const handleRowClick = onRow || onRowClick;

  const pad  = dense ? "4px 8px" : "6px 10px";
  const hPad = dense ? "4px 8px" : "6px 10px";
  const fs   = dense ? 11 : 12;
  const hFs  = 10;

  const thBase = (isActive) => ({
    background: isActive
      ? "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)"
      : "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)",
    padding: hPad, fontSize: hFs,
    textAlign: "left", fontWeight: 800,
    color: isActive ? "#2563EB" : "#64748B",
    borderBottom: isActive ? "2px solid #2563EB" : "2px solid #E2E8F0",
    whiteSpace: "nowrap",
    position: "sticky", top: 0, zIndex: 2,
    cursor: sortable ? "pointer" : "default",
    userSelect: "none",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    transition: "color 0.15s, background 0.15s",
  });

  const SortIcon = ({ colKey }) => {
    if (!sortable) return null;
    if (sortKey !== colKey) return <span style={{ opacity: 0.2, fontSize: 8, marginLeft: 4 }}>⇅</span>;
    return (
      <span style={{
        fontSize: 8, marginLeft: 4, color: "#2563EB",
        display: "inline-flex", alignItems: "center",
        background: "#DBEAFE", borderRadius: 3, padding: "1px 3px",
      }}>
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  return (
    <>
      <style id="ntable-styles">{`
        .ntable-row { }
        .ntable-row:hover td { background: linear-gradient(90deg, #EFF6FF 0%, #F8FAFC 100%) !important; }
        .ntable-row-sel td  { background: #EFF6FF !important; }
      `}</style>
      <div style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0, height: "100%", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: fs }}>
          <thead>
            <tr>
              {selectable && (
                <th style={{ ...thBase(false), width: 36, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                    style={{ accentColor: "#2563EB", cursor: "pointer", width: 13, height: 13 }}
                  />
                </th>
              )}
              <th style={{ ...thBase(false), width: 38 }}>#</th>
              {cols.map(c => (
                <th key={c.key}
                  onClick={() => handleSort(c.key)}
                  style={thBase(sortKey === c.key)}
                >
                  {c.label}<SortIcon colKey={c.key} />
                </th>
              ))}
              {(onEdit || onDelete) && (
                <th style={thBase(false)}>Actions</th>
              )}
            </tr>
          </thead>

          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + 1 + (selectable ? 1 : 0) + ((onEdit || onDelete) ? 1 : 0)}
                  style={{ padding: "48px 16px", textAlign: "center", color: B.muted, fontSize: 13, background: "#FAFBFE" }}
                >
                  <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>◈</div>
                  <div style={{ fontWeight: 600, color: "#94A3B8" }}>{emptyText}</div>
                </td>
              </tr>
            )}

            {sortedRows.map((r, i) => {
              const rowId   = r.id || i;
              const isSel   = selected.has(rowId);
              const tdBase  = {
                padding: pad,
                borderBottom: "1px solid #F1F5F9",
                verticalAlign: "middle",
                transition: "background 0.12s",
                background: isSel ? "#EFF6FF" : undefined,
              };

              return (
                <tr key={rowId}
                  className={`ntable-row${isSel ? " ntable-row-sel" : ""}`}
                  onClick={() => handleRowClick?.(r)}
                  onMouseEnter={() => setHoveredRow(rowId)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    cursor: handleRowClick ? "pointer" : "default",
                    borderLeft: isSel ? "3px solid #2563EB" : "3px solid transparent",
                    transition: "border-left 0.1s",
                  }}
                >
                  {selectable && (
                    <td style={{ ...tdBase, textAlign: "center" }}
                      onClick={e => { e.stopPropagation(); toggleRow(rowId); }}
                    >
                      <input type="checkbox" checked={isSel} onChange={() => {}}
                        style={{ accentColor: "#2563EB", cursor: "pointer", width: 13, height: 13 }} />
                    </td>
                  )}

                  {/* Row number pill */}
                  <td style={{ ...tdBase, fontSize: 10, verticalAlign: "middle" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 18, height: 18, borderRadius: 4,
                      background: isSel ? "#DBEAFE" : "#F1F5F9",
                      color: isSel ? "#2563EB" : "#94A3B8",
                      fontWeight: 700, fontSize: 9,
                      transition: "background 0.15s, color 0.15s",
                    }}>
                      {i + 1}
                    </span>
                  </td>

                  {cols.map(c => (
                    <td key={c.key} style={{
                      ...tdBase,
                      maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {c.key === "name" && r.name && !c.render ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar name={r[c.key]} size={22} />
                          <span style={{ fontWeight: 600, color: "#0F172A" }}>{r[c.key]}</span>
                        </div>
                      ) : c.render
                        ? c.render(r[c.key], r, i)
                        : <span style={{ color: "#334155" }}>{r[c.key]}</span>
                      }
                    </td>
                  ))}

                  {(onEdit || onDelete) && (
                    <td style={{ ...tdBase, whiteSpace: "nowrap" }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", gap: 5 }}>
                        {onEdit && editFields && (
                          <button
                            onClick={() => setEditModal({ row: r, index: i })}
                            style={{
                              padding: "3px 10px", fontSize: 11,
                              background: "#EFF6FF", border: "1px solid #BFDBFE",
                              borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                              color: "#2563EB", fontWeight: 600,
                              transition: "background 0.1s, transform 0.1s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#DBEAFE"; e.currentTarget.style.transform = "scale(1.04)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#EFF6FF"; e.currentTarget.style.transform = "scale(1)"; }}
                          >
                            ✏️ Edit
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => onDelete(i)}
                            style={{
                              padding: "3px 10px", fontSize: 11,
                              background: "#FEF2F2", border: "1px solid #FECACA",
                              borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                              color: "#EF4444", fontWeight: 600,
                              transition: "background 0.1s, transform 0.1s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#FEE2E2"; e.currentTarget.style.transform = "scale(1.04)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "#FEF2F2"; e.currentTarget.style.transform = "scale(1)"; }}
                          >
                            🗑 Del
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editModal && editFields && (
        <FormModal
          title="Edit record"
          fields={editFields.map(f => ({ ...f, default: editModal.row[f.key] ?? f.default ?? "" }))}
          onSave={handleEditSave}
          onClose={() => setEditModal(null)}
        />
      )}
    </>
  );
};

export default NTable;
