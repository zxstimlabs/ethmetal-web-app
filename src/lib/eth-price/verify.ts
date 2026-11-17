import { type Address, isAddressEqual } from "viem"

import {
  uniswapV1ExchangeAbi,
  uniswapV1FactoryAbi,
  uniswapV2FactoryAbi,
  uniswapV2PairAbi,
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
} from "./abis"
import {
  MAINNET_CHAIN_ID,
  type PoolInfo,
  UNISWAP_V1_FACTORY,
  UNISWAP_V2_FACTORY,
  UNISWAP_V3_FACTORY,
  USDC,
  WETH,
} from "./constants"
import { PriceLookupError } from "./errors"
import type { EthClient } from "./types"

type Check = { what: string; actual: string; expected: string; ok: boolean }

const addressCheck = (what: string, actual: Address, expected: Address) => ({
  what,
  actual,
  expected,
  ok: isAddressEqual(actual, expected),
})

/**
 * Proves a hard-coded pool address is the canonical USDC/WETH pool:
 *   - the canonical factory maps (USDC, WETH[, fee]) → this address
 *   - token0 = USDC, token1 = WETH (so the price math's orientation holds)
 *   - v3 fee tier matches
 *
 * All of these are write-once on-chain (factories refuse to overwrite a
 * pair/pool; token0/token1/fee are immutables), so checking at "latest" proves
 * them for every block since creation — and works on non-archive nodes.
 */
export async function verifyPool(
  client: EthClient,
  pool: PoolInfo
): Promise<void> {
  let checks: Check[]

  if (pool.kind === "v3") {
    const fee = pool.fee ?? 0
    const [fromFactory, token0, token1, poolFee] = await Promise.all([
      client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: uniswapV3FactoryAbi,
        functionName: "getPool",
        args: [USDC, WETH, fee],
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV3PoolAbi,
        functionName: "token0",
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV3PoolAbi,
        functionName: "token1",
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV3PoolAbi,
        functionName: "fee",
      }),
    ])
    checks = [
      addressCheck(
        "factory.getPool(USDC, WETH, fee)",
        fromFactory,
        pool.address
      ),
      addressCheck("token0", token0, USDC),
      addressCheck("token1", token1, WETH),
      {
        what: "fee",
        actual: `${poolFee}`,
        expected: `${fee}`,
        ok: poolFee === fee,
      },
    ]
  } else if (pool.kind === "v1") {
    // Vyper exchange: setup() runs once; the factory never overwrites a token's exchange.
    const [fromFactory, token, factory] = await Promise.all([
      client.readContract({
        address: UNISWAP_V1_FACTORY,
        abi: uniswapV1FactoryAbi,
        functionName: "getExchange",
        args: [USDC],
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV1ExchangeAbi,
        functionName: "tokenAddress",
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV1ExchangeAbi,
        functionName: "factoryAddress",
      }),
    ])
    checks = [
      addressCheck("factory.getExchange(USDC)", fromFactory, pool.address),
      addressCheck("tokenAddress", token, USDC),
      addressCheck("factoryAddress", factory, UNISWAP_V1_FACTORY),
    ]
  } else {
    const [fromFactory, token0, token1] = await Promise.all([
      client.readContract({
        address: UNISWAP_V2_FACTORY,
        abi: uniswapV2FactoryAbi,
        functionName: "getPair",
        args: [USDC, WETH],
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV2PairAbi,
        functionName: "token0",
      }),
      client.readContract({
        address: pool.address,
        abi: uniswapV2PairAbi,
        functionName: "token1",
      }),
    ])
    checks = [
      addressCheck("factory.getPair(USDC, WETH)", fromFactory, pool.address),
      addressCheck("token0", token0, USDC),
      addressCheck("token1", token1, WETH),
    ]
  }

  const failed = checks.find((c) => !c.ok)
  if (failed) {
    throw new PriceLookupError(`${pool.label}: ${failed.what} check failed`, {
      hint: `Expected ${failed.expected}, RPC returned ${failed.actual}. The RPC may not be Ethereum mainnet, or is returning bad data.`,
    })
  }
}

/** One verification per (client, pool); failures are not cached. */
const verified = new WeakMap<object, Map<Address, Promise<void>>>()

export function verifyPoolOnce(
  client: EthClient,
  pool: PoolInfo
): Promise<void> {
  let perClient = verified.get(client)
  if (!perClient) verified.set(client, (perClient = new Map()))
  let pending = perClient.get(pool.address)
  if (!pending) {
    const cache = perClient
    pending = verifyPool(client, pool)
    cache.set(pool.address, pending)
    pending.catch(() => cache.delete(pool.address))
  }
  return pending
}

const chainChecked = new WeakMap<object, Promise<void>>()

/**
 * eth_chainId must be 1; checked once per client. Resolves to the number of
 * RPC calls it cost (0 when cached).
 */
export async function ensureMainnetOnce(client: EthClient): Promise<number> {
  const cached = chainChecked.get(client)
  if (cached) {
    await cached
    return 0
  }
  const check = client.getChainId().then((chainId) => {
    if (chainId !== MAINNET_CHAIN_ID) {
      throw new PriceLookupError(`RPC is on chain ${chainId}, not mainnet`, {
        hint: "Use an Ethereum mainnet RPC (chain id 1).",
      })
    }
  })
  chainChecked.set(client, check)
  check.catch(() => chainChecked.delete(client))
  await check
  return 1
}
