/**
 * offlineManager.js
 * Local cache + sync queue for offline support.
 * Works with the DB abstraction layer in /services/db/.
 *
 * Flow:
 *   online  → write to DB + cache
 *   offline → write to cache + queue mutation
 *   reconnect → flush queue to DB, resolve conflicts
 */

const CACHE_KEY    = "crm_cache_v1";
const QUEUE_KEY    = "crm_sync_queue_v1";
const META_KEY     = "crm_cache_meta_v1";

// ── Cache ──────────────────────────────────────────────────────────────────

export function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(META_KEY, JSON.stringify({ savedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn("[offlineManager] saveCache failed:", e);
  }
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("[offlineManager] loadCache failed:", e);
    return null;
  }
}

export function getCacheMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(META_KEY);
}

// ── Sync queue ─────────────────────────────────────────────────────────────

export function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn("[offlineManager] saveQueue failed:", e);
  }
}

export function enqueue(mutation) {
  const queue = loadQueue();
  queue.push({ ...mutation, queuedAt: new Date().toISOString(), id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  saveQueue(queue);
}

export function dequeue(id) {
  const queue = loadQueue().filter((m) => m.id !== id);
  saveQueue(queue);
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

// ── Online detection ───────────────────────────────────────────────────────

export function isOnline() {
  return navigator.onLine;
}

export function onReconnect(callback) {
  const handler = () => callback();
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}

export function onDisconnect(callback) {
  const handler = () => callback();
  window.addEventListener("offline", handler);
  return () => window.removeEventListener("offline", handler);
}

// ── Sync flush ─────────────────────────────────────────────────────────────

/**
 * Flush the sync queue to the DB adapter.
 * @param {object} dbAdapter - must implement { applyMutation(mutation) }
 * @returns {{ flushed: number, failed: number, errors: Array }}
 */
export async function flushQueue(dbAdapter) {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0, errors: [] };

  let flushed = 0;
  let failed = 0;
  const errors = [];
  const remaining = [];

  for (const mutation of queue) {
    try {
      await dbAdapter.applyMutation(mutation);
      flushed++;
    } catch (err) {
      failed++;
      errors.push({ mutation, error: err.message });
      remaining.push(mutation);
    }
  }

  saveQueue(remaining);
  return { flushed, failed, errors };
}

// ── React hook ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

export function useOfflineStatus() {
  const [online, setOnline] = useState(isOnline());
  const [queueLength, setQueueLength] = useState(loadQueue().length);
  const [lastSynced, setLastSynced] = useState(getCacheMeta()?.savedAt ?? null);

  useEffect(() => {
    const handleOnline  = () => { setOnline(true);  setQueueLength(loadQueue().length); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refreshQueueLength = useCallback(() => {
    setQueueLength(loadQueue().length);
  }, []);

  const updateLastSynced = useCallback(() => {
    const meta = getCacheMeta();
    setLastSynced(meta?.savedAt ?? null);
  }, []);

  return { online, queueLength, lastSynced, refreshQueueLength, updateLastSynced };
}

// ── Offline status bar component (inline, no JSX dep) ─────────────────────
// Usage: import and mount <OfflineBanner /> in App.jsx topbar

export function getOfflineBannerProps(online, queueLength) {
  if (online && queueLength === 0) return null;
  if (online && queueLength > 0) return {
    bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA",
    message: `Back online — syncing ${queueLength} pending change${queueLength !== 1 ? "s" : ""}…`,
  };
  return {
    bg: "#FEF2F2", color: "#B91C1C", border: "#FECACA",
    message: "You're offline — changes will sync when reconnected",
  };
}
