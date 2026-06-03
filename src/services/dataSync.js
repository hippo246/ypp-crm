/**
 * DataSync - Enterprise data persistence and synchronization strategy
 *
 * Features:
 * - Optimistic updates with rollback
 * - Conflict resolution
 * - Offline queue management
 * - Batch operations for performance
 * - IndexedDB for large datasets
 * - Sync status tracking
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME    = "crm_enterprise_db";
const DB_VERSION = 1;

const STORE_NAMES = Object.freeze([
  "leads",
  "clients",
  "tasks",
  "accounting",
  "inventory",
  "sync_queue",
  "sync_status",
]);

// Stores that hold business data (excludes infrastructure stores)
const DATA_STORES = Object.freeze(["leads", "clients", "tasks", "accounting", "inventory"]);

const MAX_RETRIES        = 3;
const CLEANUP_AGE_MS     = 7 * 24 * 60 * 60 * 1000; // 7 days
const RETRY_BACKOFF_BASE = 500; // ms — doubles per retry

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wraps an IDBRequest in a Promise. */
function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Wraps an IDBTransaction's completion in a Promise. */
function idbTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error("Transaction aborted"));
  });
}

/** Sleep for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Generate a stable unique operation ID. */
function makeOpId() {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ─── DataSync class ───────────────────────────────────────────────────────────

class DataSync {
  constructor() {
    this._db            = null;
    // Single promise used to coalesce concurrent initDB() calls
    this._dbInitPromise = null;
    this._syncInProgress = false;
    this._listeners      = new Map();
  }

  // ── DB initialisation ────────────────────────────────────────────────────

  /**
   * Open (or return the already-open) IndexedDB connection.
   * Concurrent callers all wait on the same Promise so the DB is never
   * opened twice.
   */
  async _ensureDB() {
    if (this._db) return this._db;

    if (!this._dbInitPromise) {
      this._dbInitPromise = this._openDB().then((db) => {
        this._db = db;
        return db;
      }).catch((err) => {
        this._dbInitPromise = null;
        throw err;
      });
    }

    return this._dbInitPromise;
  }

  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        for (const name of DATA_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }

        if (!db.objectStoreNames.contains("sync_queue")) {
          const queueStore = db.createObjectStore("sync_queue", { keyPath: "id" });
          // Index by timestamp for ordered retrieval
          queueStore.createIndex("timestamp", "timestamp", { unique: false });
          // Index by status for fast pending/failed queries
          queueStore.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains("sync_status")) {
          db.createObjectStore("sync_status", { keyPath: "key" });
        }
      };
    });
  }

  // ── Core CRUD ────────────────────────────────────────────────────────────

  /**
   * Retrieve all records from a store.
   * @param {string} storeName
   * @returns {Promise<any[]>}
   */
  async getData(storeName) {
    const db  = await this._ensureDB();
    const tx  = db.transaction([storeName], "readonly");
    const all = await idbRequest(tx.objectStore(storeName).getAll());
    return all;
  }

  /**
   * Retrieve a single record by primary key.
   * Much cheaper than getData() + .find() for targeted lookups.
   * @param {string} storeName
   * @param {string|number} id
   * @returns {Promise<any|undefined>}
   */
  async getOne(storeName, id) {
    const db     = await this._ensureDB();
    const tx     = db.transaction([storeName], "readonly");
    const result = await idbRequest(tx.objectStore(storeName).get(id));
    return result;
  }

  /**
   * Persist one item or an array of items atomically inside a single
   * transaction.  If any individual put fails the entire transaction is
   * aborted and the returned Promise rejects.
   * @param {string} storeName
   * @param {any|any[]} data
   */
  async saveData(storeName, data) {
    const db    = await this._ensureDB();
    const tx    = db.transaction([storeName], "readwrite");
    const store = tx.objectStore(storeName);

    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      store.put(item); // errors bubble via tx.onerror / tx.onabort
    }

    await idbTransaction(tx);
  }

  /**
   * Delete a single record by primary key.
   * @param {string} storeName
   * @param {string|number} id
   */
  async deleteData(storeName, id) {
    const db = await this._ensureDB();
    const tx = db.transaction([storeName], "readwrite");
    tx.objectStore(storeName).delete(id);
    await idbTransaction(tx);
  }

  /**
   * Delete multiple records in one transaction.
   * @param {string} storeName
   * @param {Array<string|number>} ids
   */
  async deleteManyData(storeName, ids) {
    if (!ids.length) return;
    const db    = await this._ensureDB();
    const tx    = db.transaction([storeName], "readwrite");
    const store = tx.objectStore(storeName);
    for (const id of ids) store.delete(id);
    await idbTransaction(tx);
  }

  // ── Sync queue ───────────────────────────────────────────────────────────

  /**
   * Enqueue a single operation and trigger queue processing.
   * @param {{ type: string, storeName: string, data: any }} operation
   * @returns {Promise<string>} The operation ID
   */
  async queueOperation(operation) {
    this._validateOperation(operation);

    const queuedOp = {
      id:        makeOpId(),
      timestamp: Date.now(),
      operation,
      status:    "pending",
      retries:   0,
      lastError: null,
    };

    await this.saveData("sync_queue", queuedOp);

    // Non-blocking — errors are caught internally and emitted as events
    this._scheduleSyncQueue();

    return queuedOp.id;
  }

  /** Fire-and-forget wrapper that emits errors instead of throwing. */
  _scheduleSyncQueue() {
    if (this._syncInProgress) return;
    this.processSyncQueue().catch((err) => {
      this.emit("sync:error", { error: err.message });
    });
  }

  /**
   * Process all pending operations in timestamp order, with per-op
   * exponential-backoff retry.
   */
  async processSyncQueue() {
    if (this._syncInProgress) return;
    this._syncInProgress = true;
    this.emit("sync:start", {});

    try {
      // Fetch pending ops sorted by timestamp (oldest first) using the index
      const pendingOps = await this._getPendingOps();

      for (const op of pendingOps) {
        await this._processOneOp(op);
      }

      await this.cleanupSyncQueue();
    } finally {
      this._syncInProgress = false;
      this.emit("sync:idle", {});
    }
  }

  /** Retrieve pending queue entries ordered by timestamp via the IDB index. */
  async _getPendingOps() {
    const db    = await this._ensureDB();
    const tx    = db.transaction(["sync_queue"], "readonly");
    const index = tx.objectStore("sync_queue").index("status");
    const ops   = await idbRequest(index.getAll(IDBKeyRange.only("pending")));
    // Sort ascending by timestamp (index doesn't guarantee order across keys)
    ops.sort((a, b) => a.timestamp - b.timestamp);
    return ops;
  }

  async _processOneOp(op) {
    try {
      await this.executeOperation(op.operation);

      // Immutable update — do not mutate `op` in place before persisting
      const completed = { ...op, status: "completed" };
      await this.saveData("sync_queue", completed);
      this.emit("sync:completed", completed);

    } catch (error) {
      const retries = op.retries + 1;

      if (retries >= MAX_RETRIES) {
        const failed = { ...op, retries, status: "failed", lastError: error.message };
        await this.saveData("sync_queue", failed);
        this.emit("sync:failed", failed);
      } else {
        // Exponential backoff before marking for retry
        await sleep(RETRY_BACKOFF_BASE * 2 ** (retries - 1));
        const retried = { ...op, retries, lastError: error.message };
        await this.saveData("sync_queue", retried);
        this.emit("sync:retry", { op: retried, error: error.message });
      }
    }
  }

  /**
   * Execute a single queued operation against IndexedDB.
   * @param {{ type: string, storeName: string, data: any }} operation
   */
  async executeOperation(operation) {
    const { type, storeName, data } = operation;

    if (!STORE_NAMES.includes(storeName)) {
      throw new Error(`executeOperation: unknown store "${storeName}"`);
    }

    switch (type) {
      case "create":
      case "update":
        await this.saveData(storeName, data);
        break;
      case "delete":
        await this.deleteData(storeName, data.id);
        break;
      default:
        throw new Error(`executeOperation: unknown operation type "${type}"`);
    }
  }

  /**
   * Delete all completed queue entries older than CLEANUP_AGE_MS in a single
   * transaction instead of N individual deletes.
   */
  async cleanupSyncQueue() {
    const cutoff = Date.now() - CLEANUP_AGE_MS;
    const queue  = await this.getData("sync_queue");

    const staleIds = queue
      .filter((op) => op.status === "completed" && op.timestamp < cutoff)
      .map((op) => op.id);

    await this.deleteManyData("sync_queue", staleIds);

    if (staleIds.length) {
      this.emit("sync:cleaned", { count: staleIds.length });
    }
  }

  // ── Optimistic updates ───────────────────────────────────────────────────

  /**
   * Apply `updates` to the record identified by `id` immediately (optimistic),
   * queue a write, and return a rollback function.
   *
   * Uses getOne() instead of getData() to avoid loading the whole store.
   *
   * @param {string}   storeName
   * @param {string}   id
   * @param {object}   updates
   * @returns {Promise<() => Promise<void>>} Async rollback function
   */
  async optimisticUpdate(storeName, id, updates) {
    const currentValue = await this.getOne(storeName, id);

    if (!currentValue) {
      throw new Error(`optimisticUpdate: record "${id}" not found in "${storeName}"`);
    }

    const updatedValue = { ...currentValue, ...updates, _updatedAt: Date.now() };
    await this.saveData(storeName, updatedValue);

    const opId = await this.queueOperation({ type: "update", storeName, data: updatedValue });

    // Return an async rollback that restores the previous value and removes the
    // queued write (if it hasn't been processed yet).
    return async () => {
      await this.saveData(storeName, currentValue);
      // Best-effort: the op may already be completed/deleted
      try { await this.deleteData("sync_queue", opId); } catch {}
      this.emit("sync:rolledBack", { storeName, id, opId });
    };
  }

  // ── Batch operations ─────────────────────────────────────────────────────

  /**
   * Queue multiple operations.  Each gets its own queue entry so individual
   * retries are independent.
   * @param {Array<{ type: string, storeName: string, data: any }>} operations
   * @returns {Promise<string[]>} Array of operation IDs in the same order
   */
  async batchOperations(operations) {
    if (!operations.length) return [];

    // Validate all ops upfront before persisting any
    operations.forEach(this._validateOperation.bind(this));

    const ids = await Promise.all(operations.map((op) => this.queueOperation(op)));
    return ids;
  }

  // ── Sync status ──────────────────────────────────────────────────────────

  /**
   * Return counts of pending / failed / completed queue entries and the
   * timestamp of the most recently enqueued operation.
   */
  async getSyncStatus() {
    const queue = await this.getData("sync_queue");

    let pending = 0, failed = 0, completed = 0, lastTimestamp = 0;

    for (const op of queue) {
      if (op.status === "pending")   pending++;
      else if (op.status === "failed")    failed++;
      else if (op.status === "completed") completed++;

      // Avoid Math.max(...largeArray) stack-overflow risk
      if (op.timestamp > lastTimestamp) lastTimestamp = op.timestamp;
    }

    return {
      pending,
      failed,
      completed,
      lastSync: lastTimestamp > 0 ? new Date(lastTimestamp).toISOString() : null,
      isHealthy: failed === 0 && pending === 0,
    };
  }

  /**
   * Retry all failed queue entries immediately.
   * @returns {Promise<number>} Number of operations re-queued
   */
  async retryFailed() {
    const queue      = await this.getData("sync_queue");
    const failedOps  = queue.filter((op) => op.status === "failed");

    if (!failedOps.length) return 0;

    const reset = failedOps.map((op) => ({ ...op, status: "pending", retries: 0, lastError: null }));
    await this.saveData("sync_queue", reset);

    this._scheduleSyncQueue();
    return failedOps.length;
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  /**
   * Subscribe to a DataSync event.
   * @param {string}   event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // Return a convenient unsubscribe handle
    return () => this.off(event, callback);
  }

  /** Remove a previously registered listener. */
  off(event, callback) {
    this._listeners.get(event)?.delete(callback);
  }

  /** Emit an event, catching listener errors so one bad listener can't break sync. */
  emit(event, data) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;

    for (const cb of listeners) {
      try { cb(data); }
      catch (err) { console.error(`DataSync emit error [${event}]:`, err); }
    }
  }

  // ── Backup / restore ─────────────────────────────────────────────────────

  /**
   * Export one or more stores as a JSON string suitable for backup/download.
   * @param {string[]} [storeNames] Defaults to all data stores
   * @returns {Promise<string>} JSON string
   */
  async exportData(storeNames = DATA_STORES) {
    const exportedAt = new Date().toISOString();
    const payload    = { exportedAt, version: DB_VERSION, stores: {} };

    for (const name of storeNames) {
      payload.stores[name] = await this.getData(name);
    }

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Import data from a backup JSON string produced by exportData().
   * Only known store names are accepted; unknown keys are silently skipped
   * with a warning rather than silently corrupting unknown stores.
   *
   * @param {string}  jsonData
   * @param {{ merge?: boolean }} [options]
   *   merge=true (default) upserts records; merge=false clears each store first.
   */
  async importData(jsonData, { merge = true } = {}) {
    let payload;
    try {
      payload = JSON.parse(jsonData);
    } catch {
      throw new Error("importData: invalid JSON");
    }

    // Support both the new { stores: {} } envelope and the old flat format
    const stores = payload.stores ?? payload;

    if (typeof stores !== "object" || stores === null || Array.isArray(stores)) {
      throw new Error("importData: expected an object mapping store names to arrays");
    }

    for (const [storeName, items] of Object.entries(stores)) {
      if (!STORE_NAMES.includes(storeName)) {
        console.warn(`importData: skipping unknown store "${storeName}"`);
        continue;
      }
      if (!Array.isArray(items)) {
        console.warn(`importData: skipping "${storeName}" — expected an array`);
        continue;
      }

      if (!merge) {
        const db = await this._ensureDB();
        const tx = db.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        if (items.length) {
          for (const item of items) store.put(item);
        }
        await idbTransaction(tx);
      } else if (items.length) {
        await this.saveData(storeName, items);
      }
    }

    this.emit("sync:imported", { storeCount: Object.keys(stores).length });
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────

  /**
   * Clear all records from every store.  Awaits each transaction to
   * completion before moving to the next, ensuring a clean state.
   */
  async clearAll() {
    const db = await this._ensureDB();

    for (const storeName of STORE_NAMES) {
      const tx = db.transaction([storeName], "readwrite");
      tx.objectStore(storeName).clear();
      await idbTransaction(tx);
    }

    this.emit("sync:cleared", {});
  }

  /**
   * Return per-store record counts and approximate sizes.
   * @returns {Promise<Record<string, { count: number, sizeBytes: number, sizeMB: string }>>}
   */
  async getStorageUsage() {
    const usage = {};

    for (const storeName of DATA_STORES) {
      const data     = await this.getData(storeName);
      const sizeBytes = new Blob([JSON.stringify(data)]).size;
      usage[storeName] = {
        count:    data.length,
        sizeBytes,
        sizeMB:   (sizeBytes / (1024 * 1024)).toFixed(2),
      };
    }

    // Append total
    const totalBytes = Object.values(usage).reduce((s, v) => s + v.sizeBytes, 0);
    usage._total = {
      count:    Object.values(usage).reduce((s, v) => s + v.count, 0),
      sizeBytes: totalBytes,
      sizeMB:   (totalBytes / (1024 * 1024)).toFixed(2),
    };

    return usage;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Validate an operation object before it is enqueued.
   * Throws a descriptive error on the first violation found.
   */
  _validateOperation(op) {
    if (!op || typeof op !== "object") {
      throw new TypeError("Operation must be a plain object");
    }
    if (!["create", "update", "delete"].includes(op.type)) {
      throw new TypeError(`Operation type must be create|update|delete, got: "${op.type}"`);
    }
    if (!STORE_NAMES.includes(op.storeName)) {
      throw new TypeError(`Unknown storeName: "${op.storeName}"`);
    }
    if (op.data === undefined || op.data === null) {
      throw new TypeError("Operation must include a non-null data payload");
    }
    if (!op.data.id && op.data.id !== 0) {
      throw new TypeError('Operation data must have an "id" field');
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const dataSync = new DataSync();

export default dataSync;
