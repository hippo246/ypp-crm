import { useState } from "react";
import { B } from "../constants";

/**
 * SectionCard — enhanced
 *
 * New props:
 *   dark         boolean         — switches to dark surface
 *   collapsible  boolean         — adds a toggle chevron
 *   defaultOpen  boolean         — initial expanded state (default true)
 *   loading      boolean         — shows skeleton shimmer overlay
 *   stickyHeader boolean         — sticks the header on scroll
 *   badge        string|number   — small badge next to title
 *   accent       string (color)  — left border accent stripe
 *   noPad        boolean         — removes inner padding wrapper
 */
const SectionCard = ({
  title,
  children,
  action,
  style: extraStyle,
  dark = false,
  collapsible = false,
  defaultOpen = true,
  loading = false,
  stickyHeader = false,
  badge = null,
  accent = null,
  noPad = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  const surface = dark ? "#1a1d27" : B.white;
  const border  = dark ? "#2a2d3a" : B.border;
  const text    = dark ? "#e8eaf0" : B.text;
  const muted   = dark ? "#6b7280" : B.muted;

  return (
    <>
      <style id="sectioncard-kf">{`
        @keyframes sc-shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        .sc-shimmer-overlay {
          position: absolute; inset: 0; z-index: 10; border-radius: inherit;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%);
          background-size: 400px 100%;
          animation: sc-shimmer 1.4s ease-in-out infinite;
          pointer-events: none;
        }
        .dark-sc .sc-shimmer-overlay {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
          background-size: 400px 100%;
        }
      `}</style>

      <div
        className={dark ? "dark-sc" : undefined}
        style={{
          background: surface,
          border: `1px solid ${border}`,
          borderLeft: accent ? `3px solid ${accent}` : `1px solid ${border}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "collapsible" ? "column" : "column",
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
          transition: "box-shadow 0.15s",
          ...extraStyle,
        }}
      >
        {/* Loading shimmer */}
        {loading && <div className="sc-shimmer-overlay" />}

        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: open ? `1px solid ${border}` : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: open ? "10px 10px 0 0" : 10,
            flexShrink: 0,
            position: stickyHeader ? "sticky" : "relative",
            top: stickyHeader ? 0 : undefined,
            zIndex: stickyHeader ? 5 : undefined,
            background: surface,
            cursor: collapsible ? "pointer" : "default",
            userSelect: "none",
          }}
          onClick={collapsible ? () => setOpen(o => !o) : undefined}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: text }}>{title}</span>
            {badge !== null && badge !== undefined && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: B.accent + "22", color: B.accent,
                borderRadius: 20, padding: "1px 7px", minWidth: 20, textAlign: "center",
              }}>
                {badge}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {action}
            {collapsible && (
              <button
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: muted, fontSize: 13, padding: "0 2px", lineHeight: 1,
                  transition: "transform 0.18s",
                  transform: open ? "rotate(0deg)" : "rotate(-90deg)",
                }}
                onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
                title={open ? "Collapse" : "Expand"}
              >
                ▾
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {open && (
          <div style={{
            flex: 1, minHeight: 0,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            padding: noPad ? 0 : undefined,
          }}>
            {children}
          </div>
        )}
      </div>
    </>
  );
};

export default SectionCard;
