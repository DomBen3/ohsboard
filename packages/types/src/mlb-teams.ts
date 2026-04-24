// Canonical MLB team reference. `id` matches MLB StatsAPI team id so external
// ids in the `teams` table can be keyed as `mlb:<id>`. Change this file when
// MLB officially renames/relocates a team; regenerate logos with
// `pnpm fetch:logos`.

export interface MlbTeam {
  id: number;
  abbreviation: string;
  name: string;
  city: string;
  mascot: string;
  primaryColor: string;
}

export const MLB_TEAMS: readonly MlbTeam[] = [
  { id: 108, abbreviation: "LAA", name: "Los Angeles Angels", city: "Los Angeles", mascot: "Angels", primaryColor: "#ba0021" },
  { id: 109, abbreviation: "ARI", name: "Arizona Diamondbacks", city: "Arizona", mascot: "Diamondbacks", primaryColor: "#a71930" },
  { id: 110, abbreviation: "BAL", name: "Baltimore Orioles", city: "Baltimore", mascot: "Orioles", primaryColor: "#df4601" },
  { id: 111, abbreviation: "BOS", name: "Boston Red Sox", city: "Boston", mascot: "Red Sox", primaryColor: "#bd3039" },
  { id: 112, abbreviation: "CHC", name: "Chicago Cubs", city: "Chicago", mascot: "Cubs", primaryColor: "#0e3386" },
  { id: 113, abbreviation: "CIN", name: "Cincinnati Reds", city: "Cincinnati", mascot: "Reds", primaryColor: "#c6011f" },
  { id: 114, abbreviation: "CLE", name: "Cleveland Guardians", city: "Cleveland", mascot: "Guardians", primaryColor: "#00385d" },
  { id: 115, abbreviation: "COL", name: "Colorado Rockies", city: "Colorado", mascot: "Rockies", primaryColor: "#33006f" },
  { id: 116, abbreviation: "DET", name: "Detroit Tigers", city: "Detroit", mascot: "Tigers", primaryColor: "#0c2340" },
  { id: 117, abbreviation: "HOU", name: "Houston Astros", city: "Houston", mascot: "Astros", primaryColor: "#002d62" },
  { id: 118, abbreviation: "KC", name: "Kansas City Royals", city: "Kansas City", mascot: "Royals", primaryColor: "#004687" },
  { id: 119, abbreviation: "LAD", name: "Los Angeles Dodgers", city: "Los Angeles", mascot: "Dodgers", primaryColor: "#005a9c" },
  { id: 120, abbreviation: "WSH", name: "Washington Nationals", city: "Washington", mascot: "Nationals", primaryColor: "#ab0003" },
  { id: 121, abbreviation: "NYM", name: "New York Mets", city: "New York", mascot: "Mets", primaryColor: "#002d72" },
  { id: 133, abbreviation: "OAK", name: "Athletics", city: "Oakland", mascot: "Athletics", primaryColor: "#003831" },
  { id: 134, abbreviation: "PIT", name: "Pittsburgh Pirates", city: "Pittsburgh", mascot: "Pirates", primaryColor: "#fdb827" },
  { id: 135, abbreviation: "SD", name: "San Diego Padres", city: "San Diego", mascot: "Padres", primaryColor: "#2f241d" },
  { id: 136, abbreviation: "SEA", name: "Seattle Mariners", city: "Seattle", mascot: "Mariners", primaryColor: "#0c2c56" },
  { id: 137, abbreviation: "SF", name: "San Francisco Giants", city: "San Francisco", mascot: "Giants", primaryColor: "#fd5a1e" },
  { id: 138, abbreviation: "STL", name: "St. Louis Cardinals", city: "St. Louis", mascot: "Cardinals", primaryColor: "#c41e3a" },
  { id: 139, abbreviation: "TB", name: "Tampa Bay Rays", city: "Tampa Bay", mascot: "Rays", primaryColor: "#092c5c" },
  { id: 140, abbreviation: "TEX", name: "Texas Rangers", city: "Texas", mascot: "Rangers", primaryColor: "#003278" },
  { id: 141, abbreviation: "TOR", name: "Toronto Blue Jays", city: "Toronto", mascot: "Blue Jays", primaryColor: "#134a8e" },
  { id: 142, abbreviation: "MIN", name: "Minnesota Twins", city: "Minnesota", mascot: "Twins", primaryColor: "#002b5c" },
  { id: 143, abbreviation: "PHI", name: "Philadelphia Phillies", city: "Philadelphia", mascot: "Phillies", primaryColor: "#e81828" },
  { id: 144, abbreviation: "ATL", name: "Atlanta Braves", city: "Atlanta", mascot: "Braves", primaryColor: "#ce1141" },
  { id: 145, abbreviation: "CWS", name: "Chicago White Sox", city: "Chicago", mascot: "White Sox", primaryColor: "#27251f" },
  { id: 146, abbreviation: "MIA", name: "Miami Marlins", city: "Miami", mascot: "Marlins", primaryColor: "#00a3e0" },
  { id: 147, abbreviation: "NYY", name: "New York Yankees", city: "New York", mascot: "Yankees", primaryColor: "#003087" },
  { id: 158, abbreviation: "MIL", name: "Milwaukee Brewers", city: "Milwaukee", mascot: "Brewers", primaryColor: "#12284b" },
];

const byAbbrev = new Map(
  MLB_TEAMS.map((t) => [t.abbreviation.toUpperCase(), t]),
);
const byId = new Map(MLB_TEAMS.map((t) => [t.id, t]));
const byMascotLower = new Map(
  MLB_TEAMS.map((t) => [t.mascot.toLowerCase(), t]),
);

export function findMlbTeamById(id: number): MlbTeam | null {
  return byId.get(id) ?? null;
}

export function findMlbTeamByAbbrev(abbrev: string): MlbTeam | null {
  return byAbbrev.get(abbrev.trim().toUpperCase()) ?? null;
}

/**
 * Resolve a (possibly messy) team name — from DraftKings page text, a URL
 * slug, or the MLB schedule — to the canonical team. DK formats seen:
 * "DET Tigers", "BOS Red Sox", "CIN Reds", sometimes with " Odds" suffix.
 */
export function findMlbTeam(raw: string | null | undefined): MlbTeam | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+(?:odds|matchup|lines?)\s*$/i, "").trim();
  if (!trimmed) return null;

  const words = trimmed.split(/\s+/);

  const firstUpper = words[0]?.toUpperCase();
  if (firstUpper && byAbbrev.has(firstUpper)) return byAbbrev.get(firstUpper) ?? null;

  for (const w of words) {
    const upper = w.toUpperCase();
    if (byAbbrev.has(upper)) return byAbbrev.get(upper) ?? null;
  }

  const lower = trimmed.toLowerCase();
  for (const [mascot, team] of byMascotLower) {
    if (lower.endsWith(mascot) || lower.includes(` ${mascot}`)) return team;
  }
  for (const [mascot, team] of byMascotLower) {
    if (lower.includes(mascot)) return team;
  }

  return null;
}
