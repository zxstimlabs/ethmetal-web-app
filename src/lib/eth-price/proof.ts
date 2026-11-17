import {
  type Address,
  encodeAbiParameters,
  fromRlp,
  type Hex,
  hexToBigInt,
  keccak256,
  numberToHex,
} from "viem"

import { type PoolInfo, STORAGE_SLOTS, USDC } from "./constants"
import type { BlockHeader } from "./find-block"
import type { EthClient, PoolReading, PriceSource } from "./types"

/** A proof that doesn't hash-link to the root, or is malformed. */
export class ProofError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProofError"
  }
}

/** Decoded RLP: a byte string or a list of items. */
type RlpItem = Hex | RlpItem[]
const decodeRlp = (raw: Hex) => fromRlp(raw, "hex") as unknown as RlpItem

function toNibbles(hex: Hex): number[] {
  const out: number[] = []
  for (let i = 2; i < hex.length; i++) out.push(parseInt(hex[i], 16))
  return out
}

/** Hex-prefix (compact) encoding of a leaf/extension path. */
function decodePath(encoded: Hex): { nibbles: number[]; leaf: boolean } {
  const all = toNibbles(encoded)
  const flag = all[0]
  if (flag === undefined || flag > 3) throw new ProofError("bad path prefix")
  return { leaf: flag >= 2, nibbles: all.slice(flag & 1 ? 1 : 2) }
}

/**
 * Walks a Merkle-Patricia proof from `root` along `path` (a 32-byte hashed
 * key). Every node fetched by reference must hash to that reference; nodes
 * shorter than 32 bytes are embedded in their parent. Returns the RLP value
 * at the key, or undefined if the proof shows the key is absent.
 */
export function verifyMerkleProof(
  root: Hex,
  path: Hex,
  proof: readonly Hex[]
): Hex | undefined {
  const key = toNibbles(path)
  let pos = 0
  let ref: RlpItem = root
  let next = 0

  for (;;) {
    let node: RlpItem
    if (typeof ref === "string") {
      if (ref === "0x") return undefined // empty branch slot
      const raw = proof[next++]
      if (raw === undefined) throw new ProofError("proof ended early")
      if (keccak256(raw) !== ref.toLowerCase()) {
        throw new ProofError(
          `proof node ${next - 1} does not hash to its parent's reference`
        )
      }
      node = decodeRlp(raw)
    } else {
      node = ref
    }
    if (!Array.isArray(node)) throw new ProofError("node is not a list")

    if (node.length === 17) {
      if (pos >= key.length) throw new ProofError("key exhausted at a branch")
      ref = node[key[pos++]]
      continue
    }
    if (node.length === 2) {
      const encodedPath: RlpItem = node[0]
      const child: RlpItem = node[1]
      if (typeof encodedPath !== "string") throw new ProofError("bad path")
      const { nibbles, leaf } = decodePath(encodedPath)
      const matches =
        pos + nibbles.length <= key.length &&
        nibbles.every((n, j) => n === key[pos + j])
      if (leaf) {
        if (!matches || pos + nibbles.length !== key.length) return undefined
        if (typeof child !== "string") throw new ProofError("bad leaf value")
        return child
      }
      if (!matches) return undefined
      pos += nibbles.length
      ref = child
      continue
    }
    throw new ProofError(`node has ${node.length} items`)
  }
}

const rlpUint = (hex: Hex) => (hex === "0x" ? 0n : hexToBigInt(hex))

export type ProvenAccount = {
  address: Address
  nonce: bigint
  balance: bigint
  storageRoot: Hex
  codeHash: Hex
}

/** Proves an account against a state root; checks the RPC's claimed fields too. */
export function verifyAccountProof(
  stateRoot: Hex,
  address: Address,
  accountProof: readonly Hex[],
  claimed: { balance: bigint; nonce: number; storageHash: Hex; codeHash: Hex }
): ProvenAccount {
  const value = verifyMerkleProof(stateRoot, keccak256(address), accountProof)
  if (value === undefined) throw new ProofError(`account ${address} is absent`)
  const fields = decodeRlp(value)
  if (!Array.isArray(fields) || fields.length !== 4) {
    throw new ProofError(
      "account is not [nonce, balance, storageRoot, codeHash]"
    )
  }
  const [nonce, balance, storageRoot, codeHash] = fields as Hex[]
  const account = {
    address,
    nonce: rlpUint(nonce),
    balance: rlpUint(balance),
    storageRoot,
    codeHash,
  }
  if (
    account.balance !== claimed.balance ||
    account.nonce !== BigInt(claimed.nonce) ||
    account.storageRoot !== claimed.storageHash.toLowerCase() ||
    account.codeHash !== claimed.codeHash.toLowerCase()
  ) {
    throw new ProofError("RPC's account fields don't match the proven account")
  }
  return account
}

export const slotKey = (slot: bigint): Hex => numberToHex(slot, { size: 32 })

/** keccak256(pad(holder) ++ pad(slot)): storage key of mapping[holder]. */
export const mappingSlot = (holder: Address, slot: bigint): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [holder, slot]
    )
  )

/** Proves one storage slot against an already-proven storage root. */
export function verifyStorageProof(
  storageRoot: Hex,
  key: Hex,
  proof: readonly Hex[]
): bigint {
  const value = verifyMerkleProof(storageRoot, keccak256(key), proof)
  if (value === undefined) return 0n // absent slot = zero
  const decoded = decodeRlp(value)
  if (typeof decoded !== "string") throw new ProofError("bad storage value")
  return rlpUint(decoded)
}

export type ProofCheck = {
  label: string
  proven: bigint
  reported: bigint
  ok: boolean
}

export type ReadingProof = {
  block: BlockHeader
  accounts: ProvenAccount[]
  checks: ProofCheck[]
  /** Every reported value equals its proven value. */
  ok: boolean
  rpcCalls: number
}

const MASK_112 = (1n << 112n) - 1n
const MASK_160 = (1n << 160n) - 1n
const MASK_255 = (1n << 255n) - 1n

async function proveStorage(
  client: EthClient,
  block: BlockHeader,
  address: Address,
  slots: readonly Hex[]
) {
  const res = await client.getProof({
    address,
    storageKeys: [...slots],
    blockNumber: block.number,
  })
  const account = verifyAccountProof(
    block.stateRoot,
    address,
    res.accountProof,
    res
  )
  const values = slots.map((slot) => {
    const sp = res.storageProof.find((p) => BigInt(p.key) === BigInt(slot))
    if (!sp) throw new ProofError(`RPC omitted the proof for slot ${slot}`)
    const proven = verifyStorageProof(account.storageRoot, slot, sp.proof)
    if (proven !== sp.value) {
      throw new ProofError(
        `RPC's value for slot ${slot} doesn't match its proof`
      )
    }
    return proven
  })
  return { account, values }
}

/**
 * Re-derives the pool values behind a price from eth_getProof, verified
 * against the block's stateRoot, and compares them with what eth_call (or
 * the event log) reported. Trusts the header's stateRoot as served by the
 * RPC — verifying the header itself is a separate step.
 */
export async function proveReading(
  client: EthClient,
  block: BlockHeader,
  pool: PoolInfo,
  reading: PoolReading,
  source: PriceSource
): Promise<ReadingProof> {
  const check = (label: string, proven: bigint, reported: bigint) => ({
    label,
    proven,
    reported,
    ok: proven === reported,
  })
  let accounts: ProvenAccount[]
  let checks: ProofCheck[]
  let rpcCalls = 1

  if (reading.kind === "v3") {
    const { account, values } = await proveStorage(
      client,
      block,
      pool.address,
      [slotKey(STORAGE_SLOTS.v3Slot0), slotKey(STORAGE_SLOTS.v3Liquidity)]
    )
    accounts = [account]
    checks = [
      check(
        "sqrtPriceX96 (slot 0)",
        values[0] & MASK_160,
        reading.sqrtPriceX96
      ),
    ]
    // A Swap event's liquidity can be stale (mint/burn don't emit Swap), so
    // only compare it when the reading came from state.
    if (source.kind === "state") {
      checks.push(check("liquidity (slot 4)", values[1], reading.liquidity))
    }
  } else if (reading.kind === "v2") {
    const { account, values } = await proveStorage(
      client,
      block,
      pool.address,
      [slotKey(STORAGE_SLOTS.v2Reserves)]
    )
    accounts = [account]
    checks = [
      check(
        "reserve0 USDC (slot 8)",
        values[0] & MASK_112,
        reading.reserveUsdc
      ),
      check(
        "reserve1 WETH (slot 8)",
        (values[0] >> 112n) & MASK_112,
        reading.reserveWeth
      ),
    ]
  } else {
    // ETH reserve = exchange account balance; USDC reserve = USDC.balances[exchange].
    const [exchange, usdc] = await Promise.all([
      proveStorage(client, block, pool.address, []),
      proveStorage(client, block, USDC, [
        mappingSlot(pool.address, STORAGE_SLOTS.usdcBalances),
      ]),
    ])
    rpcCalls = 2
    accounts = [exchange.account, usdc.account]
    checks = [
      check(
        "ETH reserve (balance)",
        exchange.account.balance,
        reading.reserveEth
      ),
      check(
        "USDC reserve (slot 9)",
        usdc.values[0] & MASK_255,
        reading.reserveUsdc
      ),
    ]
  }

  return { block, accounts, checks, ok: checks.every((c) => c.ok), rpcCalls }
}
