import { STATUS_COLORS } from "../constants";

const Badge = ({ label }) => {
  const c = STATUS_COLORS[label] || { bg: "#F1F5F9", text: "#475569" };
  return (
    <span style={{ background: c.bg, color: c.text, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
};

export default Badge;
