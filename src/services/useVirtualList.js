/**
 * useVirtualList.js
 * Virtualizes long lists — only renders visible rows + overscan buffer.
 * Drop-in for any scrollable table/list with 100+ rows.
 *
 * Usage:
 *   const { containerProps, visibleItems, totalHeight, offsetY } = useVirtualList({
 *     items,
 *     rowHeight: 40,
 *     containerHeight: 500,
 *     overscan: 5,
 *   });
 *
 *   <div {...containerProps}>
 *     <div style={{ height: totalHeight, position: 'relative' }}>
 *       <div style={{ transform: `translateY(${offsetY}px)` }}>
 *         {visibleItems.map(({ item, index }) => <Row key={index} item={item} />)}
 *       </div>
 *     </div>
 *   </div>
 */

import { useState, useRef, useCallback, useEffect } from "react";

export function useVirtualList({
  items = [],
  rowHeight = 40,
  containerHeight = 500,
  overscan = 5,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Recalculate on container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const totalHeight = items.length * rowHeight;

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(items.length - 1, startIndex + visibleCount);

  const visibleItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push({ item: items[i], index: i });
  }

  const offsetY = startIndex * rowHeight;

  const containerProps = {
    ref: containerRef,
    onScroll: handleScroll,
    style: {
      height: containerHeight,
      overflowY: "auto",
      overflowX: "hidden",
      position: "relative",
    },
  };

  function scrollToIndex(index) {
    if (containerRef.current) {
      containerRef.current.scrollTop = index * rowHeight;
    }
  }

  return {
    containerProps,
    visibleItems,
    totalHeight,
    offsetY,
    scrollToIndex,
    startIndex,
    endIndex,
  };
}

/**
 * useVirtualTable
 * Convenience wrapper specifically for table rows.
 * Returns a <tbody>-ready structure.
 */
export function useVirtualTable({ items, rowHeight = 40, containerHeight = 500, overscan = 8 }) {
  const vl = useVirtualList({ items, rowHeight, containerHeight, overscan });
  return {
    ...vl,
    wrapperStyle: { height: vl.totalHeight, position: "relative" },
    innerStyle: { transform: `translateY(${vl.offsetY}px)` },
  };
}
