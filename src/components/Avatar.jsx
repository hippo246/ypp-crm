import { useState } from "react";
import { initials, avatarColor } from "../helpers";

// ── Single Avatar ─────────────────────────────────────────────────────────────
const Avatar = ({ name, size = 28, online = false, tooltip = true, ring = false, ringColor }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
      onMouseEnter={() => tooltip && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: avatarColor(name),
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.36, fontWeight: 700, color: "#fff",
        flexShrink: 0,
        boxSizing: "border-box",
        border: ring ? `2px solid ${ringColor || "#fff"}` : "none",
        transition: "transform 0.15s",
        transform: hovered && tooltip ? "scale(1.08)" : "scale(1)",
        cursor: tooltip ? "default" : "inherit",
      }}>
        {initials(name)}
      </div>

      {/* Online dot */}
      {online && (
        <span style={{
          position: "absolute", bottom: 0, right: 0,
          width: Math.max(6, size * 0.24), height: Math.max(6, size * 0.24),
          borderRadius: "50%", background: "#22c55e",
          border: "1.5px solid #fff",
          boxSizing: "border-box",
        }} />
      )}

      {/* Tooltip */}
      {hovered && tooltip && name && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: "#1e293b", color: "#fff",
          fontSize: 10, fontWeight: 600,
          padding: "3px 8px", borderRadius: 5,
          whiteSpace: "nowrap", pointerEvents: "none",
          zIndex: 9999,
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          letterSpacing: "0.2px",
        }}>
          {name}
          {/* Arrow */}
          <span style={{
            position: "absolute", top: "100%", left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "4px solid #1e293b",
          }} />
        </div>
      )}
    </div>
  );
};

// ── Avatar Group (stacked) ─────────────────────────────────────────────────────
export const AvatarGroup = ({ names = [], size = 24, max = 4, onlineSet = new Set() }) => {
  const visible = names.slice(0, max);
  const extra   = names.length - max;
  const overlap = Math.round(size * 0.3);

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {visible.map((name, i) => (
        <div key={name + i} style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: visible.length - i }}>
          <Avatar name={name} size={size} online={onlineSet.has(name)} ring ringColor="#fff" />
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -overlap, zIndex: 0,
          width: size, height: size, borderRadius: "50%",
          background: "#94a3b8", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: size * 0.32, fontWeight: 700,
          border: "2px solid #fff", boxSizing: "border-box",
        }}>
          +{extra}
        </div>
      )}
    </div>
  );
};

export default Avatar;
