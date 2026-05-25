import { B } from "../constants";

const SectionCard = ({ title, children, action, style: extraStyle }) => (
  <div style={{
    background: B.white,
    border: `1px solid ${B.border}`,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    ...extraStyle,
  }}>
    <div style={{
      padding: "10px 14px",
      borderBottom: `1px solid ${B.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: "8px 8px 0 0",
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      {action}
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {children}
    </div>
  </div>
);

export default SectionCard;
