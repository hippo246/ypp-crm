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
  maxHeight   = "calc(100vh - 200px)",
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

  const pad  = dense ? "5px 10px" : "8px 12px";
  const hPad = dense ? "5px 10px" : "7px 12px";
  const fs   = dense ? 11 : 12;
  const hFs  = 11;

  const SortIcon = ({ colKey }) => {
    if (!sortable) return null;
    if (sortKey !== colKey) return <span style={{ opacity: 0.25, fontSize: 9, marginLeft: 3 }}>⇅</span>;
    return <span style={{ fontSize: 9, marginLeft: 3, color: B.blue }}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  return (
    <>
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: fs }}>
          <thead>
            <tr>
              {selectable && (
                <th style={{
                  background: B.light, padding: hPad, width: 36,
                  borderBottom: `1px solid ${B.border}`,
                  position: "sticky", top: 0, zIndex: 2, textAlign: "center",
                }}>
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                    style={{ accentColor: B.blue, cursor: "pointer", width: 13, height: 13 }}
                  />
                </th>
              )}

              <th style={{
                background: B.light, padding: hPad, fontSize: hFs,
                textAlign: "left", fontWeight: 700, color: B.muted,
                borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap",
                position: "sticky", top: 0, zIndex: 2, width: 38,
              }}>
                #
              </th>

              {cols.map(c => (
                <th key={c.key}
                  onClick={() => handleSort(c.key)}
                  style={{
                    background: B.light, padding: hPad, fontSize: hFs,
                    textAlign: "left", fontWeight: 700, color: sortKey === c.key ? B.blue : B.muted,
                    borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap",
                    position: "sticky", top: 0, zIndex: 2,
                    cursor: sortable ? "pointer" : "default",
                    userSelect: "none",
                    transition: "color 0.12s",
                  }}
                >
                  {c.label}<SortIcon colKey={c.key} />
                </th>
              ))}

              {(onEdit || onDelete) && (
                <th style={{
                  background: B.light, padding: hPad, fontSize: hFs,
                  textAlign: "left", fontWeight: 700, color: B.muted,
                  borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap",
                  position: "sticky", top: 0, zIndex: 2,
                }}>
                  Actions
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length + 1 + (selectable ? 1 : 0) + ((onEdit || onDelete) ? 1 : 0)}
                  style={{ padding: "32px 16px", textAlign: "center", color: B.muted, fontSize: 12 }}
                >
                  <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>◈</div>
                  {emptyText}
                </td>
              </tr>
            )}

            {sortedRows.map((r, i) => {
              const rowId    = r.id || i;
              const isHover  = hoveredRow === rowId;
              const isSel    = selected.has(rowId);
              const rowBg    = isSel
                ? B.blue + "10"
                : isHover
                  ? B.light
                  : zebra && i % 2 === 1
                    ? "#fafbfd"
                    : "";

              return (
                <tr key={rowId}
                  onClick={() => handleRowClick?.(r)}
                  onMouseEnter={() => setHoveredRow(rowId)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    cursor: handleRowClick ? "pointer" : "default",
                    background: rowBg,
                    transition: "background 0.1s",
                    borderLeft: isSel ? `2px solid ${B.blue}` : "2px solid transparent",
                  }}
                >
                  {selectable && (
                    <td
                      style={{ padding: pad, borderBottom: `1px solid ${B.border}`, verticalAlign: "middle", textAlign: "center" }}
                      onClick={e => { e.stopPropagation(); toggleRow(rowId); }}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => {}}
                        style={{ accentColor: B.blue, cursor: "pointer", width: 13, height: 13 }}
                      />
                    </td>
                  )}

                  <td style={{ padding: pad, borderBottom: `1px solid ${B.border}`, fontSize: 10, color: B.muted, verticalAlign: "middle" }}>
                    {i + 1}
                  </td>

                  {cols.map(c => (
                    <td key={c.key}
                      style={{
                        padding: pad, borderBottom: `1px solid ${B.border}`,
                        verticalAlign: "middle",
                        maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {c.key === "name" && r.name
                        ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Avatar name={r[c.key]} size={24} />
                            {r[c.key]}
                          </div>
                        )
                        : c.render
                          ? c.render(r[c.key], r)
                          : r[c.key]
                      }
                    </td>
                  ))}

                  {(onEdit || onDelete) && (
                    <td
                      style={{ padding: pad, borderBottom: `1px solid ${B.border}`, verticalAlign: "middle", whiteSpace: "nowrap" }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", gap: 4 }}>
                        {onEdit && editFields && (
                          <button
                            onClick={() => setEditModal({ row: r, index: i })}
                            style={{
                              padding: dense ? "2px 8px" : "3px 10px", fontSize: 11,
                              background: B.light, border: `1px solid ${B.border}`,
                              borderRadius: 5, cursor: "pointer", fontFamily: "inherit", color: B.text,
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "#e2e8f0"}
                            onMouseLeave={e => e.currentTarget.style.background = B.light}
                          >
                            Edit
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => onDelete(i)}
                            style={{
                              padding: dense ? "2px 8px" : "3px 10px", fontSize: 11,
                              background: "#FEF2F2", border: "1px solid #FECACA",
                              borderRadius: 5, cursor: "pointer", fontFamily: "inherit", color: B.red,
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "#fee2e2"}
                            onMouseLeave={e => e.currentTarget.style.background = "#FEF2F2"}
                          >
                            Delete
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
