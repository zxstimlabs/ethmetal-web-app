import { createContext, useContext, useSyncExternalStore } from "react"

import type { BudgetStats, RequestBudget } from "@/lib/rpc-budget"

export const RpcBudgetContext = createContext<RequestBudget | null>(null)

/** Live request-budget stats for the active RPC. */
export function useRpcBudget(): BudgetStats {
  const budget = useContext(RpcBudgetContext)
  if (!budget) throw new Error("useRpcBudget needs RpcBudgetContext")
  return useSyncExternalStore(budget.subscribe, budget.getSnapshot)
}
