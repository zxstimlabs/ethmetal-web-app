import { describe, expect, test } from "bun:test"

import { sampleBlocks } from "./series"

describe("sampleBlocks", () => {
  const start = { number: 1_000n, timestamp: 10_000n }
  const head = { number: 2_000n, timestamp: 22_000n } // 12s blocks

  test("first and last samples are the range ends", () => {
    const blocks = sampleBlocks([start, head], 10_000n, 22_000n, 10)
    expect(blocks[0]).toBe(1_000n)
    expect(blocks.at(-1)).toBe(2_000n)
    expect(blocks.length).toBe(11)
  })

  test("evenly spaced in time on a uniform segment", () => {
    const blocks = sampleBlocks([start, head], 10_000n, 22_000n, 4)
    expect(blocks).toEqual([1_000n, 1_250n, 1_500n, 1_750n, 2_000n])
  })

  test("piecewise: different block rates either side of a middle knot", () => {
    // 1000 blocks in the first 20,000s (20s blocks), then 1000 in 12,000s.
    const mid = { number: 2_000n, timestamp: 30_000n }
    const end = { number: 3_000n, timestamp: 42_000n }
    const blocks = sampleBlocks(
      [{ number: 1_000n, timestamp: 10_000n }, mid, end],
      10_000n,
      42_000n,
      8
    )
    // t = 30,000 lands exactly on the middle knot.
    expect(blocks).toContain(2_000n)
    expect(blocks[1]).toBe(1_200n) // 4,000s in at 20s/block
    expect(blocks[6]).toBe(2_333n) // 4,000s past the knot at 12s/block
  })

  test("never repeats a block and stays inside the knots", () => {
    const blocks = sampleBlocks([start, head], 10_000n, 10_100n, 60)
    expect(new Set(blocks).size).toBe(blocks.length)
    for (const b of blocks) {
      expect(b).toBeGreaterThanOrEqual(1_000n)
      expect(b).toBeLessThanOrEqual(2_000n)
    }
  })
})
