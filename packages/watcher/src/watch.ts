import { decodeEventLog, parseAbiItem } from "viem";
import type { EthereumProvider, TxLog } from "@kohaku-eth/provider";
import { loadConfig, type Subscription } from "./config.js";

/** Human-readable ABI for the subscribed Tornado events (used only to decode logs). */
const TORNADO_ABI = [
  parseAbiItem("event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)"),
  parseAbiItem("event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)"),
] as const;

export interface DecodedEvent {
  blockNumber: bigint;
  address: string;
  eventName: string;
  args: Record<string, unknown>;
  raw: TxLog;
}

/**
 * Fetches recent subscribed events through the verified provider and decodes them.
 * Stays within Helios's ~8,191-block verified-logs window via `lookbackBlocks`.
 */
export async function fetchRecentEvents(
  provider: EthereumProvider,
  opts: { lookbackBlocks?: number } = {},
): Promise<DecodedEvent[]> {
  const lookback = BigInt(opts.lookbackBlocks ?? 2000);
  const head = await provider.getBlockNumber();
  const fromBlock = head > lookback ? head - lookback : 0n;

  const sub: Subscription = loadConfig().subscriptions[0];
  const topic0s = sub.events.map((e) => e.topic0);

  const filter = {
    address: sub.addresses,
    topics: [topic0s], // topic[0] OR-match: either Deposit or Withdrawal
    fromBlock,
    toBlock: head,
  };

  const logs = await provider.getLogs(filter as Parameters<typeof provider.getLogs>[0]);

  const decoded: DecodedEvent[] = [];
  for (const log of logs) {
    try {
      const ev = decodeEventLog({
        abi: TORNADO_ABI,
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      decoded.push({
        blockNumber: log.blockNumber,
        address: log.address,
        eventName: ev.eventName as string,
        args: (ev.args ?? {}) as Record<string, unknown>,
        raw: log,
      });
    } catch {
      // skip logs that don't decode against the Tornado ABI
    }
  }
  return decoded;
}
