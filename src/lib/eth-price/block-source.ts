import type { Hex } from "viem"

import type { BlockHeader, BlockSource } from "./find-block"
import type { EthClient } from "./types"

function toHeader(b: {
  number: bigint | null
  timestamp: bigint
  hash: Hex | null
  stateRoot: Hex
}): BlockHeader {
  if (b.number === null || b.hash === null) {
    throw new Error("RPC returned a pending block")
  }
  return {
    number: b.number,
    timestamp: b.timestamp,
    hash: b.hash,
    stateRoot: b.stateRoot,
  }
}

/** eth_getBlockByNumber (without transactions) as a BlockSource. */
export function viemBlockSource(client: EthClient): BlockSource {
  return {
    latest: async () => toHeader(await client.getBlock({ blockTag: "latest" })),
    byNumber: async (blockNumber) =>
      toHeader(await client.getBlock({ blockNumber })),
  }
}
