/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional default mainnet archive RPC (from .env.local). */
  readonly VITE_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
