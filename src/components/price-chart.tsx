import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { formatUnits } from "viem"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { CHART_INTERVALS, usePriceSeries } from "@/hooks/use-price-series"
import {
  describeError,
  EARLIEST_PRICE,
  formatPriceUsd,
  PRICE_DECIMALS,
  type PoolReading,
  THIN_POOL_USDC,
} from "@/lib/eth-price"
import { formatUtc, nowSeconds } from "@/lib/time"

const DAY = 86_400

const RANGES = [
  { key: "1D", label: "1D", seconds: DAY },
  { key: "1W", label: "1W", seconds: 7 * DAY },
  { key: "1M", label: "1M", seconds: 30 * DAY },
  { key: "1Y", label: "1Y", seconds: 365 * DAY },
  { key: "All", label: "All", seconds: undefined },
] as const

type RangeKey = (typeof RANGES)[number]["key"]

const chartConfig = {
  price: { label: "ETH/USDC", color: "var(--primary)" },
} satisfies ChartConfig

type Datum = {
  t: number
  price: number
  exact: bigint
  block: bigint
  pool: string
  thin: boolean
}

const isThin = (r: PoolReading) =>
  r.kind !== "v3" && r.reserveUsdc < THIN_POOL_USDC

function tickFormatter(range: RangeKey) {
  const opts: Intl.DateTimeFormatOptions =
    range === "1D"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : range === "1W" || range === "1M"
        ? { month: "short", day: "numeric" }
        : range === "1Y"
          ? { month: "short", year: "2-digit" }
          : { year: "numeric" }
  const f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" })
  return (t: number) => f.format(new Date(t * 1000))
}

const usd = (v: number) =>
  v >= 10_000
    ? `$${Math.round(v / 1000)}K`
    : `$${Math.round(v).toLocaleString("en-US")}`

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: readonly { payload?: Datum }[]
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className="grid min-w-44 gap-1 border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{formatUtc(d.t)}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Price</span>
        <span className="tabular-nums">{formatPriceUsd(d.exact)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Block</span>
        <span className="tabular-nums">#{d.block.toLocaleString("en-US")}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Pool</span>
        <span>Uniswap {d.pool}</span>
      </div>
      {d.thin && <div className="text-muted-foreground">⚠ thin pool</div>}
      <div className="pt-0.5 text-muted-foreground">Click to inspect</div>
    </div>
  )
}

type PriceChartProps = {
  rpcKey: string
  /** Currently inspected timestamp, marked on the chart. */
  selected?: number
  onSelect: (unix: number) => void
}

export default function PriceChart({
  rpcKey,
  selected,
  onSelect,
}: PriceChartProps) {
  const [range, setRange] = useState<RangeKey>("1M")
  const [now] = useState(nowSeconds)
  const spec = RANGES.find((r) => r.key === range)!
  const from =
    spec.seconds === undefined
      ? Number(EARLIEST_PRICE.timestamp)
      : now - spec.seconds

  const series = usePriceSeries(from, rpcKey, range)
  const data = useMemo<Datum[]>(
    () =>
      (series.data?.points ?? []).map((p) => ({
        t: Number(p.timestamp),
        price: Number(formatUnits(p.price, PRICE_DECIMALS)),
        exact: p.price,
        block: p.blockNumber,
        pool: p.pool,
        thin: isThin(p.reading),
      })),
    [series.data]
  )
  const format = useMemo(() => tickFormatter(range), [range])
  // "All" labels years only, so put its ticks on Jan 1 (auto ticks repeat a year).
  const yearTicks = useMemo(() => {
    if (range !== "All" || data.length < 2) return undefined
    const first = new Date(data[0].t * 1000).getUTCFullYear() + 1
    const last = new Date(data[data.length - 1].t * 1000).getUTCFullYear()
    const ticks: number[] = []
    for (let y = first; y <= last; y++) ticks.push(Date.UTC(y, 0, 1) / 1000)
    return ticks
  }, [range, data])
  const pools = [...new Set(data.map((d) => d.pool))].sort().reverse()
  const showMarker =
    selected !== undefined &&
    data.length > 1 &&
    selected >= data[0].t &&
    selected <= data[data.length - 1].t

  return (
    <Card>
      <CardHeader>
        <CardTitle>ETH/USDC history</CardTitle>
        <CardDescription>
          {CHART_INTERVALS + 1} samples, each one a state read at a past block.
          Times in UTC.
        </CardDescription>
        <CardAction>
          <div className="flex" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? "secondary" : "outline"}
                aria-pressed={range === r.key}
                className="-ml-px first:ml-0"
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent>
        {series.isError ? (
          <div className="flex h-56 flex-col items-start justify-center gap-2">
            <p className="text-destructive">
              {describeError(series.error).title}
            </p>
            {describeError(series.error).hint && (
              <p className="text-muted-foreground">
                {describeError(series.error).hint}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void series.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : series.isPending ? (
          <div className="flex h-56 flex-col gap-2" aria-busy="true">
            <Skeleton className="h-full w-full" />
            <span className="text-muted-foreground">
              Reading {CHART_INTERVALS + 1} historical blocks
              {series.progress
                ? ` · ${series.progress.done}/${series.progress.total}`
                : "…"}
            </span>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-56 w-full"
            aria-label={`ETH/USDC price chart, ${range}`}
          >
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              className="cursor-pointer"
              onClick={(state) => {
                const i = Number(state?.activeTooltipIndex)
                if (Number.isInteger(i) && data[i]) onSelect(data[i].t)
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={format}
                ticks={yearTicks}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
                tickMargin={8}
              />
              <YAxis
                dataKey="price"
                domain={["auto", "auto"]}
                tickFormatter={usd}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <ChartTooltip
                cursor={{ strokeWidth: 1 }}
                content={(props) => (
                  <PointTooltip
                    active={props.active}
                    payload={props.payload as readonly { payload?: Datum }[]}
                  />
                )}
              />
              {showMarker && (
                <ReferenceLine
                  x={selected}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                />
              )}
              <Line
                dataKey="price"
                type="linear"
                stroke="var(--color-price)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>

      {series.data && !series.isError && (
        <CardFooter className="flex-col items-start gap-2 border-t pt-3 text-muted-foreground">
          <p>
            {series.data.points.length} points from Uniswap {pools.join(" / ")}{" "}
            · {series.data.rpcCalls} RPC calls, sent as batched requests ·{" "}
            {(series.data.elapsedMs / 1000).toFixed(2)}s
            {series.isFetching && " · refreshing…"}
          </p>
          {series.data.missing > 0 && (
            <p>
              {series.data.missing} samples skipped: the RPC has no archive
              state that far back.
            </p>
          )}
          <details className="w-full">
            <summary className="cursor-pointer select-none hover:text-foreground">
              Data table
            </summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="sticky top-0 bg-card">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Time (UTC)</th>
                    <th className="py-1 pr-3 font-medium">Block</th>
                    <th className="py-1 pr-3 font-medium">Pool</th>
                    <th className="py-1 text-right font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr
                      key={d.block.toString()}
                      className="cursor-pointer border-t border-border/50 hover:text-foreground"
                      onClick={() => onSelect(d.t)}
                    >
                      <td className="py-1 pr-3">{formatUtc(d.t)}</td>
                      <td className="py-1 pr-3">
                        #{d.block.toLocaleString("en-US")}
                      </td>
                      <td className="py-1 pr-3">
                        {d.pool}
                        {d.thin && " ⚠"}
                      </td>
                      <td className="py-1 text-right">
                        {formatPriceUsd(d.exact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardFooter>
      )}
    </Card>
  )
}
