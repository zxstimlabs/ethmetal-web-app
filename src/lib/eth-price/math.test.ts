import { describe, expect, test } from "bun:test"

import {
  formatPriceExact,
  formatPriceUsd,
  v2ReservesToPrice,
  v3SqrtPriceX96ToPrice,
} from "./math"

const Q96 = 2n ** 96n
const E18 = 10n ** 18n

describe("v3SqrtPriceX96ToPrice", () => {
  test("exact round trip: 2500 USDC/ETH", () => {
    // raw price = WETH-wei per USDC-unit = 1e12 / 2500 = 4e8 → sqrt = 20000
    expect(v3SqrtPriceX96ToPrice(20_000n * Q96)).toBe(2500n * E18)
  })

  test("exact round trip: 400 USDC/ETH", () => {
    // 1e12 / 400 = 2.5e9 → sqrt = 50000
    expect(v3SqrtPriceX96ToPrice(50_000n * Q96)).toBe(400n * E18)
  })

  test("real mainnet slot0 value lands in a sane range", () => {
    // sqrtPriceX96 read from the 0.05% pool during development (late 2026)
    const price = v3SqrtPriceX96ToPrice(0x5c9b8a317e1053de0a4364c9c3b1n)
    expect(price).toBeGreaterThan(100n * E18)
    expect(price).toBeLessThan(100_000n * E18)
  })

  test("rejects zero", () => {
    expect(() => v3SqrtPriceX96ToPrice(0n)).toThrow()
  })
})

describe("v2ReservesToPrice", () => {
  test("2.5M USDC / 1000 WETH = 2500", () => {
    expect(v2ReservesToPrice(2_500_000n * 10n ** 6n, 1000n * E18)).toBe(
      2500n * E18
    )
  })

  test("matches the on-chain reserves at block 10100000 (~$214)", () => {
    const price = v2ReservesToPrice(0x2459238db0n, 0x27950f7d574a5d52d4n)
    expect(price / E18).toBe(213n)
  })

  test("v2 and v3 agree on the same price", () => {
    expect(v2ReservesToPrice(400n * 10n ** 6n, E18)).toBe(
      v3SqrtPriceX96ToPrice(50_000n * Q96)
    )
  })
})

describe("formatting", () => {
  test("exact keeps all 18 decimals", () => {
    expect(formatPriceExact(1234_567890123456789012n)).toBe(
      "1234.567890123456789012"
    )
  })

  test("usd rounds to cents", () => {
    expect(formatPriceUsd(1234_567890123456789012n)).toBe("$1,234.57")
  })
})
