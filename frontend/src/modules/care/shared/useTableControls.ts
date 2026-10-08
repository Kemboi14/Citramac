import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface TableControls<T> {
  rows: T[];
  total: number;
  filter: string;
  setFilter: (value: string) => void;
  sortKey: string | null;
  direction: SortDirection;
  toggleSort: (key: string) => void;
}

type Accessor<T> = (row: T) => string | number | null | undefined;

/**
 * Client-side sort and text filter for a worklist that is already fully loaded.
 * `sorts` maps a column key to the value to sort by; `searchText` returns the
 * text a row is matched against. Nothing is stored — controls reset on reload.
 */
export function useTableControls<T>(
  source: T[] | null,
  options: {
    sorts: Record<string, Accessor<T>>;
    searchText: (row: T) => string;
    initialSort?: { key: string; direction: SortDirection };
  },
): TableControls<T> {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(options.initialSort?.key ?? null);
  const [direction, setDirection] = useState<SortDirection>(
    options.initialSort?.direction ?? "asc",
  );
  const { sorts, searchText } = options;

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let result = source ?? [];
    if (needle) result = result.filter((row) => searchText(row).toLowerCase().includes(needle));
    const accessor = sortKey ? Object.getOwnPropertyDescriptor(sorts, sortKey)?.value : undefined;
    if (accessor) {
      const factor = direction === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        const left = (accessor as Accessor<T>)(a);
        const right = (accessor as Accessor<T>)(b);
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
        return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
      });
    }
    return result;
  }, [source, filter, sortKey, direction, sorts, searchText]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  return {
    rows,
    total: source?.length ?? 0,
    filter,
    setFilter,
    sortKey,
    direction,
    toggleSort,
  };
}
