import { useMutation } from "@tanstack/react-query"
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { usePublicClient } from "wagmi"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  describeError,
  type EthPriceResult,
  formatPriceExact,
  formatPriceUsd,
  type Progress,
  proveReading,
  type ReadingProof,
  THIN_POOL_USDC,
} from "@/lib/eth-price"
import { formatDuration, formatLocal, formatUtc } from "@/lib/time"

const ETHERSCAN = "https://etherscan.io"
const fmtInt = (n: bigint | number) => n.toLocaleString("en-US")
const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
    >
      {children}
      <ArrowUpRightIcon className="size-3 text-muted-foreground" />
    </a>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

function progressText(p: Progress | undefined): string {
  if (!p || p.stage === "chain") return "Checking the RPC is on mainnet…"
  if (p.stage === "block") {
    if (p.lo === undefined || p.hi === undefined) return "Finding the block…"
    return `Finding the block · probe ${p.probes} · ${fmtInt(p.hi - p.lo)} block window`
  }
  return p.via === "state"
    ? `Reading ${p.pool.label} state at the block…`
    : `No archive state; scanning ${p.pool.label} event logs…`
}

/** Mirrors the result layout so nothing jumps when data arrives. */
function ResultSkeleton({ progress }: { progress?: Progress }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-3 w-36" />
        <Skeleton className="mt-1 h-10 w-52" />
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-5 w-28" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-3">
          {[40, 56, 48, 64, 52].map((w, i) => (
            <div key={i} className="contents">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground" role="status">
          {progressText(progress)}
        </p>
      </CardContent>
    </Card>
  )
}

function readVia(data: EthPriceResult): ReactNode {
  const { pool, source, block } = data
  if (source.kind === "event") {
    return (
      <>
        {source.eventName} at #{fmtInt(source.blockNumber)} in{" "}
        <ExternalLink href={`${ETHERSCAN}/tx/${source.transactionHash}`}>
          {short(source.transactionHash)}
        </ExternalLink>
        <span className="block text-muted-foreground">
          The RPC had no archive state, so this is the last {source.eventName}{" "}
          at or before the block. Same value as the state read.
        </span>
      </>
    )
  }
  const calls =
    pool.kind === "v3"
      ? "slot0() + liquidity() + observe()"
      : pool.kind === "v2"
        ? "getReserves()"
        : "eth_getBalance + USDC.balanceOf()"
  return (
    <>
      {pool.kind === "v1" ? calls : `eth_call ${calls}`} at #
      {fmtInt(block.number)} (state after the block)
    </>
  )
}

function TwapRow({ data }: { data: EthPriceResult }) {
  if (data.pool.kind !== "v3") {
    return <Row label="30-min TWAP">— (v3 pools only)</Row>
  }
  if (!data.twap) {
    return <Row label="30-min TWAP">— (needs archive state)</Row>
  }
  if (!data.twap.available) {
    return (
      <Row label="30-min TWAP">
        unavailable
        <span className="block text-muted-foreground">{data.twap.reason}</span>
      </Row>
    )
  }
  const diffBps = Number(
    ((data.twap.price - data.price) * 10_000n) / data.price
  )
  return (
    <Row label="30-min TWAP">
      <span className="tabular-nums">{formatPriceUsd(data.twap.price)}</span>{" "}
      <span className="text-muted-foreground">
        ({diffBps >= 0 ? "+" : ""}
        {(diffBps / 100).toFixed(2)}% vs spot)
      </span>
      <span className="block text-muted-foreground">
        observe([1800, 0]) → mean tick {data.twap.meanTick}
      </span>
    </Row>
  )
}

function ProofPanel({ data }: { data: EthPriceResult }) {
  const client = usePublicClient()
  const prove = useMutation<ReadingProof>({
    mutationFn: () =>
      proveReading(client!, data.block, data.pool, data.reading, data.source),
  })

  if (prove.isIdle) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!client}
          onClick={() => prove.mutate()}
        >
          <ShieldCheckIcon /> Verify with eth_getProof
        </Button>
        <span className="text-muted-foreground">
          Merkle-proves these pool values against block #
          {fmtInt(data.block.number)}&apos;s stateRoot.
        </span>
      </div>
    )
  }

  if (prove.isPending) {
    return (
      <div className="flex flex-col gap-2 border-t pt-3" aria-busy="true">
        <Skeleton className="h-3.5 w-64" />
        <Skeleton className="h-3.5 w-80" />
        <Skeleton className="h-3.5 w-72" />
      </div>
    )
  }

  if (prove.isError) {
    const { title, hint } = describeError(prove.error)
    return (
      <div className="flex flex-col gap-1 border-t pt-3">
        <p className="flex items-center gap-1.5 text-destructive">
          <CircleXIcon className="size-4" /> Proof failed: {title}
        </p>
        {hint && <p className="break-words text-muted-foreground">{hint}</p>}
        <p className="text-muted-foreground">
          Historical eth_getProof needs an archive node that serves proofs for
          old blocks; many only prove recent ones.
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={() => prove.mutate()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const proof = prove.data
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p
        className={
          proof.ok
            ? "flex items-center gap-1.5 font-medium"
            : "flex items-center gap-1.5 font-medium text-destructive"
        }
      >
        {proof.ok ? (
          <CircleCheckIcon className="size-4" />
        ) : (
          <CircleXIcon className="size-4" />
        )}
        {proof.ok
          ? "Proven: every value matches the state trie"
          : "Mismatch: the RPC's values disagree with its own proof"}
      </p>
      <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-1 break-all">
        {proof.checks.map((c) => (
          <Row key={c.label} label={c.label}>
            <span className={c.ok ? undefined : "text-destructive"}>
              {c.ok ? "✓" : "✗"} {c.proven.toString()}
              {!c.ok && ` (RPC said ${c.reported})`}
            </span>
          </Row>
        ))}
        <Row label="stateRoot">{proof.block.stateRoot}</Row>
        {proof.accounts.map((a) => (
          <Row key={a.address} label={`storageRoot ${short(a.address)}`}>
            {a.storageRoot}
          </Row>
        ))}
      </dl>
      <p className="text-muted-foreground">
        Checked locally: each proof node hashes to its parent, from the
        stateRoot down to the storage slots. The block header (and so the
        stateRoot) is still taken from the RPC; verifying the header is a
        separate step.
      </p>
    </div>
  )
}

type PriceResultProps = {
  status: "idle" | "pending" | "error" | "success"
  data?: EthPriceResult
  error?: unknown
  progress?: Progress
  onRetry: () => void
}

export function PriceResult({
  status,
  data,
  error,
  progress,
  onRetry,
}: PriceResultProps) {
  if (status === "idle") {
    return (
      <Card>
        <CardContent className="py-6 text-muted-foreground">
          Pick a date and time, then <strong>Get price</strong>, or click a
          point on the chart.
        </CardContent>
      </Card>
    )
  }

  if (status === "pending") return <ResultSkeleton progress={progress} />

  if (status === "error" || !data) {
    const { title, hint } = describeError(error)
    return (
      <Card className="ring-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlertIcon className="size-4" /> {title}
          </CardTitle>
          {hint && (
            <CardDescription className="break-words">{hint}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { block, pool, reading, source } = data
  const lag = data.target - block.timestamp
  const thin = reading.kind !== "v3" && reading.reserveUsdc < THIN_POOL_USDC

  return (
    <Card>
      <CardHeader>
        <CardDescription>ETH price in USDC · spot</CardDescription>
        <CardTitle className="text-3xl tracking-tight tabular-nums sm:text-4xl">
          {formatPriceUsd(data.price)}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="secondary">{pool.label}</Badge>
          <Badge variant="outline">
            {source.kind === "state"
              ? "state @ block"
              : `last ${source.eventName} event`}
          </Badge>
          {data.isHead && <Badge variant="outline">latest block</Badge>}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {thin && (
          <p className="flex items-start gap-1.5 border border-border p-2">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Thin pool: only {fmtInt(Number(reading.reserveUsdc / 1_000_000n))}{" "}
              USDC of liquidity. A price this shallow can be stale (no trades
              for days) or moved by a single swap.
            </span>
          </p>
        )}

        <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-2">
          <Row label="Block">
            <ExternalLink href={`${ETHERSCAN}/block/${block.number}`}>
              #{fmtInt(block.number)}
            </ExternalLink>
          </Row>
          <Row label="Block time">
            {formatUtc(block.timestamp)}
            <span className="block text-muted-foreground">
              {formatLocal(block.timestamp)} local ·{" "}
              {data.isHead
                ? "latest block; target is at or after it"
                : `${formatDuration(lag)} before target`}
            </span>
          </Row>
          <Row label="Target">
            {formatUtc(data.target)}
            <span className="block text-muted-foreground">
              unix {data.target.toString()}
            </span>
          </Row>
          <Row label="Pool">
            {pool.label} ·{" "}
            <ExternalLink href={`${ETHERSCAN}/address/${pool.address}`}>
              {short(pool.address)}
            </ExternalLink>
            <span className="block text-muted-foreground">
              Verified against the Uniswap {pool.kind} factory
            </span>
          </Row>
          <TwapRow data={data} />
          <Row label="Read via">{readVia(data)}</Row>
          <Row label="Lookup">
            {data.probes} × eth_getBlockByNumber ·{" "}
            {(data.elapsedMs / 1000).toFixed(2)}s total
          </Row>
          {data.skipped.map((s) => (
            <Row key={s.pool.address} label="Skipped">
              {s.pool.label}: {s.reason}
            </Row>
          ))}
        </dl>

        <details className="border-t pt-3">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
            Raw values
          </summary>
          <dl className="mt-3 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-2 break-all">
            {reading.kind === "v3" ? (
              <>
                <Row label="sqrtPriceX96">
                  {reading.sqrtPriceX96.toString()}
                </Row>
                <Row label="tick">{reading.tick}</Row>
                <Row label="liquidity">{reading.liquidity.toString()}</Row>
                <Row label="formula">1e12 · 2^192 / sqrtPriceX96²</Row>
                {data.twap?.available && (
                  <Row label="tickCumulatives">
                    {data.twap.tickCumulatives.join(", ")}
                  </Row>
                )}
              </>
            ) : (
              <>
                <Row label="USDC reserve">{reading.reserveUsdc.toString()}</Row>
                <Row
                  label={reading.kind === "v2" ? "WETH reserve" : "ETH reserve"}
                >
                  {(reading.kind === "v2"
                    ? reading.reserveWeth
                    : reading.reserveEth
                  ).toString()}
                </Row>
                <Row label="formula">reserveUSDC · 1e12 / reserveETH</Row>
              </>
            )}
            <Row label="exact price">{formatPriceExact(data.price)}</Row>
            <Row label="block hash">{block.hash}</Row>
            <Row label="state root">{block.stateRoot}</Row>
          </dl>
        </details>

        <ProofPanel key={`${block.number}-${pool.address}`} data={data} />
      </CardContent>
    </Card>
  )
}
