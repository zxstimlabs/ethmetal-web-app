import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { usePublicClient } from "wagmi"

import {
  getPriceSeries,
  type PriceSeries,
  type SeriesProgress,
} from "@/lib/eth-price"

/** Samples per chart: 33 points. Coarse on purpose; each one is a historical read. */
export const CHART_INTERVALS = 32

/**
 * Price series for [from, now]. With a batching transport this is two HTTP
 * requests: the head block and one batch of Multicall eth_calls.
 */
export function usePriceSeries(
  fromSeconds: number,
  rpcKey: string,
  rangeKey: string
) {
  const client = usePublicClient()
  const [progress, setProgress] = useState<SeriesProgress>()

  const query = useQuery<PriceSeries>({
    // rangeKey (not fromSeconds) keeps one cache entry per range.
    queryKey: ["price-series", rpcKey, rangeKey],
    enabled: client !== undefined,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: ({ signal }) =>
      getPriceSeries(client!, {
        from: BigInt(fromSeconds),
        intervals: CHART_INTERVALS,
        onProgress: setProgress,
        signal,
      }),
  })
  return { ...query, progress }
}
