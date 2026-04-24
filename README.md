# OhsBoard

A React + Neon + Playwright stack that tracks DraftKings MLB odds, with an agent that self-heals its selectors via the OpenAI API when DraftKings' HTML changes.

Full PRD: `~/.claude/plans/create-a-prd-for-reactive-lollipop.md`.

## Layout

```
apps/web            Next.js 15 App Router frontend + API routes   (Vercel)
worker              Node + Playwright scraping agent              (Fly.io)
db                  Drizzle schema + migrations + seed
packages/types      Shared TS types used by web and worker
Dockerfile.worker   Worker image (build context = repo root)
fly.worker.toml     Fly deployment for the worker
odd_scraper.py      Legacy Python scraper (reference only, not deployed)
```

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- A Neon Postgres database (free tier is fine — https://neon.tech)
- Later (M6+): an OpenAI API key + organization ID; Fly.io account for worker deploy

## First-time setup

```bash
# 1. Install everything (this includes Playwright + its Chromium; ~5 min the first time)
pnpm install

# 2. Install the Chromium binary Playwright needs for scraping (worker only)
pnpm --filter @ohsboard/worker exec playwright install --with-deps chromium

# 3. Copy env template and fill in DATABASE_URL from Neon + a WORKER_SECRET
cp .env.example .env.local
# Edit .env.local: DATABASE_URL and WORKER_SECRET are required
# OPENAI_API_KEY + OPENAI_ORG_ID can stay blank until M6

# 4. Push schema to Neon (creates all tables)
pnpm db:push

# 5. Seed sports rows + initial selectors from the legacy Python scraper
pnpm db:seed
```

## Running locally

```bash
# Web on http://localhost:3000
pnpm web:dev

# Worker on http://localhost:8080 (cron runs every 5 min; HTTP /trigger for manual)
pnpm worker:dev
```

To verify the worker is wired up end-to-end:

```bash
curl -X POST http://localhost:8080/trigger \
  -H "x-worker-secret: $(grep WORKER_SECRET .env.local | cut -d= -f2)"
# => {"runId":"...","cached":false}
```

The scrape itself is stubbed until M2 — the run will record as `ok` with 0 rows. That's expected.

## Scripts

| Script              | What it does                                                    |
|---------------------|-----------------------------------------------------------------|
| `pnpm web:dev`      | Next.js dev server on :3000                                     |
| `pnpm worker:dev`   | Worker with tsx watch + node-cron + HTTP :8080                  |
| `pnpm db:push`      | Apply Drizzle schema directly to Neon                           |
| `pnpm db:generate`  | Generate a SQL migration from schema changes                    |
| `pnpm db:seed`      | Seed sports + initial selectors                                 |
| `pnpm db:studio`    | Drizzle Studio (local schema browser)                           |
| `pnpm typecheck`    | Typecheck every workspace                                       |

## M1 verification checklist

- [ ] `pnpm install` completes without errors
- [ ] `pnpm db:push` creates the 7 tables in Neon (sports, teams, games, selectors, scrape_runs, odds_snapshots, refresh_rate_limits)
- [ ] `pnpm db:seed` inserts 3 sports (MLB active, NBA/NFL inactive) and 4 seed selectors
- [ ] `pnpm web:dev` renders the sidebar with MLB highlighted and NBA/NFL greyed-out "Soon" pills
- [ ] `pnpm worker:dev` logs `cron scheduled: */5 * * * *` and `http listening on :8080`
- [ ] `POST /trigger` with the correct secret returns `{runId, cached:false}` and inserts a `scrape_runs` row with `status='ok'`

## Milestones

Tracked in the PRD §13. Current status: **M1 — repo scaffold (done)**. Next up: **M2 — real Playwright extraction of moneyline + totals**.
