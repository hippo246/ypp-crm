import { B } from "../constants";

const StatCard = ({ label, value, sub, color = B.blue }) => (
  <div style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: "14px 16px", borderTop: `3px solid ${color}` }}>
    <div style={{ fontSize: 22, fontWeight: 600, color: B.text }}>{value}</div>
    <div style={{ fontSize: 12, color: B.muted, marginTop: 2 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: color, marginTop: 4 }}>{sub}</div>}
  </div>
);

export default StatCard;
