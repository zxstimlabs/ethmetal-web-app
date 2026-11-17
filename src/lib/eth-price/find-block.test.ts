import { describe, expect, test } from "bun:test"

import type { ChainAnchors } from "./constants"
import {
  type BlockHeader,
  type BlockSource,
  findBlockByTimestamp,
} from "./find-block"

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Synthetic chain shaped like mainnet: genesis at t=0, block 1 at T1,
 * PoW blocks 1–40s apart (with a slow "difficulty bomb" stretch), then PoS
 * blocks on 12s slots with ~3% missed slots.
 */
function makeChain(seed: number, powBlocks: number, posBlocks: number) {
  const rand = mulberry32(seed)
  const ts: bigint[] = [0n, 1_438_269_988n]
  for (let i = 2; i <= powBlocks; i++) {
    const bomb = i > powBlocks * 0.6 && i < powBlocks * 0.7
    const gap = bomb
      ? 20 + Math.floor(rand() * 20)
      : 1 + Math.floor(rand() * 26)
    ts.push(ts[i - 1] + BigInt(gap))
  }
  const mergeNumber = ts.length
  // First PoS block: a little after the last PoW block.
  ts.push(ts[mergeNumber - 1] + 17n)
  for (let i = 1; i < posBlocks; i++) {
    let slots = 1
    while (rand() < 0.03) slots++
    ts.push(ts[ts.length - 1] + 12n * BigInt(slots))
  }

  const header = (n: number): BlockHeader => ({
    number: BigInt(n),
    timestamp: ts[n],
    hash: `0x${n.toString(16).padStart(64, "0")}`,
    stateRoot: `0x${"0".repeat(64)}`,
  })
  let calls = 0
  const source: BlockSource = {
    latest: async () => header(ts.length - 1),
    byNumber: async (n) => {
      calls++
      if (n < 0n || n >= BigInt(ts.length)) throw new Error(`no block ${n}`)
      return header(Number(n))
    },
  }
  const anchors: ChainAnchors = {
    first: { number: 1n, timestamp: ts[1] },
    merge: { number: BigInt(mergeNumber), timestamp: ts[mergeNumber] },
    slotSeconds: 12n,
  }
  /** Reference answer by plain binary search over the in-memory array. */
  const expected = (t: bigint): number => {
    let lo = 0
    let hi = ts.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (ts[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return { ts, source, anchors, expected, calls: () => calls }
}

describe("findBlockByTimestamp", () => {
  const chain = makeChain(42, 200_000, 300_000)
  const head = chain.ts[chain.ts.length - 1]
  const first = chain.ts[1]

  test("matches brute force for random targets (pre- and post-merge)", async () => {
    const rand = mulberry32(7)
    let maxProbes = 0
    for (let i = 0; i < 400; i++) {
      const t = first + BigInt(Math.floor(rand() * Number(head - first)))
      const r = await findBlockByTimestamp(chain.source, t, {
        anchors: chain.anchors,
      })
      expect(Number(r.block.number)).toBe(chain.expected(t))
      maxProbes = Math.max(maxProbes, r.probes)
    }
    // log2(500k) ≈ 19; interpolation + forced bisection should stay well under 2x.
    expect(maxProbes).toBeLessThanOrEqual(30)
  })

  test("exact block timestamps and the second just before them", async () => {
    for (const n of [1, 2, 1000, 150_000, 199_999, 200_000, 200_001, 350_000]) {
      const t = chain.ts[n]
      const at = await findBlockByTimestamp(chain.source, t, {
        anchors: chain.anchors,
      })
      expect(Number(at.block.number)).toBe(n)
      const before = await findBlockByTimestamp(chain.source, t - 1n, {
        anchors: chain.anchors,
      })
      expect(Number(before.block.number)).toBe(chain.expected(t - 1n))
    }
  })

  test("targets inside missed-slot gaps resolve to the block before the gap", async () => {
    // Find a post-merge gap > 12s and aim at its middle.
    const merge = Number(chain.anchors.merge.number)
    const n = chain.ts.findIndex(
      (t, i) => i > merge && t - chain.ts[i - 1] > 12n
    )
    const t = chain.ts[n - 1] + 13n
    const r = await findBlockByTimestamp(chain.source, t, {
      anchors: chain.anchors,
    })
    expect(Number(r.block.number)).toBe(n - 1)
  })

  test("at or after head returns the head", async () => {
    const r = await findBlockByTimestamp(chain.source, head + 1000n, {
      anchors: chain.anchors,
    })
    expect(r.isHead).toBe(true)
    expect(r.block.timestamp).toBe(head)
  })

  test("before block 1 returns genesis", async () => {
    const r = await findBlockByTimestamp(chain.source, 5n, {
      anchors: chain.anchors,
    })
    expect(r.block.number).toBe(0n)
  })

  test("post-merge lookups are fast", async () => {
    const rand = mulberry32(99)
    const merge = chain.anchors.merge.timestamp
    let total = 0
    for (let i = 0; i < 100; i++) {
      const t = merge + BigInt(Math.floor(rand() * Number(head - merge)))
      total += (
        await findBlockByTimestamp(chain.source, t, { anchors: chain.anchors })
      ).probes
    }
    expect(total / 100).toBeLessThan(12)
  })
})

describe("findBlockByTimestamp with checkpoints", () => {
  const chain = makeChain(1234, 150_000, 250_000)
  const head = chain.ts[chain.ts.length - 1]
  const first = chain.ts[1]
  // One checkpoint every ~25k blocks, like the quarterly mainnet table.
  const checkpoints = Array.from({ length: 15 }, (_, i) => {
    const n = 10_000 + i * 25_000
    return { number: BigInt(n), timestamp: chain.ts[n] }
  })
  const anchors = { ...chain.anchors, checkpoints }

  test("still exact, and needs fewer probes", async () => {
    const rand = mulberry32(5)
    let withCk = 0
    let without = 0
    for (let i = 0; i < 300; i++) {
      const t = first + BigInt(Math.floor(rand() * Number(head - first)))
      const a = await findBlockByTimestamp(chain.source, t, { anchors })
      const b = await findBlockByTimestamp(chain.source, t, {
        anchors: chain.anchors,
      })
      expect(Number(a.block.number)).toBe(chain.expected(t))
      expect(a.block.number).toBe(b.block.number)
      withCk += a.probes
      without += b.probes
    }
    expect(withCk).toBeLessThan(without)
  })

  test("targets exactly on a checkpoint", async () => {
    for (const ck of checkpoints) {
      const r = await findBlockByTimestamp(chain.source, ck.timestamp, {
        anchors,
      })
      expect(r.block.number).toBe(ck.number)
    }
  })
})
