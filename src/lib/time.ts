/**
 * Date/time helpers on plain unix seconds. Native Date + Intl only: switching
 * between UTC and the browser's zone doesn't need a timezone library.
 */

export type TimeZoneMode = "utc" | "local"

export type DateTimeParts = {
  year: number
  /** 0-11 */
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
}

export const nowSeconds = () => Math.floor(Date.now() / 1000)

export function toParts(unix: number, tz: TimeZoneMode): DateTimeParts {
  const d = new Date(unix * 1000)
  return tz === "utc"
    ? {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        day: d.getUTCDate(),
        hours: d.getUTCHours(),
        minutes: d.getUTCMinutes(),
        seconds: d.getUTCSeconds(),
      }
    : {
        year: d.getFullYear(),
        month: d.getMonth(),
        day: d.getDate(),
        hours: d.getHours(),
        minutes: d.getMinutes(),
        seconds: d.getSeconds(),
      }
}

export function fromParts(p: DateTimeParts, tz: TimeZoneMode): number {
  const ms =
    tz === "utc"
      ? Date.UTC(p.year, p.month, p.day, p.hours, p.minutes, p.seconds)
      : new Date(
          p.year,
          p.month,
          p.day,
          p.hours,
          p.minutes,
          p.seconds
        ).getTime()
  return Math.floor(ms / 1000)
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "HH:mm:ss" for <input type="time" step="1">. */
export function timeValue(p: DateTimeParts): string {
  return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`
}

export function parseTimeValue(
  value: string
): Pick<DateTimeParts, "hours" | "minutes" | "seconds"> | undefined {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return undefined
  return { hours: +m[1], minutes: +m[2], seconds: m[3] ? +m[3] : 0 }
}

/** "2022-09-15 06:42:59 UTC" */
export function formatUtc(unix: number | bigint): string {
  return (
    new Date(Number(unix) * 1000).toISOString().replace("T", " ").slice(0, 19) +
    " UTC"
  )
}

const localFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
})

/** e.g. "Sep 15, 2022, 1:42:59 PM", in the browser's zone. */
export function formatLocal(unix: number | bigint): string {
  return localFormatter.format(new Date(Number(unix) * 1000))
}

export function localZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Compact duration: "0s", "17s", "3m 05s", "2h 01m", "3d 4h". */
export function formatDuration(totalSeconds: number | bigint): string {
  let s = Math.abs(Number(totalSeconds))
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${pad(m)}m`
  if (m) return `${m}m ${pad(s)}s`
  return `${s}s`
}
