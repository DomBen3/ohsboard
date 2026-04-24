import clsx from "clsx";

interface SyncIndicatorProps {
  capturedAt: string | null;
}

/**
 * Live sync dot + last-synced relative time. Green dot pulses when data is
 * fresh (<15 min). Amber static dot when stale. Ghost dot when we have no data.
 */
export function SyncIndicator({ capturedAt }: SyncIndicatorProps) {
  if (!capturedAt) {
    return (
      <div className="flex items-center gap-2 font-seg text-[11px] uppercase tracking-[0.18em] text-[var(--color-chalk-dimmer)]">
        <span className="h-2 w-2 rounded-full border border-[var(--color-chalk-dimmer)]" />
        <span>No sync yet</span>
      </div>
    );
  }

  const ageMs = Date.now() - new Date(capturedAt).getTime();
  const ageMin = Math.max(0, Math.round(ageMs / 60_000));
  const stale = ageMin > 15;
  const label = ageMin < 1 ? "LIVE" : `${ageMin}m ago`;

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={clsx(
          "h-2 w-2 rounded-full",
          stale
            ? "bg-[var(--color-warn)] shadow-[0_0_6px_rgba(247,185,85,0.35)]"
            : "signal-dot",
        )}
      />
      <div className="flex items-baseline gap-1.5">
        <span
          className={clsx(
            "font-display text-[11px] uppercase tracking-[0.22em]",
            stale
              ? "text-[var(--color-warn)]"
              : "text-[var(--color-signal-dim)]",
          )}
        >
          {stale ? "Stale" : "Fresh"}
        </span>
        <span className="font-seg text-[11px] uppercase tracking-[0.14em] text-[var(--color-chalk-soft)]">
          · {label}
        </span>
      </div>
    </div>
  );
}
