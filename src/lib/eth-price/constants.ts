import type { Address } from "viem"

/**
 * Mainnet constants. Every address below was checked against the canonical
 * Uniswap factories (getPair / getPool) and the pools' token0/token1/fee
 * getters; creation blocks were found by bisecting eth_getCode. The pools are
 * additionally re-verified at runtime before any price is read from them
 * (see verify.ts).
 */

export const MAINNET_CHAIN_ID = 1

export const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
export const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
export const USDC_DECIMALS = 6
export const WETH_DECIMALS = 18

export const UNISWAP_V1_FACTORY: Address =
  "0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95"
export const UNISWAP_V2_FACTORY: Address =
  "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
export const UNISWAP_V3_FACTORY: Address =
  "0x1F98431c8aD98523631AE4a59f267346ea31F984"

/**
 * MakerDAO Multicall (v1), deployed at block 7929876 (2019-06-10): before the
 * v2 and v3 pools, but after the v1 exchange — chart points earlier than this
 * fall back to separate reads. aggregate() reverts if any inner call fails,
 * so only non-reverting reads go through it.
 */
export const MULTICALL1: Address = "0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441"
export const MULTICALL1_CREATED_AT_BLOCK = 7929876n

/** Known (block, timestamp) points used to bracket the time → block search. */
export type ChainAnchor = { number: bigint; timestamp: bigint }

export type ChainAnchors = {
  /** Block 1. Genesis (block 0) has timestamp 0, which would skew interpolation. */
  first: ChainAnchor
  /** First proof-of-stake block. After it, blocks land on 12s slots. */
  merge: ChainAnchor
  slotSeconds: bigint
  /**
   * Extra known points (sorted). They only narrow the search bracket and
   * the chart's block estimates; returned blocks are always fetched.
   */
  checkpoints?: readonly ChainAnchor[]
}

/**
 * Last block at or before 00:00 UTC on each quarter start, 2019–2026.
 * Generated with findBlockByTimestamp against mainnet and checked so that
 * block + 1 is after the boundary. History is immutable, so these never go
 * stale; later times interpolate up to the live head.
 */
export const MAINNET_CHECKPOINTS: readonly ChainAnchor[] = [
  { number: 6988614n, timestamp: 1546300782n }, // 2018-12-31T23:59:42Z
  { number: 7479256n, timestamp: 1554076786n }, // 2019-03-31T23:59:46Z
  { number: 8062292n, timestamp: 1561939196n }, // 2019-06-30T23:59:56Z
  { number: 8653171n, timestamp: 1569888000n }, // 2019-10-01T00:00:00Z
  { number: 9193265n, timestamp: 1577836785n }, // 2019-12-31T23:59:45Z
  { number: 9782601n, timestamp: 1585699197n }, // 2020-03-31T23:59:57Z
  { number: 10370273n, timestamp: 1593561580n }, // 2020-06-30T23:59:40Z
  { number: 10966873n, timestamp: 1601510385n }, // 2020-09-30T23:59:45Z
  { number: 11565019n, timestamp: 1609459200n }, // 2021-01-01T00:00:00Z
  { number: 12150244n, timestamp: 1617235197n }, // 2021-03-31T23:59:57Z
  { number: 12738508n, timestamp: 1625097591n }, // 2021-06-30T23:59:51Z
  { number: 13330090n, timestamp: 1633046400n }, // 2021-10-01T00:00:00Z
  { number: 13916165n, timestamp: 1640995189n }, // 2021-12-31T23:59:49Z
  { number: 14497033n, timestamp: 1648771196n }, // 2022-03-31T23:59:56Z
  { number: 15053226n, timestamp: 1656633600n }, // 2022-07-01T00:00:00Z
  { number: 15649594n, timestamp: 1664582399n }, // 2022-09-30T23:59:59Z
  { number: 16308189n, timestamp: 1672531199n }, // 2022-12-31T23:59:59Z
  { number: 16950602n, timestamp: 1680307199n }, // 2023-03-31T23:59:59Z
  { number: 17595509n, timestamp: 1688169599n }, // 2023-06-30T23:59:59Z
  { number: 18251964n, timestamp: 1696118399n }, // 2023-09-30T23:59:59Z
  { number: 18908894n, timestamp: 1704067199n }, // 2023-12-31T23:59:59Z
  { number: 19557288n, timestamp: 1711929599n }, // 2024-03-31T23:59:59Z
  { number: 20207948n, timestamp: 1719791999n }, // 2024-06-30T23:59:59Z
  { number: 20866918n, timestamp: 1727740799n }, // 2024-09-30T23:59:59Z
  { number: 21525890n, timestamp: 1735689599n }, // 2024-12-31T23:59:59Z
  { number: 22170334n, timestamp: 1743465599n }, // 2025-03-31T23:59:59Z
  { number: 22820673n, timestamp: 1751327999n }, // 2025-06-30T23:59:59Z
  { number: 23479243n, timestamp: 1759276799n }, // 2025-09-30T23:59:59Z
  { number: 24136052n, timestamp: 1767225599n }, // 2025-12-31T23:59:59Z
  { number: 24781026n, timestamp: 1775001599n }, // 2026-03-31T23:59:59Z
  { number: 25433938n, timestamp: 1782863999n }, // 2026-06-30T23:59:59Z
  { number: 26093737n, timestamp: 1790812799n }, // 2026-09-30T23:59:59Z
]

export const MAINNET_ANCHORS: ChainAnchors = {
  first: { number: 1n, timestamp: 1438269988n },
  merge: { number: 15537394n, timestamp: 1663224179n },
  slotSeconds: 12n,
  checkpoints: MAINNET_CHECKPOINTS,
}

export type PoolKind = "v3" | "v2" | "v1"

export type PoolInfo = {
  kind: PoolKind
  address: Address
  label: string
  /** v3 fee tier in hundredths of a bip (500 = 0.05%). */
  fee?: number
  createdAtBlock: bigint
  createdAtTimestamp: bigint
}

export const UNISWAP_V3_USDC_WETH_005: PoolInfo = {
  kind: "v3",
  address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
  label: "Uniswap v3 USDC/WETH 0.05%",
  fee: 500,
  createdAtBlock: 12376729n, // 2021-05-05T21:42:11Z
  createdAtTimestamp: 1620250931n,
}

export const UNISWAP_V2_USDC_WETH: PoolInfo = {
  kind: "v2",
  address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
  label: "Uniswap v2 USDC/WETH",
  createdAtBlock: 10008355n, // 2020-05-05T20:22:25Z
  createdAtTimestamp: 1588710145n,
}

/**
 * Uniswap v1 USDC exchange (ETH ↔ USDC, Vyper). Address from
 * factory.getExchange(USDC). Reserves are the exchange's ETH balance and its
 * USDC balance — there is no getReserves().
 */
export const UNISWAP_V1_USDC_ETH: PoolInfo = {
  kind: "v1",
  address: "0x97deC872013f6B5fB443861090ad931542878126",
  label: "Uniswap v1 USDC/ETH",
  createdAtBlock: 6783192n, // 2018-11-27T16:42:39Z
  createdAtTimestamp: 1543336959n,
}

/** In order of preference: deepest liquidity first. */
export const POOLS: readonly PoolInfo[] = [
  UNISWAP_V3_USDC_WETH_005,
  UNISWAP_V2_USDC_WETH,
  UNISWAP_V1_USDC_ETH,
]

/** Earliest pool creation. */
export const EARLIEST_POOL = POOLS.reduce((a, b) =>
  a.createdAtBlock < b.createdAtBlock ? a : b
)

/**
 * First block where any pool had both reserves > 0: the v1 exchange's first
 * deposit (0.009 ETH + 1 USDC), found by bisecting its balances. Nothing can
 * be priced before this instant.
 */
export const EARLIEST_PRICE = {
  block: 7101817n,
  timestamp: 1548041198n, // 2019-01-21T03:26:38Z
} as const

/**
 * Below this USDC reserve a v1/v2 pool is shallow enough that its price can
 * be stale (no trades for days) or skewed by a single swap.
 */
export const THIN_POOL_USDC = 100_000n * 10n ** 6n

/** Storage slots used for eth_getProof (checked against eth_call results). */
export const STORAGE_SLOTS = {
  /** UniswapV3Pool.slot0: sqrtPriceX96 is the low 160 bits. */
  v3Slot0: 0n,
  /** UniswapV3Pool.liquidity (uint128). */
  v3Liquidity: 4n,
  /** UniswapV2Pair: reserve0 (112) | reserve1 (112) | blockTimestampLast (32). */
  v2Reserves: 8n,
  /** FiatToken balances mapping (bit 255 is a blacklist flag since v2.2). */
  usdcBalances: 9n,
} as const

/** Pools that existed at `blockNumber`, most preferred first. */
export function poolsAtBlock(blockNumber: bigint): PoolInfo[] {
  return POOLS.filter((p) => p.createdAtBlock <= blockNumber)
}
