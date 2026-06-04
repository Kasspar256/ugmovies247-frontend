'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

type ResponsiveValue = {
  base: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
  twoXl?: number;
};

type VirtualizedCatalogGridProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  columns?: ResponsiveValue;
  rowHeight?: ResponsiveValue;
  rowClassName?: string;
  overscan?: number;
};

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  twoXl: 1536,
};

const DEFAULT_COLUMNS: ResponsiveValue = {
  base: 3,
  sm: 4,
  md: 5,
  twoXl: 6,
};

const DEFAULT_ROW_HEIGHT: ResponsiveValue = {
  base: 232,
  sm: 256,
  md: 314,
  lg: 360,
  xl: 392,
  twoXl: 372,
};

const DEFAULT_ROW_CLASS =
  'grid grid-cols-3 gap-x-6 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7 2xl:grid-cols-6';

function resolveResponsiveValue(value: ResponsiveValue, viewportWidth: number) {
  let resolved = value.base;

  if (viewportWidth >= BREAKPOINTS.sm && typeof value.sm === 'number') {
    resolved = value.sm;
  }

  if (viewportWidth >= BREAKPOINTS.md && typeof value.md === 'number') {
    resolved = value.md;
  }

  if (viewportWidth >= BREAKPOINTS.lg && typeof value.lg === 'number') {
    resolved = value.lg;
  }

  if (viewportWidth >= BREAKPOINTS.xl && typeof value.xl === 'number') {
    resolved = value.xl;
  }

  if (viewportWidth >= BREAKPOINTS.twoXl && typeof value.twoXl === 'number') {
    resolved = value.twoXl;
  }

  return resolved;
}

function useResponsiveMetrics(columns: ResponsiveValue, rowHeight: ResponsiveValue) {
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const updateViewportWidth = () => {
      setViewportWidth(window.innerWidth || 0);
    };

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);

    return () => {
      window.removeEventListener('resize', updateViewportWidth);
    };
  }, []);

  return useMemo(
    () => ({
      columnCount: resolveResponsiveValue(columns, viewportWidth),
      rowSize: resolveResponsiveValue(rowHeight, viewportWidth),
    }),
    [columns, rowHeight, viewportWidth]
  );
}

export default function VirtualizedCatalogGrid<T>({
  items,
  getKey,
  renderItem,
  columns = DEFAULT_COLUMNS,
  rowHeight = DEFAULT_ROW_HEIGHT,
  rowClassName = DEFAULT_ROW_CLASS,
  overscan = 5,
}: VirtualizedCatalogGridProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { columnCount, rowSize } = useResponsiveMetrics(columns, rowHeight);
  const rowCount = Math.ceil(items.length / columnCount);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowSize,
    overscan,
    scrollMargin,
  });

  useLayoutEffect(() => {
    const updateScrollMargin = () => {
      setScrollMargin(containerRef.current?.offsetTop || 0);
    };

    updateScrollMargin();
    window.addEventListener('resize', updateScrollMargin);

    return () => {
      window.removeEventListener('resize', updateScrollMargin);
    };
  }, [items.length, columnCount]);

  useEffect(() => {
    virtualizer.measure();
    // The virtualizer facade can be recreated during measurement; the sizing inputs are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnCount, rowCount, rowSize]);

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualRows.map((virtualRow) => {
        const startIndex = virtualRow.index * columnCount;
        const rowItems = items.slice(startIndex, startIndex + columnCount);

        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            className={`absolute left-0 top-0 w-full ${rowClassName}`}
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {rowItems.map((item, rowItemIndex) => {
              const itemIndex = startIndex + rowItemIndex;

              return (
                <div key={getKey(item)} className="min-w-0">
                  {renderItem(item, itemIndex)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
