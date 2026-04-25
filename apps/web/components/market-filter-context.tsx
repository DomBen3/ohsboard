"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SportSlug } from "@/lib/teams";

export type MarketKey =
  // MLB markets
  | "moneyline"
  | "run_line"
  | "total"
  | "prop_pitcher_strikeouts"
  | "prop_pitcher_outs_recorded"
  // NBA markets
  | "prop_nba_points"
  | "prop_nba_threes"
  | "prop_nba_rebounds"
  | "prop_nba_assists";

export const MLB_MARKETS: readonly MarketKey[] = [
  "moneyline",
  "run_line",
  "total",
  "prop_pitcher_strikeouts",
  "prop_pitcher_outs_recorded",
];

export const NBA_MARKETS: readonly MarketKey[] = [
  "prop_nba_points",
  "prop_nba_threes",
  "prop_nba_rebounds",
  "prop_nba_assists",
];

export function marketsForSport(sport: SportSlug): readonly MarketKey[] {
  if (sport === "nba") return NBA_MARKETS;
  return MLB_MARKETS;
}

/** Back-compat: the old single-set ALL_MARKETS, used by the reset button. */
export const ALL_MARKETS = MLB_MARKETS;

const STORAGE_PREFIX = "ohs.visibleMarkets";
const LEGACY_KEY = "ohs.visibleMarkets";

function storageKey(sport: SportSlug): string {
  return `${STORAGE_PREFIX}.${sport}`;
}

interface MarketFilterContextValue {
  sport: SportSlug;
  visible: Set<MarketKey>;
  isVisible(key: MarketKey): boolean;
  toggle(key: MarketKey): void;
  setAll(visible: boolean): void;
}

const Ctx = createContext<MarketFilterContextValue | null>(null);

interface ProviderProps {
  sport: SportSlug;
  children: React.ReactNode;
}

export function MarketFilterProvider({ sport, children }: ProviderProps) {
  const sportMarkets = useMemo(() => marketsForSport(sport), [sport]);

  const [visible, setVisible] = useState<Set<MarketKey>>(
    () => new Set(sportMarkets),
  );

  // Hydrate from localStorage on first client render. We migrate the legacy
  // single-key layout to a sport-scoped key so MLB users keep their prefs
  // when MLB un-pauses.
  useEffect(() => {
    try {
      // One-shot legacy migration: the v1 app stored a single
      // `ohs.visibleMarkets` array (MLB-only). Copy it forward to the
      // mlb-scoped key so MLB chip prefs survive the unpause.
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy && !window.localStorage.getItem(storageKey("mlb"))) {
        window.localStorage.setItem(storageKey("mlb"), legacy);
      }

      const raw = window.localStorage.getItem(storageKey(sport));
      if (!raw) {
        // No stored value for this sport — keep the default (all on).
        setVisible(new Set(sportMarkets));
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((k): k is MarketKey =>
        sportMarkets.includes(k as MarketKey),
      );
      setVisible(new Set(filtered));
    } catch {
      /* localStorage unavailable or corrupt — fall back to defaults */
    }
  }, [sport, sportMarkets]);

  const persist = useCallback(
    (next: Set<MarketKey>) => {
      try {
        window.localStorage.setItem(
          storageKey(sport),
          JSON.stringify(Array.from(next)),
        );
      } catch {
        /* ignore */
      }
    },
    [sport],
  );

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
      const next = new Set(visibleFlag ? sportMarkets : []);
      setVisible(next);
      persist(next);
    },
    [persist, sportMarkets],
  );

  const value = useMemo<MarketFilterContextValue>(
    () => ({
      sport,
      visible,
      isVisible: (k) => visible.has(k),
      toggle,
      setAll,
    }),
    [sport, visible, toggle, setAll],
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
