// One-shot script: download all 30 NBA team logos from ESPN's CDN and save
// them to apps/web/public/teams/nba/<abbreviation>.png keyed on the canonical
// `abbreviation` from @ohsboard/types (SAS, NYK, PHX, GSW, …).
//
// ESPN serves PNGs at https://a.espncdn.com/i/teamlogos/nba/500/<espn>.png
// where <espn> is the lowercase ESPN abbreviation (e.g. "sa", "ny", "gs",
// "phx"). MLB logos are SVG; NBA are PNG; the per-sport extension is handled
// by `apps/web/lib/teams.ts#teamLogoPath`.
//
// Run with: pnpm fetch:nba-logos
//
// Idempotent — overwrites existing files. Commit the result so production
// serves the logos directly from Vercel's CDN (no runtime I/O).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NBA_TEAMS } from "@ohsboard/types";

const logoUrl = (espnAbbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nba/500/${espnAbbr.toLowerCase()}.png`;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "apps", "web", "public", "teams", "nba");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Target directory: ${OUT_DIR}`);
  console.log(`Fetching ${NBA_TEAMS.length} NBA team logos from ESPN CDN.`);

  let ok = 0;
  let fail = 0;
  for (const team of NBA_TEAMS) {
    const url = logoUrl(team.espnAbbreviation);
    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.warn(
          `  - ${team.abbreviation} (${team.espnAbbreviation}): HTTP ${r.status} ${url}`,
        );
        fail++;
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const filePath = join(OUT_DIR, `${team.abbreviation}.png`);
      await writeFile(filePath, buf);
      console.log(
        `  + ${team.abbreviation}  ${buf.length.toLocaleString()} bytes  (${team.name})`,
      );
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
