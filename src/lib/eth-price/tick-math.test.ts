import { describe, expect, test } from "bun:test"

import { v3SqrtPriceX96ToPrice } from "./math"
import { getSqrtRatioAtTick, MAX_TICK, meanTick, MIN_TICK } from "./tick-math"

describe("getSqrtRatioAtTick", () => {
  test("known values from TickMath.sol", () => {
    expect(getSqrtRatioAtTick(0)).toBe(2n ** 96n)
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(4295128739n)
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(
      1461446703485210103287273052203988822378723970342n
    )
  })

  test("every bit factor ≈ 2^128 / sqrt(1.0001^(2^k))", () => {
    // Checks each magic constant independently of the others.
    for (let k = 0; k < 20; k++) {
      const tick = -(1 << k)
      const exact = Number(getSqrtRatioAtTick(tick)) / 2 ** 96
      const expected = Math.pow(1.0001, tick / 2)
      expect(Math.abs(exact / expected - 1)).toBeLessThan(1e-9)
    }
  })

  test("brackets real slot0 values (tick, sqrtPriceX96) from mainnet", () => {
    // [tick, sqrtPriceX96] read from the 0.05% pool's slot0 via eth_call.
    const samples: [number, bigint][] = [
      [193640, 1269165747759120555205429899998606n], // block 12400000
      [191571, 1144465605143258280467652961203912n], // block 13588888
      [195351, 1382537124844685226697955111740338n], // block 14500000
      [202558, 1982244619494748261826333426841861n], // block 15537394
      [202507, 1977194307287946707739091212969505n], // block 16500000
      [202234, 1950377547303575102371563899111474n], // block 18000000
      [193213, 1242346220384989294691111747609101n], // block 19415285
      [197548, 1543052165869004215919172554023539n], // block 21000000
      [200247, 1765959474864046520317530896909938n], // block 26400000
    ]
    for (const [tick, sqrtP] of samples) {
      expect(getSqrtRatioAtTick(tick)).toBeLessThanOrEqual(sqrtP)
      expect(getSqrtRatioAtTick(tick + 1)).toBeGreaterThan(sqrtP)
    }
  })

  test("price from tick matches the spot formula", () => {
    // tick 200311 ≈ $2,000: 1e12 / 1.0001^tick
    const price =
      Number(v3SqrtPriceX96ToPrice(getSqrtRatioAtTick(200311))) / 1e18
    expect(price).toBeCloseTo(1e12 / Math.pow(1.0001, 200311), 4)
  })
})

describe("meanTick", () => {
  test("positive delta truncates", () => {
    expect(meanTick(0n, 3_601n * 1800n + 5n, 1800)).toBe(3601)
  })
  test("negative delta rounds toward -infinity", () => {
    expect(meanTick(0n, -(10n * 1800n) - 1n, 1800)).toBe(-11)
    expect(meanTick(0n, -(10n * 1800n), 1800)).toBe(-10)
  })
})
