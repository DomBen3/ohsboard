import type { SportSlug } from "@ohsboard/types";
import {
  fetchExpectedMlbGames,
  matchExpectedGame as matchExpectedMlbGame,
  type ExpectedGame,
} from "./mlb-statsapi";
import {
  fetchExpectedNbaGames,
  matchExpectedNbaGame,
  type ExpectedNbaGame,
} from "./espn-nba";

export {
  fetchExpectedMlbGames,
  matchExpectedMlbGame,
  fetchExpectedNbaGames,
  matchExpectedNbaGame,
};
export type { ExpectedGame, ExpectedNbaGame };

/**
 * Sport-agnostic schedule entry — the slim projection used by the scraper for
 * games-expected counts and off-day short-circuiting. Per-sport callers can
 * still reach for `ExpectedGame` / `ExpectedNbaGame` (which carry the
 * canonical team objects + sport-specific ids) when they need to merge DK
 * data with the schedule.
 */
export interface ScheduleEntry {
  sport: SportSlug;
  externalId: string; // 'mlb:<gamePk>' | 'nba:<espnEventId>'
  startTime: Date;
  home: { abbreviation: string; externalId: string };
  away: { abbreviation: string; externalId: string };
}

function mlbToEntry(g: ExpectedGame): ScheduleEntry {
  return {
    sport: "mlb",
    externalId: `mlb:${g.gamePk}`,
    startTime: g.gameDate,
    home: { abbreviation: g.home.abbreviation, externalId: `mlb:${g.home.id}` },
    away: { abbreviation: g.away.abbreviation, externalId: `mlb:${g.away.id}` },
  };
}

function nbaToEntry(g: ExpectedNbaGame): ScheduleEntry {
  return {
    sport: "nba",
    externalId: `nba:${g.espnEventId}`,
    startTime: g.gameDate,
    home: { abbreviation: g.home.abbreviation, externalId: `nba:${g.home.id}` },
    away: { abbreviation: g.away.abbreviation, externalId: `nba:${g.away.id}` },
  };
}

/**
 * Generic schedule fetch keyed on sport slug. Throws on transport failures so
 * the caller can decide whether to fall back to "no cross-check" mode.
 */
export async function fetchExpectedSchedule(
  sport: SportSlug,
  date: Date = new Date(),
): Promise<ScheduleEntry[]> {
  switch (sport) {
    case "mlb": {
      const games = await fetchExpectedMlbGames(date);
      return games.map(mlbToEntry);
    }
    case "nba": {
      const games = await fetchExpectedNbaGames(date);
      return games.map(nbaToEntry);
    }
    case "nfl":
      throw new Error("NFL schedule source not implemented");
  }
}
