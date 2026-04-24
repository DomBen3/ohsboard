import { MarketFilterBar } from "@/components/market-filter-bar";
import { MarketFilterProvider } from "@/components/market-filter-context";
import { RefreshButton } from "@/components/refresh-button";
import { Scoreboard } from "@/components/scoreboard";
import { SyncIndicator } from "@/components/sync-indicator";
import { loadMlbGames } from "@/lib/games";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const games = await loadMlbGames();
  const newestCapture = games
    .map((g) => g.capturedAt)
    .filter((t): t is string => !!t)
    .reduce<string | null>((max, t) => (!max || t > max ? t : max), null);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <MarketFilterProvider>
      <div className="flex min-h-screen flex-col">
        <TopBar today={today} newestCapture={newestCapture} />
        <section className="flex-1 px-10 pt-8 pb-16">
          <SectionHeading gamesCount={games.length} />
          <div className="mt-6">
            <MarketFilterBar />
          </div>
          <div className="mt-4">
            <Scoreboard games={games} />
          </div>
        </section>
      </div>
    </MarketFilterProvider>
  );
}

function TopBar({
  today,
  newestCapture,
}: {
  today: string;
  newestCapture: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-rule)] bg-[var(--color-ink)]/85 backdrop-blur-md">
      <div className="flex items-center justify-between px-10 py-5">
        <div className="flex items-baseline gap-5">
          <h1 className="font-display text-2xl font-black uppercase tracking-[0.03em] text-[var(--color-chalk)]">
            MLB
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

function SectionHeading({ gamesCount }: { gamesCount: number }) {
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
          <span className="ml-3 text-[var(--color-brass)]">MLB</span>
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-[var(--color-chalk-soft)]">
          DraftKings moneyline, run line, total, and pitcher props. Self-healing
          scraper refreshes every five minutes — tap a row for the detail slip
          and line-movement charts.
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
