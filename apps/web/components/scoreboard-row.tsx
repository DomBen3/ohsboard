"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { GameDto } from "@/lib/games";
import { findTeam } from "@/lib/teams";
import { HistoryCharts } from "./history-charts";
import { useMarketFilter } from "./market-filter-context";
import { gridTemplate } from "./scoreboard";
import { SyncIndicator } from "./sync-indicator";
import { TeamBadge } from "./team-badge";

interface ScoreboardRowProps {
  game: GameDto;
  index: number;
}

export function ScoreboardRow({ game, index }: ScoreboardRowProps) {
  const [open, setOpen] = useState(false);
  // Keep ExpandedPanel mounted briefly after `open` goes false so the close
  // grid-rows transition has content to animate out of. Unmounting instantly
  // would kill the animation. 320ms > the 260ms CSS transition.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);
  const { visible } = useMarketFilter();
  const home = findTeam(game.home.name);
  const away = findTeam(game.away.name);

  const totalLine = game.total?.line ?? null;
  const over = game.total?.over ?? null;
  const under = game.total?.under ?? null;

  const showTotal = visible.has("total");
  const showMoneyline = visible.has("moneyline");

  // Flash the row briefly when its captured time changes, i.e. when the
  // scraper just wrote a new odds snapshot for this game mid-run.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const prevCapturedRef = useRef(game.capturedAt);
  useEffect(() => {
    const prev = prevCapturedRef.current;
    if (prev !== null && prev !== game.capturedAt && rowRef.current) {
      const el = rowRef.current;
      el.classList.remove("row-flash");
      // Force reflow so removing then adding the class actually re-runs the
      // CSS animation instead of being collapsed away by the browser.
      void el.offsetWidth;
      el.classList.add("row-flash");
    }
    prevCapturedRef.current = game.capturedAt;
  }, [game.capturedAt]);

  return (
    <div
      ref={rowRef}
      className={clsx(
        "row-rise relative border-b border-[var(--color-rule)]",
        open && "row-active",
      )}
      style={{ animationDelay: `${60 + index * 34}ms` }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Toggle details for ${away?.name ?? game.away.name} at ${home?.name ?? game.home.name}`}
        className="w-full px-6 py-4 text-left transition-colors hover:bg-[var(--color-ink-hover)]/60"
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate(visible),
          alignItems: "center",
          columnGap: "18px",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <TeamBadge team={away} fallbackCode={game.away.abbreviation ?? "AWY"} />
          <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-[var(--color-chalk)]">
            {away?.abbreviation ?? game.away.abbreviation ?? "AWY"}
          </span>
          <span className="font-display text-[11px] uppercase tracking-[0.22em] text-[var(--color-chalk-dimmer)]">
            at
          </span>
          <span className="font-display text-sm font-black uppercase tracking-[0.06em] text-[var(--color-chalk)]">
            {home?.abbreviation ?? game.home.abbreviation ?? "HOM"}
          </span>
          <TeamBadge team={home} fallbackCode={game.home.abbreviation ?? "HOM"} />
        </div>

        {showTotal ? (
          <>
            <div className="justify-self-center text-center">
              {totalLine !== null ? (
                <div className="font-seg text-lg text-[var(--color-brass)]">
                  {totalLine.toFixed(1)}
                </div>
              ) : (
                <span className="font-seg text-sm text-[var(--color-chalk-dimmer)]">
                  —
                </span>
              )}
              <div className="mt-0.5 font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
                Line
              </div>
            </div>
            <PriceCell label="Over" price={over} />
            <PriceCell label="Under" price={under} />
          </>
        ) : null}

        {showMoneyline ? (
          <MoneylineStack
            awayAbbr={away?.abbreviation ?? game.away.abbreviation ?? "AWY"}
            homeAbbr={home?.abbreviation ?? game.home.abbreviation ?? "HOM"}
            awayPrice={game.moneyline.away}
            homePrice={game.moneyline.home}
          />
        ) : null}

        <div className="justify-self-end pr-1">
          <SyncIndicator capturedAt={game.capturedAt} />
        </div>

        <span
          aria-hidden
          className={clsx(
            "justify-self-end text-[var(--color-chalk-dim)] transition-transform duration-200",
            open && "rotate-90 text-[var(--color-signal)]",
          )}
        >
          <svg viewBox="0 0 8 12" className="h-3 w-2" fill="currentColor">
            <path d="M0 0 L8 6 L0 12 Z" />
          </svg>
        </span>
      </button>

      <div className={clsx("expansion", open && "is-open")}>
        <div className="expansion-inner">
          {mounted ? (
            <ExpandedPanel game={game} home={home} away={away} open={open} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MoneylineStack({
  awayAbbr,
  homeAbbr,
  awayPrice,
  homePrice,
}: {
  awayAbbr: string;
  homeAbbr: string;
  awayPrice: number | null;
  homePrice: number | null;
}) {
  return (
    <div className="justify-self-center text-center">
      <div className="flex flex-col gap-0.5">
        <MoneylineLine abbr={awayAbbr} price={awayPrice} />
        <MoneylineLine abbr={homeAbbr} price={homePrice} />
      </div>
      <div className="mt-0.5 font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
        ML
      </div>
    </div>
  );
}

function MoneylineLine({
  abbr,
  price,
}: {
  abbr: string;
  price: number | null;
}) {
  const positive = typeof price === "number" && price > 0;
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="font-display text-[10px] uppercase tracking-[0.12em] text-[var(--color-chalk-dim)]">
        {abbr}
      </span>
      <span
        className={clsx(
          "font-seg text-sm",
          price === null
            ? "text-[var(--color-chalk-dimmer)]"
            : positive
              ? "text-[var(--color-signal)]"
              : "text-[var(--color-chalk)]",
        )}
      >
        {price === null
          ? "—"
          : price > 0
            ? `+${price}`
            : `−${Math.abs(price)}`}
      </span>
    </div>
  );
}

function PriceCell({
  label,
  price,
}: {
  label: string;
  price: number | null;
}) {
  const positive = typeof price === "number" && price > 0;
  return (
    <div className="justify-self-center text-center">
      <div
        className={clsx(
          "font-seg text-lg",
          price === null
            ? "text-[var(--color-chalk-dimmer)]"
            : positive
              ? "text-[var(--color-signal)]"
              : "text-[var(--color-chalk)]",
        )}
      >
        {price === null
          ? "—"
          : price > 0
            ? `+${price}`
            : `−${Math.abs(price)}`}
      </div>
      <div className="mt-0.5 font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
        {label}
      </div>
    </div>
  );
}

interface ExpandedPanelProps {
  game: GameDto;
  home: ReturnType<typeof findTeam>;
  away: ReturnType<typeof findTeam>;
  /** Only true when the row is expanded — gates the chart mount+fetch. */
  open: boolean;
}

function ExpandedPanel({ game, home, away, open }: ExpandedPanelProps) {
  const captured = game.capturedAt ? new Date(game.capturedAt) : null;
  const { isVisible } = useMarketFilter();
  return (
    <div className="px-6 pb-6 pt-1">
      <div className="border-t border-[var(--color-rule-bright)] pt-5">
        <div className="flex items-center gap-5">
          <TeamSummary team={away} fallback={game.away.name} label="Away" />
          <div className="font-display text-3xl font-black uppercase text-[var(--color-chalk-dimmer)]">
            @
          </div>
          <TeamSummary team={home} fallback={game.home.name} label="Home" />
        </div>
      </div>

      {isVisible("run_line") ? (
        game.runLine ? (
          <RunLineSection
            runLine={game.runLine}
            home={home}
            away={away}
            homeFallback={game.home.abbreviation}
            awayFallback={game.away.abbreviation}
          />
        ) : (
          <div className="mt-5 rounded-sm border border-dashed border-[var(--color-rule)] bg-[var(--color-ink)]/40 px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
            Run Line · awaiting first scrape
          </div>
        )
      ) : null}

      {isVisible("prop_pitcher_strikeouts") ? (
        <PitcherPropsSection
          title="Strikeouts Thrown"
          pitchers={game.props.strikeouts}
        />
      ) : null}
      {isVisible("prop_pitcher_outs_recorded") ? (
        <PitcherPropsSection
          title="Outs Recorded"
          pitchers={game.props.outsRecorded}
        />
      ) : null}

      {open ? <HistoryCharts gameId={game.id} capturedAt={game.capturedAt} /> : null}

      <div className="mt-6 flex flex-col gap-4 border-t border-[var(--color-rule)] pt-5 md:flex-row md:items-start md:gap-12">
        <Detail label="Captured">
          {captured ? (
            <time
              dateTime={captured.toISOString()}
              className="font-seg text-sm text-[var(--color-chalk)]"
            >
              {captured.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
          ) : (
            <span className="font-seg text-sm text-[var(--color-chalk-dimmer)]">
              —
            </span>
          )}
        </Detail>

        <Detail label="Source">
          {game.sourceUrl ? (
            <a
              href={game.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 font-display text-xs uppercase tracking-[0.2em] text-[var(--color-signal-dim)] hover:text-[var(--color-signal)]"
            >
              View on DraftKings
              <svg
                viewBox="0 0 10 10"
                className="h-2.5 w-2.5 transition-transform group-hover:translate-x-0.5"
                fill="currentColor"
              >
                <path d="M2 0 L10 0 L10 8 L8 8 L8 3.5 L1.4 10 L0 8.6 L6.5 2 L2 2 Z" />
              </svg>
            </a>
          ) : (
            <span className="font-seg text-sm text-[var(--color-chalk-dimmer)]">
              —
            </span>
          )}
        </Detail>
      </div>
    </div>
  );
}

function RunLineSection({
  runLine,
  home,
  away,
  homeFallback,
  awayFallback,
}: {
  runLine: NonNullable<GameDto["runLine"]>;
  home: ReturnType<typeof findTeam>;
  away: ReturnType<typeof findTeam>;
  homeFallback: string | null;
  awayFallback: string | null;
}) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
          Run line
        </span>
        <span className="h-px flex-1 bg-[var(--color-rule)]" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RunLineRowCell
          label="Away"
          team={away}
          fallback={awayFallback ?? "AWY"}
          line={runLine.away.line}
          price={runLine.away.price}
        />
        <RunLineRowCell
          label="Home"
          team={home}
          fallback={homeFallback ?? "HOM"}
          line={runLine.home.line}
          price={runLine.home.price}
        />
      </div>
    </div>
  );
}

function RunLineRowCell({
  label,
  team,
  fallback,
  line,
  price,
}: {
  label: string;
  team: ReturnType<typeof findTeam>;
  fallback: string;
  line: number | null;
  price: number | null;
}) {
  const positive = typeof price === "number" && price > 0;
  return (
    <div className="flex items-center justify-between gap-4 border border-[var(--color-rule)] bg-[var(--color-ink)]/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <TeamBadge team={team} fallbackCode={fallback} size="sm" />
        <div>
          <div className="font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
            {label}
          </div>
          <div className="font-display text-sm font-bold uppercase tracking-[0.06em] text-[var(--color-chalk)]">
            {team?.abbreviation ?? fallback}
          </div>
        </div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-seg text-base text-[var(--color-brass)]">
          {line === null
            ? "—"
            : line > 0
              ? `+${line.toFixed(1)}`
              : line.toFixed(1)}
        </span>
        <span
          className={clsx(
            "font-seg text-base",
            price === null
              ? "text-[var(--color-chalk-dimmer)]"
              : positive
                ? "text-[var(--color-signal)]"
                : "text-[var(--color-chalk)]",
          )}
        >
          {price === null
            ? "—"
            : price > 0
              ? `+${price}`
              : `−${Math.abs(price)}`}
        </span>
      </div>
    </div>
  );
}

function PitcherPropsSection({
  title,
  pitchers,
}: {
  title: string;
  pitchers: GameDto["props"]["strikeouts"];
}) {
  if (pitchers.length === 0) {
    return (
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-display text-[10px] uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
            {title}
          </span>
          <span className="h-px flex-1 bg-[var(--color-rule)]" />
        </div>
        <div className="rounded-sm border border-dashed border-[var(--color-rule)] bg-[var(--color-ink)]/40 px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
          Awaiting pitcher props
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
          {title}
        </span>
        <span className="h-px flex-1 bg-[var(--color-rule)]" />
      </div>
      <div className="border border-[var(--color-rule)] bg-[var(--color-ink)]/60">
        <div className="grid grid-cols-[minmax(160px,1.6fr)_70px_90px_90px] gap-3 border-b border-[var(--color-rule)] px-4 py-2 font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
          <span>Pitcher</span>
          <span className="justify-self-end">Line</span>
          <span className="justify-self-end">Over</span>
          <span className="justify-self-end">Under</span>
        </div>
        {pitchers.map((p) => (
          <div
            key={p.player}
            className="grid grid-cols-[minmax(160px,1.6fr)_70px_90px_90px] items-center gap-3 border-b border-[var(--color-rule)] px-4 py-2 last:border-b-0"
          >
            <span className="font-display text-sm tracking-[0.02em] text-[var(--color-chalk)]">
              {p.player}
            </span>
            <span className="justify-self-end font-seg text-sm text-[var(--color-brass)]">
              {p.line == null ? "—" : p.line.toFixed(1)}
            </span>
            <PricePill price={p.overPrice} />
            <PricePill price={p.underPrice} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PricePill({ price }: { price: number | null }) {
  const positive = typeof price === "number" && price > 0;
  return (
    <span
      className={clsx(
        "justify-self-end font-seg text-sm",
        price === null
          ? "text-[var(--color-chalk-dimmer)]"
          : positive
            ? "text-[var(--color-signal)]"
            : "text-[var(--color-chalk)]",
      )}
    >
      {price === null ? "—" : price > 0 ? `+${price}` : `−${Math.abs(price)}`}
    </span>
  );
}

function TeamSummary({
  team,
  fallback,
  label,
}: {
  team: ReturnType<typeof findTeam>;
  fallback: string | null;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <TeamBadge team={team} fallbackCode={fallback ?? label} size="lg" />
      <div>
        <div className="font-display text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
          {label}
        </div>
        <div className="font-display text-lg font-bold uppercase tracking-[0.04em] text-[var(--color-chalk)]">
          {team?.name ?? fallback ?? "Unknown"}
        </div>
        {team ? (
          <div className="font-seg text-[11px] uppercase tracking-[0.18em] text-[var(--color-chalk-soft)]">
            {team.abbreviation} · {team.city}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-display text-[10px] uppercase tracking-[0.28em] text-[var(--color-chalk-dim)]">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
