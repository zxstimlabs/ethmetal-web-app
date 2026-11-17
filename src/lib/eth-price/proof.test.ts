import { describe, expect, test } from "bun:test"
import type { Hex } from "viem"

import fixtures from "./__fixtures__/proofs.json"
import {
  UNISWAP_V1_USDC_ETH,
  UNISWAP_V2_USDC_WETH,
  UNISWAP_V3_USDC_WETH_005,
} from "./constants"
import type { BlockHeader } from "./find-block"
import {
  ProofError,
  proveReading,
  verifyAccountProof,
  verifyMerkleProof,
} from "./proof"
import type { EthClient, PoolReading } from "./types"

/**
 * Real eth_getProof responses captured from mainnet (see __fixtures__).
 * JSON stores bigints as strings; these rehydrate them.
 */
type RawProof = {
  address: Hex
  balance: string
  codeHash: Hex
  nonce: number
  storageHash: Hex
  accountProof: Hex[]
  storageProof: { key: Hex; proof: Hex[]; value: string }[]
}
type RawFixture = {
  block: { number: string; timestamp: string; hash: Hex; stateRoot: Hex }
  reading: Record<string, string | number>
  proofs: RawProof[]
}

const block = (f: RawFixture): BlockHeader => ({
  number: BigInt(f.block.number),
  timestamp: BigInt(f.block.timestamp),
  hash: f.block.hash,
  stateRoot: f.block.stateRoot,
})

const proofOf = (p: RawProof) => ({
  ...p,
  balance: BigInt(p.balance),
  storageProof: p.storageProof.map((s) => ({ ...s, value: BigInt(s.value) })),
})

function reading(f: RawFixture): PoolReading {
  const r = f.reading
  if (r.kind === "v3") {
    return {
      kind: "v3",
      sqrtPriceX96: BigInt(r.sqrtPriceX96),
      tick: Number(r.tick),
      liquidity: BigInt(r.liquidity),
    }
  }
  if (r.kind === "v2") {
    return {
      kind: "v2",
      reserveUsdc: BigInt(r.reserveUsdc),
      reserveWeth: BigInt(r.reserveWeth),
    }
  }
  return {
    kind: "v1",
    reserveUsdc: BigInt(r.reserveUsdc),
    reserveEth: BigInt(r.reserveEth),
  }
}

/** A client whose eth_getProof replays the fixture. */
function replayClient(f: RawFixture): EthClient {
  return {
    getProof: async ({ address }: { address: Hex }) => {
      const p = f.proofs.find(
        (x) => x.address.toLowerCase() === address.toLowerCase()
      )
      if (!p) throw new Error(`no fixture for ${address}`)
      return proofOf(p)
    },
  } as unknown as EthClient
}

const all = fixtures as unknown as Record<"v1" | "v2" | "v3", RawFixture>
const POOLS = {
  v3: UNISWAP_V3_USDC_WETH_005,
  v2: UNISWAP_V2_USDC_WETH,
  v1: UNISWAP_V1_USDC_ETH,
}

describe("proveReading against real mainnet proofs", () => {
  for (const kind of ["v3", "v2", "v1"] as const) {
    test(`${kind}: eth_call values equal the values proven against stateRoot`, async () => {
      const f = all[kind]
      const proof = await proveReading(
        replayClient(f),
        block(f),
        POOLS[kind],
        reading(f),
        { kind: "state" }
      )
      expect(proof.ok).toBe(true)
      expect(proof.checks.length).toBeGreaterThan(0)
      for (const c of proof.checks) expect(c.proven).toBe(c.reported)
    })
  }

  test("a wrong reported value is flagged, not hidden", async () => {
    const f = all.v2
    const r = reading(f) as Extract<PoolReading, { kind: "v2" }>
    const proof = await proveReading(
      replayClient(f),
      block(f),
      POOLS.v2,
      { ...r, reserveUsdc: r.reserveUsdc + 1n },
      { kind: "state" }
    )
    expect(proof.ok).toBe(false)
    expect(proof.checks.find((c) => !c.ok)?.label).toContain("reserve0")
  })
})

describe("verifyMerkleProof tamper resistance", () => {
  const f = all.v2
  const p = f.proofs[0]
  const claimed = { ...proofOf(p) }

  test("valid account proof verifies", () => {
    const acct = verifyAccountProof(
      f.block.stateRoot,
      p.address,
      p.accountProof,
      claimed
    )
    expect(acct.storageRoot).toBe(p.storageHash.toLowerCase())
  })

  test("wrong state root is rejected", () => {
    const wrongRoot = all.v1.block.stateRoot
    expect(() =>
      verifyAccountProof(wrongRoot, p.address, p.accountProof, claimed)
    ).toThrow(ProofError)
  })

  test("a flipped byte inside any proof node is rejected", () => {
    for (let i = 0; i < p.accountProof.length; i++) {
      const node = p.accountProof[i]
      const pos = 10 + 2 * Math.floor(node.length / 4)
      const flipped = (node[pos] === "0" ? "1" : "0") as string
      const tampered = [...p.accountProof]
      tampered[i] = (node.slice(0, pos) + flipped + node.slice(pos + 1)) as Hex
      expect(() =>
        verifyAccountProof(f.block.stateRoot, p.address, tampered, claimed)
      ).toThrow()
    }
  })

  test("a lying RPC balance is rejected", () => {
    expect(() =>
      verifyAccountProof(f.block.stateRoot, p.address, p.accountProof, {
        ...claimed,
        balance: claimed.balance + 1n,
      })
    ).toThrow(ProofError)
  })

  test("truncated proof is rejected", () => {
    expect(() =>
      verifyMerkleProof(
        f.block.stateRoot,
        ("0x" + "ab".repeat(32)) as Hex,
        p.accountProof.slice(0, 1)
      )
    ).toThrow()
  })
})
