"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGameHistory, type Snapshot } from "@/lib/use-game-history";
import { useMarketFilter } from "./market-filter-context";

interface HistoryChartsProps {
  gameId: string;
  /** Changes on every run tick so we refetch freshly-written points. */
  capturedAt: string | null;
}

export function HistoryCharts({ gameId, capturedAt }: HistoryChartsProps) {
  const { snapshots, error } = useGameHistory(gameId, capturedAt);
  const { isVisible, visible } = useMarketFilter();

  const grouped = useMemo(() => groupByMarket(snapshots ?? []), [snapshots]);

  // If every chartable market is off, don't render the Movement header at all.
  if (visible.size === 0) return null;

  if (error) {
    return (
      <div className="mt-6 rounded-sm border border-dashed border-[var(--color-rule)] px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-alert)]">
        Chart history failed to load · {error}
      </div>
    );
  }

  if (!snapshots) {
    return (
      <div className="mt-6 rounded-sm border border-dashed border-[var(--color-rule)] px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
        Loading odds history…
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
          Movement
        </span>
        <span className="h-px flex-1 bg-[var(--color-rule)]" />
      </div>

      {isVisible("moneyline") ? (
        <GameMarketCharts
          title="Moneyline"
          rows={grouped.get("moneyline") ?? []}
          series={[
            { field: "away", label: "Away", color: "var(--color-signal)" },
            { field: "home", label: "Home", color: "var(--color-brass)" },
          ]}
          showLine={false}
        />
      ) : null}

      {isVisible("total") ? (
        <GameMarketCharts
          title="Total"
          rows={grouped.get("total") ?? []}
          series={[
            { field: "over", label: "Over", color: "var(--color-signal)" },
            { field: "under", label: "Under", color: "var(--color-brass)" },
          ]}
          showLine
        />
      ) : null}

      {isVisible("run_line") ? (
        <GameMarketCharts
          title="Run Line"
          rows={grouped.get("run_line") ?? []}
          series={[
            { field: "away", label: "Away", color: "var(--color-signal)" },
            { field: "home", label: "Home", color: "var(--color-brass)" },
          ]}
          showLine
        />
      ) : null}

      {isVisible("prop_pitcher_strikeouts") ? (
        <PitcherPropCharts
          title="Strikeouts Thrown"
          rows={grouped.get("prop_pitcher_strikeouts") ?? []}
        />
      ) : null}
      {isVisible("prop_pitcher_outs_recorded") ? (
        <PitcherPropCharts
          title="Outs Recorded"
          rows={grouped.get("prop_pitcher_outs_recorded") ?? []}
        />
      ) : null}
    </div>
  );
}

function groupByMarket(snaps: Snapshot[]): Map<string, Snapshot[]> {
  const out = new Map<string, Snapshot[]>();
  for (const s of snaps) {
    const arr = out.get(s.market) ?? [];
    arr.push(s);
    out.set(s.market, arr);
  }
  return out;
}

interface ChartSeries {
  field: string;
  label: string;
  color: string;
}

function GameMarketCharts({
  title,
  rows,
  series,
  showLine,
}: {
  title: string;
  rows: Snapshot[];
  series: ChartSeries[];
  showLine: boolean;
}) {
  const filtered = rows.filter((r) => !r.player);
  const points = buildTimeSeries(filtered, series.map((s) => s.field));

  if (points.length < 2) {
    return <EmptyChart title={title} />;
  }

  return (
    <section>
      <ChartHeader title={title} />
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
            {series.map((s) => (
              <Line
                key={s.field}
                type="stepAfter"
                dataKey={s.field}
                stroke={s.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {showLine ? (
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
      ) : null}
    </section>
  );
}

function PitcherPropCharts({
  title,
  rows,
}: {
  title: string;
  rows: Snapshot[];
}) {
  // Group by pitcher first, then render a chart pair per pitcher.
  const byPlayer = new Map<string, Snapshot[]>();
  for (const r of rows) {
    if (!r.player) continue;
    const arr = byPlayer.get(r.player) ?? [];
    arr.push(r);
    byPlayer.set(r.player, arr);
  }

  if (byPlayer.size === 0) {
    return <EmptyChart title={title} />;
  }

  return (
    <section>
      <ChartHeader title={title} />
      <div className="flex flex-col gap-4">
        {Array.from(byPlayer.entries()).map(([player, playerRows]) => {
          const points = buildTimeSeries(playerRows, ["over", "under"]);
          if (points.length < 2) {
            return (
              <div
                key={player}
                className="rounded-sm border border-dashed border-[var(--color-rule)] bg-[var(--color-ink)]/40 px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]"
              >
                {player} · waiting for more data
              </div>
            );
          }
          return (
            <div key={player} className="flex flex-col gap-2">
              <div className="font-display text-[11px] uppercase tracking-[0.18em] text-[var(--color-chalk-soft)]">
                {player}
              </div>
              <ChartCard label="Price">
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
                <ResponsiveContainer width="100%" height={100}>
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
        })}
      </div>
    </section>
  );
}

export type ChartPoint = { t: number; line?: number | null } & Record<string, number | null | undefined>;

export function buildTimeSeries(rows: Snapshot[], fields: string[]): ChartPoint[] {
  // Bucket rows by truncated-to-second capturedAt. Over/under snapshots from
  // the same scrape run land in the same bucket and merge into one point.
  const buckets = new Map<number, ChartPoint>();
  for (const r of rows) {
    const t = Math.floor(new Date(r.capturedAt).getTime() / 1000) * 1000;
    const bucket: ChartPoint = buckets.get(t) ?? { t };
    if (fields.includes(r.field)) bucket[r.field] = r.priceAmerican;
    if (r.line != null) bucket.line = r.line;
    buckets.set(t, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

function ChartHeader({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="font-display text-[10px] uppercase tracking-[0.32em] text-[var(--color-chalk-dim)]">
        {title}
      </span>
      <span className="h-px flex-1 bg-[var(--color-rule)]" />
    </div>
  );
}

export function ChartCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--color-rule)] bg-[var(--color-ink)]/60 px-3 pb-3 pt-2">
      <div className="mb-1 font-display text-[9px] uppercase tracking-[0.28em] text-[var(--color-chalk-dimmer)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ title }: { title: string }) {
  return (
    <section>
      <ChartHeader title={title} />
      <div className="rounded-sm border border-dashed border-[var(--color-rule)] bg-[var(--color-ink)]/40 px-4 py-3 font-seg text-[11px] uppercase tracking-[0.2em] text-[var(--color-chalk-dimmer)]">
        Chart appears after the next scrape
      </div>
    </section>
  );
}

export const axisTick = {
  fill: "var(--color-chalk-dim)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
};

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return "";
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}

export function StadiumTooltip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: number;
  formatValue: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border border-[var(--color-rule-bright)] bg-[var(--color-ink-soft)]/95 px-3 py-2 font-seg text-[11px] text-[var(--color-chalk)]">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-chalk-dim)]">
        {label != null ? fmtTime(label) : ""}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="mt-1 flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="uppercase tracking-[0.14em] text-[var(--color-chalk-soft)]">
            {p.dataKey}
          </span>
          <span className="ml-auto">
            {p.value == null ? "—" : formatValue(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  );
}
