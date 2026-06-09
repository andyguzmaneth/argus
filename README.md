# Argus

**A trust-minimized, private Ethereum event feed.** Subscribe to a contract's events and
get a feed where every item is **verifiable** — proven against the consensus sync committee,
not trusted from an RPC — and fetched **privately**, with the watcher's queries routed over Tor.

> Demo target: Tornado Cash deposit/withdrawal events.

```
  upstream RPC (untrusted)
        │  ← routed through Tor (tor-js / Arti-in-WASM)   ← hides who's asking
  Helios light client (@kohaku-eth/provider)
        │  verifies eth_getLogs against the block receiptsRoot
  Watcher  ── filters: contract addresses + event topics
        │
  Feed  ── signed Atom/JSON, each item carries a re-checkable proof
        └──► `argus verify`  ── "don't trust my feed, check it against mainnet yourself"
```

Most on-chain monitoring trusts an RPC provider to tell the truth and leaks to that provider
exactly which contracts you watch. Argus removes both assumptions.

## What it is / is NOT

- **IS:** read-only indexing of public, immutable on-chain event logs, republished as a
  signed and independently-verifiable feed.
- **IS NOT:** it does not interact with any protocol, does not deposit or withdraw, and does
  not deanonymize anyone. It adds observability *for the watcher* and privacy *for the watcher* —
  never the reverse. The Tornado Cash contracts it reads were OFAC-delisted in March 2025;
  reading public event logs is neutral, lawful activity.

## The stack it reuses (Ethereum Access Layer)

Argus is deliberately a thin integration over Ethereum's emerging privacy stack — it's a
reference consumer, not a reimplementation.

| Component | Package | Role |
|-----------|---------|------|
| Light client provider | [`@kohaku-eth/provider`](https://github.com/ethereum/kohaku) | EIP-1193 abstraction; verifies logs |
| Light client | [`@a16z/helios`](https://github.com/a16z/helios) | verifies `eth_getLogs` vs `receiptsRoot` |
| Network privacy | [`tor-js`](https://www.npmjs.com/package/tor-js) | Arti (Tor) in WASM; fetch() over Tor |
| Stateless client (alt) | `@corpus-core/colibri-stateless` | candidate portable-proof source |
| Event decoding | [`viem`](https://viem.sh) | ABI decode |

## Status

Early. **M1 works today**: Helios (via the Kohaku provider) returns verified Tornado
Deposit/Withdrawal events, optionally with all RPC egress over Tor.

| Milestone | State |
|-----------|-------|
| M1 — verified events via Helios + Kohaku provider, Tor egress | ✅ working |
| M2 — portable, re-checkable proof per event | next |
| M3 — `argus verify` standalone verifier | planned |
| M4 — signed Atom/RSS + JSON feed | planned |
| M5 — ChainFetch-aligned pluggable transport | planned |
| M6 — docs / CI / hosted feed | planned |

See [SCOPE.md](./SCOPE.md) for the full design.

## Quickstart

```bash
pnpm install

# dev mode (direct RPC, no Tor) — fastest
ARGUS_TOR=0 ARGUS_LOOKBACK=300 pnpm argus

# with Tor egress (Arti bootstrap; raise the fd limit for the wasm-file store)
ulimit -n 8192
ARGUS_LOOKBACK=200 pnpm argus
```

Environment:

| Var | Default | Meaning |
|-----|---------|---------|
| `ARGUS_TOR` | `1` | `0` disables Tor (dev mode) |
| `ARGUS_LOOKBACK` | `2000` | blocks to scan back from head (≤ ~8191, Helios verified-logs window) |
| `ARGUS_EXECUTION_RPC` | publicnode | upstream execution RPC |
| `ARGUS_CONSENSUS_RPC` | publicnode beacon | beacon light-client data |
| `ARGUS_CHECKPOINT` | — | trusted weak-subjectivity checkpoint (faster sync) |

## License

MIT
