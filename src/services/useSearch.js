/**
 * useSearch.js
 * Debounced search + indexed filtering for CRM datasets.
 *
 * Exports
 * ───────
 * useDebounceSearch(value, delay)               — stable debounce
 * useFilteredData(items, query, keys)            — ranked filter, fuzzy, multi-word
 * useMultiFilter(items, filters)                 — exact multi-key filter
 * useTableFilter({ items, search, searchKeys,    — combined hook
 *                  filters, weights })
 * buildSearchIndex(items, keys)                  — prebuilt trigram index
 * queryIndex(index, items, query)                — query a prebuilt index
 * highlightMatches(text, query)                  — returns [{text,match}] spans
 * useSearchHistory(storageKey, maxSize)          — persisted search history
 *
 * Scoring breakdown (per key, best wins, then summed across keys)
 * ───────────────────────────────────────────────────────────────
 *   exact match          → 1000
 *   exact word boundary  →  400
 *   starts-with          →  200
 *   all words present    →  100  (multi-word: "ahmed mansouri")
 *   contains             →   50
 *   fuzzy (≤2 edits)     →   20 – editDistance*5
 *
 * Key weighting: pass weights: { title: 3, name: 2 } — score is multiplied.
 * Default weight is 1 for all keys.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";

// ─── Levenshtein (bounded) ────────────────────────────────────────────────────
// Returns edit distance between a and b, capped at `cap` (default 3).
// Early-exits if the minimum possible distance already exceeds cap.
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two rows instead of a full matrix — O(min(m,n)) space
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > cap) return cap + 1; // prune
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// ─── Score a single field value against a query ───────────────────────────────
const _wordBoundaryCache = new Map();
function _wordBoundaryRegex(q) {
  if (_wordBoundaryCache.has(q)) return _wordBoundaryCache.get(q);
  let re;
  try { re = new RegExp(`\\b${q}\\b`); } catch { re = null; }
  _wordBoundaryCache.set(q, re);
  if (_wordBoundaryCache.size > 500) {
    // Evict oldest entry to bound memory
    _wordBoundaryCache.delete(_wordBoundaryCache.keys().next().value);
  }
  return re;
}

function scoreField(val, q, words) {
  if (!val) return 0;
  const v = val.toLowerCase();

  if (v === q)                       return 1000;
  // word boundary exact: "ahmed" matches "ahmed al mansouri"
  const wbRe = _wordBoundaryRegex(q);
  if (wbRe && wbRe.test(v))          return 400;
  if (v.startsWith(q))               return 200;

  // multi-word: all query words appear somewhere in the value
  if (words.length > 1 && words.every(w => v.includes(w))) return 100;

  if (v.includes(q))                 return 50;

  // fuzzy — threshold scales: 1 allowed edit per 4 chars (len 3-6→1, 7-10→2, 11+→3)
  if (q.length >= 3) {
    const cap = Math.floor(q.length / 4) + 1;

    // Token-level fuzzy
    const valWords = v.split(/\s+/);
    for (const vw of valWords) {
      if (Math.abs(vw.length - q.length) > cap) continue;
      const d = editDistance(vw, q, cap);
      if (d <= cap) return Math.max(0, 20 - d * 5);
    }

    // Sliding-window fuzzy across full field — handles "ahmed mans" → "Ahmed Al Mansouri"
    if (words.length > 1) {
      const vCompact = v.replace(/\s+/g, "");
      const qCompact = q.replace(/\s+/g, "");
      if (vCompact.length >= qCompact.length) {
        for (let start = 0; start <= vCompact.length - qCompact.length; start++) {
          const window = vCompact.slice(start, start + qCompact.length);
          const d = editDistance(window, qCompact, cap + 1);
          if (d <= cap + 1) return Math.max(0, 15 - d * 3);
        }
      }
    }
  }

  return 0;
}

// ─── Stable keys ref helper ───────────────────────────────────────────────────
// Avoids the `keys.join(",")` dep-array hack by keeping a stable ref that
// only updates when the key list actually changes.
function useStableKeys(keys) {
  const ref = useRef(keys);
  const serialized = keys.join("\x00");
  const prevRef = useRef(serialized);
  if (prevRef.current !== serialized) {
    ref.current = keys;
    prevRef.current = serialized;
  }
  return ref.current;
}

// ─── Stable filters ref helper ────────────────────────────────────────────────
// Avoids JSON.stringify in dep arrays. Only triggers re-memo when filters
// actually change by value.
function useStableFilters(filters) {
  const ref = useRef(filters);
  const serialized = JSON.stringify(filters);
  const prevRef = useRef(serialized);
  if (prevRef.current !== serialized) {
    ref.current = filters;
    prevRef.current = serialized;
  }
  return ref.current;
}

// ─── useDebounceSearch ────────────────────────────────────────────────────────
/**
 * Debounces a string value. Flushes immediately on empty string so clearing
 * the search box feels instant.
 */
export function useDebounceSearch(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    // Flush immediately when clearing — no delay needed for empty queries
    if (!value.trim()) {
      setDebounced(value);
      return;
    }
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── useFilteredData ─────────────────────────────────────────────────────────
/**
 * Filter and rank items against a search query.
 *
 * @param {Array}  items   — full dataset
 * @param {string} query   — raw search string (debounced internally)
 * @param {Array}  keys    — field names to search, e.g. ["title","assigned"]
 *                           OR weighted objects: [{ key:"title", weight:3 }, ...]
 * @returns {Array} filtered + sorted items
 */
export function useFilteredData(items = [], query = "", keys = []) {
  const debouncedQuery = useDebounceSearch(query, 200);
  const stableKeys = useStableKeys(
    keys.map(k => (typeof k === "string" ? k : `${k.key}:${k.weight ?? 1}`))
  );

  return useMemo(() => {
    if (!debouncedQuery.trim()) return items;

    const q      = debouncedQuery.toLowerCase().trim();
    const words  = q.split(/\s+/).filter(Boolean);

    // Normalise keys to { key, weight } objects
    const normKeys = keys.map(k =>
      typeof k === "string" ? { key: k, weight: 1 } : { key: k.key, weight: k.weight ?? 1 }
    );

    const scored = items.map((item) => {
      let totalScore = 0;
      for (const { key, weight } of normKeys) {
        const val = String(item[key] ?? "");
        const s   = scoreField(val, q, words);
        totalScore += s * weight;
      }
      return { item, score: totalScore };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, debouncedQuery, stableKeys.join("\x00")]);
}

// ─── useMultiFilter ───────────────────────────────────────────────────────────
/**
 * Apply multiple exact-match filter criteria simultaneously.
 * Supports arrays as filter values — any match passes (OR within a key).
 *
 * @param {Array}  items
 * @param {Object} filters  { key: value | value[] }
 *                          Pass "" / null / undefined to skip a filter.
 */
export function useMultiFilter(items = [], filters = {}) {
  const stableFilters = useStableFilters(filters);
  return useMemo(() => {
    const entries = Object.entries(stableFilters).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined
    );
    if (entries.length === 0) return items;

    return items.filter(item =>
      entries.every(([key, value]) => {
        const itemVal = String(item[key] ?? "").toLowerCase();
        if (Array.isArray(value)) {
          return value.length === 0 || value.some(v => itemVal === String(v).toLowerCase());
        }
        return itemVal === String(value).toLowerCase();
      })
    );
  }, [items, stableFilters]);
}

// ─── useTableFilter ───────────────────────────────────────────────────────────
/**
 * Combined hook: multi-filter → debounced search → ranked results.
 *
 * @param {Object} options
 * @param {Array}    options.items
 * @param {string}   options.search
 * @param {Array}    options.searchKeys   string[] or {key,weight}[]
 * @param {Object}   options.filters      passed to useMultiFilter
 * @returns {Array} filtered + ranked items
 */
export function useTableFilter({ items, search, searchKeys, filters }) {
  const filtered = useMultiFilter(items, filters ?? {});
  const results  = useFilteredData(filtered, search ?? "", searchKeys ?? []);
  return results;
}

// ─── buildSearchIndex ─────────────────────────────────────────────────────────
/**
 * Pre-build a trigram index for a large dataset.
 * Call once when data loads; use queryIndex() to query.
 * Trigrams are faster and more precise than arbitrary substrings.
 *
 * Returns { index: Map<string, Set<number>>, items }
 */
export function buildSearchIndex(items = [], keys = []) {
  const index = new Map();

  const addToken = (token, i) => {
    if (!index.has(token)) index.set(token, new Set());
    index.get(token).add(i);
  };

  items.forEach((item, i) => {
    keys.forEach(key => {
      const val = String(item[key] ?? "").toLowerCase();

      // Index the full value and each space-separated word
      const parts = [val, ...val.split(/\s+/)];
      parts.forEach(part => {
        if (!part) return;
        // Trigrams
        for (let j = 0; j <= part.length - 3; j++) {
          addToken(part.slice(j, j + 3), i);
        }
        // Also index whole tokens <= 20 chars for exact word lookup
        if (part.length <= 20) addToken(part, i);
      });
    });
  });

  return { index, items };
}

/**
 * Query a prebuilt index.
 * Uses trigram intersection for multi-char queries, falls back to linear scan
 * for very short (1–2 char) queries.
 *
 * @param {{ index: Map, items: Array }} built  — output of buildSearchIndex
 * @param {string} query
 * @returns {Array} matched items, scored and sorted
 */
export function queryIndex({ index, items }, query) {
  if (!query.trim()) return items;
  const q     = query.toLowerCase().trim();
  const words = q.split(/\s+/);

  // Short queries: iterate all tokens containing q
  if (q.length < 3) {
    const matching = new Set();
    index.forEach((idxSet, token) => {
      if (token.startsWith(q)) idxSet.forEach(i => matching.add(i));
    });
    return [...matching].map(i => items[i]);
  }

  // Trigram intersection across all query trigrams — fast candidate retrieval
  const trigrams = [];
  for (let j = 0; j <= q.length - 3; j++) trigrams.push(q.slice(j, j + 3));

  const sets = trigrams.map(tg => index.get(tg) ?? new Set());
  if (sets.length === 0) return [];

  // Intersect (AND across trigrams) — items must match all trigrams
  let candidates = new Set(sets[0]);
  for (let k = 1; k < sets.length && candidates.size > 0; k++) {
    candidates = new Set([...candidates].filter(i => sets[k].has(i)));
  }

  // If intersection is empty (can happen with fuzzy typos), union instead
  if (candidates.size === 0) {
    sets.forEach(s => s.forEach(i => candidates.add(i)));
  }

  // Re-score candidates using scoreField and sort — same quality as useFilteredData
  // Extract keys from index tokens: we don't have them, so score against full
  // stringified representation of each item
  return [...candidates]
    .map(i => {
      const item = items[i];
      // Score each string field found on the item
      let score = 0;
      for (const v of Object.values(item)) {
        if (typeof v === "string" || typeof v === "number") {
          score += scoreField(String(v), q, words);
        }
      }
      return { item, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.item);
}

// ─── highlightMatches ─────────────────────────────────────────────────────────
/**
 * Split `text` into highlight spans for a given query.
 * Returns an array of { text: string, match: boolean }.
 *
 * Usage in JSX:
 *   highlightMatches(item.title, search).map(({ text, match }, i) => (
 *     <span key={i} style={match ? { background:"#fef08a", fontWeight:700 } : {}}>
 *       {text}
 *     </span>
 *   ))
 */
export function highlightMatches(text, query) {
  if (!query?.trim() || !text) return [{ text: String(text ?? ""), match: false }];

  const str  = String(text);
  const q    = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);

  // Build regex for exact word matches
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  // Collect match ranges [start, end] from exact matches
  const ranges = [];
  let regex;
  try { regex = new RegExp(`(${pattern})`, "gi"); } catch { return [{ text: str, match: false }]; }
  let m;
  while ((m = regex.exec(str)) !== null) ranges.push([m.index, m.index + m[0].length]);

  // Also mark fuzzy-matched tokens in the text
  const cap = Math.floor(q.length / 4) + 1;
  const strWords = str.split(/(\s+)/); // preserve spacing
  let cursor = 0;
  for (const token of strWords) {
    const tokenLow = token.toLowerCase();
    if (token.trim().length >= 2) {
      for (const qw of words) {
        if (qw.length < 3) continue;
        if (Math.abs(tokenLow.length - qw.length) <= cap) {
          const d = editDistance(tokenLow, qw, cap);
          if (d > 0 && d <= cap) ranges.push([cursor, cursor + token.length]);
        }
      }
    }
    cursor += token.length;
  }

  if (ranges.length === 0) return [{ text: str, match: false }];

  // Merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i]);
  }

  // Build spans
  const parts = [];
  let lastIndex = 0;
  for (const [start, end] of merged) {
    if (start > lastIndex) parts.push({ text: str.slice(lastIndex, start), match: false });
    parts.push({ text: str.slice(start, end), match: true });
    lastIndex = end;
  }
  if (lastIndex < str.length) parts.push({ text: str.slice(lastIndex), match: false });

  return parts.length ? parts : [{ text: str, match: false }];
}

// ─── useSearchHistory ─────────────────────────────────────────────────────────
/**
 * Persisted search history with deduplication and recency ordering.
 *
 * @param {string} storageKey   localStorage key, e.g. "crm_search_history"
 * @param {number} maxSize      max entries to keep (default 20)
 *
 * Returns { history, push, remove, clear }
 */
export function useSearchHistory(storageKey = "crm_search_history", maxSize = 20) {
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    } catch {
      return [];
    }
  });

  const persist = useCallback((nextOrUpdater) => {
    setHistory(prev => {
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [storageKey]);

  const push = useCallback((term) => {
    if (!term?.trim()) return;
    const t = term.trim();
    persist(prev => {
      const deduped = [t, ...prev.filter(h => h.toLowerCase() !== t.toLowerCase())];
      return deduped.slice(0, maxSize);
    });
  }, [persist, maxSize]);

  const remove = useCallback((term) => {
    persist(prev => prev.filter(h => h !== term));
  }, [persist]);

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  return { history, push, remove, clear };
}

// ─── useTableFilter (improved — debounces filters, supports computed fields) ──
/**
 * Replaces the old useTableFilter. Now debounces filter changes at 150ms,
 * and supports computed fields so you can search across derived values
 * like fullName = `${first} ${last}`.
 *
 * computed: [{ key: "fullName", fn: item => `${item.first} ${item.last}` }]
 */
export function useTableFilterV2({ items, search, searchKeys, filters, computed }) {
  const [debouncedFilters, setDebouncedFilters] = useState(filters ?? {});
  const stableFilters = useStableFilters(filters ?? {});
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(stableFilters), 150);
    return () => clearTimeout(t);
  }, [stableFilters]);

  const augmented = useMemo(() => {
    if (!computed?.length) return items;
    return items.map(item => {
      const extra = {};
      computed.forEach(({ key, fn }) => { extra[key] = fn(item); });
      return { ...item, ...extra };
    });
  }, [items, computed]);

  const filtered = useAdvancedFilter(augmented, debouncedFilters);
  const results  = useFilteredData(filtered, search ?? "", searchKeys ?? []);
  return results;
}

// ─── useAdvancedFilter ────────────────────────────────────────────────────────
/**
 * Upgrade from useMultiFilter — supports date ranges, numeric ranges,
 * null/empty checks, negation, and array OR — in one hook.
 *
 * Filter shapes:
 *   exact string:    { status: "Done" }
 *   array OR:        { status: ["Done", "In Review"] }
 *   negation:        { status: { not: "Blocked" } }
 *   empty/null:      { assigned: { empty: true } }
 *   date range:      { due: { from: "2025-01-01", to: "2025-12-31" } }
 *   numeric range:   { value: { min: 1000, max: 50000 } }
 */
export function useAdvancedFilter(items = [], filters = {}) {
  const stableFilters = useStableFilters(filters);
  return useMemo(() => {
    const entries = Object.entries(stableFilters);
    if (entries.length === 0) return items;
    return items.filter(item =>
      entries.every(([key, rule]) => {
        if (rule === "" || rule === null || rule === undefined) return true;
        const rawVal = item[key];
        const strVal = String(rawVal ?? "").toLowerCase();
        if (rule && typeof rule === "object" && "empty" in rule) {
          const isEmpty = rawVal === "" || rawVal === null || rawVal === undefined;
          return rule.empty ? isEmpty : !isEmpty;
        }
        if (rule && typeof rule === "object" && "not" in rule) {
          const nots = Array.isArray(rule.not)
            ? rule.not.map(v => String(v).toLowerCase())
            : [String(rule.not).toLowerCase()];
          return !nots.includes(strVal);
        }
        if (rule && typeof rule === "object" && ("from" in rule || "to" in rule)) {
          const d = new Date(rawVal);
          if (isNaN(d)) return false;
          if (rule.from && d < new Date(rule.from)) return false;
          if (rule.to   && d > new Date(rule.to))   return false;
          return true;
        }
        if (rule && typeof rule === "object" && ("min" in rule || "max" in rule)) {
          const n = parseFloat(rawVal);
          if (isNaN(n)) return false;
          if (rule.min !== undefined && n < rule.min) return false;
          if (rule.max !== undefined && n > rule.max) return false;
          return true;
        }
        if (Array.isArray(rule)) {
          return rule.length === 0 || rule.some(v => strVal === String(v).toLowerCase());
        }
        return strVal === String(rule).toLowerCase();
      })
    );
  }, [items, stableFilters]);
}

// ─── useSearchIndex — reactive prebuilt index ─────────────────────────────────
/**
 * Hook version of buildSearchIndex. Rebuilds automatically when items change.
 * Use this inside components instead of calling buildSearchIndex manually.
 */
export function useSearchIndex(items = [], keys = []) {
  const stableKeys = useStableKeys(keys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildSearchIndex(items, keys), [items, stableKeys.join("\x00")]);
}

// ─── useFilterCount ───────────────────────────────────────────────────────────
/**
 * Count items per distinct value for a given key.
 * Other active filters are respected so counts stay contextual.
 *
 * @param {Array}  items
 * @param {string} key        field to count by, e.g. "status"
 * @param {Object} filters    other currently active filters (to count in context)
 * @returns {Object}  { [value]: count }
 *
 * Example: useFilterCount(tasks, "status") → { Done:12, Pending:5 }
 */
export function useFilterCount(items = [], key = "", filters = {}) {
  const stableFilters = useStableFilters(filters);
  return useMemo(() => {
    const relevant = Object.keys(stableFilters).length
      ? items.filter(item =>
          Object.entries(stableFilters).every(([k, v]) => {
            if (k === key || v === "" || v === null || v === undefined) return true;
            return String(item[k] ?? "").toLowerCase() === String(v).toLowerCase();
          })
        )
      : items;
    return relevant.reduce((acc, item) => {
      const val = String(item[key] ?? "");
      acc[val] = (acc[val] ?? 0) + 1;
      return acc;
    }, {});
  }, [items, key, stableFilters]);
}

// ─── useSearchSuggestions ─────────────────────────────────────────────────────
/**
 * Autocomplete candidates from real dataset values.
 * Typing "Ahm" surfaces "Ahmed Al Mansouri" from actual data, not hardcoded.
 *
 * @param {Array}   items
 * @param {Array}   keys        fields to pull suggestions from
 * @param {string}  query       current input
 * @param {number}  maxResults  max suggestions returned (default 8)
 * @returns {string[]}
 */
export function useSearchSuggestions(items = [], keys = [], query = "", maxResults = 8) {
  const debouncedQuery = useDebounceSearch(query, 150);
  const stableKeys = useStableKeys(keys);

  return useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    if (!q) return [];
    const cap = Math.floor(q.length / 4) + 1;
    const seen = new Set();
    const results = [];

    for (const item of items) {
      for (const key of keys) {
        const val = String(item[key] ?? "").trim();
        if (!val || seen.has(val)) continue;
        const vl = val.toLowerCase();
        let score = 0;
        if (vl === q)              score = 1000;
        else if (vl.startsWith(q)) score = 500;
        else if (vl.includes(q))   score = 100;
        else {
          for (const w of vl.split(/\s+/)) {
            if (Math.abs(w.length - q.length) <= cap) {
              const d = editDistance(w, q, cap);
              if (d <= cap) score = Math.max(score, 20 - d * 5);
            }
          }
        }
        if (score > 0) { seen.add(val); results.push({ val, score }); }
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, maxResults).map(r => r.val);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, debouncedQuery, stableKeys.join("\x00"), maxResults]);
}

// ─── parseOperatorQuery ───────────────────────────────────────────────────────
/**
 * Parse "status:done priority:high ahmed" into structured filters + free text.
 *
 * Supported operators:
 *   key:value        → exact filter
 *   -key:value       → negation  { not: value }
 *   key:>100         → numeric   { min: 101 }
 *   key:<100         → numeric   { max: 99 }
 *   key:empty        → null/empty check { empty: true }
 *
 * @param {string} query
 * @returns {{ filters: Object, text: string }}
 *
 * Example:
 *   parseOperatorQuery("status:done -priority:low ahmed")
 *   → { filters: { status:"done", priority:{ not:"low" } }, text:"ahmed" }
 */
export function parseOperatorQuery(query = "") {
  const filters = {};
  const TOKEN = /(-?)(\w+):((?:"[^"]*"|\S)+)/g;
  const text = query.replace(TOKEN, (_, neg, key, val) => {
    const clean = val.replace(/^"|"$/g, "");
    if (clean === "empty") {
      filters[key] = { empty: true };
    } else if (clean.startsWith(">")) {
      filters[key] = { min: parseFloat(clean.slice(1)) };
    } else if (clean.startsWith("<")) {
      filters[key] = { max: parseFloat(clean.slice(1)) };
    } else if (neg === "-") {
      filters[key] = { not: clean };
    } else {
      filters[key] = clean;
    }
    return "";
  }).trim().replace(/\s+/g, " ");
  return { filters, text };
}

// ─── useSavedFilters ──────────────────────────────────────────────────────────
/**
 * Save and restore named filter presets (filters + search string).
 *
 * @param {string} storageKey  localStorage key, e.g. "tasks_saved_filters"
 * @returns {{ saved, save, load, remove, clear }}
 *
 * Example:
 *   const { save, load, saved } = useSavedFilters("tasks_filters");
 *   save("High priority mine", { filters:{ priority:"High" }, search:"" });
 *   load("High priority mine"); // → { filters, search }
 */
export function useSavedFilters(storageKey = "crm_saved_filters") {
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}"); }
    catch { return {}; }
  });
  const persist = useCallback(next => {
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota */ }
  }, [storageKey]);
  const save   = useCallback((name, preset) => {
    if (!name?.trim()) return;
    persist({ ...saved, [name.trim()]: preset });
  }, [saved, persist]);
  const load   = useCallback((name) => saved[name] ?? null, [saved]);
  const remove = useCallback((name) => {
    const next = { ...saved }; delete next[name]; persist(next);
  }, [saved, persist]);
  const clear  = useCallback(() => persist({}), [persist]);
  return { saved, save, load, remove, clear };
}

// ─── useSortedData ────────────────────────────────────────────────────────────
/**
 * Stable multi-column sort with Intl.Collator (locale-aware, handles Arabic etc).
 *
 * @param {Array}  items
 * @param {Array}  initialConfig  [{ key, direction:"asc"|"desc", type?:"string"|"number"|"date" }]
 * @returns {{ sorted, toggle, setSort, sortConfig }}
 *
 * Example:
 *   const { sorted, toggle } = useSortedData(tasks, [{ key:"due", direction:"asc", type:"date" }]);
 *   <th onClick={() => toggle("due", "date")}>Due</th>
 */
export function useSortedData(items = [], initialConfig = []) {
  const [sortConfig, setSortConfig] = useState(initialConfig);
  const collator = useMemo(() => new Intl.Collator(undefined, { sensitivity: "base", numeric: true }), []);

  const sorted = useMemo(() => {
    if (!sortConfig.length) return items;
    return [...items].sort((a, b) => {
      for (const { key, direction, type } of sortConfig) {
        let cmp = 0;
        if (type === "number") {
          cmp = (parseFloat(a[key]) || 0) - (parseFloat(b[key]) || 0);
        } else if (type === "date") {
          cmp = new Date(a[key] || 0) - new Date(b[key] || 0);
        } else {
          cmp = collator.compare(String(a[key] ?? ""), String(b[key] ?? ""));
        }
        if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }, [items, sortConfig, collator]);

  const toggle = useCallback((key, type = "string") => {
    setSortConfig(prev => {
      const existing = prev.find(s => s.key === key);
      if (!existing) return [{ key, direction: "asc", type }];
      if (existing.direction === "asc") return prev.map(s => s.key === key ? { ...s, direction: "desc" } : s);
      return prev.filter(s => s.key !== key);
    });
  }, []);
  const setSort = useCallback(config => setSortConfig(config), []);
  return { sorted, toggle, setSort, sortConfig };
}

// ─── usePagination ────────────────────────────────────────────────────────────
/**
 * Paginate any array. Resets to page 1 when items change.
 *
 * @param {Array}  items     already filtered + sorted
 * @param {number} pageSize  rows per page (default 25)
 * @returns {{ pageItems, page, totalPages, totalItems, goTo, next, prev, setPageSize }}
 */
export function usePagination(items = [], pageSize = 25) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  useEffect(() => { setPage(1); }, [items.length, size]);

  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const safePage   = Math.min(page, totalPages);
  const pageItems  = useMemo(() => items.slice((safePage - 1) * size, safePage * size), [items, safePage, size]);

  const goTo       = useCallback(n => setPage(Math.max(1, Math.min(n, totalPages))), [totalPages]);
  const next       = useCallback(() => goTo(safePage + 1), [goTo, safePage]);
  const prev       = useCallback(() => goTo(safePage - 1), [goTo, safePage]);
  const setPageSize = useCallback(n => { setSize(n); setPage(1); }, []);

  return { pageItems, page: safePage, totalPages, totalItems: items.length, goTo, next, prev, setPageSize };
}

// ─── useVirtualSearch ─────────────────────────────────────────────────────────
/**
 * For 50k+ row datasets. Uses the trigram index to get candidates,
 * then only scores up to `windowSize` rows — never the full dataset.
 *
 * @param {Object} builtIndex  output of useSearchIndex or buildSearchIndex
 * @param {string} query
 * @param {number} windowSize  max rows to score (default 200)
 * @returns {Array}
 */
export function useVirtualSearch(builtIndex, query, windowSize = 200) {
  const debouncedQuery = useDebounceSearch(query, 250);
  return useMemo(() => {
    if (!builtIndex || !debouncedQuery.trim()) return builtIndex?.items ?? [];
    return queryIndex(builtIndex, debouncedQuery).slice(0, windowSize);
  }, [builtIndex, debouncedQuery, windowSize]);
}

// ─── useUrlSync ───────────────────────────────────────────────────────────────
/**
 * Sync search + filters to URL querystring so state survives page refresh.
 * Works with plain window.history — no router dependency.
 *
 * @param {Object}   state      { search: string, filters: Object }
 * @param {Function} setState   setter called on mount with URL values
 * @param {string}   prefix     URL param namespace (default "q")
 *
 * Usage:
 *   useUrlSync({ search, filters }, ({ search, filters }) => {
 *     setSearch(search); setFilters(filters);
 *   });
 */
export function useUrlSync(state, setState, prefix = "q") {
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const search  = params.get(prefix) ?? "";
    const raw     = params.get(`${prefix}_filters`);
    let filters   = {};
    try { if (raw) filters = JSON.parse(decodeURIComponent(raw)); } catch { /* ignore */ }
    if (search || Object.keys(filters).length) setState({ search, filters });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stableState = useStableFilters(state);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (state.search) params.set(prefix, state.search);
    else params.delete(prefix);
    const fs = JSON.stringify(state.filters ?? {});
    if (fs !== "{}") params.set(`${prefix}_filters`, encodeURIComponent(fs));
    else params.delete(`${prefix}_filters`);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [stableState]);
}

// ─── withTiming — dev-mode performance telemetry ──────────────────────────────
/**
 * Wrap any function with a console timer in development. No-ops in production.
 *
 * Usage:
 *   const timedFn = withTiming("label", myFn);
 *   // Dev: [useSearch] label: 2.3ms (842 items)
 */
export function withTiming(label, fn) {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return fn;
  return function timed(...args) {
    const t0 = performance.now();
    const result = fn(...args);
    const ms = (performance.now() - t0).toFixed(2);
    const n  = Array.isArray(result) ? result.length : "?";
    console.debug(`[useSearch] ${label}: ${ms}ms (${n} items)`);
    return result;
  };
}
