import { useEffect, useRef, useState } from "react";
import { B } from "../constants";

// Tiny 8-point sparkline rendered as inline SVG
function Sparkline({ data = [], color, height = 28 }) {
  if (!data.length) return null;
  const w = 72;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width={w} height={height} style={{ overflow: "visible", opacity: 0.8 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {/* Fill area */}
      <polyline points={`0,${height} ${pts} ${w},${height}`} fill={color + "22"} stroke="none" />
    </svg>
  );
}

// Animated number count-up
function AnimCount({ target }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    const numTarget = parseFloat(String(target).replace(/[^0-9.]/g, "")) || 0;
    const isFormatted = typeof target === "string" && /[^0-9.]/.test(target);
    const prefix = isFormatted ? String(target).replace(/[\d.,]+.*/, "") : "";
    const suffix = isFormatted ? String(target).replace(/^[^0-9]*[\d.,]+/, "") : "";

    const duration = 600;
    const start    = performance.now();
    const from     = 0;

    const tick = (now) => {
      const elapsed = Math.min(now - start, duration);
      const progress = elapsed / duration;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (numTarget - from) * eased));
      if (elapsed < duration) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  return <>{display}</>;
}

// Trend indicator
function Trend({ delta }) {
  if (delta === null || delta === undefined) return null;
  const up = delta >= 0;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700,
      color: up ? B.green : B.red,
      background: (up ? B.green : B.red) + "15",
      borderRadius: 20, padding: "1px 6px",
      display: "inline-flex", alignItems: "center", gap: 2,
    }}>
      {up ? "▲" : "▼"} {Math.abs(delta)}%
    </span>
  );
}

const StatCard = ({
  label,
  value,
  sub,
  color = B.blue,
  trend = null,          // number — % change
  sparkData = null,      // array of 6-8 numbers for mini sparkline
  animate = true,
  icon = null,
  alert = false,         // if true, adds a pulsing left border
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <style id="statcard-kf">{`
        @keyframes sc-alert-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: B.white,
          border: `1px solid ${B.border}`,
          borderRadius: 10,
          padding: "14px 16px",
          borderTop: `3px solid ${color}`,
          borderLeft: alert ? `3px solid ${B.red}` : undefined,
          transition: "box-shadow 0.18s, transform 0.18s",
          boxShadow: hovered ? "0 6px 20px rgba(0,0,0,0.09)" : "0 1px 3px rgba(0,0,0,0.04)",
          transform: hovered ? "translateY(-2px)" : "translateY(0)",
          cursor: "default",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background sparkline watermark */}
        {sparkData && (
          <div style={{ position: "absolute", right: 8, bottom: 8, opacity: 0.35, pointerEvents: "none" }}>
            <Sparkline data={sparkData} color={color} height={32} />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: B.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
            {label}
          </div>
          {trend !== null && <Trend delta={trend} />}
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, color: B.text, lineHeight: 1, letterSpacing: "-0.5px" }}>
          {animate && typeof value === "number"
            ? <AnimCount target={value} />
            : value}
        </div>

        {sub && (
          <div style={{
            fontSize: 11, color: alert ? B.red : B.muted,
            marginTop: 5,
            animation: alert ? "sc-alert-pulse 2s ease-in-out infinite" : "none",
          }}>
            {sub}
          </div>
        )}
      </div>
    </>
  );
};

export default StatCard;
