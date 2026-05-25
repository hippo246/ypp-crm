/**
 * useSearch.js
 * Debounced search + indexed filtering for CRM datasets.
 *
 * useDebounceSearch(value, delay) — debounces a string
 * useFilteredData(items, query, keys) — filters + ranks by relevance
 * buildSearchIndex(items, keys) — prebuilt index for large datasets
 */

import { useState, useEffect, useMemo, useRef } from "react";

/** Debounce a value */
export function useDebounceSearch(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Filter items against a query across specified keys.
 * Returns matched items sorted by relevance (exact match first, then starts-with, then contains).
 */
export function useFilteredData(items = [], query = "", keys = []) {
  const debouncedQuery = useDebounceSearch(query, 200);

  return useMemo(() => {
    if (!debouncedQuery.trim()) return items;
    const q = debouncedQuery.toLowerCase().trim();

    const scored = items.map((item) => {
      let score = 0;
      for (const key of keys) {
        const val = String(item[key] ?? "").toLowerCase();
        if (val === q) { score = Math.max(score, 100); break; }
        if (val.startsWith(q)) score = Math.max(score, 50);
        else if (val.includes(q)) score = Math.max(score, 10);
      }
      return { item, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item);
  }, [items, debouncedQuery, keys.join(",")]);
}

/**
 * Pre-build a search index for a dataset.
 * Useful for 1000+ row datasets — build once, query fast.
 */
export function buildSearchIndex(items = [], keys = []) {
  const index = new Map();
  items.forEach((item, i) => {
    const tokens = new Set();
    keys.forEach((key) => {
      const val = String(item[key] ?? "").toLowerCase();
      // index every substring of length >= 2
      for (let start = 0; start < val.length; start++) {
        for (let end = start + 2; end <= Math.min(val.length, start + 20); end++) {
          tokens.add(val.slice(start, end));
        }
      }
    });
    tokens.forEach((token) => {
      if (!index.has(token)) index.set(token, []);
      index.get(token).push(i);
    });
  });
  return index;
}

export function queryIndex(index, items, query) {
  if (!query.trim()) return items;
  const q = query.toLowerCase().trim();
  const indices = index.get(q) ?? [];
  if (indices.length === 0) {
    // fallback: find any key that contains q
    const matching = new Set();
    index.forEach((idxList, token) => {
      if (token.includes(q)) idxList.forEach((i) => matching.add(i));
    });
    return [...matching].map((i) => items[i]);
  }
  return indices.map((i) => items[i]);
}

/**
 * Multi-filter hook — apply multiple filter criteria at once.
 * filters: { key: value } — empty string = no filter for that key
 */
export function useMultiFilter(items = [], filters = {}) {
  return useMemo(() => {
    return items.filter((item) => {
      return Object.entries(filters).every(([key, value]) => {
        if (value === "" || value === null || value === undefined) return true;
        return String(item[key] ?? "").toLowerCase() === String(value).toLowerCase();
      });
    });
  }, [items, JSON.stringify(filters)]);
}

/**
 * Combined hook: debounced search + multi-filter
 */
export function useTableFilter({ items, search, searchKeys, filters }) {
  const filtered = useMultiFilter(items, filters ?? {});
  const results = useFilteredData(filtered, search ?? "", searchKeys ?? []);
  return results;
}
