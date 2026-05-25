/**
 * auditEngine.js
 * Pure functions for audit log creation and querying.
 * Every edit / delete / export / payment change goes through here.
 */

export const AUDIT_ACTIONS = {
  CREATE:  "Created",
  UPDATE:  "Updated",
  DELETE:  "Deleted",
  EXPORT:  "Exported",
  PAYMENT: "Payment recorded",
  LOGIN:   "Logged in",
  AUTOMATION: "Automation triggered",
};

/**
 * Build an audit entry. Call this before dispatching a state change.
 * @param {string} action  - AUDIT_ACTIONS key
 * @param {string} module  - "leads" | "accounting" | etc.
 * @param {string} entityId - record id
 * @param {string} summary  - human-readable description
 * @param {string} user     - current user name/role
 * @param {object} [diff]   - optional { before, after } snapshot
 */
export function createAuditEntry(action, module, entityId, summary, user, diff = null) {
  return {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    action,
    module,
    entityId,
    summary,
    user,
    diff,
    timestamp: new Date().toISOString(),
  };
}

/** Filter/search audit log */
export function filterAuditLog(entries = [], { module, action, user, search, from, to } = {}) {
  return entries.filter((e) => {
    if (module && e.module !== module) return false;
    if (action && e.action !== action) return false;
    if (user && e.user !== user) return false;
    if (from && e.timestamp < from) return false;
    if (to && e.timestamp > to) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.summary.toLowerCase().includes(q) ||
        e.entityId?.toLowerCase().includes(q) ||
        e.user?.toLowerCase().includes(q)
      );
    }
    return true;
  });
}

/** Recent entries, most recent first */
export function recentAudit(entries = [], limit = 50) {
  return [...entries]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
