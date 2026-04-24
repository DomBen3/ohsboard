import { createServer } from "node:http";
import { env } from "./env";
import { runMlbScrape } from "./run";

export function startHttpServer(): void {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/trigger") {
      const secret = req.headers["x-worker-secret"];
      if (secret !== env.WORKER_SECRET) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const outcome = await runMlbScrape("manual");
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify(outcome));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(env.PORT, () => {
    console.log(`[worker] http listening on :${env.PORT}`);
  });
}
