import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  inet,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const sports = pgTable(
  "sports",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
  },
  (t) => ({
    slugUnique: uniqueIndex("sports_slug_unique").on(t.slug),
  }),
);

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    abbreviation: text("abbreviation").notNull(),
  },
  (t) => ({
    sportExternalUnique: uniqueIndex("teams_sport_external_unique").on(
      t.sportId,
      t.externalId,
    ),
  }),
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    homeTeamId: integer("home_team_id").references(() => teams.id),
    awayTeamId: integer("away_team_id").references(() => teams.id),
    // Nullable: NBA games we discover via DraftKings before ESPN's schedule
    // window catches up have no authoritative tip-off yet. The UI renders
    // "TBD" for nulls; never write `new Date()` here as a placeholder.
    startTime: timestamp("start_time", { withTimezone: true }),
  },
  (t) => ({
    sportExternalUnique: uniqueIndex("games_sport_external_unique").on(
      t.sportId,
      t.externalId,
    ),
  }),
);

export const selectors = pgTable(
  "selectors",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("draftkings"),
    market: text("market").notNull(),
    field: text("field").notNull(),
    selectorType: text("selector_type").notNull().default("css"),
    selector: text("selector").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    onProbation: boolean("on_probation").notNull().default(false),
    origin: text("origin").notNull(),
    healRunId: uuid("heal_run_id"),
    confidence: numeric("confidence"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    versionUnique: uniqueIndex("selectors_version_unique").on(
      t.sportId,
      t.source,
      t.market,
      t.field,
      t.version,
    ),
    // partial unique: one active row per (sport, source, market, field)
    activeUnique: uniqueIndex("selectors_active_unique")
      .on(t.sportId, t.source, t.market, t.field)
      .where(sql`${t.isActive}`),
  }),
);

export const scrapeRuns = pgTable("scrape_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sportId: integer("sport_id")
    .notNull()
    .references(() => sports.id),
  trigger: text("trigger").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  gamesExpected: integer("games_expected"),
  gamesScraped: integer("games_scraped"),
  rowsWritten: integer("rows_written"),
  shapePassRate: numeric("shape_pass_rate"),
  healed: boolean("healed").notNull().default(false),
  healMarkets: text("heal_markets")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  healLlmTokens: integer("heal_llm_tokens").notNull().default(0),
  healCostUsd: numeric("heal_cost_usd").notNull().default("0"),
  errorMessage: text("error_message"),
  rawHtmlSnapshotUrl: text("raw_html_snapshot_url"),
});

export const oddsSnapshots = pgTable("odds_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  scrapeRunId: uuid("scrape_run_id")
    .notNull()
    .references(() => scrapeRuns.id, { onDelete: "cascade" }),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  market: text("market").notNull(),
  field: text("field").notNull(),
  player: text("player"),
  line: numeric("line"),
  priceAmerican: integer("price_american").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const refreshRateLimits = pgTable(
  "refresh_rate_limits",
  {
    ip: inet("ip").notNull(),
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ip, t.hourBucket] }),
  }),
);
