import type { Transport } from "viem"
import { createConfig, fallback, http } from "wagmi"
import { mainnet } from "wagmi/chains"

import { RequestBudget, type BudgetLimits } from "@/lib/rpc-budget"

/**
 * Public mainnet RPCs checked (Nov 2026) for archive eth_call, historical
 * eth_getProof, CORS and JSON-RPC batches. Ordered by capability: MEV
 * Blocker and Blast pass all four; Tenderly rate-limits batches; dRPC's free
 * plan caps batches at 3 and only proves recent blocks.
 */
export const PUBLIC_ARCHIVE_RPCS: readonly {
  url: string
  batchSize: number
}[] = [
  { url: "https://rpc.mevblocker.io", batchSize: 50 },
  { url: "https://eth-mainnet.public.blastapi.io", batchSize: 50 },
  { url: "https://gateway.tenderly.co/public/mainnet", batchSize: 10 },
  { url: "https://eth.drpc.org", batchSize: 3 },
]

export type TransportSettings = BudgetLimits & {
  /** Merge concurrent calls into JSON-RPC batch requests. */
  batch: boolean
}

/**
 * Read-only config: one chain, no connectors, no wallet discovery, no
 * storage. Every HTTP request goes through one RequestBudget (returned so the
 * UI can show usage); concurrent calls are batched.
 */
export function createReadOnlyConfig(
  rpcUrl: string | undefined,
  settings: TransportSettings
) {
  const budget = new RequestBudget({
    perSecond: settings.perSecond,
    perMinute: settings.perMinute,
  })
  const httpTransport = (url: string, batchSize: number): Transport =>
    http(url, {
      batch: settings.batch ? { batchSize, wait: 16 } : false,
      fetchFn: budget.fetch,
      retryCount: 2,
    })

  const transport = rpcUrl
    ? httpTransport(rpcUrl, 50)
    : fallback(
        PUBLIC_ARCHIVE_RPCS.map((r) => httpTransport(r.url, r.batchSize))
      )

  const config = createConfig({
    chains: [mainnet],
    connectors: [],
    multiInjectedProviderDiscovery: false,
    storage: null,
    transports: { [mainnet.id]: transport },
    // wagmi defaults to viem's Multicall3 auto-batching. Before Multicall3
    // existed (Mar 2022) viem falls back to a *deployless* Multicall3 whose
    // bytecode needs post-Constantinople opcodes, so calls at early-2019
    // blocks return 0x. We bundle per block ourselves (Multicall v1), and
    // JSON-RPC batching above still merges calls into few HTTP requests.
    batch: { multicall: false },
  })
  return { config, budget }
}
