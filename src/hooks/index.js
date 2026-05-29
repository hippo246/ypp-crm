/**
 * hooks/index.js
 * Shared table/data hooks used by LeadsTab, ClientsTab, TasksTab, AutomationsTab
 */

import { useState, useMemo, useCallback } from "react";

// ─── useTableFilterV2 ──────────────────────────────────────────────────────────
/**
 * Filters an array of row objects against a parsed query object.
 * Supports both free-text search and field:value operator syntax
 * (produced by parseOperatorQuery from ../helpers).
 *
 * @param {object[]} rows       - The full data array to filter
 * @param {object}   parsedQuery - { free: string, filters: {field: string}[] }
 * @param {string[]} searchKeys  - Which fields to search for free-text terms
 * @returns {object[]} filtered rows
 */
export function useTableFilterV2(rows, parsedQuery, searchKeys = []) {
  return useMemo(() => {
    if (!rows) return [];
    let result = rows;

    // Apply operator filters (field:value pairs)
    if (parsedQuery?.filters?.length) {
      result = result.filter((row) =>
        parsedQuery.filters.every(({ field, value }) => {
          const cell = String(row[field] ?? "").toLowerCase();
          return cell.includes(value.toLowerCase());
        })
      );
    }

    // Apply free-text search across searchKeys
    const free = parsedQuery?.free?.trim().toLowerCase();
    if (free) {
      result = result.filter((row) =>
        searchKeys.some((key) =>
          String(row[key] ?? "").toLowerCase().includes(free)
        )
      );
    }

    return result;
  }, [rows, parsedQuery, searchKeys.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── useSortedData ─────────────────────────────────────────────────────────────
/**
 * Adds client-side column sorting to a data array.
 *
 * @param {object[]} data - Array to sort
 * @returns {{ sortedData, sortKey, sortDir, toggleSort }}
 *   toggleSort(key) — call with a column key to sort/reverse
 */
export function useSortedData(data) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc"); // "asc" | "desc"

  const toggleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!data) return [];
    if (!sortKey) return data;

    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";

      // Numeric sort
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }

      // Date sort (ISO strings or Date objects)
      const aDate = Date.parse(av);
      const bDate = Date.parse(bv);
      if (!isNaN(aDate) && !isNaN(bDate)) {
        return sortDir === "asc" ? aDate - bDate : bDate - aDate;
      }

      // String sort
      const cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  return { sortedData, sortKey, sortDir, toggleSort };
}

// ─── usePagination ─────────────────────────────────────────────────────────────
/**
 * Paginates an array.
 *
 * @param {any[]} data - The (already filtered/sorted) array to paginate
 * @param {number} [defaultPageSize=25]
 * @returns {{ page, setPage, pageSize, setPageSize, pageData, pageCount }}
 */
export function usePagination(data, defaultPageSize = 25) {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(defaultPageSize);

  // Reset to page 1 whenever data length changes (new filter applied)
  const safeLength = data?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(safeLength / pageSize));

  const setPage = useCallback((p) => {
    setPageRaw((prev) => {
      const next = Math.min(Math.max(1, p), Math.ceil(safeLength / pageSize) || 1);
      return next;
    });
  }, [safeLength, pageSize]);

  const setPageSize = useCallback((size) => {
    setPageSizeRaw(size);
    setPageRaw(1);
  }, []);

  const pageData = useMemo(() => {
    if (!data) return [];
    const start = (page - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, page, pageSize]);

  return { page, setPage, pageSize, setPageSize, pageData, pageCount };
}

// ─── useSearchSuggestions ──────────────────────────────────────────────────────
/**
 * Generates autocomplete suggestions from row field values.
 *
 * @param {string}   query       - Current search input value
 * @param {string[]} fields      - Field names to pull suggestion values from
 * @param {Function} setQuery    - Setter to apply a chosen suggestion
 * @param {object[]} [rows=[]]   - Optional explicit rows; if omitted, no suggestions
 * @returns {{ suggestions, showSuggestions, onSuggestionSelect }}
 */
export function useSearchSuggestions(query, fields, setQuery, rows = []) {
  const suggestions = useMemo(() => {
    const q = query?.trim().toLowerCase();
    if (!q || q.length < 1) return [];

    const seen = new Set();
    const result = [];

    for (const row of rows) {
      for (const field of fields) {
        const val = String(row[field] ?? "").trim();
        if (val && val.toLowerCase().includes(q) && !seen.has(val)) {
          seen.add(val);
          result.push(val);
          if (result.length >= 8) return result;
        }
      }
    }
    return result;
  }, [query, rows, fields.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSuggestions = suggestions.length > 0;

  const onSuggestionSelect = useCallback((suggestion) => {
    setQuery(suggestion);
  }, [setQuery]);

  return { suggestions, showSuggestions, onSuggestionSelect };
}
