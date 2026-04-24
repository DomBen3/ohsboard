// One-shot script: download all active MLB team SVG logos from mlbstatic
// and commit them to apps/web/public/teams/mlb/<abbreviation>.svg.
//
// Run with: pnpm fetch:logos
//
// Idempotent — overwrites existing files. Commit the result to version control
// so production serves the logos directly from Vercel's CDN (no runtime I/O).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATS_API =
  "https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Y";
const logoUrl = (teamId: number) =>
  `https://www.mlbstatic.com/team-logos/${teamId}.svg`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "apps", "web", "public", "teams", "mlb");

interface StatsTeam {
  id: number;
  abbreviation: string;
  name: string;
  active: boolean;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Target directory: ${OUT_DIR}`);

  const res = await fetch(STATS_API);
  if (!res.ok) throw new Error(`StatsAPI responded ${res.status}`);
  const body = (await res.json()) as { teams: StatsTeam[] };
  const teams = body.teams.filter((t) => t.active);
  console.log(`Fetched ${teams.length} active teams from MLB StatsAPI.`);

  let ok = 0;
  let fail = 0;
  for (const team of teams) {
    try {
      const r = await fetch(logoUrl(team.id));
      if (!r.ok) {
        console.warn(`  - ${team.abbreviation} (${team.id}): HTTP ${r.status}`);
        fail++;
        continue;
      }
      const svg = await r.text();
      const filePath = join(OUT_DIR, `${team.abbreviation}.svg`);
      await writeFile(filePath, svg, "utf-8");
      console.log(`  + ${team.abbreviation}  ${svg.length.toLocaleString()} bytes  (${team.name})`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  - ${team.abbreviation}: ${msg}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} saved, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
