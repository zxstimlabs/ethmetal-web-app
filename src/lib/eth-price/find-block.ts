import type { Hex } from "viem"

import { type ChainAnchors, MAINNET_ANCHORS } from "./constants"

export type BlockHeader = {
  number: bigint
  timestamp: bigint
  hash: Hex
  stateRoot: Hex
}

export interface BlockSource {
  latest(): Promise<BlockHeader>
  byNumber(blockNumber: bigint): Promise<BlockHeader>
}

export type FindBlockResult = {
  block: BlockHeader
  /** Number of eth_getBlockByNumber calls made (excluding "latest"). */
  probes: number
  /** Target was at/after the chain head; `block` is the head. */
  isHead: boolean
}

type Point = { number: bigint; timestamp: bigint; header?: BlockHeader }

const min = (a: bigint, b: bigint) => (a < b ? a : b)
const max = (a: bigint, b: bigint) => (a > b ? a : b)

/**
 * Finds the last block whose timestamp is <= `target` (unix seconds).
 *
 * Correctness comes only from the bracket invariant
 *   ts(lo) <= target < ts(hi)
 * which every probe narrows using real block timestamps. Speed comes from
 * picking probes well: the first post-Merge probe uses the slot estimate
 * (merge + (t - tMerge) / 12), later probes interpolate between lo and hi,
 * and a plain bisection step is forced whenever interpolation fails to halve
 * the bracket — so the worst case stays O(log n). Nothing assumes a fixed
 * block time, so a future slot-time change makes this slower, not wrong.
 */
export async function findBlockByTimestamp(
  source: BlockSource,
  target: bigint,
  options: {
    anchors?: ChainAnchors
    /** Already-fetched chain head, to save a call. */
    head?: BlockHeader
    onProbe?: (probes: number, lo: bigint, hi: bigint) => void
    signal?: AbortSignal
  } = {}
): Promise<FindBlockResult> {
  const { anchors = MAINNET_ANCHORS, onProbe, signal } = options
  if (target < 0n) throw new RangeError("Timestamp must be >= 0")

  const head = options.head ?? (await source.latest())
  if (target >= head.timestamp) {
    return { block: head, probes: 0, isHead: true }
  }

  let probes = 0
  const fetchBlock = async (n: bigint): Promise<BlockHeader> => {
    signal?.throwIfAborted()
    probes++
    const header = await source.byNumber(n)
    if (header.number !== n) {
      throw new Error(`RPC returned block ${header.number} for ${n}`)
    }
    return header
  }

  if (target < anchors.first.timestamp) {
    // Only genesis (timestamp 0) is at or before the target.
    return { block: await fetchBlock(0n), probes, isHead: false }
  }

  // Initial bracket from known history. Anchors are only used to bound the
  // search; the block that is finally returned is always fetched from the RPC.
  const known: Point[] = [
    anchors.first,
    anchors.merge,
    ...(anchors.checkpoints ?? []),
  ]
    .filter((p) => p.number < head.number)
    .sort((a, b) => (a.number < b.number ? -1 : 1))
  let lo: Point = anchors.first
  let hi: Point = { ...head, header: head }
  for (const p of known) {
    if (p.timestamp <= target) lo = p
    else {
      hi = p
      break
    }
  }
  // Right after the Merge with nothing tighter known: use the slot estimate.
  // Otherwise the bracket is tight enough that interpolation wins.
  let firstGuess: bigint | undefined
  if (lo === anchors.merge) {
    firstGuess =
      anchors.merge.number +
      (target - anchors.merge.timestamp) / anchors.slotSeconds
  }

  let bisectNext = false
  while (hi.number - lo.number > 1n) {
    const span = hi.number - lo.number
    let probe: bigint
    if (firstGuess !== undefined) {
      probe = firstGuess
      firstGuess = undefined
    } else if (bisectNext) {
      probe = lo.number + span / 2n
    } else {
      probe =
        lo.number +
        ((target - lo.timestamp) * span) / (hi.timestamp - lo.timestamp)
    }
    probe = max(lo.number + 1n, min(hi.number - 1n, probe))

    const header = await fetchBlock(probe)
    const point = { number: header.number, timestamp: header.timestamp, header }
    if (header.timestamp <= target) lo = point
    else hi = point

    onProbe?.(probes, lo.number, hi.number)
    // If this step didn't at least halve the bracket, bisect on the next one.
    bisectNext = !bisectNext && (hi.number - lo.number) * 2n > span
  }

  const block = lo.header ?? (await fetchBlock(lo.number))
  if (block.timestamp > target) {
    // Only possible if a hard-coded anchor disagrees with the RPC.
    throw new Error(
      `Block ${block.number} has timestamp ${block.timestamp} > target ${target}; ` +
        "the RPC does not match Ethereum mainnet history"
    )
  }
  return { block, probes, isHead: false }
}
