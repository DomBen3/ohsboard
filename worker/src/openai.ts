import OpenAI from "openai";
import { env } from "./env";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    organization: env.OPENAI_ORG_ID || undefined,
  });
  return client;
}
