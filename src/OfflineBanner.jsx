/**
 * OfflineBanner.jsx
 * Drop into App.jsx topbar — shows when offline or syncing.
 *
 * Usage in App.jsx topbar:
 *   import OfflineBanner from "./OfflineBanner";
 *   <OfflineBanner />   (inside the topbar div, full width below it)
 */

import { useOfflineStatus } from "./services/offlineManager";
import { B } from "./constants";

export default function OfflineBanner() {
  const { online, queueLength } = useOfflineStatus();

  if (online && queueLength === 0) return null;

  const syncing = online && queueLength > 0;
  const bg     = syncing ? "#FFF7ED" : "#FEF2F2";
  const color  = syncing ? "#C2410C" : "#B91C1C";
  const border = syncing ? "#FED7AA" : "#FECACA";
  const icon   = syncing ? "🔄" : "📡";
  const msg    = syncing
    ? `Syncing ${queueLength} pending change${queueLength !== 1 ? "s" : ""}…`
    : "You're offline — changes saved locally and will sync on reconnect";

  return (
    <div style={{
      background: bg, borderBottom: `1px solid ${border}`,
      padding: "6px 16px", display: "flex", alignItems: "center", gap: 8,
      fontSize: 12, color, fontWeight: 500, flexShrink: 0,
    }}>
      <span>{icon}</span>
      <span>{msg}</span>
    </div>
  );
}

/**
 * MobileBottomNav.jsx (inline export)
 * Responsive bottom nav for mobile/tablet.
 * Mount this at root level, visible only on small screens.
 */
export function MobileBottomNav({ navItems, activeTab, onTabChange }) {
  // Only render on small screens (CSS handles visibility)
  const visibleItems = navItems.slice(0, 5); // max 5 items

  return (
    <div style={{
      display: "none",  // overridden by media query in index.css
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 900,
      background: B.white, borderTop: `1px solid ${B.border}`,
      padding: "6px 0 calc(6px + env(safe-area-inset-bottom))",
    }} className="mobile-bottom-nav">
      {visibleItems.map((n) => (
        <button key={n.id} onClick={() => onTabChange(n.id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 2, background: "none", border: "none", cursor: "pointer",
            padding: "4px 0", fontFamily: "inherit",
            color: activeTab === n.id ? B.blue : B.muted,
          }}>
          <span style={{ fontSize: 18 }}>{n.icon}</span>
          <span style={{ fontSize: 10, fontWeight: activeTab === n.id ? 700 : 400 }}>{n.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * CSS to add to index.css for mobile support:
 *
 * @media (max-width: 768px) {
 *   .sidebar { display: none !important; }
 *   .mobile-bottom-nav { display: flex !important; }
 *   .main-content { padding-bottom: 80px; }
 *   .topbar-search { display: none; }
 *   .content-grid { grid-template-columns: 1fr !important; }
 *   table { font-size: 11px; }
 *   table td, table th { padding: 6px 8px; }
 * }
 *
 * @media (max-width: 480px) {
 *   .page-padding { padding: 8px !important; }
 *   .card-grid { grid-template-columns: 1fr !important; }
 * }
 */
