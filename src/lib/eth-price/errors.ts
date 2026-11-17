import { BaseError } from "viem"

/** Collects every message in an error's cause chain (viem nests RPC errors). */
function messagesOf(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 10; depth++) {
    if (current instanceof BaseError) {
      parts.push(current.shortMessage, current.details)
    } else if (current instanceof Error) {
      parts.push(current.message)
    }
    current = (current as { cause?: unknown }).cause
  }
  return parts.filter(Boolean).join(" | ")
}

/**
 * Node can't serve state at that block (it isn't an archive node, or the
 * state has been pruned). Wording differs per client; these cover geth,
 * reth, erigon, nethermind, besu and the common hosted providers.
 */
const MISSING_STATE =
  /missing trie node|historical state .*not available|state .*(not available|unavailable|pruned)|required historical state|header not found|archive|pruned|state histories|not (an )?archive|distance to target block exceeds|block .*not found|unknown block/i

export function isMissingStateError(error: unknown): boolean {
  return MISSING_STATE.test(messagesOf(error))
}

/** Provider refused eth_getLogs because the block range / result set is too big. */
const LOG_RANGE =
  /block range|range (is )?too (large|big|wide)|too many (blocks|results|logs)|query returned more than|exceed(s|ed)? (the )?(max|maximum|limit)|response size|limited to|up to a \d+ block/i
const RATE_LIMIT = /rate.?limit|too many requests|429/i

export function isLogRangeError(error: unknown): boolean {
  const msg = messagesOf(error)
  return LOG_RANGE.test(msg) && !RATE_LIMIT.test(msg)
}

/** Pre-merge receipts are commonly dropped by non-archive nodes (EIP-4444). */
export function isPrunedHistoryError(error: unknown): boolean {
  return /pruned|history.*(expired|unavailable)|4444/i.test(messagesOf(error))
}

export class PriceLookupError extends Error {
  readonly hint?: string
  constructor(message: string, options?: { hint?: string; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = "PriceLookupError"
    this.hint = options?.hint
  }
}

export function describeError(error: unknown): {
  title: string
  hint?: string
} {
  if (error instanceof PriceLookupError) {
    return { title: error.message, hint: error.hint }
  }
  if (error instanceof BaseError) {
    return { title: error.shortMessage, hint: error.details || undefined }
  }
  if (error instanceof Error) return { title: error.message }
  return { title: String(error) }
}
