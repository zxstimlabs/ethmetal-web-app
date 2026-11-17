import { EARLIEST_POOL, poolsAtBlock } from "./constants"
import {
  describeError,
  isMissingStateError,
  isPrunedHistoryError,
  PriceLookupError,
} from "./errors"
import { viemBlockSource } from "./block-source"
import { findBlockByTimestamp } from "./find-block"
import {
  type PoolRead,
  readPoolFromLogs,
  readPoolState,
  UnusablePoolError,
} from "./read-pool"
import type { EthClient, EthPriceResult, Progress, SkippedPool } from "./types"
import { ensureMainnetOnce, verifyPoolOnce } from "./verify"

export * from "./constants"
export * from "./errors"
export * from "./math"
export type * from "./types"
export type { BlockHeader } from "./find-block"
export { viemBlockSource } from "./block-source"
export { getPriceSeries, sampleBlocks } from "./series"
export { proveReading, type ReadingProof } from "./proof"
export { TWAP_WINDOW_SECONDS } from "./read-pool"

const rpcSaid = (error: unknown) => {
  const { title, hint } = describeError(error)
  return hint ?? title
}

/**
 * ETH price in USDC at a unix timestamp, read from Ethereum mainnet:
 *   1. timestamp → last block with timestamp <= target
 *   2. pick the deepest canonical pool that existed at that block
 *   3. verify the pool against its factory, then read its spot price via
 *      eth_call at that block, or — if the RPC lacks that historical state —
 *      from the last Swap/Sync event at or before the block.
 */
export async function getEthPriceAt(
  client: EthClient,
  target: bigint,
  options: {
    onProgress?: (progress: Progress) => void
    signal?: AbortSignal
  } = {}
): Promise<EthPriceResult> {
  const { onProgress, signal } = options
  const started = performance.now()

  onProgress?.({ stage: "chain" })
  await ensureMainnetOnce(client)

  onProgress?.({ stage: "block", probes: 0 })
  const found = await findBlockByTimestamp(viemBlockSource(client), target, {
    signal,
    onProbe: (probes, lo, hi) =>
      onProgress?.({ stage: "block", probes, lo, hi }),
  }).catch((error: unknown) => {
    if (!isPrunedHistoryError(error)) throw error
    throw new PriceLookupError("This RPC has pruned old block history", {
      hint: `It can't return block headers that far back (EIP-4444 history expiry), so the date can't be mapped to a block. Use an archive RPC. RPC said: ${rpcSaid(error)}`,
      cause: error,
    })
  })
  const { block } = found

  const candidates = poolsAtBlock(block.number)
  if (candidates.length === 0) {
    throw new PriceLookupError(
      `No USDC/ETH Uniswap pool existed at block ${block.number}`,
      {
        hint: `The earliest one (${EARLIEST_POOL.label}) was created at block ${EARLIEST_POOL.createdAtBlock}, ${new Date(Number(EARLIEST_POOL.createdAtTimestamp) * 1000).toISOString()}.`,
      }
    )
  }

  const skipped: SkippedPool[] = []
  for (const pool of candidates) {
    signal?.throwIfAborted()
    await verifyPoolOnce(client, pool)

    let read: PoolRead
    try {
      onProgress?.({ stage: "pool", pool, via: "state" })
      read = await readPoolState(client, pool, block.number)
    } catch (error) {
      if (error instanceof UnusablePoolError) {
        skipped.push({ pool, reason: error.message })
        continue
      }
      if (!isMissingStateError(error)) throw error
      // No archive state at this block: fall back to the event log.
      onProgress?.({ stage: "pool", pool, via: "event" })
      try {
        read = await readPoolFromLogs(client, pool, block.number, { signal })
      } catch (logError) {
        if (logError instanceof UnusablePoolError) {
          skipped.push({ pool, reason: logError.message })
          continue
        }
        if (logError instanceof PriceLookupError) throw logError
        throw new PriceLookupError(
          `RPC has neither historical state nor logs for block ${block.number}`,
          {
            hint: `It looks like a pruned full node, so use an archive RPC for this date. RPC said: ${rpcSaid(logError)}`,
            cause: logError,
          }
        )
      }
    }

    return {
      target,
      block,
      isHead: found.isHead,
      probes: found.probes,
      pool,
      ...read,
      skipped,
      elapsedMs: Math.round(performance.now() - started),
    }
  }

  throw new PriceLookupError(`No usable pool at block ${block.number}`, {
    hint: skipped.map((s) => `${s.pool.label}: ${s.reason}`).join("; "),
  })
}
