import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  WORKER_SECRET: required("WORKER_SECRET"),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_ORG_ID: process.env.OPENAI_ORG_ID ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5",
  PORT: Number(process.env.PORT ?? 8080),
  CRON_SCHEDULE: process.env.CRON_SCHEDULE ?? "*/5 * * * *",
  HEADLESS: (process.env.HEADLESS ?? "true") !== "false",
};
