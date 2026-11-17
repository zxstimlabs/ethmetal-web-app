import type { Hex, PublicClient } from "viem"

import type { PoolInfo } from "./constants"
import type { BlockHeader } from "./find-block"

/** The subset of a viem PublicClient this library needs. */
export type EthClient = Pick<
  PublicClient,
  | "getBalance"
  | "getBlock"
  | "getChainId"
  | "getLogs"
  | "getProof"
  | "readContract"
>

/** Where the pool values came from. */
export type PriceSource =
  /** eth_call against the state after the block (archive node). */
  | { kind: "state" }
  /** Last Swap/Sync event at or before the block (works on full nodes). */
  | {
      kind: "event"
      eventName: "Swap" | "Sync"
      blockNumber: bigint
      transactionHash: Hex
      logIndex: number
    }

export type V3Reading = {
  kind: "v3"
  sqrtPriceX96: bigint
  tick: number
  /** In-range liquidity at that point. */
  liquidity: bigint
}

export type V2Reading = {
  kind: "v2"
  reserveUsdc: bigint
  reserveWeth: bigint
}

export type V1Reading = {
  kind: "v1"
  /** Exchange's USDC balance (its token reserve). */
  reserveUsdc: bigint
  /** Exchange's own ETH balance (its ETH reserve). */
  reserveEth: bigint
}

export type PoolReading = V3Reading | V2Reading | V1Reading

/** 30-minute v3 oracle TWAP (observe([1800, 0])) at the block. */
export type Twap =
  | {
      available: true
      windowSeconds: number
      /** Arithmetic-mean tick over the window. */
      meanTick: number
      tickCumulatives: readonly [bigint, bigint]
      /** USDC per ETH, PRICE_DECIMALS fixed-point. */
      price: bigint
    }
  | { available: false; reason: string }

export type SkippedPool = { pool: PoolInfo; reason: string }

export type EthPriceResult = {
  /** Requested unix timestamp (seconds). */
  target: bigint
  /** Last block with timestamp <= target. Price is the state *after* it. */
  block: BlockHeader
  /** Target was at/after the head when queried. */
  isHead: boolean
  /** eth_getBlockByNumber calls used by the search. */
  probes: number
  pool: PoolInfo
  reading: PoolReading
  source: PriceSource
  /** USDC per ETH, fixed-point with PRICE_DECIMALS (18) decimals. */
  price: bigint
  /** v3 only, and only when read from state. */
  twap?: Twap
  /** Preferred pools that were passed over, and why. */
  skipped: SkippedPool[]
  elapsedMs: number
}

/** One chart sample: state after `blockNumber`. */
export type SeriesPoint = {
  blockNumber: bigint
  /** Exact block timestamp, read in the same eth_call. */
  timestamp: bigint
  pool: PoolInfo["kind"]
  price: bigint
  reading: PoolReading
}

export type PriceSeries = {
  from: bigint
  to: bigint
  points: SeriesPoint[]
  /** Sample blocks the RPC had no state for (non-archive node). */
  missing: number
  /** RPC requests spent (chain id + block search + one eth_call per point). */
  rpcCalls: number
  elapsedMs: number
}

export type SeriesProgress = { done: number; total: number }

export type Progress =
  | { stage: "chain" }
  | { stage: "block"; probes: number; lo?: bigint; hi?: bigint }
  | { stage: "pool"; pool: PoolInfo; via: PriceSource["kind"] }
