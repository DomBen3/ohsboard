// Canonical NBA team reference. `id` matches ESPN's NBA team id (1–30) so
// external ids in the `teams` table can be keyed as `nba:<id>`. DK's display
// abbreviation differs from ESPN's in a handful of cases (PHO vs PHX, SA vs
// SAS, NY vs NYK), captured here as `dkAbbreviation`.

export interface NbaTeam {
  id: number;
  abbreviation: string;
  dkAbbreviation: string;
  espnAbbreviation: string;
  name: string;
  city: string;
  mascot: string;
  primaryColor: string;
}

export const NBA_TEAMS: readonly NbaTeam[] = [
  { id: 1,  abbreviation: "ATL", dkAbbreviation: "ATL", espnAbbreviation: "ATL",  name: "Atlanta Hawks",          city: "Atlanta",       mascot: "Hawks",        primaryColor: "#e03a3e" },
  { id: 2,  abbreviation: "BOS", dkAbbreviation: "BOS", espnAbbreviation: "BOS",  name: "Boston Celtics",         city: "Boston",        mascot: "Celtics",      primaryColor: "#007a33" },
  { id: 3,  abbreviation: "NOP", dkAbbreviation: "NO",  espnAbbreviation: "NO",   name: "New Orleans Pelicans",   city: "New Orleans",   mascot: "Pelicans",     primaryColor: "#0c2340" },
  { id: 4,  abbreviation: "CHI", dkAbbreviation: "CHI", espnAbbreviation: "CHI",  name: "Chicago Bulls",          city: "Chicago",       mascot: "Bulls",        primaryColor: "#ce1141" },
  { id: 5,  abbreviation: "CLE", dkAbbreviation: "CLE", espnAbbreviation: "CLE",  name: "Cleveland Cavaliers",    city: "Cleveland",     mascot: "Cavaliers",    primaryColor: "#6f263d" },
  { id: 6,  abbreviation: "DAL", dkAbbreviation: "DAL", espnAbbreviation: "DAL",  name: "Dallas Mavericks",       city: "Dallas",        mascot: "Mavericks",    primaryColor: "#00538c" },
  { id: 7,  abbreviation: "DEN", dkAbbreviation: "DEN", espnAbbreviation: "DEN",  name: "Denver Nuggets",         city: "Denver",        mascot: "Nuggets",      primaryColor: "#0e2240" },
  { id: 8,  abbreviation: "DET", dkAbbreviation: "DET", espnAbbreviation: "DET",  name: "Detroit Pistons",        city: "Detroit",       mascot: "Pistons",      primaryColor: "#c8102e" },
  { id: 9,  abbreviation: "GSW", dkAbbreviation: "GSW", espnAbbreviation: "GS",   name: "Golden State Warriors",  city: "Golden State",  mascot: "Warriors",     primaryColor: "#1d428a" },
  { id: 10, abbreviation: "HOU", dkAbbreviation: "HOU", espnAbbreviation: "HOU",  name: "Houston Rockets",        city: "Houston",       mascot: "Rockets",      primaryColor: "#ce1141" },
  { id: 11, abbreviation: "IND", dkAbbreviation: "IND", espnAbbreviation: "IND",  name: "Indiana Pacers",         city: "Indiana",       mascot: "Pacers",       primaryColor: "#002d62" },
  { id: 12, abbreviation: "LAC", dkAbbreviation: "LAC", espnAbbreviation: "LAC",  name: "LA Clippers",            city: "Los Angeles",   mascot: "Clippers",     primaryColor: "#c8102e" },
  { id: 13, abbreviation: "LAL", dkAbbreviation: "LAL", espnAbbreviation: "LAL",  name: "Los Angeles Lakers",     city: "Los Angeles",   mascot: "Lakers",       primaryColor: "#552583" },
  { id: 14, abbreviation: "MIA", dkAbbreviation: "MIA", espnAbbreviation: "MIA",  name: "Miami Heat",             city: "Miami",         mascot: "Heat",         primaryColor: "#98002e" },
  { id: 15, abbreviation: "MIL", dkAbbreviation: "MIL", espnAbbreviation: "MIL",  name: "Milwaukee Bucks",        city: "Milwaukee",     mascot: "Bucks",        primaryColor: "#00471b" },
  { id: 16, abbreviation: "MIN", dkAbbreviation: "MIN", espnAbbreviation: "MIN",  name: "Minnesota Timberwolves", city: "Minnesota",     mascot: "Timberwolves", primaryColor: "#0c2340" },
  { id: 17, abbreviation: "BKN", dkAbbreviation: "BKN", espnAbbreviation: "BKN",  name: "Brooklyn Nets",          city: "Brooklyn",      mascot: "Nets",         primaryColor: "#000000" },
  { id: 18, abbreviation: "NYK", dkAbbreviation: "NY",  espnAbbreviation: "NY",   name: "New York Knicks",        city: "New York",      mascot: "Knicks",       primaryColor: "#006bb6" },
  { id: 19, abbreviation: "ORL", dkAbbreviation: "ORL", espnAbbreviation: "ORL",  name: "Orlando Magic",          city: "Orlando",       mascot: "Magic",        primaryColor: "#0077c0" },
  { id: 20, abbreviation: "PHI", dkAbbreviation: "PHI", espnAbbreviation: "PHI",  name: "Philadelphia 76ers",     city: "Philadelphia",  mascot: "76ers",        primaryColor: "#006bb6" },
  { id: 21, abbreviation: "PHX", dkAbbreviation: "PHO", espnAbbreviation: "PHX",  name: "Phoenix Suns",           city: "Phoenix",       mascot: "Suns",         primaryColor: "#1d1160" },
  { id: 22, abbreviation: "POR", dkAbbreviation: "POR", espnAbbreviation: "POR",  name: "Portland Trail Blazers", city: "Portland",      mascot: "Trail Blazers", primaryColor: "#e03a3e" },
  { id: 23, abbreviation: "SAC", dkAbbreviation: "SAC", espnAbbreviation: "SAC",  name: "Sacramento Kings",       city: "Sacramento",    mascot: "Kings",        primaryColor: "#5a2d81" },
  { id: 24, abbreviation: "SAS", dkAbbreviation: "SA",  espnAbbreviation: "SA",   name: "San Antonio Spurs",      city: "San Antonio",   mascot: "Spurs",        primaryColor: "#c4ced4" },
  { id: 25, abbreviation: "OKC", dkAbbreviation: "OKC", espnAbbreviation: "OKC",  name: "Oklahoma City Thunder",  city: "Oklahoma City", mascot: "Thunder",      primaryColor: "#007ac1" },
  { id: 26, abbreviation: "UTA", dkAbbreviation: "UTA", espnAbbreviation: "UTAH", name: "Utah Jazz",              city: "Utah",          mascot: "Jazz",         primaryColor: "#002b5c" },
  { id: 27, abbreviation: "WAS", dkAbbreviation: "WAS", espnAbbreviation: "WSH",  name: "Washington Wizards",     city: "Washington",    mascot: "Wizards",      primaryColor: "#002b5c" },
  { id: 28, abbreviation: "TOR", dkAbbreviation: "TOR", espnAbbreviation: "TOR",  name: "Toronto Raptors",        city: "Toronto",       mascot: "Raptors",      primaryColor: "#ce1141" },
  { id: 29, abbreviation: "MEM", dkAbbreviation: "MEM", espnAbbreviation: "MEM",  name: "Memphis Grizzlies",      city: "Memphis",       mascot: "Grizzlies",    primaryColor: "#5d76a9" },
  { id: 30, abbreviation: "CHA", dkAbbreviation: "CHA", espnAbbreviation: "CHA",  name: "Charlotte Hornets",      city: "Charlotte",     mascot: "Hornets",      primaryColor: "#1d1160" },
];

const byAbbrev = new Map(
  NBA_TEAMS.map((t) => [t.abbreviation.toUpperCase(), t]),
);
const byDkAbbrev = new Map(
  NBA_TEAMS.map((t) => [t.dkAbbreviation.toUpperCase(), t]),
);
const byEspnAbbrev = new Map(
  NBA_TEAMS.map((t) => [t.espnAbbreviation.toUpperCase(), t]),
);
const byId = new Map(NBA_TEAMS.map((t) => [t.id, t]));
const byMascotLower = new Map(
  NBA_TEAMS.map((t) => [t.mascot.toLowerCase(), t]),
);

export function findNbaTeamById(id: number): NbaTeam | null {
  return byId.get(id) ?? null;
}

export function findNbaTeamByAbbrev(abbrev: string): NbaTeam | null {
  const upper = abbrev.trim().toUpperCase();
  return (
    byAbbrev.get(upper) ??
    byDkAbbrev.get(upper) ??
    byEspnAbbrev.get(upper) ??
    null
  );
}

/**
 * Resolve a (possibly messy) team string — DK header text like
 * "SA Spurs" / "POR Trail Blazers", an ESPN abbreviation, or a slug fragment —
 * to the canonical team. DK abbreviations (e.g. "SA", "PHO", "NY") are checked
 * before ESPN ones so DK page text resolves cleanly.
 */
export function findNbaTeam(raw: string | null | undefined): NbaTeam | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+(?:odds|matchup|lines?)\s*$/i, "").trim();
  if (!trimmed) return null;

  const words = trimmed.split(/\s+/);

  const firstUpper = words[0]?.toUpperCase();
  if (firstUpper) {
    const hit =
      byDkAbbrev.get(firstUpper) ??
      byAbbrev.get(firstUpper) ??
      byEspnAbbrev.get(firstUpper);
    if (hit) return hit;
  }

  for (const w of words) {
    const upper = w.toUpperCase();
    const hit =
      byDkAbbrev.get(upper) ?? byAbbrev.get(upper) ?? byEspnAbbrev.get(upper);
    if (hit) return hit;
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
