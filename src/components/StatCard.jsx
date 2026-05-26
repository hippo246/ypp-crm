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
  trend = null,
  sparkData = null,
  animate = true,
  icon = null,
  alert = false,
}) => {
  const [hovered, setHovered] = useState(false);

  // derive a soft glow color from the accent
  const glowColor = color + "30";

  return (
    <>
      <style id="statcard-kf">{`
        @keyframes sc-alert-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes sc-shine {
          0%   { transform: translateX(-100%) skewX(-15deg); }
          100% { transform: translateX(250%) skewX(-15deg); }
        }
        .statcard-shine::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.55) 50%, transparent 60%);
          animation: sc-shine 2.4s ease-in-out infinite;
          pointer-events: none;
          border-radius: inherit;
          overflow: hidden;
        }
      `}</style>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered
            ? `linear-gradient(145deg, #ffffff 0%, ${color}08 100%)`
            : "#ffffff",
          border: `1px solid ${hovered ? color + "40" : "#E2E8F0"}`,
          borderRadius: 14,
          padding: "16px 18px 14px",
          borderTop: `4px solid ${color}`,
          transition: "box-shadow 0.2s, transform 0.2s, border-color 0.2s, background 0.2s",
          boxShadow: hovered
            ? `0 8px 32px ${glowColor}, 0 2px 8px rgba(0,0,0,0.06)`
            : "0 1px 4px rgba(0,0,0,0.05)",
          transform: hovered ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
          cursor: "default",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background sparkline watermark */}
        {sparkData && (
          <div style={{ position: "absolute", right: 8, bottom: 8, opacity: hovered ? 0.5 : 0.25, pointerEvents: "none", transition: "opacity 0.2s" }}>
            <Sparkline data={sparkData} color={color} height={32} />
          </div>
        )}

        {/* Subtle color wash bottom-right */}
        <div style={{
          position: "absolute", right: -20, bottom: -20,
          width: 80, height: 80, borderRadius: "50%",
          background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{
            fontSize: 10, color: B.muted, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.8px",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            {icon && (
              <span style={{
                fontSize: 14, width: 22, height: 22, borderRadius: 6,
                background: color + "18", display: "inline-flex",
                alignItems: "center", justifyContent: "center",
              }}>{icon}</span>
            )}
            {label}
          </div>
          {trend !== null && <Trend delta={trend} />}
        </div>

        <div style={{
          fontSize: 26, fontWeight: 900, color: B.text,
          lineHeight: 1, letterSpacing: "-1px",
          fontVariantNumeric: "tabular-nums",
        }}>
          {animate && typeof value === "number"
            ? <AnimCount target={value} />
            : value}
        </div>

        {sub && (
          <div style={{
            fontSize: 11, color: alert ? B.red : B.muted,
            marginTop: 6, fontWeight: 500,
            animation: alert ? "sc-alert-pulse 2s ease-in-out infinite" : "none",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {alert && <span style={{ width: 5, height: 5, borderRadius: "50%", background: B.red, display: "inline-block", animation: "sc-alert-pulse 1.4s ease-in-out infinite" }} />}
            {sub}
          </div>
        )}
      </div>
    </>
  );
};

export default StatCard;
