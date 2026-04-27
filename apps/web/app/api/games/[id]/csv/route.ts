import { db } from "@/lib/db";
import { marketLabel } from "@/lib/games";
import { games, oddsSnapshots, sports, teams } from "@ohsboard/db";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const homeTeam = alias(teams, "home_team");
const awayTeam = alias(teams, "away_team");

const NBA_MARKETS = new Set([
  "prop_nba_points",
  "prop_nba_threes",
  "prop_nba_rebounds",
  "prop_nba_assists",
]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  // Pull the game + teams + sport in one query so we can both gate on
  // sport=nba and compute the filename without a second round-trip.
  const [meta] = await db
    .select({
      gameId: games.id,
      sportSlug: sports.slug,
      startTime: games.startTime,
      homeAbbr: homeTeam.abbreviation,
      homeName: homeTeam.name,
      awayAbbr: awayTeam.abbreviation,
      awayName: awayTeam.name,
    })
    .from(games)
    .innerJoin(sports, eq(sports.id, games.sportId))
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(eq(games.id, id))
    .limit(1);

  if (!meta) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (meta.sportSlug !== "nba") {
    return NextResponse.json({ error: "not_nba" }, { status: 404 });
  }

  // Full odds history for this game. Same shape as `/api/games/[id]/history`
  // but ordered ASC and restricted to NBA prop markets so we don't emit any
  // pitcher / game-line rows that would slip in if a game ever changed sport.
  const rows = await db
    .select({
      market: oddsSnapshots.market,
      field: oddsSnapshots.field,
      player: oddsSnapshots.player,
      line: oddsSnapshots.line,
      priceAmerican: oddsSnapshots.priceAmerican,
      capturedAt: oddsSnapshots.capturedAt,
    })
    .from(oddsSnapshots)
    .where(and(eq(oddsSnapshots.gameId, id)))
    .orderBy(asc(oddsSnapshots.capturedAt));

  const awayLabel = (meta.awayAbbr ?? meta.awayName ?? "AWY").trim();
  const homeLabel = (meta.homeAbbr ?? meta.homeName ?? "HOM").trim();
  const teamsCell = `${awayLabel} @ ${homeLabel}`;

  // Pivot (player, market, capturedAt-truncated-to-second) → one row.
  // Each scrape writes over+under as separate rows in odds_snapshots; here we
  // collapse them back into one row with `over` and `under` columns.
  type Pivot = {
    player: string;
    market: string;
    line: number | null;
    over: number | null;
    under: number | null;
    capturedAt: Date;
  };
  const buckets = new Map<string, Pivot>();
  for (const r of rows) {
    if (!NBA_MARKETS.has(r.market)) continue;
    if (!r.player) continue;
    const t = new Date(r.capturedAt);
    // Truncate to the second so over/under from the same scrape land in the
    // same bucket even if their write timestamps differ by microseconds.
    const tSec = Math.floor(t.getTime() / 1000);
    const key = `${r.player}|${r.market}|${tSec}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        player: r.player,
        market: r.market,
        line: r.line != null ? Number(r.line) : null,
        over: null,
        under: null,
        capturedAt: t,
      };
      buckets.set(key, bucket);
    }
    if (r.line != null) bucket.line = Number(r.line);
    if (r.field === "over") bucket.over = r.priceAmerican;
    else if (r.field === "under") bucket.under = r.priceAmerican;
  }

  const data = Array.from(buckets.values()).sort((a, b) => {
    if (a.capturedAt.getTime() !== b.capturedAt.getTime()) {
      return a.capturedAt.getTime() - b.capturedAt.getTime();
    }
    if (a.player !== b.player) return a.player.localeCompare(b.player);
    return a.market.localeCompare(b.market);
  });

  const header = ["teams", "player_name", "market", "line", "over", "under", "time"];
  const lines: string[] = [header.map(csvEscape).join(",")];
  for (const row of data) {
    lines.push(
      [
        csvEscape(teamsCell),
        csvEscape(row.player),
        csvEscape(marketLabel(row.market)),
        row.line != null ? row.line.toString() : "",
        row.over != null ? row.over.toString() : "",
        row.under != null ? row.under.toString() : "",
        csvEscape(formatEt(row.capturedAt)),
      ].join(","),
    );
  }
  // Trailing newline keeps Unix tools (wc -l, awk) accurate.
  const body = lines.join("\n") + "\n";

  const filename = buildFilename(
    meta.awayAbbr,
    meta.homeAbbr,
    meta.startTime ? new Date(meta.startTime) : null,
  );

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

// RFC 4180 quoting + Excel-formula injection guard. Excel auto-evaluates
// cells starting with `=`, `+`, `-`, `@`, so we tick-prefix any string that
// begins with those. A single tick is a no-op character in Excel display
// but blocks formula evaluation.
const FORMULA_PREFIX = /^[=+\-@]/;
function csvEscape(value: string): string {
  let v = value;
  if (FORMULA_PREFIX.test(v)) v = "'" + v;
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function formatEt(d: Date): string {
  // `Intl.DateTimeFormat.formatToParts` so we can compose `YYYY-MM-DD H:MM:SS AM/PM ET`
  // independent of the locale's preferred ordering (en-US default is M/D/Y).
  const parts = ET_FORMATTER.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
  return `${date} ${time} ET`;
}

function buildFilename(
  awayAbbr: string | null,
  homeAbbr: string | null,
  startTime: Date | null,
): string {
  const away = sanitizeAbbr(awayAbbr) ?? "AWY";
  const home = sanitizeAbbr(homeAbbr) ?? "HOM";
  const datePart = startTime ? ET_DATE_FORMATTER.format(startTime) : "tbd";
  return `nba-${away}-at-${home}-${datePart}.csv`;
}

const ET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function sanitizeAbbr(raw: string | null): string | null {
  if (!raw) return null;
  // Only ASCII alphanumerics in the filename to avoid Content-Disposition
  // RFC 5987 encoding edge cases. NBA abbreviations are already 2-4 letters.
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length > 0 ? cleaned.toUpperCase() : null;
}
