import { MarketFilterBar } from "@/components/market-filter-bar";
import { MarketFilterProvider } from "@/components/market-filter-context";
import { RefreshButton } from "@/components/refresh-button";
import { Scoreboard } from "@/components/scoreboard";
import { SyncIndicator } from "@/components/sync-indicator";
import type { SportNavItem } from "@/lib/active-sport";
import { loadGames } from "@/lib/games";

const BLURB: Record<string, string> = {
  nba: "DraftKings player props — Points, Threes, Rebounds, Assists. Self-healing scraper refreshes every five minutes — tap a row for the per-player slip.",
  mlb: "DraftKings moneyline, run line, total, and pitcher props. Self-healing scraper refreshes every five minutes — tap a row for the detail slip and line-movement charts.",
};

export async function SportBoard({ sport }: { sport: SportNavItem }) {
  const games = await loadGames(sport.slug);
  const newestCapture = games
    .map((g) => g.capturedAt)
    .filter((t): t is string => !!t)
    .reduce<string | null>((max, t) => (!max || t > max ? t : max), null);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const blurb = BLURB[sport.slug] ?? BLURB.mlb!;

  return (
    <MarketFilterProvider sport={sport.slug}>
      <div className="flex min-h-screen flex-col">
        <TopBar
          sportName={sport.name}
          today={today}
          newestCapture={newestCapture}
        />
        <section className="flex-1 px-10 pt-8 pb-16">
          <SectionHeading
            sportName={sport.name}
            blurb={blurb}
            gamesCount={games.length}
          />
          <div className="mt-6">
            <MarketFilterBar />
          </div>
          <div className="mt-4">
            <Scoreboard sport={sport.slug} games={games} />
          </div>
        </section>
      </div>
    </MarketFilterProvider>
  );
}

function TopBar({
  sportName,
  today,
  newestCapture,
}: {
  sportName: string;
  today: string;
  newestCapture: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-rule)] bg-[var(--color-ink)]/85 backdrop-blur-md">
      <div className="flex items-center justify-between px-10 py-5">
        <div className="flex items-baseline gap-5">
          <h1 className="font-display text-2xl font-black uppercase tracking-[0.03em] text-[var(--color-chalk)]">
            {sportName}
          </h1>
          <span className="h-4 w-px bg-[var(--color-rule)]" />
          <span className="font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dim)]">
            {today}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <SyncIndicator capturedAt={newestCapture} />
          <RefreshButton />
        </div>
      </div>
    </header>
  );
}

function SectionHeading({
  sportName,
  blurb,
  gamesCount,
}: {
  sportName: string;
  blurb: string;
  gamesCount: number;
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <div className="flex items-center gap-3">
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--color-signal-dim)]">
            §01
          </span>
          <span className="h-px w-8 bg-[var(--color-rule-bright)]" />
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--color-chalk-soft)]">
            Board
          </span>
        </div>
        <h2 className="mt-3 font-display text-5xl font-black uppercase leading-[0.95] tracking-[0.01em] text-[var(--color-chalk)]">
          Live Lines
          <span className="ml-3 text-[var(--color-signal-dim)]">·</span>
          <span className="ml-3 text-[var(--color-brass)]">{sportName}</span>
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-[var(--color-chalk-soft)]">
          {blurb}
        </p>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
        <div className="font-display text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
          On the board
        </div>
        <div className="font-seg text-5xl leading-none text-[var(--color-signal)]">
          {gamesCount.toString().padStart(2, "0")}
        </div>
        <div className="font-display text-[10px] uppercase tracking-[0.24em] text-[var(--color-chalk-dimmer)]">
          Active matchups
        </div>
      </div>
    </div>
  );
}

export function SportPaused({ sport }: { sport: SportNavItem }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--color-rule)] bg-[var(--color-ink)]/85 backdrop-blur-md">
        <div className="flex items-center justify-between px-10 py-5">
          <div className="flex items-baseline gap-5">
            <h1 className="font-display text-2xl font-black uppercase tracking-[0.03em] text-[var(--color-chalk-dim)]">
              {sport.name}
            </h1>
            <span className="h-4 w-px bg-[var(--color-rule)]" />
            <span className="font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-brass)]">
              Paused
            </span>
          </div>
        </div>
      </header>
      <section className="flex-1 px-10 pt-16 pb-16">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--color-brass)]">
              §00
            </span>
            <span className="h-px w-8 bg-[var(--color-rule-bright)]" />
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--color-chalk-soft)]">
              Pen
            </span>
          </div>
          <h2 className="mt-3 font-display text-5xl font-black uppercase leading-[0.95] tracking-[0.01em] text-[var(--color-chalk)]">
            {sport.name} on the bench
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--color-chalk-soft)]">
            The {sport.name} scraper is paused. All historical {sport.name} odds
            are preserved in the database and the code paths are intact — the
            worker simply skips this sport on each cron tick because{" "}
            <code className="font-mono text-xs text-[var(--color-chalk)]">
              sports.is_active=false
            </code>
            . Flip a single row to re-enable.
          </p>
          <div className="mt-8 inline-flex items-center gap-2 rounded border border-[var(--color-rule)] px-3 py-2 text-[10px] uppercase tracking-[0.24em] text-[var(--color-chalk-dim)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brass)]" />
            <span>Code retained · Scrape off</span>
          </div>
        </div>
      </section>
    </div>
  );
}
