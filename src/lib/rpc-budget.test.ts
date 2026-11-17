import { describe, expect, test } from "bun:test"

import { RequestBudget } from "./rpc-budget"

describe("RequestBudget", () => {
  test("allows up to perSecond immediately, then spaces the rest", async () => {
    const budget = new RequestBudget({ perSecond: 5, perMinute: 100 })
    const t0 = performance.now()
    await Promise.all(Array.from({ length: 5 }, () => budget.acquire()))
    expect(performance.now() - t0).toBeLessThan(100)
    await budget.acquire()
    // The 6th must wait for the first to leave the 1s window.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(990)
    expect(budget.getSnapshot().lastMinute).toBe(6)
  })

  test("never exceeds perMinute inside the window", async () => {
    const budget = new RequestBudget({ perSecond: 100, perMinute: 3 })
    await Promise.all(Array.from({ length: 3 }, () => budget.acquire()))
    let fourth = false
    void budget.acquire().then(() => (fourth = true))
    await new Promise((r) => setTimeout(r, 200))
    expect(fourth).toBe(false)
    expect(budget.getSnapshot().queued).toBe(1)
  })

  test("counts batch bodies as one request with many calls", async () => {
    const budget = new RequestBudget({ perSecond: 10, perMinute: 10 })
    const body = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "eth_call",
        params: [],
      }))
    )
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("[]")) as unknown as typeof fetch
    try {
      await budget.fetch("http://rpc.test", { method: "POST", body })
    } finally {
      globalThis.fetch = original
    }
    const s = budget.getSnapshot()
    expect(s.httpRequests).toBe(1)
    expect(s.rpcCalls).toBe(40)
  })
})
