import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MoonIcon, SunIcon } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { WagmiProvider } from "wagmi"

import { DateTimePicker } from "@/components/date-time-picker"
import { PriceResult } from "@/components/price-result"
import { RpcSettings } from "@/components/rpc-settings"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useEthPrice } from "@/hooks/use-eth-price"
import { RpcBudgetContext } from "@/hooks/use-rpc-budget"
import { EARLIEST_PRICE } from "@/lib/eth-price"
import {
  type ActiveRpc,
  loadCustomRpc,
  loadTransportSettings,
  resolveRpc,
  saveCustomRpc,
  saveTransportSettings,
  type StoredTransportSettings,
} from "@/lib/rpc"
import { formatUtc, nowSeconds, type TimeZoneMode } from "@/lib/time"
import { createReadOnlyConfig } from "@/lib/wagmi"

const queryClient = new QueryClient()

// recharts is the heaviest dependency; load it with the chart.
const PriceChart = lazy(() => import("@/components/price-chart"))

/** First instant any pool had liquidity: Uniswap v1's first USDC deposit. */
const MIN_TIMESTAMP = Number(EARLIEST_PRICE.timestamp)

const PRESETS: { label: string; at: () => number }[] = [
  { label: "Now", at: nowSeconds },
  { label: "The Merge", at: () => 1663224179 },
  { label: "Nov 2021 ATH", at: () => Date.UTC(2021, 10, 10, 14) / 1000 },
  { label: "DeFi Summer", at: () => Date.UTC(2020, 7, 1) / 1000 },
  { label: "Black Thursday (v1)", at: () => Date.UTC(2020, 2, 12, 12) / 1000 },
  { label: "Earliest", at: () => MIN_TIMESTAMP },
]

function targetFromUrl(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get("t")
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined
  return Number(raw)
}

function writeTargetToUrl(unix: number) {
  const url = new URL(window.location.href)
  url.searchParams.set("t", String(unix))
  window.history.replaceState(null, "", url)
}

export function App() {
  const [customRpc, setCustomRpc] = useState(loadCustomRpc)
  const [settings, setSettings] = useState(loadTransportSettings)
  const rpc = resolveRpc(customRpc)
  const { config, budget } = useMemo(
    () => createReadOnlyConfig(rpc.url, settings),
    [rpc.url, settings]
  )

  const changeRpc = (url: string | undefined) => {
    saveCustomRpc(url)
    setCustomRpc(url)
  }
  const changeSettings = (next: StoredTransportSettings) => {
    saveTransportSettings(next)
    setSettings(next)
  }

  return (
    // Remount when the transport changes so every wagmi hook picks it up.
    <WagmiProvider
      config={config}
      key={`${rpc.key}|${settings.perSecond}|${settings.perMinute}|${settings.batch}`}
      reconnectOnMount={false}
    >
      <QueryClientProvider client={queryClient}>
        <RpcBudgetContext.Provider value={budget}>
          <PriceExplorer
            rpc={rpc}
            onRpcChange={changeRpc}
            settings={settings}
            onSettingsChange={changeSettings}
          />
        </RpcBudgetContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function ThemeToggle() {
  const { setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() =>
        setTheme(
          document.documentElement.classList.contains("dark") ? "light" : "dark"
        )
      }
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </Button>
  )
}

function PriceExplorer({
  rpc,
  onRpcChange,
  settings,
  onSettingsChange,
}: {
  rpc: ActiveRpc
  onRpcChange: (url: string | undefined) => void
  settings: StoredTransportSettings
  onSettingsChange: (settings: StoredTransportSettings) => void
}) {
  const [initialTarget] = useState(targetFromUrl)
  const [tz, setTz] = useState<TimeZoneMode>("utc")
  const [draft, setDraft] = useState(() => initialTarget ?? nowSeconds())
  const [target, setTarget] = useState(initialTarget)
  const [now, setNow] = useState(nowSeconds)

  const query = useEthPrice(target, rpc.key)

  const draftProblem =
    draft > now
      ? "That's in the future."
      : draft < MIN_TIMESTAMP
        ? `Nothing to price before ${formatUtc(MIN_TIMESTAMP)}, when the first Uniswap pool (v1 USDC) got liquidity.`
        : undefined

  function lookUp(unix: number) {
    setNow(nowSeconds())
    setDraft(unix)
    if (unix === target) void query.refetch()
    setTarget(unix)
    writeTargetToUrl(unix)
  }

  const status =
    target === undefined
      ? "idle"
      : query.isFetching
        ? "pending"
        : query.isError
          ? "error"
          : query.isSuccess
            ? "success"
            : "pending"

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-medium">ethmetal</h1>
          <p className="text-xs text-muted-foreground">
            ETH/USDC at any moment since 2019, from chain state
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <RpcSettings
            rpc={rpc}
            onChange={onRpcChange}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
          <ThemeToggle />
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!draftProblem) lookUp(draft)
            }}
          >
            <DateTimePicker
              value={draft}
              onChange={(unix) => {
                setNow(nowSeconds())
                setDraft(unix)
              }}
              tz={tz}
              onTzChange={setTz}
              min={MIN_TIMESTAMP}
              max={now}
            />
            <Button type="submit" disabled={!!draftProblem}>
              Get price
            </Button>
          </form>

          {draftProblem ? (
            <p className="text-xs text-destructive">{draftProblem}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Earliest: {formatUtc(MIN_TIMESTAMP)}, the first Uniswap v1 USDC
              liquidity. Latest: the current block.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Jump to</span>
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                variant="outline"
                size="xs"
                onClick={() => lookUp(p.at())}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <PriceResult
        status={status}
        data={query.data}
        error={query.error}
        progress={query.progress}
        onRetry={() => void query.refetch()}
      />

      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <PriceChart rpcKey={rpc.key} selected={target} onSelect={lookUp} />
      </Suspense>

      <footer className="mt-auto text-xs text-muted-foreground">
        No wallet, no backend: your browser queries the RPC directly. Prices are
        Uniswap v1/v2/v3 spot prices from on-chain state at each block, from
        pools verified against their factories.
      </footer>
    </div>
  )
}

export default App
