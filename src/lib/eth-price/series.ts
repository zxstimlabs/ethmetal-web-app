import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem"

import {
  erc20Abi,
  multicall1Abi,
  uniswapV2PairAbi,
  uniswapV3PoolAbi,
} from "./abis"
import {
  type ChainAnchor,
  EARLIEST_PRICE,
  MAINNET_ANCHORS,
  MULTICALL1,
  MULTICALL1_CREATED_AT_BLOCK,
  type PoolInfo,
  poolsAtBlock,
  USDC,
} from "./constants"
import { isMissingStateError, PriceLookupError } from "./errors"
import { priceOf, readPoolState, UnusablePoolError } from "./read-pool"
import type {
  EthClient,
  PoolReading,
  PriceSeries,
  SeriesPoint,
  SeriesProgress,
} from "./types"
import { ensureMainnetOnce, verifyPoolOnce } from "./verify"
import { viemBlockSource } from "./block-source"

type Call = { target: Address; callData: Hex }

/**
 * Block numbers for `intervals + 1` evenly spaced times in [from, to],
 * estimated by piecewise-linear interpolation through known (block, time)
 * knots — e.g. the range start, the Merge, and the head. Accurate to a few
 * blocks, which is plenty for a chart: each point's exact timestamp is read
 * back in the same eth_call.
 */
export function sampleBlocks(
  knots: readonly ChainAnchor[],
  from: bigint,
  to: bigint,
  intervals: number
): bigint[] {
  if (knots.length < 2) throw new RangeError("need at least two knots")
  const first = knots[0]
  const last = knots[knots.length - 1]
  const out: bigint[] = []
  for (let i = 0; i <= intervals; i++) {
    const t = from + ((to - from) * BigInt(i)) / BigInt(intervals)
    let k = 0
    while (k < knots.length - 2 && knots[k + 1].timestamp <= t) k++
    const a = knots[k]
    const b = knots[k + 1]
    let block =
      b.timestamp === a.timestamp
        ? a.number
        : a.number +
          ((t - a.timestamp) * (b.number - a.number)) /
            (b.timestamp - a.timestamp)
    if (block < first.number) block = first.number
    if (block > last.number) block = last.number
    if (out.at(-1) !== block) out.push(block)
  }
  return out
}

const encode = {
  timestamp: () =>
    encodeFunctionData({
      abi: multicall1Abi,
      functionName: "getCurrentBlockTimestamp",
    }),
  ethBalance: (addr: Address) =>
    encodeFunctionData({
      abi: multicall1Abi,
      functionName: "getEthBalance",
      args: [addr],
    }),
}

/** The reads one pool needs, and how to turn their return data into a reading. */
function poolCalls(pool: PoolInfo): {
  calls: Call[]
  toReading: (data: readonly Hex[]) => PoolReading
} {
  if (pool.kind === "v3") {
    return {
      calls: [
        {
          target: pool.address,
          callData: encodeFunctionData({
            abi: uniswapV3PoolAbi,
            functionName: "slot0",
          }),
        },
        {
          target: pool.address,
          callData: encodeFunctionData({
            abi: uniswapV3PoolAbi,
            functionName: "liquidity",
          }),
        },
      ],
      toReading: ([slot0Data, liquidityData]) => {
        const slot0 = decodeFunctionResult({
          abi: uniswapV3PoolAbi,
          functionName: "slot0",
          data: slot0Data,
        })
        const liquidity = decodeFunctionResult({
          abi: uniswapV3PoolAbi,
          functionName: "liquidity",
          data: liquidityData,
        })
        return {
          kind: "v3",
          sqrtPriceX96: slot0[0],
          tick: slot0[1],
          liquidity,
        }
      },
    }
  }
  if (pool.kind === "v2") {
    return {
      calls: [
        {
          target: pool.address,
          callData: encodeFunctionData({
            abi: uniswapV2PairAbi,
            functionName: "getReserves",
          }),
        },
      ],
      toReading: ([data]) => {
        const [reserve0, reserve1] = decodeFunctionResult({
          abi: uniswapV2PairAbi,
          functionName: "getReserves",
          data,
        })
        return { kind: "v2", reserveUsdc: reserve0, reserveWeth: reserve1 }
      },
    }
  }
  return {
    calls: [
      { target: MULTICALL1, callData: encode.ethBalance(pool.address) },
      {
        target: USDC,
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [pool.address],
        }),
      },
    ],
    toReading: ([ethData, usdcData]) => ({
      kind: "v1",
      reserveEth: decodeFunctionResult({
        abi: multicall1Abi,
        functionName: "getEthBalance",
        data: ethData,
      }),
      reserveUsdc: decodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        data: usdcData,
      }),
    }),
  }
}

export type PointRead = {
  /** Undefined if no pool had a usable price at the block. */
  point?: SeriesPoint
  /** RPC requests this point cost. */
  calls: number
}

/**
 * Price after `blockNumber` in ONE eth_call: Multicall.aggregate bundles the
 * block timestamp with every existing pool's reserves; the most preferred
 * pool with a usable price wins. Before Multicall was deployed (only the v1
 * exchange existed then) it falls back to separate reads.
 */
export async function readPricePoint(
  client: EthClient,
  blockNumber: bigint
): Promise<PointRead> {
  if (blockNumber < MULTICALL1_CREATED_AT_BLOCK) {
    return readPricePointDirect(client, blockNumber)
  }
  const pools = poolsAtBlock(blockNumber).map((pool) => ({
    pool,
    ...poolCalls(pool),
  }))
  const calls: Call[] = [
    { target: MULTICALL1, callData: encode.timestamp() },
    ...pools.flatMap((p) => p.calls),
  ]
  const [, returnData] = await client.readContract({
    address: MULTICALL1,
    abi: multicall1Abi,
    functionName: "aggregate",
    args: [calls],
    blockNumber,
  })

  const timestamp = decodeFunctionResult({
    abi: multicall1Abi,
    functionName: "getCurrentBlockTimestamp",
    data: returnData[0],
  })
  let offset = 1
  for (const p of pools) {
    const data = returnData.slice(offset, offset + p.calls.length)
    offset += p.calls.length
    try {
      const reading = p.toReading(data)
      const price = priceOf(reading)
      return {
        point: { blockNumber, timestamp, pool: p.pool.kind, price, reading },
        calls: 1,
      }
    } catch (error) {
      if (!(error instanceof UnusablePoolError)) throw error
    }
  }
  return { calls: 1 }
}

/** Pre-Multicall: block header + each pool's own reads. */
async function readPricePointDirect(
  client: EthClient,
  blockNumber: bigint
): Promise<PointRead> {
  const pools = poolsAtBlock(blockNumber)
  const [header, ...reads] = await Promise.all([
    client.getBlock({ blockNumber }),
    ...pools.map((pool) =>
      readPoolState(client, pool, blockNumber).catch((error: unknown) => {
        if (error instanceof UnusablePoolError) return undefined
        throw error
      })
    ),
  ])
  // getBlock + v1's getBalance + balanceOf (v2/v3 never exist this early).
  const calls = 1 + pools.length * 2
  for (const [i, read] of reads.entries()) {
    if (!read) continue
    return {
      point: {
        blockNumber,
        timestamp: header.timestamp,
        pool: pools[i].kind,
        price: read.price,
        reading: read.reading,
      },
      calls,
    }
  }
  return { calls }
}

/** Runs `fn` over `items` with at most `limit` in flight; stops on first error. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      signal?.throwIfAborted()
      const i = next++
      try {
        results[i] = await fn(items[i])
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return results
}

export type SeriesOptions = {
  /** Unix seconds. Clamped to EARLIEST_PRICE. */
  from: bigint
  /** Unix seconds; defaults to (and is clamped to) the chain head. */
  to?: bigint
  /** Number of intervals; the series has intervals + 1 points. */
  intervals: number
  onProgress?: (progress: SeriesProgress) => void
  signal?: AbortSignal
}

/**
 * Price series over a time range for a fixed RPC budget: 1 latest block +
 * 1 eth_call per point (Multicall bundles everything at that block), all
 * sent together so a batching transport makes it ONE HTTP request.
 * Points the RPC has no state for (pruned full node) are dropped and counted.
 */
export async function getPriceSeries(
  client: EthClient,
  options: SeriesOptions
): Promise<PriceSeries> {
  const { intervals, onProgress, signal } = options
  const started = performance.now()

  const chainCalls = await ensureMainnetOnce(client)
  const head = await viemBlockSource(client).latest()
  let to = options.to ?? head.timestamp
  if (to > head.timestamp) to = head.timestamp
  let from = options.from
  if (from < EARLIEST_PRICE.timestamp) from = EARLIEST_PRICE.timestamp
  if (from >= to) throw new RangeError("Empty time range")

  // No block search: estimate sample blocks from known (block, time) points
  // — the first priced block, quarterly checkpoints, the Merge — and the head.
  // Each point's exact timestamp comes back in its own eth_call.
  const anchors = MAINNET_ANCHORS
  const knots: ChainAnchor[] = [
    { number: EARLIEST_PRICE.block, timestamp: EARLIEST_PRICE.timestamp },
    anchors.merge,
    ...(anchors.checkpoints ?? []),
  ]
    .filter((k) => k.number < head.number && k.number >= EARLIEST_PRICE.block)
    .sort((a, b) => (a.number < b.number ? -1 : 1))
  knots.push(head)
  const blocks = sampleBlocks(knots, from, to, intervals)

  // Verify (once per RPC) every pool that can appear in this range.
  await Promise.all(
    poolsAtBlock(head.number)
      .filter((p) => p.createdAtBlock <= blocks[blocks.length - 1])
      .map((p) => verifyPoolOnce(client, p))
  )

  let done = 0
  let missing = 0
  let pointCalls = 0
  onProgress?.({ done, total: blocks.length })
  const points = await mapLimit(
    blocks,
    // Everything at once: viem's batching turns this into one HTTP request
    // (or a few, by batchSize); the fetch-level budget paces the rest.
    blocks.length,
    async (blockNumber) => {
      try {
        const { point, calls } = await readPricePoint(client, blockNumber)
        pointCalls += calls
        return point
      } catch (error) {
        if (!isMissingStateError(error)) throw error
        pointCalls++
        missing++
        return undefined
      } finally {
        onProgress?.({ done: ++done, total: blocks.length })
      }
    },
    signal
  )

  const present = points.filter((p): p is SeriesPoint => p !== undefined)
  if (present.length === 0 && missing > 0) {
    throw new PriceLookupError(
      "This RPC has no historical state for this range",
      {
        hint: "Charts read state at every sample block. Use an archive RPC, or a shorter range that fits the node's recent-state window.",
      }
    )
  }

  return {
    from,
    to,
    points: present,
    missing,
    rpcCalls: chainCalls + 1 + pointCalls,
    elapsedMs: Math.round(performance.now() - started),
  }
}
