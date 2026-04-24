export * from "./mlb-teams";

export type SportSlug = "mlb" | "nba" | "nfl";

export type Sportsbook = "draftkings";

export type Market =
  | "moneyline"
  | "run_line"
  | "total"
  | "prop_strikeouts_thrown"
  | "prop_outs_recorded"
  | "prop_total_bases"
  | "prop_home_runs"
  | "prop_hits"
  | "prop_rbis";

export type OddsField =
  | "home"
  | "away"
  | "over"
  | "under";

export interface Sport {
  id: number;
  slug: SportSlug;
  name: string;
  isActive: boolean;
}

export interface Team {
  id: number;
  sportId: number;
  externalId: string;
  name: string;
  abbreviation: string;
}

export interface Game {
  id: string;
  sportId: number;
  externalId: string;
  sourceUrl: string;
  homeTeam: Team;
  awayTeam: Team;
  startTime: string;
}

export interface OddsSnapshot {
  id: number;
  scrapeRunId: string;
  gameId: string;
  market: Market;
  field: OddsField;
  player: string | null;
  line: number | null;
  priceAmerican: number;
  capturedAt: string;
}

export type ScrapeStatus = "running" | "ok" | "degraded" | "failed";
export type ScrapeTrigger = "cron" | "manual";

export interface ScrapeRun {
  id: string;
  sportId: number;
  trigger: ScrapeTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: ScrapeStatus;
  gamesExpected: number | null;
  gamesScraped: number | null;
  rowsWritten: number | null;
  shapePassRate: number | null;
  healed: boolean;
  healMarkets: string[];
  healLlmTokens: number;
  healCostUsd: number;
  errorMessage: string | null;
  rawHtmlSnapshotUrl: string | null;
}

export interface Selector {
  id: string;
  sportId: number;
  source: Sportsbook;
  market: Market | "_root";
  field: string;
  selectorType: "css" | "xpath";
  selector: string;
  version: number;
  isActive: boolean;
  onProbation: boolean;
  origin: "seed" | "heal" | "manual";
  healRunId: string | null;
  confidence: number | null;
  notes: string | null;
  createdAt: string;
}
