import { ServerIcon } from "lucide-react"
import { useId, useState } from "react"
import { useBlockNumber } from "wagmi"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useRpcBudget } from "@/hooks/use-rpc-budget"
import {
  type ActiveRpc,
  DEFAULT_TRANSPORT_SETTINGS,
  displayRpcHost,
  ENV_RPC_URL,
  type StoredTransportSettings,
  validateRpcUrl,
} from "@/lib/rpc"
import { cn } from "@/lib/utils"
import { PUBLIC_ARCHIVE_RPCS } from "@/lib/wagmi"

const SOURCE_LABEL: Record<ActiveRpc["source"], string> = {
  custom: "Custom",
  env: ".env.local",
  public: "Public",
}

function rpcLabel(rpc: ActiveRpc): string {
  return rpc.url ? displayRpcHost(rpc.url) : "public archive RPCs"
}

function BudgetMeter() {
  const b = useRpcBudget()
  const pct = Math.min(100, (b.lastMinute / b.perMinute) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">HTTP requests, last 60s</span>
        <span className="tabular-nums">
          {b.lastMinute} / {b.perMinute}
        </span>
      </div>
      <div
        className="h-1.5 w-full bg-muted"
        role="meter"
        aria-label="Requests used in the last minute"
        aria-valuemin={0}
        aria-valuemax={b.perMinute}
        aria-valuenow={b.lastMinute}
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted-foreground tabular-nums">
        This session: {b.httpRequests} requests carrying {b.rpcCalls} RPC calls
        {b.queued > 0 && ` · ${b.queued} waiting for budget`}
      </span>
    </div>
  )
}

type RpcSettingsProps = {
  rpc: ActiveRpc
  onChange: (url: string | undefined) => void
  settings: StoredTransportSettings
  onSettingsChange: (settings: StoredTransportSettings) => void
}

export function RpcSettings({
  rpc,
  onChange,
  settings,
  onSettingsChange,
}: RpcSettingsProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string>()
  // Polling spends budget too; every 30s is plenty for a status dot.
  const head = useBlockNumber({ query: { refetchInterval: 30_000 } })

  const status = head.isError ? "error" : head.data ? "ok" : "pending"

  function save() {
    const problem = validateRpcUrl(draft)
    if (problem) return setError(problem)
    onChange(draft.trim())
    setDraft("")
    setError(undefined)
    setOpen(false)
  }

  const limitInput = (key: "perSecond" | "perMinute", label: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        type="number"
        min={1}
        step={1}
        defaultValue={settings[key]}
        onBlur={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n > 0 && n !== settings[key]) {
            onSettingsChange({ ...settings, [key]: n })
          } else {
            e.target.value = String(settings[key])
          }
        }}
      />
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="max-w-full font-normal" />}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "ok" && "bg-emerald-500",
            status === "pending" && "animate-pulse bg-amber-500",
            status === "error" && "bg-destructive"
          )}
        />
        <span className="truncate">{rpcLabel(rpc)}</span>
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          {head.data !== undefined
            ? `#${head.data.toLocaleString("en-US")}`
            : status === "error"
              ? "unreachable"
              : "…"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2">
            <ServerIcon className="size-4" /> Mainnet RPC
          </PopoverTitle>
          <PopoverDescription>
            Use an <strong>archive</strong> node for historical lookups. A full
            node only works for recent blocks; older ones fall back to event
            logs if the node still has them.
          </PopoverDescription>
        </PopoverHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Source</dt>
          <dd>{SOURCE_LABEL[rpc.source]}</dd>
          <dt className="text-muted-foreground">Host</dt>
          <dd className="truncate">
            {rpc.url
              ? displayRpcHost(rpc.url)
              : PUBLIC_ARCHIVE_RPCS.map((r) => displayRpcHost(r.url)).join(
                  ", "
                )}
          </dd>
          <dt className="text-muted-foreground">Head</dt>
          <dd className="tabular-nums">
            {head.data !== undefined ? (
              `#${head.data.toLocaleString("en-US")}`
            ) : status === "error" ? (
              <span className="text-destructive">unreachable</span>
            ) : (
              "…"
            )}
          </dd>
        </dl>

        <BudgetMeter />

        <div className="flex flex-col gap-2 border-t pt-2.5">
          <div className="grid grid-cols-2 gap-2">
            {limitInput("perSecond", "Max requests / s")}
            {limitInput("perMinute", "Max requests / min")}
          </div>
          <label className="flex items-center justify-between gap-2">
            <span>
              Batch JSON-RPC calls
              <span className="block text-muted-foreground">
                A chart becomes one HTTP request
              </span>
            </span>
            <Switch
              checked={settings.batch}
              onCheckedChange={(batch) =>
                onSettingsChange({ ...settings, batch })
              }
            />
          </label>
          {(settings.perSecond !== DEFAULT_TRANSPORT_SETTINGS.perSecond ||
            settings.perMinute !== DEFAULT_TRANSPORT_SETTINGS.perMinute ||
            settings.batch !== DEFAULT_TRANSPORT_SETTINGS.batch) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSettingsChange(DEFAULT_TRANSPORT_SETTINGS)}
            >
              Reset limits
            </Button>
          )}
        </div>

        <form
          className="flex flex-col gap-1.5 border-t pt-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Label htmlFor={`${id}-url`}>Custom RPC URL</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-url`}
              type="url"
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setDraft(e.target.value)
                setError(undefined)
              }}
            />
            <Button type="submit" disabled={!draft.trim()}>
              Use
            </Button>
          </div>
          {error && <p className="text-destructive">{error}</p>}
          <p className="text-muted-foreground">
            Saved in this browser only. Requests go straight from your browser
            to the RPC.
          </p>
        </form>

        {rpc.source === "custom" && (
          <Button
            variant="ghost"
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
          >
            Reset to {ENV_RPC_URL ? ".env.local RPC" : "public RPCs"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
