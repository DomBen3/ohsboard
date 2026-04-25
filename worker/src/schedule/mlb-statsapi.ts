import {
  findMlbTeam,
  findMlbTeamByAbbrev,
  findMlbTeamById,
  type MlbTeam,
} from "@ohsboard/types";

export interface ExpectedGame {
  gamePk: number;
  gameDate: Date;
  home: MlbTeam;
  away: MlbTeam;
  statusCode: string;
  abstractGameState: string;
}

interface StatsApiTeamRef {
  team: {
    id: number;
    name?: string;
    abbreviation?: string;
  };
}

interface StatsApiGame {
  gamePk: number;
  gameDate: string;
  status?: { abstractGameState?: string; statusCode?: string };
  teams: { home: StatsApiTeamRef; away: StatsApiTeamRef };
}

interface StatsApiResponse {
  dates?: Array<{ games?: StatsApiGame[] }>;
}

function toYmd(date: Date): string {
  // MLB StatsAPI expects a local (Eastern) date. Using ET is the closest match
  // to MLB's schedule-day convention — games after midnight local still count
  // for the previous day in the API. UTC-4/5 approximation is fine here.
  const et = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const y = et.getUTCFullYear();
  const m = String(et.getUTCMonth() + 1).padStart(2, "0");
  const d = String(et.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapTeam(ref: StatsApiTeamRef): MlbTeam | null {
  return (
    findMlbTeamById(ref.team.id) ??
    (ref.team.abbreviation ? findMlbTeamByAbbrev(ref.team.abbreviation) : null) ??
    findMlbTeam(ref.team.name ?? null)
  );
}

/**
 * Return the MLB games scheduled for the given date (default: today, in ET).
 * Throws if the StatsAPI request fails; callers decide whether to fall back.
 */
export async function fetchExpectedMlbGames(
  date: Date = new Date(),
): Promise<ExpectedGame[]> {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${toYmd(date)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`StatsAPI ${res.status} ${res.statusText}`);
  const body = (await res.json()) as StatsApiResponse;
  const games = body.dates?.[0]?.games ?? [];

  const out: ExpectedGame[] = [];
  for (const g of games) {
    const home = mapTeam(g.teams.home);
    const away = mapTeam(g.teams.away);
    if (!home || !away) continue;
    out.push({
      gamePk: g.gamePk,
      gameDate: new Date(g.gameDate),
      home,
      away,
      statusCode: g.status?.statusCode ?? "?",
      abstractGameState: g.status?.abstractGameState ?? "Preview",
    });
  }
  return out;
}

/**
 * Find the ExpectedGame whose home + away teams match the given DK-derived
 * team names. Returns null when we can't resolve both DK names to canonical
 * teams or no StatsAPI game pairs those two teams today.
 */
export function matchExpectedGame(
  expected: ExpectedGame[],
  dkHomeName: string | null | undefined,
  dkAwayName: string | null | undefined,
): ExpectedGame | null {
  const home = findMlbTeam(dkHomeName);
  const away = findMlbTeam(dkAwayName);
  if (!home || !away) return null;
  return (
    expected.find((g) => g.home.id === home.id && g.away.id === away.id) ?? null
  );
}
