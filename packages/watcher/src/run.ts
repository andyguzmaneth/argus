import { installTorFetch, type TorHandle } from "./torFetch.js";
import { makeHeliosProvider } from "./heliosProvider.js";
import { fetchRecentEvents } from "./watch.js";

/**
 * M1 demo entry: bootstrap Tor → start Helios light client → scan recent blocks
 * for verified Tornado Deposit/Withdrawal events → print them.
 *
 * Env:
 *   ARGUS_TOR=0           disable Tor (dev mode, direct fetch)
 *   ARGUS_TOR_GATEWAY     tor-js fast-bootstrap gateway URL (optional)
 *   ARGUS_LOOKBACK=2000   blocks to scan back from head (<= ~8191)
 *   ARGUS_EXECUTION_RPC   upstream execution RPC (default: publicnode)
 *   ARGUS_CONSENSUS_RPC   beacon light-client data (default: lightclientdata.org)
 */
async function main(): Promise<void> {
  const useTor = process.env.ARGUS_TOR !== "0";
  const lookback = Number(process.env.ARGUS_LOOKBACK ?? 2000);

  let tor: TorHandle | undefined;
  if (useTor) {
    console.error("[argus] bootstrapping Tor (tor-js / Arti-WASM)…");
    const t0 = performance.now();
    tor = await installTorFetch({ gateway: process.env.ARGUS_TOR_GATEWAY });
    console.error(`[argus] Tor ready in ${((performance.now() - t0) / 1000).toFixed(1)}s — RPC egress now over Tor`);
  } else {
    console.error("[argus] ARGUS_TOR=0 → direct fetch (no Tor; dev mode)");
  }

  try {
    console.error("[argus] starting Helios light client (verifying logs vs receiptsRoot)…");
    const provider = await makeHeliosProvider();
    const head = await provider.getBlockNumber();
    console.error(`[argus] light client synced. head=${head}`);
    console.error(`[argus] scanning last ${lookback} blocks for Tornado Deposit/Withdrawal…`);

    const events = await fetchRecentEvents(provider, { lookbackBlocks: lookback });
    console.error(`[argus] ${events.length} verified event(s):\n`);

    for (const e of events) {
      console.log(
        JSON.stringify({
          block: e.blockNumber.toString(),
          pool: e.address,
          event: e.eventName,
          args: Object.fromEntries(
            Object.entries(e.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
          ),
        }),
      );
    }
  } finally {
    tor?.restore();
  }
}

main()
  .then(() => process.exit(0)) // Helios WASM keeps the event loop alive; exit explicitly
  .catch((err) => {
    console.error("[argus] fatal:", err);
    process.exit(1);
  });
