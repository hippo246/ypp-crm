import { STATUS_COLORS } from "../constants";

// States that get a live pulse dot
const PULSE_STATES = new Set(["Overdue", "Blocked", "Critical"]);
// States that get a subtle shimmer border
const GLOW_STATES  = new Set(["In Progress", "Pending"]);

const Badge = ({ label, size = "md" }) => {
  const c    = STATUS_COLORS[label] || { bg: "#F1F5F9", text: "#475569", glow: "transparent" };
  const pulse = PULSE_STATES.has(label);
  const glow  = GLOW_STATES.has(label);

  const pad  = size === "sm" ? "2px 7px" : "3px 10px";
  const fs   = size === "sm" ? 10 : 11;

  return (
    <>
      <style id="badge-keyframes">{`
        @keyframes badge-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: .35; transform: scale(0.7); }
        }
        @keyframes badge-glow {
          0%, 100% { box-shadow: 0 0 0 0px currentColor; }
          50%       { box-shadow: 0 0 0 3px currentColor; }
        }
        .badge-glow-anim { animation: badge-glow 2.2s ease-in-out infinite; }
      `}</style>

      <span
        className={glow ? "badge-glow-anim" : undefined}
        style={{
          background: c.bg,
          color: c.text,
          padding: pad,
          borderRadius: 20,
          fontSize: fs,
          fontWeight: 700,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          letterSpacing: "0.2px",
          border: `1.5px solid ${c.text}28`,
          boxShadow: c.glow ? `0 0 0 3px ${c.glow}` : "none",
        }}
      >
        {pulse && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: c.text,
            display: "inline-block", flexShrink: 0,
            animation: "badge-pulse 1.3s ease-in-out infinite",
          }} />
        )}
        {label}
      </span>
    </>
  );
};

export default Badge;
