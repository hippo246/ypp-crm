/**
 * useVirtualizedList - Performance optimization for large lists
 * 
 * Features:
 * - Windowed rendering for large datasets
 * - Dynamic item height support
 * - Smooth scrolling
 * - Memory-efficient rendering
 * - Supports 10,000+ items
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ── Binary search helpers ──────────────────────────────────────────────────────
// O(log n) replacements for findIndex/findLastIndex on itemPositions.
// Critical for 10k+ item lists where those are called on every scroll event.

function binarySearchStart(positions, scrollTop) {
  let lo = 0, hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid].y + positions[mid].height <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function binarySearchEnd(positions, bottom) {
  let lo = 0, hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (positions[mid].y >= bottom) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}

export function useVirtualizedList({
  items = [],
  itemHeight = 50,
  overscan = 3,
  containerHeight = 400,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);
  const containerRef = useRef(null);

  const totalHeight = items.length * itemHeight;
  
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.floor((scrollTop + containerHeight) / itemHeight) + overscan
  );
  
  const visibleItems = items.slice(startIndex, endIndex + 1);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback((e) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    
    setIsScrolling(true);
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, []);

  // Clear pending timeout on unmount — prevents setState on an unmounted component
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const scrollToIndex = useCallback((index) => {
    if (containerRef.current) {
      const targetScrollTop = index * itemHeight;
      containerRef.current.scrollTop = targetScrollTop;
      setScrollTop(targetScrollTop);
    }
  }, [itemHeight]);

  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    scrollToIndex,
    isScrolling,
    startIndex,
    endIndex,
  };
}

export function useDynamicVirtualizedList({
  items = [],
  estimatedItemHeight = 50,
  overscan = 3,
  containerHeight = 400,
}) {
  const [itemPositions, setItemPositions] = useState([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [totalHeight, setTotalHeight] = useState(0);
  const containerRef = useRef(null);
  const itemRefs = useRef(new Map());
  const observerRef = useRef(null);
  const recalcRef = useRef(null);

  // Calculate item positions — driven by ResizeObserver so real DOM size changes
  // (font load, image decode, dynamic content) trigger a recalc automatically.
  // The previous useEffect approach only re-ran when `items` or `estimatedItemHeight`
  // changed, silently missing any height changes that happened after first render.
  useEffect(() => {
    const recalc = () => {
      let currentY = 0;
      const positions = items.map((_, index) => {
        const height = itemRefs.current.get(index)?.offsetHeight ?? estimatedItemHeight;
        const pos = { index, y: currentY, height };
        currentY += height;
        return pos;
      });
      setItemPositions(positions);
      setTotalHeight(currentY);
    };

    recalcRef.current = recalc;

    // Initial calculation
    recalc();

    const observer = new ResizeObserver(recalc);
    observerRef.current = observer;
    itemRefs.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [items, estimatedItemHeight]);

  const startIndex = itemPositions.length > 0
    ? binarySearchStart(itemPositions, scrollTop)
    : 0;

  const endIndex = itemPositions.length > 0
    ? binarySearchEnd(itemPositions, scrollTop + containerHeight)
    : 0;

  const visibleStartIndex = Math.max(0, startIndex - overscan);
  const visibleEndIndex = Math.min(
    items.length - 1,
    endIndex + overscan
  );

  const visibleItems = items.slice(visibleStartIndex, visibleEndIndex + 1);
  const offsetY = itemPositions[visibleStartIndex]?.y || 0;

  const handleScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const setItemRef = useCallback((index, element) => {
    if (element) {
      itemRefs.current.set(index, element);
      observerRef.current?.observe(element);
      // Recalc immediately so the new element's real height is reflected at mount,
      // not deferred until ResizeObserver fires (which may never happen if height is stable)
      recalcRef.current?.();
    } else {
      const el = itemRefs.current.get(index);
      if (el) observerRef.current?.unobserve(el);
      itemRefs.current.delete(index);
    }
  }, []);

  return {
    containerRef,
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    setItemRef,
    visibleStartIndex,
    visibleEndIndex,
  };
}

export default useVirtualizedList;
