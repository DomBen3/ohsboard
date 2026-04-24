import cron from "node-cron";
import { env } from "./env";
import { runMlbScrape } from "./run";
import { startHttpServer } from "./server";

async function main() {
  startHttpServer();

  cron.schedule(env.CRON_SCHEDULE, () => {
    runMlbScrape("cron").catch((err) => {
      console.error("[cron] scrape failed to start:", err);
    });
  });
  console.log(`[worker] cron scheduled: ${env.CRON_SCHEDULE}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
