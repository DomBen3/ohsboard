"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type MarketKey =
  | "moneyline"
  | "run_line"
  | "total"
  | "prop_pitcher_strikeouts"
  | "prop_pitcher_outs_recorded";

export const ALL_MARKETS: readonly MarketKey[] = [
  "moneyline",
  "run_line",
  "total",
  "prop_pitcher_strikeouts",
  "prop_pitcher_outs_recorded",
];

const STORAGE_KEY = "ohs.visibleMarkets";

interface MarketFilterContextValue {
  visible: Set<MarketKey>;
  isVisible(key: MarketKey): boolean;
  toggle(key: MarketKey): void;
  setAll(visible: boolean): void;
}

const Ctx = createContext<MarketFilterContextValue | null>(null);

export function MarketFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState<Set<MarketKey>>(
    () => new Set(ALL_MARKETS),
  );

  // Hydrate from localStorage on first client render.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((k): k is MarketKey =>
        ALL_MARKETS.includes(k as MarketKey),
      );
      setVisible(new Set(filtered));
    } catch {
      /* localStorage unavailable or corrupt — fall back to defaults */
    }
  }, []);

  const persist = useCallback((next: Set<MarketKey>) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(next)),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(
    (key: MarketKey) => {
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setAll = useCallback(
    (visibleFlag: boolean) => {
      const next = new Set(visibleFlag ? ALL_MARKETS : []);
      setVisible(next);
      persist(next);
    },
    [persist],
  );

  const value = useMemo<MarketFilterContextValue>(
    () => ({
      visible,
      isVisible: (k) => visible.has(k),
      toggle,
      setAll,
    }),
    [visible, toggle, setAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarketFilter(): MarketFilterContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useMarketFilter must be used within <MarketFilterProvider>",
    );
  }
  return ctx;
}
