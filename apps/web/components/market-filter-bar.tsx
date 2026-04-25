"use client";

import clsx from "clsx";
import {
  marketsForSport,
  useMarketFilter,
  type MarketKey,
} from "./market-filter-context";

const CHIP_LABELS: Record<MarketKey, string> = {
  moneyline: "Moneyline",
  run_line: "Run Line",
  total: "Total",
  prop_pitcher_strikeouts: "Strikeouts",
  prop_pitcher_outs_recorded: "Outs Recorded",
  prop_nba_points: "Points",
  prop_nba_threes: "Threes",
  prop_nba_rebounds: "Rebounds",
  prop_nba_assists: "Assists",
};

export function MarketFilterBar() {
  const { isVisible, toggle, visible, setAll, sport } = useMarketFilter();
  const chips = marketsForSport(sport);
  const anyOff = visible.size < chips.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-display text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
        Markets
      </span>
      {chips.map((key) => {
        const active = isVisible(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={active}
            className={clsx(
              "relative inline-flex items-center gap-1.5 border px-3 py-1",
              "font-display text-[11px] uppercase tracking-[0.2em] transition-colors",
              active
                ? "border-[var(--color-signal-dim)] bg-[var(--color-signal)]/10 text-[var(--color-signal-dim)]"
                : "border-[var(--color-rule)] bg-[var(--color-ink-raised)] text-[var(--color-chalk-dimmer)] hover:text-[var(--color-chalk-soft)]",
            )}
          >
            <span
              aria-hidden
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                active
                  ? "bg-[var(--color-signal)] shadow-[0_0_6px_var(--color-signal-glow)]"
                  : "border border-[var(--color-chalk-dimmer)] bg-transparent",
              )}
            />
            {CHIP_LABELS[key]}
          </button>
        );
      })}
      {anyOff ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="ml-1 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dim)] hover:text-[var(--color-chalk)]"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
