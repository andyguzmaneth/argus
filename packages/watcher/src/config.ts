import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface EventDef {
  name: string;
  signature: string;
  topic0: `0x${string}`;
  indexed: string[];
}

export interface Subscription {
  name: string;
  addresses: `0x${string}`[];
  events: EventDef[];
}

export interface ArgusConfig {
  network: string;
  subscriptions: Subscription[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Loads the subscription config. Defaults to the repo's config/tornado.json. */
export function loadConfig(path?: string): ArgusConfig {
  const file = path ?? resolve(__dirname, "../../../config/tornado.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return raw as ArgusConfig;
}
