const STORAGE_KEY = "ethmetal:rpc-url"

export type RpcSource = "custom" | "env" | "public"

export type ActiveRpc = {
  source: RpcSource
  /** Undefined for the public fallback list. */
  url?: string
  /** Stable key for caches; never shown to the user. */
  key: string
}

export const ENV_RPC_URL = import.meta.env.VITE_RPC_URL?.trim() || undefined

/** Precedence: URL pasted in the UI → VITE_RPC_URL (.env.local) → public list. */
export function resolveRpc(customUrl: string | undefined): ActiveRpc {
  if (customUrl) return { source: "custom", url: customUrl, key: customUrl }
  if (ENV_RPC_URL) return { source: "env", url: ENV_RPC_URL, key: ENV_RPC_URL }
  return { source: "public", key: "public" }
}

export function validateRpcUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Use an http(s):// URL"
    }
    return undefined
  } catch {
    return "Not a valid URL"
  }
}

/**
 * Host only: RPC URLs often carry an API key in the path or query, so the
 * full URL is never rendered.
 */
export function displayRpcHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "invalid URL"
  }
}

export function loadCustomRpc(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) || undefined
  } catch {
    return undefined
  }
}

export function saveCustomRpc(url: string | undefined) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode etc.): the choice just won't persist.
  }
}

const SETTINGS_KEY = "ethmetal:transport"

export type StoredTransportSettings = {
  perSecond: number
  perMinute: number
  batch: boolean
}

export const DEFAULT_TRANSPORT_SETTINGS: StoredTransportSettings = {
  perSecond: 10,
  perMinute: 180,
  batch: true,
}

const positiveInt = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 100_000
    ? v
    : fallback

export function loadTransportSettings(): StoredTransportSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")
    const d = DEFAULT_TRANSPORT_SETTINGS
    return {
      perSecond: positiveInt(raw.perSecond, d.perSecond),
      perMinute: positiveInt(raw.perMinute, d.perMinute),
      batch: typeof raw.batch === "boolean" ? raw.batch : d.batch,
    }
  } catch {
    return DEFAULT_TRANSPORT_SETTINGS
  }
}

export function saveTransportSettings(settings: StoredTransportSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: settings just won't persist.
  }
}
