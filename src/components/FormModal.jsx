import { useState } from "react";
import { B } from "../constants";

const FormModal = ({ title, fields, onSave, onClose }) => {
  const init = Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""]));
  const [vals, setVals] = useState(init);

  const set = (key, val) => setVals((v) => ({ ...v, [key]: val }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 20, minWidth: 420, maxWidth: 560, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: B.blue }}>{title}</h3>
        {fields.map((f) => (
          <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: B.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{f.label}</label>
            {f.type === "select" ? (
              <select value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)}
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", background: "#fff", color: B.text }}>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={3} placeholder={f.placeholder || ""}
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical" }} />
            ) : (
              <input type={f.type || "text"} value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder || ""}
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            )}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${B.border}`, background: B.light, color: B.muted, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { onSave(vals); onClose(); }} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", background: B.blue, color: "#fff", cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default FormModal;
