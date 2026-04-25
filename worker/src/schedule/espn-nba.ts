import {
  findNbaTeam,
  findNbaTeamByAbbrev,
  findNbaTeamById,
  type NbaTeam,
} from "@ohsboard/types";

export interface ExpectedNbaGame {
  espnEventId: string;
  gameDate: Date;
  home: NbaTeam;
  away: NbaTeam;
  statusName: string;
  statusState: string;
}

interface EspnTeamRef {
  homeAway: "home" | "away";
  team: {
    id: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
  };
}

interface EspnEvent {
  id: string;
  date: string;
  competitions?: Array<{
    competitors?: EspnTeamRef[];
  }>;
  status?: { type?: { name?: string; state?: string } };
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

function toYmd(date: Date): string {
  // ESPN scoreboard uses YYYYMMDD with no separators. We pass UTC-shifted-to-ET
  // because NBA games in the late slot run past midnight UTC; ET is the
  // schedule-day convention.
  const et = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const y = et.getUTCFullYear();
  const m = String(et.getUTCMonth() + 1).padStart(2, "0");
  const d = String(et.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function mapTeam(ref: EspnTeamRef): NbaTeam | null {
  const numericId = Number(ref.team.id);
  if (!Number.isNaN(numericId)) {
    const byId = findNbaTeamById(numericId);
    if (byId) return byId;
  }
  if (ref.team.abbreviation) {
    const byAbbr = findNbaTeamByAbbrev(ref.team.abbreviation);
    if (byAbbr) return byAbbr;
  }
  return findNbaTeam(ref.team.displayName ?? ref.team.shortDisplayName ?? null);
}

/**
 * Return the NBA games scheduled for the given date (default: today, in ET).
 * Throws on transport/HTTP failure; callers decide whether to proceed without
 * the cross-check.
 */
export async function fetchExpectedNbaGames(
  date: Date = new Date(),
): Promise<ExpectedNbaGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${toYmd(date)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${res.statusText}`);
  const body = (await res.json()) as EspnScoreboardResponse;
  const events = body.events ?? [];

  const out: ExpectedNbaGame[] = [];
  for (const ev of events) {
    const competitors = ev.competitions?.[0]?.competitors ?? [];
    const homeRef = competitors.find((c) => c.homeAway === "home");
    const awayRef = competitors.find((c) => c.homeAway === "away");
    if (!homeRef || !awayRef) continue;
    const home = mapTeam(homeRef);
    const away = mapTeam(awayRef);
    if (!home || !away) continue;
    out.push({
      espnEventId: ev.id,
      gameDate: new Date(ev.date),
      home,
      away,
      statusName: ev.status?.type?.name ?? "STATUS_UNKNOWN",
      statusState: ev.status?.type?.state ?? "pre",
    });
  }
  return out;
}

/**
 * Find the ExpectedNbaGame whose home + away match the given DK-derived team
 * strings (e.g. "POR Trail Blazers", "SA Spurs"). Returns null when either
 * side fails to resolve or no scheduled game pairs the two teams today.
 */
export function matchExpectedNbaGame(
  expected: ExpectedNbaGame[],
  dkHomeName: string | null | undefined,
  dkAwayName: string | null | undefined,
): ExpectedNbaGame | null {
  const home = findNbaTeam(dkHomeName);
  const away = findNbaTeam(dkAwayName);
  if (!home || !away) return null;
  return (
    expected.find((g) => g.home.id === home.id && g.away.id === away.id) ?? null
  );
}
