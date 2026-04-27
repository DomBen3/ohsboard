import clsx from "clsx";

interface SyncIndicatorProps {
  capturedAt: string | null;
  /** Tip-off, when known. Drives the "Game Over" state once now is past
   *  start + GAME_DURATION_MIN. Optional so aggregate header indicators
   *  (which span many games) can omit it. */
  startTime?: string | null;
}

// Mirrors `GAME_DURATION_MIN` in lib/games.ts. Hardcoded here to avoid
// importing a server-only module into a client component; if the duration
// changes, update both.
const GAME_DURATION_MIN = 180;

/**
 * Live sync dot + last-synced relative time. Green dot pulses when data is
 * fresh (<15 min). Amber static dot when stale. Red dot + "Game Over" once
 * the game has been over for long enough that a stale price is expected.
 * Ghost dot when we have no data.
 */
export function SyncIndicator({ capturedAt, startTime }: SyncIndicatorProps) {
  const isGameOver =
    !!startTime &&
    Date.now() >
      new Date(startTime).getTime() + GAME_DURATION_MIN * 60_000;

  if (isGameOver) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-[var(--color-alert)] shadow-[0_0_6px_rgba(255,90,95,0.4)]" />
        <span className="font-display text-[11px] uppercase tracking-[0.22em] text-[var(--color-alert)]">
          Game Over
        </span>
      </div>
    );
  }

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
