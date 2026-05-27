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
const scrollMap = ssGetJSON(SCROLL_KEY, {});

export function saveTabScroll(tabId, scrollY) {
  scrollMap[tabId] = scrollY;
  ssSetJSON(SCROLL_KEY, scrollMap);
}

export function restoreTabScroll(tabId) {
  return scrollMap[tabId] ?? 0;
}

// ── Main hook ──────────────────────────────────────────────────────────────────
export function useTabSync(defaultTab) {
  const [activeTab, setActiveTabRaw] = useState(() => ssGet(STORAGE_KEY, defaultTab));
  const channelRef = useRef(null);
  const writeTimer = useRef(null);

  // Set up BroadcastChannel for cross-tab sync
  useEffect(() => {
    try {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.onmessage = (e) => {
        if (e.data?.type === "TAB_CHANGE" && e.data.tab) {
          setActiveTabRaw(e.data.tab);
        }
      };
    } catch {
      // BroadcastChannel not available (old browsers)
    }
    return () => {
      channelRef.current?.close();
      clearTimeout(writeTimer.current);
    };
  }, []);

  const setActiveTab = useCallback((tab) => {
    // Save current scroll before switching
    saveTabScroll(activeTab, window.scrollY);

    setActiveTabRaw(tab);

    // Debounced storage write — avoids thrashing during rapid tab switches
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      ssSet(STORAGE_KEY, tab);
    }, 80);

    // Broadcast to other open windows/tabs
    try {
      channelRef.current?.postMessage({ type: "TAB_CHANGE", tab });
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Restore scroll position after tab switch
  useEffect(() => {
    const y = restoreTabScroll(activeTab);
    // rAF ensures DOM has painted the new tab content
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "instant" });
    });
  }, [activeTab]);

  return { activeTab, setActiveTab };
}
