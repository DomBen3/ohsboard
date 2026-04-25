import { db } from "@/lib/db";
import { games, oddsSnapshots, sports, teams } from "@ohsboard/db";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SportSlug } from "@ohsboard/types";

const homeTeam = alias(teams, "home_team");
const awayTeam = alias(teams, "away_team");

export interface PitcherPropOutcome {
  player: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

/** NBA player prop outcome — same shape as MLB but renamed for clarity. */
export type PlayerPropOutcome = PitcherPropOutcome;

/**
 * Sport-tagged DTO. MLB rows use `sport: "mlb"` and carry game-level lines
 * plus pitcher-prop sections; NBA rows use `sport: "nba"` and carry only the
 * four player-prop sections (game-level lines absent).
 */
export type GameDto = MlbGameDto | NbaGameDto;

interface BaseGameDto {
  id: string;
  sourceUrl: string;
  startTime: string;
  home: { name: string | null; abbreviation: string | null };
  away: { name: string | null; abbreviation: string | null };
  capturedAt: string | null;
}

export interface MlbGameDto extends BaseGameDto {
  sport: "mlb";
  moneyline: { home: number | null; away: number | null };
  total: { line: number | null; over: number | null; under: number | null } | null;
  runLine: {
    home: { line: number | null; price: number | null };
    away: { line: number | null; price: number | null };
  } | null;
  props: {
    strikeouts: PitcherPropOutcome[];
    outsRecorded: PitcherPropOutcome[];
  };
}

export interface NbaGameDto extends BaseGameDto {
  sport: "nba";
  /** No game-level moneyline/total/run-line for NBA in v1. */
  props: {
    points: PlayerPropOutcome[];
    threes: PlayerPropOutcome[];
    rebounds: PlayerPropOutcome[];
    assists: PlayerPropOutcome[];
  };
}

export async function loadMlbGames(): Promise<MlbGameDto[]> {
  const mlb = await db.query.sports.findFirst({ where: eq(sports.slug, "mlb") });
  if (!mlb) return [];

  const gameRows = await db
    .select({
      id: games.id,
      sourceUrl: games.sourceUrl,
      startTime: games.startTime,
      homeName: homeTeam.name,
      homeAbbr: homeTeam.abbreviation,
      awayName: awayTeam.name,
      awayAbbr: awayTeam.abbreviation,
    })
    .from(games)
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(eq(games.sportId, mlb.id))
    .orderBy(desc(games.startTime))
    .limit(30);

  if (gameRows.length === 0) return [];

  // Latest snapshot per (game, market, player, field). Including `player` in
  // the distinct key is how we keep one row per pitcher for the prop markets;
  // it's NULL for game-level markets so the behaviour there is unchanged.
  const latestOdds = await db
    .selectDistinctOn(
      [
        oddsSnapshots.gameId,
        oddsSnapshots.market,
        oddsSnapshots.player,
        oddsSnapshots.field,
      ],
      {
        gameId: oddsSnapshots.gameId,
        market: oddsSnapshots.market,
        field: oddsSnapshots.field,
        player: oddsSnapshots.player,
        line: oddsSnapshots.line,
        priceAmerican: oddsSnapshots.priceAmerican,
        capturedAt: oddsSnapshots.capturedAt,
      },
    )
    .from(oddsSnapshots)
    .orderBy(
      oddsSnapshots.gameId,
      oddsSnapshots.market,
      oddsSnapshots.player,
      oddsSnapshots.field,
      desc(oddsSnapshots.capturedAt),
    );

  const byGame = new Map<string, typeof latestOdds>();
  for (const row of latestOdds) {
    const arr = byGame.get(row.gameId) ?? [];
    arr.push(row);
    byGame.set(row.gameId, arr);
  }

  return gameRows.map((g) => {
    const odds = byGame.get(g.id) ?? [];
    const pick = (market: string, field: string) =>
      odds.find((o) => o.market === market && o.field === field && !o.player) ??
      null;
    const mlHome = pick("moneyline", "home");
    const mlAway = pick("moneyline", "away");
    const totOver = pick("total", "over");
    const totUnder = pick("total", "under");
    const rlHome = pick("run_line", "home");
    const rlAway = pick("run_line", "away");

    const strikeouts = groupPlayerProps(odds, "prop_pitcher_strikeouts");
    const outsRecorded = groupPlayerProps(odds, "prop_pitcher_outs_recorded");

    const capturedAts = odds.map((o) => new Date(o.capturedAt).getTime());
    const newest = capturedAts.length ? new Date(Math.max(...capturedAts)) : null;
    return {
      sport: "mlb",
      id: g.id,
      sourceUrl: g.sourceUrl,
      startTime: g.startTime.toISOString(),
      home: { name: g.homeName, abbreviation: g.homeAbbr },
      away: { name: g.awayName, abbreviation: g.awayAbbr },
      moneyline: {
        home: mlHome?.priceAmerican ?? null,
        away: mlAway?.priceAmerican ?? null,
      },
      total:
        totOver || totUnder
          ? {
              line:
                totOver?.line != null
                  ? Number(totOver.line)
                  : totUnder?.line != null
                    ? Number(totUnder.line)
                    : null,
              over: totOver?.priceAmerican ?? null,
              under: totUnder?.priceAmerican ?? null,
            }
          : null,
      runLine:
        rlHome || rlAway
          ? {
              home: {
                line: rlHome?.line != null ? Number(rlHome.line) : null,
                price: rlHome?.priceAmerican ?? null,
              },
              away: {
                line: rlAway?.line != null ? Number(rlAway.line) : null,
                price: rlAway?.priceAmerican ?? null,
              },
            }
          : null,
      props: { strikeouts, outsRecorded },
      capturedAt: newest?.toISOString() ?? null,
    };
  });
}

export async function loadNbaGames(): Promise<NbaGameDto[]> {
  const nba = await db.query.sports.findFirst({ where: eq(sports.slug, "nba") });
  if (!nba) return [];

  const gameRows = await db
    .select({
      id: games.id,
      sourceUrl: games.sourceUrl,
      startTime: games.startTime,
      homeName: homeTeam.name,
      homeAbbr: homeTeam.abbreviation,
      awayName: awayTeam.name,
      awayAbbr: awayTeam.abbreviation,
    })
    .from(games)
    .leftJoin(homeTeam, eq(homeTeam.id, games.homeTeamId))
    .leftJoin(awayTeam, eq(awayTeam.id, games.awayTeamId))
    .where(eq(games.sportId, nba.id))
    .orderBy(desc(games.startTime))
    .limit(30);

  if (gameRows.length === 0) return [];

  const latestOdds = await db
    .selectDistinctOn(
      [
        oddsSnapshots.gameId,
        oddsSnapshots.market,
        oddsSnapshots.player,
        oddsSnapshots.field,
      ],
      {
        gameId: oddsSnapshots.gameId,
        market: oddsSnapshots.market,
        field: oddsSnapshots.field,
        player: oddsSnapshots.player,
        line: oddsSnapshots.line,
        priceAmerican: oddsSnapshots.priceAmerican,
        capturedAt: oddsSnapshots.capturedAt,
      },
    )
    .from(oddsSnapshots)
    .orderBy(
      oddsSnapshots.gameId,
      oddsSnapshots.market,
      oddsSnapshots.player,
      oddsSnapshots.field,
      desc(oddsSnapshots.capturedAt),
    );

  const byGame = new Map<string, typeof latestOdds>();
  for (const row of latestOdds) {
    const arr = byGame.get(row.gameId) ?? [];
    arr.push(row);
    byGame.set(row.gameId, arr);
  }

  return gameRows.map((g) => {
    const odds = byGame.get(g.id) ?? [];
    const points = groupPlayerProps(odds, "prop_nba_points");
    const threes = groupPlayerProps(odds, "prop_nba_threes");
    const rebounds = groupPlayerProps(odds, "prop_nba_rebounds");
    const assists = groupPlayerProps(odds, "prop_nba_assists");

    const capturedAts = odds.map((o) => new Date(o.capturedAt).getTime());
    const newest = capturedAts.length ? new Date(Math.max(...capturedAts)) : null;
    return {
      sport: "nba",
      id: g.id,
      sourceUrl: g.sourceUrl,
      startTime: g.startTime.toISOString(),
      home: { name: g.homeName, abbreviation: g.homeAbbr },
      away: { name: g.awayName, abbreviation: g.awayAbbr },
      props: { points, threes, rebounds, assists },
      capturedAt: newest?.toISOString() ?? null,
    };
  });
}

/** Sport-agnostic loader. */
export async function loadGames(sport: SportSlug): Promise<GameDto[]> {
  if (sport === "nba") return loadNbaGames();
  if (sport === "mlb") return loadMlbGames();
  return [];
}

function groupPlayerProps(
  odds: Array<{
    market: string;
    field: string;
    player: string | null;
    line: string | null;
    priceAmerican: number;
  }>,
  market: string,
): PlayerPropOutcome[] {
  const byPlayer = new Map<string, PlayerPropOutcome>();
  for (const o of odds) {
    if (o.market !== market || !o.player) continue;
    const existing = byPlayer.get(o.player) ?? {
      player: o.player,
      line: o.line != null ? Number(o.line) : null,
      overPrice: null,
      underPrice: null,
    };
    if (o.field === "over") existing.overPrice = o.priceAmerican;
    else if (o.field === "under") existing.underPrice = o.priceAmerican;
    if (existing.line === null && o.line != null) existing.line = Number(o.line);
    byPlayer.set(o.player, existing);
  }
  return Array.from(byPlayer.values()).sort((a, b) => a.player.localeCompare(b.player));
}
