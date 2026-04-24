import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  const before = await sql`
    SELECT market, COUNT(*)::int AS n
    FROM odds_snapshots
    WHERE market IN ('prop_pitcher_strikeouts', 'prop_pitcher_outs_recorded')
    GROUP BY market
    ORDER BY market
  `;
  console.log("Before:", before);

  const deleted = await sql`
    DELETE FROM odds_snapshots
    WHERE market IN ('prop_pitcher_strikeouts', 'prop_pitcher_outs_recorded')
    RETURNING id
  `;
  console.log(`Deleted ${deleted.length} rows`);

  const after = await sql`
    SELECT market, COUNT(*)::int AS n
    FROM odds_snapshots
    WHERE market IN ('prop_pitcher_strikeouts', 'prop_pitcher_outs_recorded')
    GROUP BY market
  `;
  console.log("After:", after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
