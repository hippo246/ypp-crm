/**
 * useTabSync — persistent tab state with scroll memory + perf guards
 *
 * Features:
 *  • Persists active tab to sessionStorage (survives refresh within session)
 *  • Remembers scroll position per tab so returning feels instant
 *  • Debounced writes so heavy re-renders don't thrash storage
 *  • BroadcastChannel syncs across same-origin tabs in the same browser
 *  • Safe fallback when storage is unavailable (private browsing etc.)
 *
 * Usage:
 *   const { activeTab, setActiveTab } = useTabSync("dashboard");
 */

import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "app_activeTab";
const SCROLL_KEY  = "app_tabScrolls";
const CHANNEL_NAME = "tab_sync";

// ── Safe storage helpers ───────────────────────────────────────────────────────
function ssGet(key, fallback) {
  try { const v = sessionStorage.getItem(key); return v !== null ? v : fallback; }
  catch { return fallback; }
}
function ssSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}
function ssGetJSON(key, fallback) {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function ssSetJSON(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Scroll position memory ─────────────────────────────────────────────────────
// Read/write directly through storage rather than a module-level cache —
// a shared mutable object would corrupt state if the hook is mounted more than once.
export function saveTabScroll(tabId, scrollY) {
  const map = ssGetJSON(SCROLL_KEY, {});
  map[tabId] = scrollY;
  ssSetJSON(SCROLL_KEY, map);
}

export function restoreTabScroll(tabId) {
  return ssGetJSON(SCROLL_KEY, {})[tabId] ?? 0;
}

// ── Main hook ──────────────────────────────────────────────────────────────────
export function useTabSync(defaultTab) {
  const [activeTab, setActiveTabRaw] = useState(
    // defaultTab is intentionally only read once — sessionStorage wins on refresh.
    // To reset the active tab programmatically, call setActiveTab directly.
    () => ssGet(STORAGE_KEY, defaultTab)
  );
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const channelRef = useRef(null);
  const instanceId = useRef(crypto.randomUUID()); // unique per hook mount
  const writeTimer = useRef(null);

  // Set up BroadcastChannel for cross-tab sync
  useEffect(() => {
    try {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.onmessage = (e) => {
        if (e.data?.senderId === instanceId.current) return; // ignore own echo
        if (e.data?.type === "TAB_CHANGE" && e.data.tab) {
          setActiveTabRaw(e.data.tab);
        }
      };
    } catch {
      // BroadcastChannel not available (old browsers)
    }
    return () => {
      clearTimeout(writeTimer.current);
      channelRef.current?.close();
    };
  }, []);

  const setActiveTab = useCallback((tab) => {
    // Read from ref — stays current even when tab changed via BroadcastChannel
    saveTabScroll(activeTabRef.current, window.scrollY);
    activeTabRef.current = tab; // update ref immediately so rapid calls stay consistent

    setActiveTabRaw(tab);

    // Debounced storage write — avoids thrashing during rapid tab switches
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      ssSet(STORAGE_KEY, tab);
    }, 80);

    // Broadcast to other open windows/tabs
    try {
      channelRef.current?.postMessage({ type: "TAB_CHANGE", tab, senderId: instanceId.current });
    } catch {}
  }, []); // no activeTab dep — stable reference across renders

  // Restore scroll position after tab switch
  useEffect(() => {
    const y = restoreTabScroll(activeTab);
    // rAF ensures DOM has painted the new tab content.
    // Cancel on cleanup so a rapid switch doesn't fire the previous tab's scroll.
    const rafId = requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "instant" });
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeTab]);

  return { activeTab, setActiveTab };
}
