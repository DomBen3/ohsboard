import {
  games,
  oddsSnapshots,
  type Db,
  teams,
} from "@ohsboard/db";
import type { MlbTeam } from "@ohsboard/types";
import { and, eq } from "drizzle-orm";

export interface GameUpsert {
  sportId: number;
  dkEventId: string;
  sourceUrl: string;
  /** Canonical MLB team, or null when the name didn't resolve. */
  home: MlbTeam | null;
  away: MlbTeam | null;
  /** Raw DK-derived names — used when the MLB lookup misses. */
  homeFallbackName: string;
  awayFallbackName: string;
  startTime: Date;
}

function computeAbbrev(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => (w[0] ?? "").toUpperCase())
      .join("");
  }
  return name.slice(0, 3).toUpperCase();
}

/**
 * Upsert a team. When a canonical MlbTeam is supplied we key on `mlb:<id>`
 * (stable, matches StatsAPI). When it's missing we fall back to a DK-scoped
 * key so the scrape still completes; a later run will normalize.
 */
export async function upsertTeam(
  db: Db,
  sportId: number,
  team: MlbTeam | null,
  fallbackName: string,
): Promise<number> {
  const externalId = team
    ? `mlb:${team.id}`
    : `dk:${fallbackName.trim().toLowerCase()}`;
  const displayName = team ? team.name : fallbackName;
  const abbreviation = team ? team.abbreviation : computeAbbrev(fallbackName);

  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.sportId, sportId), eq(teams.externalId, externalId)))
    .limit(1);
  if (existing[0]) {
    // Keep display name + abbreviation fresh (e.g. if a team was renamed).
    await db
      .update(teams)
      .set({ name: displayName, abbreviation })
      .where(eq(teams.id, existing[0].id));
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(teams)
    .values({ sportId, externalId, name: displayName, abbreviation })
    .onConflictDoNothing({ target: [teams.sportId, teams.externalId] })
    .returning({ id: teams.id });
  if (inserted) return inserted.id;

  const [raced] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.sportId, sportId), eq(teams.externalId, externalId)))
    .limit(1);
  if (!raced) throw new Error(`team upsert failed for ${displayName}`);
  return raced.id;
}

export async function upsertGame(db: Db, g: GameUpsert): Promise<string> {
  const [homeId, awayId] = await Promise.all([
    upsertTeam(db, g.sportId, g.home, g.homeFallbackName),
    upsertTeam(db, g.sportId, g.away, g.awayFallbackName),
  ]);

  const [inserted] = await db
    .insert(games)
    .values({
      sportId: g.sportId,
      externalId: g.dkEventId,
      sourceUrl: g.sourceUrl,
      homeTeamId: homeId,
      awayTeamId: awayId,
      startTime: g.startTime,
    })
    .onConflictDoUpdate({
      target: [games.sportId, games.externalId],
      set: {
        sourceUrl: g.sourceUrl,
        homeTeamId: homeId,
        awayTeamId: awayId,
        startTime: g.startTime,
      },
    })
    .returning({ id: games.id });

  if (!inserted) throw new Error(`game upsert failed for ${g.dkEventId}`);
  return inserted.id;
}

export interface OddsRow {
  gameId: string;
  market:
    | "moneyline"
    | "total"
    | "run_line"
    | "prop_pitcher_strikeouts"
    | "prop_pitcher_outs_recorded";
  field: "home" | "away" | "over" | "under";
  line: number | null;
  priceAmerican: number;
  /** Pitcher name for prop markets; null for game-level markets. */
  player: string | null;
}

export async function insertOddsSnapshots(
  db: Db,
  scrapeRunId: string,
  rows: OddsRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(oddsSnapshots)
    .values(
      rows.map((r) => ({
        scrapeRunId,
        gameId: r.gameId,
        market: r.market,
        field: r.field,
        player: r.player,
        line: r.line !== null ? String(r.line) : null,
        priceAmerican: r.priceAmerican,
      })),
    )
    .returning({ id: oddsSnapshots.id });
  return inserted.length;
}
