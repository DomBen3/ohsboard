"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  axisTick,
  buildTimeSeries,
  ChartCard,
  fmtPrice,
  fmtTime,
  StadiumTooltip,
} from "./history-charts";
import { useGameHistory, type Snapshot } from "@/lib/use-game-history";

interface PlayerChartPairProps {
  gameId: string;
  capturedAt: string | null;
  market: string;
  player: string;
  /**
   * Pre-fetched snapshots for the game, when the parent already has them
   * (avoids a redundant fetch per player click). When omitted, this component
   * fetches via `useGameHistory` itself — keeps it standalone-usable.
   */
  snapshots?: Snapshot[] | null;
}

export function PlayerChartPair({
  gameId,
  capturedAt,
  market,
  player,
  snapshots,
}: PlayerChartPairProps) {
  // Hook is always called (rules-of-hooks); the `enabled` gate inside the
  // hook short-circuits the actual network fetch when the parent already
  // supplied snapshots — common case in the scoreboard panel.
  const fetched = useGameHistory(gameId, capturedAt, {
    enabled: snapshots === undefined,
  });
  const source = snapshots ?? fetched.snapshots;
  const error = snapshots ? null : fetched.error;

  if (error) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-rule)] px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-alert)]">
        History failed to load · {error}
      </div>
    );
  }

  if (source === null) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-rule)] px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
        Loading {player}…
      </div>
    );
  }

  const filtered = source.filter(
    (r) => r.market === market && r.player === player,
  );
  const points = buildTimeSeries(filtered, ["over", "under"]);

  if (points.length < 2) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--color-rule)] bg-[var(--color-ink)]/40 px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
        {player} · waiting for more data
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ChartCard label="Price">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTime}
              tick={axisTick}
              stroke="var(--color-rule)"
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={fmtPrice}
              tick={axisTick}
              stroke="var(--color-rule)"
              width={50}
            />
            <Tooltip content={<StadiumTooltip formatValue={fmtPrice} />} />
            <Line
              type="stepAfter"
              dataKey="over"
              stroke="var(--color-signal)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="stepAfter"
              dataKey="under"
              stroke="var(--color-brass)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard label="Line">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTime}
              tick={axisTick}
              stroke="var(--color-rule)"
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => v.toFixed(1)}
              tick={axisTick}
              stroke="var(--color-rule)"
              width={40}
            />
            <Tooltip content={<StadiumTooltip formatValue={(v) => v.toFixed(1)} />} />
            <Line
              type="stepAfter"
              dataKey="line"
              stroke="var(--color-chart-line)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
