import { formatUnits } from "viem"

import { USDC_DECIMALS, WETH_DECIMALS } from "./constants"

/**
 * Prices are fixed-point bigints: USDC per 1 ETH, scaled by 10^PRICE_DECIMALS.
 * All math stays in bigint until display.
 */
export const PRICE_DECIMALS = 18

const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS)
/** token0 = USDC (6 dec), token1 = WETH (18 dec) → raw ratios are off by 1e12. */
const DECIMALS_FACTOR = 10n ** BigInt(WETH_DECIMALS - USDC_DECIMALS)
const Q192 = 2n ** 192n

/**
 * Uniswap v3: sqrtPriceX96 = sqrt(token1/token0) · 2^96 in raw units, i.e.
 * sqrt(WETH-wei per USDC-unit). Inverting and fixing decimals:
 *   ETH price in USDC = 1e12 · 2^192 / sqrtPriceX96²
 */
export function v3SqrtPriceX96ToPrice(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= 0n) throw new RangeError("sqrtPriceX96 must be > 0")
  return (DECIMALS_FACTOR * Q192 * PRICE_SCALE) / (sqrtPriceX96 * sqrtPriceX96)
}

/** Uniswap v2 mid price: (reserveUSDC / 1e6) / (reserveWETH / 1e18). */
export function v2ReservesToPrice(
  reserveUsdc: bigint,
  reserveWeth: bigint
): bigint {
  if (reserveWeth <= 0n) throw new RangeError("WETH reserve must be > 0")
  return (reserveUsdc * DECIMALS_FACTOR * PRICE_SCALE) / reserveWeth
}

/** Exact decimal string, e.g. "1612.345678901234567890". */
export function formatPriceExact(price: bigint): string {
  return formatUnits(price, PRICE_DECIMALS)
}

/** Rounded for display. Converting to a double here is fine: only for UI. */
export function formatPriceUsd(price: bigint, fractionDigits = 2): string {
  return Number(formatUnits(price, PRICE_DECIMALS)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}
