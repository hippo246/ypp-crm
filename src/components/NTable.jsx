import { useState } from "react";
import { B } from "../constants";
import Avatar from "./Avatar";
import FormModal from "./FormModal";

const NTable = ({ cols, rows, onRow, onDelete, onEdit, editFields }) => {
  const [editModal, setEditModal] = useState(null); // { row, index }

  function handleEditSave(vals) {
    onEdit && onEdit(editModal.index, vals);
    setEditModal(null);
  }

  return (
    <>
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ background: B.light, padding: "7px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: B.muted, borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap", position: "sticky", top: 0 }}>#</th>
              {cols.map((c) => (
                <th key={c.key} style={{ background: B.light, padding: "7px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: B.muted, borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap", position: "sticky", top: 0 }}>
                  {c.label}
                </th>
              ))}
              {(onEdit || onDelete) && (
                <th style={{ background: B.light, padding: "7px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: B.muted, borderBottom: `1px solid ${B.border}`, whiteSpace: "nowrap", position: "sticky", top: 0 }}>Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} onClick={() => onRow && onRow(r)} style={{ cursor: onRow ? "pointer" : "default" }}
                onMouseEnter={(e) => e.currentTarget.style.background = B.light}
                onMouseLeave={(e) => e.currentTarget.style.background = ""}
              >
                <td style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, fontSize: 11, color: B.muted, verticalAlign: "middle" }}>{i + 1}</td>
                {cols.map((c) => (
                  <td key={c.key} style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, verticalAlign: "middle", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.key === "name" && r.name
                      ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={r[c.key]} size={24} />{r[c.key]}</div>
                      : c.render ? c.render(r[c.key], r) : r[c.key]}
                  </td>
                ))}
                {(onEdit || onDelete) && (
                  <td style={{ padding: "8px 12px", borderBottom: `1px solid ${B.border}`, verticalAlign: "middle", whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {onEdit && editFields && (
                        <button onClick={() => setEditModal({ row: r, index: i })}
                          style={{ padding: "3px 10px", fontSize: 11, background: B.light, border: `1px solid ${B.border}`, borderRadius: 5, cursor: "pointer", fontFamily: "inherit", color: B.text }}>
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={() => onDelete(i)}
                          style={{ padding: "3px 10px", fontSize: 11, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 5, cursor: "pointer", fontFamily: "inherit", color: B.red }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editModal && editFields && (
        <FormModal
          title="Edit record"
          fields={editFields.map((f) => ({ ...f, default: editModal.row[f.key] ?? f.default ?? "" }))}
          onSave={handleEditSave}
          onClose={() => setEditModal(null)}
        />
      )}
    </>
  );
};

export default NTable;
