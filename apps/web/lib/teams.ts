// Sport-aware team helpers. The canonical reference data lives in
// @ohsboard/types so the worker uses the same lookup. Web callers pass a
// `sport` slug ("mlb" | "nba") to disambiguate; we keep MLB-only export names
// around for legacy callers though all current consumers go through the
// sport-aware helpers.

import {
  findMlbTeam,
  findMlbTeamByAbbrev,
  findMlbTeamById,
  findNbaTeam,
  findNbaTeamByAbbrev,
  findNbaTeamById,
  MLB_TEAMS,
  NBA_TEAMS,
  type MlbTeam,
  type NbaTeam,
  type SportSlug,
} from "@ohsboard/types";

export type { MlbTeam, NbaTeam, SportSlug };
export { MLB_TEAMS, NBA_TEAMS };

/** Union team type — has the fields both the MLB and NBA refs share. */
export type AnyTeam = (MlbTeam | NbaTeam) & {
  abbreviation: string;
  name: string;
  city: string;
  mascot: string;
  primaryColor: string;
};

/** Find a team given a sport and any raw label (city, abbrev, mascot, etc.). */
export function findTeam(
  sport: SportSlug,
  raw: string | null | undefined,
): AnyTeam | null {
  if (sport === "nba") return findNbaTeam(raw) as AnyTeam | null;
  if (sport === "mlb") return findMlbTeam(raw) as AnyTeam | null;
  return null;
}

export function findTeamByAbbrev(
  sport: SportSlug,
  abbrev: string,
): AnyTeam | null {
  if (sport === "nba") return findNbaTeamByAbbrev(abbrev) as AnyTeam | null;
  if (sport === "mlb") return findMlbTeamByAbbrev(abbrev) as AnyTeam | null;
  return null;
}

export function findTeamById(sport: SportSlug, id: number): AnyTeam | null {
  if (sport === "nba") return findNbaTeamById(id) as AnyTeam | null;
  if (sport === "mlb") return findMlbTeamById(id) as AnyTeam | null;
  return null;
}

/**
 * Logo path on disk. MLB logos are committed as SVG (statsapi.mlb.com),
 * NBA logos as PNG (a.espncdn.com) — the per-sport extension lives here so
 * callers don't have to know.
 */
export function teamLogoPath(
  sport: SportSlug,
  abbreviation: string,
): string {
  const ext = sport === "nba" ? "png" : "svg";
  return `/teams/${sport}/${abbreviation}.${ext}`;
}
