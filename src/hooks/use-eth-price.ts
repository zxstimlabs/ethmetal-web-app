import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { usePublicClient } from "wagmi"

import {
  type EthPriceResult,
  getEthPriceAt,
  type Progress,
} from "@/lib/eth-price"

/**
 * Runs the full time → block → pool → price pipeline through wagmi's public
 * client. Historical results are immutable, so they never go stale; a lookup
 * that resolved to the chain head is refetched when asked again.
 */
export function useEthPrice(target: number | undefined, rpcKey: string) {
  const client = usePublicClient()
  const [progress, setProgress] = useState<Progress>()

  const query = useQuery<EthPriceResult>({
    queryKey: ["eth-price", rpcKey, target],
    enabled: target !== undefined && client !== undefined,
    retry: false,
    staleTime: (q) => (q.state.data?.isHead ? 0 : Infinity),
    gcTime: 60 * 60_000,
    queryFn: ({ signal }) =>
      getEthPriceAt(client!, BigInt(target!), {
        signal,
        onProgress: setProgress,
      }),
  })

  return { ...query, progress }
}
