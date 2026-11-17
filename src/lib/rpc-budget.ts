/**
 * Client-side RPC request budget, enforced at the fetch layer so it counts
 * exactly what rate limiters count: HTTP requests (a JSON-RPC batch of 40
 * eth_calls is ONE request), including viem's own retries.
 *
 * Browsers usually can't read RateLimit-* / Retry-After headers (they must be
 * listed in Access-Control-Expose-Headers), so the budget is tracked locally
 * with sliding one-second and one-minute windows. Requests over budget wait.
 */

export type BudgetLimits = { perSecond: number; perMinute: number }

export type BudgetStats = BudgetLimits & {
  /** HTTP requests sent in the last 60s. */
  lastMinute: number
  /** Requests currently waiting for budget. */
  queued: number
  /** Totals since the page loaded. */
  httpRequests: number
  rpcCalls: number
}

export const DEFAULT_LIMITS: BudgetLimits = { perSecond: 10, perMinute: 180 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Number of JSON-RPC calls in a request body (array = batch). */
function countCalls(body: unknown): number {
  if (typeof body !== "string") return 1
  return body.trimStart().startsWith("[")
    ? Math.max(1, (body.match(/"jsonrpc"/g) ?? []).length)
    : 1
}

export class RequestBudget {
  private stamps: number[] = []
  private listeners = new Set<() => void>()
  private snapshot: BudgetStats
  private queued = 0
  private httpRequests = 0
  private rpcCalls = 0
  private ticker?: ReturnType<typeof setInterval>
  readonly limits: BudgetLimits

  constructor(limits: BudgetLimits = DEFAULT_LIMITS) {
    this.limits = limits
    this.snapshot = this.compute()
  }

  private prune(now: number) {
    while (this.stamps.length && now - this.stamps[0] >= 60_000) {
      this.stamps.shift()
    }
  }

  private compute(): BudgetStats {
    this.prune(performance.now())
    return {
      ...this.limits,
      lastMinute: this.stamps.length,
      queued: this.queued,
      httpRequests: this.httpRequests,
      rpcCalls: this.rpcCalls,
    }
  }

  private emit() {
    this.snapshot = this.compute()
    for (const l of this.listeners) l()
  }

  /** Waits until one more HTTP request fits in both windows, then records it. */
  async acquire(calls = 1): Promise<void> {
    const { perSecond, perMinute } = this.limits
    this.queued++
    this.emit()
    for (;;) {
      const now = performance.now()
      this.prune(now)
      const n = this.stamps.length
      const inLastSecond = n - this.stamps.findIndex((t) => now - t < 1000)
      const secondCount = inLastSecond > n ? 0 : inLastSecond
      if (n < perMinute && secondCount < perSecond) break
      const waitMs =
        n >= perMinute
          ? this.stamps[0] + 60_000 - now
          : this.stamps[n - perSecond] + 1000 - now
      await sleep(Math.max(waitMs, 5))
    }
    this.stamps.push(performance.now())
    this.queued--
    this.httpRequests++
    this.rpcCalls += calls
    this.emit()
  }

  /** A fetch that spends budget first; pass to viem's http({ fetchFn }). */
  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    await this.acquire(countCalls(init?.body))
    return fetch(input, init)
  }

  // useSyncExternalStore plumbing. Ticks while requests are in the window so
  // "last minute" counts down as they age out.
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    this.ticker ??= setInterval(() => this.emit(), 2_000)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.ticker) {
        clearInterval(this.ticker)
        this.ticker = undefined
      }
    }
  }

  readonly getSnapshot = () => this.snapshot
}
