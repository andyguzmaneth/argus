# Argus — Scope

> A trust-minimized, private Ethereum event feed. Subscribe to any contract's events
> and get a feed where every item is **verifiable** (proven against consensus, not trusted
> from an RPC) and fetched **privately** (the watcher's queries are hidden over Tor).
> Demo target: Tornado Cash deposit/withdrawal events.

Status: **scoping** · Owner: Andy · Date: 2026-06-09

---

## 1. Thesis

Today, watching on-chain events means trusting an RPC provider to tell you the truth, and
leaking to that provider exactly which contracts you care about. Argus fixes both:

| Pillar | Problem | Argus solution | EF/PSE tool reused |
|--------|---------|----------------|--------------------|
| **Verifiable** | RPC can lie / omit | Light-client proof per event, anchored to the consensus sync committee; a standalone verifier re-checks against mainnet | `@kohaku-eth/provider` → `@a16z/helios` / Colibri |
| **Private** | RPC sees your query + IP | All upstream traffic routed through Tor-in-WASM | **TorJS** (`tor-js`, voltrevo/arti) |

The one-line demo: *"Here's a Tornado withdrawal from block N. Don't trust my feed — run
`argus verify` and check it against mainnet yourself."*

## 2. What it is / is NOT

- **IS:** read-only indexing of public, immutable on-chain event logs, republished as a
  signed + self-verifiable Atom/JSON feed.
- **IS NOT:** it does not interact with any protocol, does not deposit/withdraw, does not
  deanonymize users. It adds *observability for the watcher's benefit*, and *privacy for the
  watcher* — never the opposite. (README carries this disclaimer verbatim.)

## 3. The EF / PSE stack Argus dogfoods

This is the point of the project as much as the feed itself: Argus is a public artifact that
**exercises the Access Layer / Private Reads stack end-to-end** as a non-wallet consumer.

| Component | Package / repo | Role in Argus | Source |
|-----------|----------------|---------------|--------|
| **TorJS** | `tor-js` npm · `wasm-arti-client` @ github.com/voltrevo/arti | Network privacy: route all RPC egress through Tor via fetch()-compatible API | Private Reads workstream (Andrew) |
| **Kohaku provider** | `@kohaku-eth/provider@0.1.0-alpha.8` | EIP-1193 provider abstraction; swap light-client backend (helios / colibri / raw) | ethereum/kohaku |
| **Helios** | `@a16z/helios@^0.11` (WASM) | Light client that verifies `eth_getLogs` against `receiptsRoot` internally | a16z/helios |
| **Colibri** | `@corpus-core/colibri-stateless` | Kohaku's *default* stateless verifying light client; candidate proof source | corpus-core |
| **ChainFetch** | Andrew's draft standard (`specs/chainfetch.md`) | Pluggable transport interface — Argus = early reference consumer | Private Reads / Access Layer |
| **Snowflake PT** | bundled in TorJS | Optional censorship-resistant transport (WebSocket/WebRTC) | TorJS |
| **anon-RPC standard** | privacy-stack/anon-rpc-standard-adopters | Argus listed as an adopter / demo | PSE research |
| **PIR (LeanPIR/VIA)** | Private Reads PIR workstream | **Future work only** — cited as the eventual way to hide query *content* (PIR not viable for live getLogs in 2026). Tor hides *who*, PIR will hide *what*. | Private Reads |

**Strategic value:** validates the Q2 2026 "Wallet SDK integrations (Helios, ethers.js, viem.js)"
goal with a real integration, gives the team a non-wallet reference + an external, subscribable
artifact, and demonstrates the read-path privacy thesis (origin/content/correctness) in runnable form.

## 4. Language decision — REVERSED to TypeScript

Earlier pick was Rust. Reusing "our tools" forces TS: TorJS, the Kohaku provider, Helios-WASM,
and Colibri are all TS/Node. Rust would mean reimplementing TorJS's glue and the provider
abstraction from scratch and forfeiting the uniquely-PSE piece.

| | TS/Node (chosen) | Rust (rejected) |
|---|---|---|
| TorJS | ✅ native `fetch()` API | ❌ would use raw arti-client, lose the WASM wrapper + Snowflake + bootstrap work |
| Kohaku provider | ✅ full reuse | ❌ rebuild |
| Helios / Colibri | ✅ WASM + Colibri | ⚠️ helios-core native only, no Colibri |
| Portable proof export | ⚠️ via Verifiable-API or hand-built trie (M2 research) | ✅ helios-core exposes receipt proofs directly |

Trade-off accepted: proof-artifact export is slightly more work in TS (see §6); reuse wins.

## 5. Architecture

```
        upstream EL/CL RPC (untrusted)
                  │
        ┌─────────┴─────────┐
        │   TorJS transport  │   ← fetch() routed through Tor-in-WASM (hides IP + linkage)
        └─────────┬─────────┘
                  │
   ┌──────────────┴───────────────┐
   │  @kohaku-eth/provider          │  ← EIP-1193; backend = helios | colibri
   │  (light client verifies logs   │     consensus anchor: sync committee + checkpoint
   │   vs receiptsRoot internally)  │
   └──────────────┬───────────────┘
                  │  verified getLogs (subscribed filters)
   ┌──────────────┴───────────────┐
   │  Watcher                       │  filters: Tornado addrs + Deposit/Withdrawal topics
   │  - poll on newHeads            │  per match → build portable proof artifact + decode event
   │  - header-chain continuity     │  guards against RPC omission
   └──────────────┬───────────────┘
                  │
   ┌──────────────┴───────────────┐
   │  Feed emitter                  │  Atom/RSS + JSON; each item = event + proof blob + ed25519 sig
   └──────┬────────────────┬───────┘
          │                │
   any RSS reader     `argus verify` CLI/lib  ← re-checks proof vs mainnet. Trust no one. ★ crown jewel
```

### Package layout (pnpm monorepo)

```
argus/
├─ packages/
│  ├─ watcher/   # provider + TorJS wiring, filters, emit loop
│  ├─ proof/     # portable proof artifact format (serde) + builder
│  ├─ feed/      # Atom/RSS + JSON, ed25519 signing
│  ├─ verify/    # standalone verifier lib + `argus verify` CLI  ★
│  └─ cli/       # `argus run` — the watcher binary
├─ config/tornado.toml   # subscribed pools + event topics
├─ examples/             # sample signed feed + a pre-baked item to verify
└─ README.md             # thesis + read-only disclaimer
```

## 6. Verifiability — open technical question (resolve in M2)

Helios-WASM verifies logs internally but may not hand back a *portable* proof blob a third
party can re-check offline. Three candidate paths, to spike in M2:

1. **Helios Verifiable-API mode** — returns per-receipt MPT proofs we can capture & embed. (Primary.)
2. **Colibri stateless proofs** — stateless clients carry verification data natively; Colibri may
   be the *better* proof source than Helios. (Investigate — could simplify M2.)
3. **Hand-built receipt proof** — fetch all block receipts, rebuild the receipt trie in TS, extract
   the branch for our tx index. (Fallback; no standard `eth_getReceiptProof` exists.)

Proof tiers for the artifact:
- **Tier 1 (v0.1):** receipt-inclusion proof + block header; verifier confirms canonical via its own
  light-client view. Small items.
- **Tier 2 (roadmap):** also embed beacon header + sync-committee signature → fully self-contained.

## 7. Demo target — Tornado Cash (verified)

Classic mainnet ETH pools (events emitted by the pool, not the router):

| Pool | Address |
|------|---------|
| 0.1 ETH | `0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc` |
| 1 ETH | `0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936` |
| 10 ETH | `0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF` |
| 100 ETH | `0xA160cdAB225685dA1d56aa342Ad8841c3b53f291` |

Events (canonical sig → topic0):
- `Deposit(bytes32,uint32,uint256)` → `0xa945e51eec50ab98c161376f0db4cf2aeba3ec92755fe2fcd388bdbbb80ff196` (only `commitment` indexed)
- `Withdrawal(address,bytes32,address,uint256)` → `0xe9e508bad6d4c3227e881ca19068f099da81b5164dd6d62b2eaf1e8bc6c34931` (only `relayer` indexed)

Legal: contracts OFAC-**delisted Mar 2025** (post *Van Loon*); read-only monitoring is not the
conduct prosecuted in *US v. Storm*. Positioned as transparency tooling. README disclaimer + optional
30-min counsel check before real-name public release.

## 8. Milestones (v0.1)

| # | Milestone | Done = |
|---|-----------|--------|
| M1 | Provider + TorJS wiring | verified `getLogs` for Tornado pools, egress over Tor |
| M2 | Portable proof export | a Tornado event serialized with a re-checkable proof (path chosen from §6) |
| M3 | `argus verify` | standalone CLI re-verifies an item against mainnet — **crown jewel** |
| M4 | Feed emitter | signed Atom/RSS + JSON output |
| M5 | ChainFetch alignment | transport behind the pluggable interface; `--tor` on by default |
| M6 | README / disclaimer / CI / examples | public-ready |

Deferred to v0.2+: LLM enrichment of items, live hosting (homelab `eth` VM), multi-contract config UI, Tier-2 proofs, PIR query-content privacy.

## 8b. M1 results & findings (2026-06-09)

**Verified path works.** In dev mode (direct RPC), Helios via `@kohaku-eth/provider` returned
real, decoded, receipt-root-verified Tornado events, e.g.:
- Withdrawal @ block 25,281,297 (100 ETH pool), relayer `0x0`, fee 0
- Deposit @ block 25,281,433 (1 ETH pool), leafIndex 84798

**Tor egress works** — tor-js (Arti-WASM) bootstraps in ~8–11s and Helios's RPC requests
demonstrably traverse Tor. Integration issues found & solved while wiring the global-`fetch`
override:
1. wasm-file storage opens one file per microdescriptor → `EMFILE`. Fix: `storage.MemoryStorage`.
2. Helios loads WASM via `data:` URLs → must bypass Tor (only http(s) egress is routed).
3. wasm-bindgen calls `fetch` with a `Request` object → adapter normalizes both shapes.
4. tor-js `Response.url` is empty → Helios `Url::parse("")` throws "url parse". Fix: backfill `.url`.

**Open finding — public RPCs are hostile to Tor.** Over Tor: publicnode/allnodes returns **403**
to Tor exit IPs ("order a dedicated full node"); lodestar accepts the bootstrap but consensus
sync is flaky/incomplete ("out of sync"). A fully-green Tor run needs a **Tor-tolerant RPC** or
the **EF fast-bootstrap gateway** (`gateway` opt). This is exactly the friction the Access Layer /
ChainFetch work addresses — a useful data point to bring Andrew.

## 9. Decisions (resolved 2026-06-09)

1. **Language: TypeScript** ✅ (reversed from Rust — to reuse TorJS + Kohaku provider + Helios/Colibri).
2. **Proof source** — open; spike Colibri-first vs Helios Verifiable-API vs hand-built in M2.
3. **Repo home + license** — `andyguzmaneth/argus`, **MIT** ✅.
4. **Build-then-publish** — develop locally; push to public GitHub only once M1–M3 are green. ✅ (no push without explicit go.)
5. **Andrew (TorJS/ChainFetch)** — **build first, show working**, then bring him a running demo. ✅
