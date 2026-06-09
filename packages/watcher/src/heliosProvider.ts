import { helios } from "@kohaku-eth/provider/helios";
import type { Config } from "@a16z/helios";
import type { EthereumProvider } from "@kohaku-eth/provider";

export interface ProviderOptions {
  executionRpc?: string;
  consensusRpc?: string;
  /** Trusted weak-subjectivity checkpoint for faster initial sync (optional). */
  checkpoint?: string;
}

/**
 * Builds a Helios light-client provider through the Kohaku provider abstraction.
 *
 * `bypassLogs = false` (here) routes `eth_getLogs` THROUGH the light client, so
 * returned logs are verified against the block `receiptsRoot`. Note Helios only
 * serves verified logs within the last ~8,191 blocks (~1.1 days) — which suits a
 * live event tail, not historical backfill.
 */
export async function makeHeliosProvider(opts: ProviderOptions = {}): Promise<EthereumProvider> {
  const config: Config = {
    executionRpc: opts.executionRpc ?? process.env.ARGUS_EXECUTION_RPC ?? "https://ethereum-rpc.publicnode.com",
    consensusRpc: opts.consensusRpc ?? process.env.ARGUS_CONSENSUS_RPC ?? "https://www.lightclientdata.org",
    ...(opts.checkpoint ?? process.env.ARGUS_CHECKPOINT
      ? { checkpoint: opts.checkpoint ?? process.env.ARGUS_CHECKPOINT }
      : {}),
  };

  return helios(config, "ethereum", false);
}
