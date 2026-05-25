import { initials, avatarColor } from "../helpers";

const Avatar = ({ name, size = 28 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: avatarColor(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 600, color: "#fff", flexShrink: 0 }}>
    {initials(name)}
  </div>
);

export default Avatar;
