import { useState, useEffect, useRef } from "react";
import { B } from "../constants";

/**
 * FormModal — enhanced
 *
 * Field additions:
 *   required   boolean      — marks field as required, blocks save
 *   group      string       — groups fields under a sub-heading
 *   hint       string       — small helper text under the input
 *   validate   fn(val)→str  — returns error string or null
 *
 * Modal additions:
 *   loading    boolean      — shows spinner on Save button
 *   dark       boolean      — dark surface
 *   width      number       — override default 460
 *   danger     boolean      — Save button turns red (for destructive confirms)
 *   saveLabel  string       — custom save button text
 */
const FormModal = ({
  title,
  fields,
  onSave,
  onClose,
  loading = false,
  dark = false,
  width = 460,
  danger = false,
  saveLabel = "Save",
}) => {
  const init   = Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""]));
  const [vals, setVals]   = useState(init);
  const [errors, setErrors] = useState({});
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const surface = dark ? "#1a1d27" : "#fff";
  const border  = dark ? "#2a2d3a" : B.border;
  const text    = dark ? "#e8eaf0" : B.text;
  const muted   = dark ? "#9ca3af" : B.muted;
  const inputBg = dark ? "#252836" : "#fff";

  const set = (key, val) => {
    setVals(v => ({ ...v, [key]: val }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: null }));
  };

  const validate = () => {
    const errs = {};
    fields.forEach(f => {
      if (f.required && !vals[f.key]?.toString().trim()) {
        errs[f.key] = `${f.label} is required`;
      }
      if (f.validate && vals[f.key]) {
        const msg = f.validate(vals[f.key]);
        if (msg) errs[f.key] = msg;
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(vals);
    onClose();
  };

  // Group fields
  const groups = [];
  const ungrouped = [];
  const seenGroups = new Set();
  fields.forEach(f => {
    if (f.group) {
      if (!seenGroups.has(f.group)) { seenGroups.add(f.group); groups.push(f.group); }
    } else {
      ungrouped.push(f);
    }
  });

  const renderField = (f, idx) => {
    const err = errors[f.key];
    const isFirst = idx === 0;
    return (
      <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
            {f.label}
          </span>
          {f.required && <span style={{ fontSize: 10, color: B.red }}>*</span>}
        </label>

        {f.type === "select" ? (
          <select
            ref={isFirst ? firstRef : undefined}
            value={vals[f.key]}
            onChange={e => set(f.key, e.target.value)}
            style={{
              border: `1px solid ${err ? B.red : border}`, borderRadius: 7,
              padding: "7px 10px", fontSize: 13, fontFamily: "inherit",
              outline: "none", background: inputBg, color: text,
              boxShadow: err ? `0 0 0 3px ${B.red}20` : "none",
            }}
          >
            {(f.options || []).map(o => <option key={o} value={o}>{o || "—"}</option>)}
          </select>

        ) : f.type === "textarea" ? (
          <textarea
            ref={isFirst ? firstRef : undefined}
            value={vals[f.key]}
            onChange={e => set(f.key, e.target.value)}
            rows={3}
            placeholder={f.placeholder || ""}
            style={{
              border: `1px solid ${err ? B.red : border}`, borderRadius: 7,
              padding: "7px 10px", fontSize: 13, fontFamily: "inherit",
              outline: "none", resize: "vertical", background: inputBg, color: text,
              boxShadow: err ? `0 0 0 3px ${B.red}20` : "none",
            }}
          />

        ) : f.type === "checkbox" ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!vals[f.key]}
              onChange={e => set(f.key, e.target.checked)}
              style={{ width: 15, height: 15, accentColor: B.blue }}
            />
            <span style={{ color: text }}>{f.placeholder || f.label}</span>
          </label>

        ) : (
          <input
            ref={isFirst ? firstRef : undefined}
            type={f.type || "text"}
            value={vals[f.key]}
            onChange={e => set(f.key, e.target.value)}
            onKeyDown={e => e.key === "Enter" && !f.multiline && handleSave()}
            placeholder={f.placeholder || ""}
            style={{
              border: `1px solid ${err ? B.red : border}`, borderRadius: 7,
              padding: "7px 10px", fontSize: 13, fontFamily: "inherit",
              outline: "none", background: inputBg, color: text,
              transition: "border-color 0.15s, box-shadow 0.15s",
              boxShadow: err ? `0 0 0 3px ${B.red}20` : "none",
            }}
            onFocus={e => { if (!err) e.target.style.borderColor = B.accent; e.target.style.boxShadow = `0 0 0 3px ${B.accent}20`; }}
            onBlur={e  => { e.target.style.borderColor = err ? B.red : border; e.target.style.boxShadow = err ? `0 0 0 3px ${B.red}20` : "none"; }}
          />
        )}

        {f.hint && !err && (
          <span style={{ fontSize: 10, color: muted }}>{f.hint}</span>
        )}
        {err && (
          <span style={{ fontSize: 10, color: B.red, fontWeight: 600 }}>⚠ {err}</span>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
        animation: "fm-fade 0.12s ease",
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <style>{`
        @keyframes fm-fade { from { opacity:0; } to { opacity:1; } }
        @keyframes fm-slide { from { opacity:0; transform:translateY(-10px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }
      `}</style>

      <div
        style={{
          background: surface, borderRadius: 12, padding: 24,
          width: Math.min(width, window.innerWidth - 32),
          maxHeight: "88vh", overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
          border: `1px solid ${border}`,
          animation: "fm-slide 0.14s ease",
          color: text,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: text, margin: 0, letterSpacing: "-0.2px" }}>{title}</h3>
          <button onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: muted, lineHeight: 1, padding: "2px 4px" }}>
            ✕
          </button>
        </div>

        {/* Ungrouped fields */}
        {ungrouped.map((f, i) => renderField(f, i))}

        {/* Grouped fields */}
        {groups.map(group => (
          <div key={group}>
            <div style={{ fontSize: 10, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: "0.8px", margin: "16px 0 10px", borderBottom: `1px solid ${border}`, paddingBottom: 4 }}>
              {group}
            </div>
            {fields.filter(f => f.group === group).map((f, i) => renderField(f, ungrouped.length + i))}
          </div>
        ))}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${border}` }}>
          <button onClick={onClose}
            style={{
              padding: "8px 18px", borderRadius: 7, fontSize: 12, fontWeight: 600,
              border: `1px solid ${border}`, background: "transparent", color: muted, cursor: "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = dark ? "#252836" : B.light}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              padding: "8px 22px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              border: "none",
              background: loading ? (dark ? "#2a2d3a" : B.border) : danger ? B.red : B.blue,
              color: loading ? muted : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
              transition: "opacity 0.15s, transform 0.1s",
              opacity: loading ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = "0.88"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            {loading && (
              <span style={{
                width: 11, height: 11, border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%",
                display: "inline-block",
                animation: "spin 0.7s linear infinite",
              }} />
            )}
            {saveLabel}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default FormModal;
