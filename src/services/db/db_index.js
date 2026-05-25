/**
 * /services/db/index.js
 * DB abstraction layer.
 * Swap adapters by changing the import below — app code never changes.
 *
 * Interface every adapter must implement:
 *   getAll(collection)              → Promise<Array>
 *   getById(collection, id)         → Promise<object|null>
 *   create(collection, data)        → Promise<object>
 *   update(collection, id, data)    → Promise<object>
 *   delete(collection, id)          → Promise<void>
 *   applyMutation(mutation)         → Promise<void>  (for offline sync)
 */

import { localAdapter } from "./localAdapter";
// import { vercelAdapter } from "./vercelAdapter";
// import { firebaseAdapter } from "./firebaseAdapter";

// ── Active adapter ─────────────────────────────────────────────────────────
const adapter = localAdapter;

export const db = {
  async getAll(collection) {
    return adapter.getAll(collection);
  },
  async getById(collection, id) {
    return adapter.getById(collection, id);
  },
  async create(collection, data) {
    return adapter.create(collection, data);
  },
  async update(collection, id, data) {
    return adapter.update(collection, id, data);
  },
  async delete(collection, id) {
    return adapter.delete(collection, id);
  },
  async applyMutation(mutation) {
    return adapter.applyMutation(mutation);
  },
  /** Seed all collections at once (used on first load) */
  async seed(data) {
    if (adapter.seed) return adapter.seed(data);
  },
  /** Export all data (for backup/migration) */
  async exportAll() {
    if (adapter.exportAll) return adapter.exportAll();
    const collections = ["leads","clients","tasks","accounting","inventory","suppliers"];
    const result = {};
    for (const col of collections) result[col] = await adapter.getAll(col);
    return result;
  },
};
