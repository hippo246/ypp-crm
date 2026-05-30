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
  const viewportHeight = containerHeight;
  
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.floor((scrollTop + viewportHeight) / itemHeight) + overscan
  );
  
  const visibleItems = items.slice(startIndex, endIndex + 1);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback((e) => {
    const newScrollTop = e.target.scrollTop;
    setScrollTop(newScrollTop);
    
    setIsScrolling(true);
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
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

  // Calculate item positions
  useEffect(() => {
    let currentY = 0;
    const positions = [];
    
    items.forEach((item, index) => {
      const itemRef = itemRefs.current.get(index);
      const height = itemRef?.offsetHeight || estimatedItemHeight;
      
      positions.push({
        index,
        y: currentY,
        height,
      });
      
      currentY += height;
    });
    
    setItemPositions(positions);
    setTotalHeight(currentY);
  }, [items, estimatedItemHeight]);

  const startIndex = itemPositions.findIndex(
    pos => pos.y + pos.height > scrollTop
  );
  
  const endIndex = itemPositions.findLastIndex(
    pos => pos.y < scrollTop + containerHeight
  );

  const visibleStartIndex = Math.max(0, startIndex - overscan);
  const visibleEndIndex = Math.min(
    items.length - 1,
    endIndex + overscan
  );

  const visibleItems = items.slice(visibleStartIndex, visibleEndIndex + 1);
  const offsetY = itemPositions[visibleStartIndex]?.y || 0;

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const setItemRef = useCallback((index, element) => {
    if (element) {
      itemRefs.current.set(index, element);
    } else {
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
