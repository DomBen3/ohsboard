"use client";

import clsx from "clsx";
import {
  ALL_MARKETS,
  useMarketFilter,
  type MarketKey,
} from "./market-filter-context";

const CHIPS: Array<{ key: MarketKey; label: string }> = [
  { key: "moneyline", label: "Moneyline" },
  { key: "run_line", label: "Run Line" },
  { key: "total", label: "Total" },
  { key: "prop_pitcher_strikeouts", label: "Strikeouts" },
  { key: "prop_pitcher_outs_recorded", label: "Outs Recorded" },
];

export function MarketFilterBar() {
  const { isVisible, toggle, visible, setAll } = useMarketFilter();
  const anyOff = visible.size < ALL_MARKETS.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-display text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
        Markets
      </span>
      {CHIPS.map((chip) => {
        const active = isVisible(chip.key);
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggle(chip.key)}
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
            {chip.label}
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
