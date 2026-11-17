# ethmetal

ETH/USDC price at any moment since Jan 2019, computed in the browser from
Ethereum mainnet state over JSON-RPC. Static site, no backend, no wallet.

- **Lookup:** date and time → block → verified Uniswap pool → spot price, plus
  the 30-min TWAP (v3), with Etherscan links.
- **Proof:** on demand, `eth_getProof` Merkle-proves the pool values against
  the block's `stateRoot`.
- **Chart:** 33 historical state reads per range (1D … All), usually in **2 HTTP
  requests**.

## Run

```bash
bun install
cp .env.example .env.local      # optional: set VITE_RPC_URL
bun --bun run dev               # http://localhost:5173
bun test                        # unit tests (bun:test)
bun --bun run typecheck         # tsc -b
bun --bun run build
```

`bun --bun` forces the Bun runtime; without it, `vite`/`tsc` run through their
node shebangs.

## RPC

Precedence: URL pasted in the UI (saved in localStorage) → `VITE_RPC_URL` in
`.env.local` → a `fallback()` of public archive RPCs (MEV Blocker, Blast,
Tenderly, dRPC).

Use an **archive** node for anything older than the node's recent-state window.
With a full node, lookups past that window fall back to event logs (see below).
Historical `eth_getProof` needs a node that serves proofs for old blocks; many
only prove recent ones.

> `VITE_*` variables are inlined into the built bundle. Don't deploy a build
> made with a private RPC key in `.env.local`.

### Rate limits

Every HTTP request goes through one client-side budget, `src/lib/rpc-budget.ts`.
It defaults to 10/s and 180/min and can be adjusted in the RPC popover, which
also shows live usage. Concurrent calls are merged into JSON-RPC batches, and
most gateways count a batch as one request. Browsers usually can't read the
`RateLimit-*`/`Retry-After` headers unless the RPC lists them in
`Access-Control-Expose-Headers`, which is why the budget is tracked locally.

wagmi's default viem Multicall3 auto-batching is turned off. Before Multicall3
existed (Mar 2022), viem substitutes a deployless Multicall3 whose bytecode
needs post-Constantinople opcodes, so calls at early-2019 blocks return `0x`.

## How it works

`src/lib/eth-price/` is framework-free and takes any viem client; the UI gets
one from wagmi's `usePublicClient()`.

1. **Time → block** (`find-block.ts`): finds the last block with
   `timestamp <= target`. Correctness rests only on a bracket
   `ts(lo) <= target < ts(hi)` that is narrowed with real block timestamps. The
   bracket starts from known points: block 1, the Merge, and quarterly
   checkpoints (`constants.ts`, generated and verified against mainnet). From
   there it interpolates, forcing a bisection whenever a step doesn't halve
   the bracket.
2. **Pool** (`constants.ts`, `verify.ts`): the deepest pool with liquidity at
   that block:
   - Uniswap v3 USDC/WETH 0.05% (from block 12376729)
   - v2 USDC/WETH (from block 10008355)
   - v1 USDC exchange (first liquidity at block 7101817, 2019-01-21)

   Each pool is verified once per RPC against its factory
   (`getPool`/`getPair`/`getExchange`), its token getters and its fee. These
   are all write-once, so checking at `latest` is sound.
3. **Spot price** (`read-pool.ts`, `math.ts`), with all math in bigint:
   - v3: `slot0()`, giving `1e12 · 2^192 / sqrtPriceX96²`
   - v2: `getReserves()`, giving `reserveUSDC · 1e12 / reserveWETH`
   - v1: `eth_getBalance` + `USDC.balanceOf()`, with the same formula as v2

   v1/v2 pools under 100k USDC are flagged as thin.
4. **TWAP** (v3): `observe([1800, 0])` gives the mean tick, which a bigint port
   of `TickMath.getSqrtRatioAtTick` converts to a price. `observe` reverts
   with `OLD` until the pool's oracle had grown, around mid-2021; the UI shows
   that as unavailable rather than failing.
5. **Fallback** without archive state: the last v3 `Swap` / v2 `Sync` event at
   or before the block gives the same value. It scans backwards with adaptive
   `eth_getLogs` windows that learn the provider's range cap. v1 events carry
   no reserves, so v1 needs archive state.
6. **Proof** (`proof.ts`): `eth_getProof` for the pool's storage slots (v3
   `slot0`/`liquidity` = slots 0/4, v2 reserves = slot 8). For v1 it uses the
   exchange's account balance plus `USDC.balances[exchange]` (slot 9). Proofs
   are verified locally, node by node, up to the block's `stateRoot`. The header
   itself is still trusted from the RPC; that's the next phase.
7. **Chart** (`series.ts`): there's no block search. Sample blocks are
   interpolated from the checkpoints and the head. Each sample is **one**
   `eth_call` to MakerDAO Multicall v1 (deployed June 2019, unlike Multicall3),
   which bundles `block.timestamp` with every pool's reserves at that block.
   All samples go out together, so the batching transport sends a whole chart
   as one HTTP request. Samples before June 2019 use direct reads.
