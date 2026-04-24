import { createDb } from "@ohsboard/db";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const db = createDb(url);
