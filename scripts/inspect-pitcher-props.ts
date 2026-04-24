import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const rows = await sql`
    SELECT id, market, field, player, line, price_american, captured_at
    FROM odds_snapshots
    WHERE market IN ('prop_pitcher_strikeouts', 'prop_pitcher_outs_recorded')
    ORDER BY captured_at DESC
    LIMIT 40
  `;
  console.log(rows);
}

main().catch((e) => { console.error(e); process.exit(1); });
