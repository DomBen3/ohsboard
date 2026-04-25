"use client";

import type { GameDto } from "@/lib/games";
import type { SportSlug } from "@/lib/teams";
import { useMarketFilter, type MarketKey } from "./market-filter-context";
import { ScoreboardRow } from "./scoreboard-row";

interface ScoreboardProps {
  sport: SportSlug;
  games: GameDto[];
}

/**
 * Shared grid template — header row + each data row both use this.
 * The column shape depends on the sport:
 *   - MLB: matchup | (Total/Over/Under)? | (ML)? | Updated | chevron
 *   - NBA: matchup | Tip | Updated | chevron   (Props live in expanded panel)
 */
export function gridTemplate(sport: SportSlug, vis: Set<MarketKey>): string {
  const cols: string[] = ["minmax(260px, 1.8fr)"]; // matchup
  if (sport === "mlb") {
    if (vis.has("total")) cols.push("96px", "100px", "100px");
    if (vis.has("moneyline")) cols.push("116px");
  } else if (sport === "nba") {
    cols.push("minmax(120px, 0.8fr)"); // tip-off time
  }
  cols.push("minmax(140px, 0.7fr)", "28px");
  return cols.join(" ");
}

export function Scoreboard({ sport, games }: ScoreboardProps) {
  if (games.length === 0) return <EmptyBoard />;

  return (
    <section className="border border-[var(--color-rule)] bg-[var(--color-ink-soft)]/80">
      <ScoreboardHeader sport={sport} count={games.length} />
      <div role="rowgroup">
        {games.map((game, i) => (
          <ScoreboardRow key={game.id} sport={sport} game={game} index={i} />
        ))}
      </div>
      <ScoreboardFooter />
    </section>
  );
}

function ScoreboardHeader({
  sport,
  count,
}: {
  sport: SportSlug;
  count: number;
}) {
  const { visible } = useMarketFilter();
  return (
    <header className="border-b border-[var(--color-rule)] bg-[var(--color-ink-raised)]/40">
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.32em] text-[var(--color-chalk-soft)]">
            Today&apos;s board
          </span>
          <span className="font-seg text-[11px] uppercase tracking-[0.14em] text-[var(--color-chalk-dim)]">
            {count.toString().padStart(2, "0")} games
          </span>
        </div>
        <span className="font-seg text-[11px] uppercase tracking-[0.14em] text-[var(--color-chalk-dim)]">
          Source · DraftKings
        </span>
      </div>
      <div className="px-6 pb-3">
        <div className="ticker-rule" />
      </div>
      <div
        className="px-6 pb-3 text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]"
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate(sport, visible),
          alignItems: "center",
          columnGap: "18px",
        }}
      >
        <div className="font-display">Matchup</div>
        {sport === "mlb" ? (
          <>
            {visible.has("total") ? (
              <>
                <div className="justify-self-center font-display">Total</div>
                <div className="justify-self-center font-display">Over</div>
                <div className="justify-self-center font-display">Under</div>
              </>
            ) : null}
            {visible.has("moneyline") ? (
              <div className="justify-self-center font-display">Moneyline</div>
            ) : null}
          </>
        ) : null}
        {sport === "nba" ? (
          <div className="justify-self-center font-display">Tip-off</div>
        ) : null}
        <div className="justify-self-end font-display">Updated</div>
        <div />
      </div>
    </header>
  );
}

function ScoreboardFooter() {
  return (
    <footer className="border-t border-[var(--color-rule)] bg-[var(--color-ink-raised)]/40 px-6 py-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
        <span className="font-seg">
          Self-healing agent · prices refresh every 5 min
        </span>
        <span className="font-seg">
          Open a row for details · American odds
        </span>
      </div>
    </footer>
  );
}

function EmptyBoard() {
  return (
    <div className="border border-dashed border-[var(--color-rule)] bg-[var(--color-ink-soft)]/50 p-16 text-center">
      <div className="mx-auto max-w-sm">
        <div className="font-display text-xs uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
          Board clear
        </div>
        <h2 className="mt-3 font-display text-2xl font-black uppercase tracking-[0.04em] text-[var(--color-chalk)]">
          No lines posted
        </h2>
        <p className="mt-2 text-sm text-[var(--color-chalk-soft)]">
          Hit refresh to kick off a new scrape, or wait for the 5-minute cron.
          The healer will re-discover selectors if DraftKings&apos; layout
          drifted.
        </p>
      </div>
    </div>
  );
}
