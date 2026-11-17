import { BaseError, ContractFunctionRevertedError } from "viem"

import { erc20Abi, uniswapV2PairAbi, uniswapV3PoolAbi } from "./abis"
import { type PoolInfo, USDC } from "./constants"
import {
  isLogRangeError,
  isMissingStateError,
  PriceLookupError,
} from "./errors"
import { v2ReservesToPrice, v3SqrtPriceX96ToPrice } from "./math"
import { getSqrtRatioAtTick, meanTick } from "./tick-math"
import type { EthClient, PoolReading, PriceSource, Twap } from "./types"

export type PoolRead = {
  reading: PoolReading
  source: PriceSource
  price: bigint
  twap?: Twap
}

export const TWAP_WINDOW_SECONDS = 1800

/** Pool has no usable price at this block (e.g. zero in-range liquidity). */
export class UnusablePoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnusablePoolError"
  }
}

/** Spot price of a reading; throws UnusablePoolError if it has none. */
export function priceOf(reading: PoolReading): bigint {
  if (reading.kind === "v3") {
    if (reading.sqrtPriceX96 === 0n) {
      throw new UnusablePoolError("pool not initialized at this block")
    }
    if (reading.liquidity === 0n) {
      throw new UnusablePoolError("zero in-range liquidity at this block")
    }
    return v3SqrtPriceX96ToPrice(reading.sqrtPriceX96)
  }
  const eth = reading.kind === "v2" ? reading.reserveWeth : reading.reserveEth
  if (eth === 0n || reading.reserveUsdc === 0n) {
    throw new UnusablePoolError("empty reserves at this block")
  }
  // v1 and v2 are both constant-product: mid price = USDC reserve / ETH reserve.
  return v2ReservesToPrice(reading.reserveUsdc, eth)
}

/**
 * 30-minute TWAP from the pool's own oracle. observe() reverts with "OLD"
 * when the oracle's history at that block is shorter than the window (the
 * 0.05% pool's cardinality was 1 until mid-2021), which is reported, not
 * thrown.
 */
async function readV3Twap(
  client: EthClient,
  pool: PoolInfo,
  blockNumber: bigint
): Promise<Twap> {
  try {
    const [tickCumulatives] = await client.readContract({
      address: pool.address,
      abi: uniswapV3PoolAbi,
      functionName: "observe",
      args: [[TWAP_WINDOW_SECONDS, 0]],
      blockNumber,
    })
    const [start, end] = tickCumulatives
    const tick = meanTick(start, end, TWAP_WINDOW_SECONDS)
    return {
      available: true,
      windowSeconds: TWAP_WINDOW_SECONDS,
      meanTick: tick,
      tickCumulatives: [start, end],
      price: v3SqrtPriceX96ToPrice(getSqrtRatioAtTick(tick)),
    }
  } catch (error) {
    if (isMissingStateError(error)) throw error
    const revert =
      error instanceof BaseError
        ? error.walk((e) => e instanceof ContractFunctionRevertedError)
        : undefined
    if (revert instanceof ContractFunctionRevertedError) {
      return {
        available: false,
        reason:
          revert.reason === "OLD"
            ? "the pool's oracle had less than 30 min of history at this block (observe reverted: OLD)"
            : `observe() reverted: ${revert.reason ?? revert.shortMessage}`,
      }
    }
    throw error
  }
}

/**
 * Spot price from state after `blockNumber` via eth_call (needs an archive
 * node for anything older than the node's recent-state window).
 */
export async function readPoolState(
  client: EthClient,
  pool: PoolInfo,
  blockNumber: bigint
): Promise<PoolRead> {
  if (pool.kind === "v3") {
    const [slot0, liquidity, twap] = await Promise.all([
      client.readContract({
        address: pool.address,
        abi: uniswapV3PoolAbi,
        functionName: "slot0",
        blockNumber,
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV3PoolAbi,
        functionName: "liquidity",
        blockNumber,
      }),
      readV3Twap(client, pool, blockNumber),
    ])
    const reading: PoolReading = {
      kind: "v3",
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
    }
    return { reading, source: { kind: "state" }, price: priceOf(reading), twap }
  }

  let reading: PoolReading
  if (pool.kind === "v2") {
    const [reserve0, reserve1] = await client.readContract({
      address: pool.address,
      abi: uniswapV2PairAbi,
      functionName: "getReserves",
      blockNumber,
    })
    // token0 = USDC, token1 = WETH (checked by verifyPool).
    reading = { kind: "v2", reserveUsdc: reserve0, reserveWeth: reserve1 }
  } else {
    // v1 keeps reserves as plain balances: its own ETH, and USDC.balanceOf.
    const [reserveEth, reserveUsdc] = await Promise.all([
      client.getBalance({ address: pool.address, blockNumber }),
      client.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool.address],
        blockNumber,
      }),
    ])
    reading = { kind: "v1", reserveUsdc, reserveEth }
  }
  return { reading, source: { kind: "state" }, price: priceOf(reading) }
}

const v3SwapEvent = uniswapV3PoolAbi.find(
  (x) => x.type === "event" && x.name === "Swap"
)!
const v2SyncEvent = uniswapV2PairAbi.find(
  (x) => x.type === "event" && x.name === "Sync"
)!

export type LogScanOptions = {
  /** First window size in blocks. Small, since the v3 pool trades ~every block. */
  initialWindow?: bigint
  maxWindow?: bigint
  maxRequests?: number
  signal?: AbortSignal
}

/**
 * Spot price from the last Swap (v3) / Sync (v2) event at or before
 * `blockNumber`. This equals the state read exactly: v3's sqrtPriceX96 only
 * moves on swaps, and every v2 reserve change emits Sync. Works on full
 * (non-archive) nodes as long as they still have the receipts.
 *
 * Scans backwards in windows: grows the window while it finds nothing,
 * shrinks it when the provider rejects the range (some cap at 10 blocks).
 */
export async function readPoolFromLogs(
  client: EthClient,
  pool: PoolInfo,
  blockNumber: bigint,
  options: LogScanOptions = {}
): Promise<PoolRead> {
  const {
    initialWindow = 10n,
    maxWindow = 2_000n,
    maxRequests = 40,
    signal,
  } = options

  if (pool.kind === "v1") {
    // v1 events (TokenPurchase, EthPurchase, …) carry trade amounts, not
    // reserves, so the price can't be recovered from the last event.
    throw new PriceLookupError(
      `${pool.label} needs archive state at block ${blockNumber}`,
      {
        hint: "Uniswap v1 events don't include reserves, so there is no event-log fallback. Use an archive RPC.",
      }
    )
  }

  let toBlock = blockNumber
  let window = initialWindow
  // Largest window the provider has accepted so far; lowered on range errors.
  let cap = maxWindow
  let requests = 0

  while (toBlock >= pool.createdAtBlock) {
    if (requests++ >= maxRequests) {
      throw new PriceLookupError(
        `No ${pool.kind === "v3" ? "Swap" : "Sync"} event found in the ${blockNumber - toBlock} blocks before #${blockNumber}`,
        { hint: `Gave up after ${maxRequests} eth_getLogs requests.` }
      )
    }
    signal?.throwIfAborted()
    const fromBlock =
      toBlock - window + 1n > pool.createdAtBlock
        ? toBlock - window + 1n
        : pool.createdAtBlock

    let found: PoolRead | undefined
    try {
      found =
        pool.kind === "v3"
          ? await lastV3Swap(client, pool, fromBlock, toBlock)
          : await lastV2Sync(client, pool, fromBlock, toBlock)
    } catch (error) {
      if (isLogRangeError(error) && window > 1n) {
        cap = window / 2n
        window = cap
        continue
      }
      throw error
    }
    if (found) return found

    toBlock = fromBlock - 1n
    window = window * 2n < cap ? window * 2n : cap
  }

  throw new UnusablePoolError(
    `no ${pool.kind === "v3" ? "Swap" : "Sync"} event between pool creation and this block`
  )
}

async function lastV3Swap(
  client: EthClient,
  pool: PoolInfo,
  fromBlock: bigint,
  toBlock: bigint
): Promise<PoolRead | undefined> {
  const logs = await client.getLogs({
    address: pool.address,
    event: v3SwapEvent,
    fromBlock,
    toBlock,
    strict: true,
  })
  const log = logs.at(-1)
  if (!log) return undefined
  const reading: PoolReading = {
    kind: "v3",
    sqrtPriceX96: log.args.sqrtPriceX96,
    tick: log.args.tick,
    liquidity: log.args.liquidity,
  }
  return {
    reading,
    source: {
      kind: "event",
      eventName: "Swap",
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    },
    price: priceOf(reading),
  }
}

async function lastV2Sync(
  client: EthClient,
  pool: PoolInfo,
  fromBlock: bigint,
  toBlock: bigint
): Promise<PoolRead | undefined> {
  const logs = await client.getLogs({
    address: pool.address,
    event: v2SyncEvent,
    fromBlock,
    toBlock,
    strict: true,
  })
  const log = logs.at(-1)
  if (!log) return undefined
  const reading: PoolReading = {
    kind: "v2",
    reserveUsdc: log.args.reserve0,
    reserveWeth: log.args.reserve1,
  }
  return {
    reading,
    source: {
      kind: "event",
      eventName: "Sync",
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    },
    price: priceOf(reading),
  }
}
