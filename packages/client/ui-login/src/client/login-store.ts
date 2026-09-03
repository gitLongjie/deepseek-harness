/**
 * Login session state over localStorage. The account server (the deployment's
 * Deepagens Claw gateway) issues the API key on sign-in; this plugin stores
 * the account profile locally and hands the key to the host credential layer,
 * so real authorization stays with the servers that accept the key.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/** localStorage key holding the persisted login session. */
const SESSION_STORAGE_KEY = 'dsh.login.session'

/** One authenticated session as the gate consumes it. */
export interface LoginSession {
  /** Display name shown beside the avatar; the username when the server omits one. */
  account: string
  /** Absolute avatar URL, or null when the account has none. */
  avatar: string | null
  /** API key the server issued; kept so a reload can refresh it on the next sign-in. */
  apiKey: string
}

/** Credential references this plugin writes while a session is signed in. */
export const LOGIN_CREDENTIAL_REFS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'] as const

/** State rendered by the login gate. */
export interface LoginState {
  status: 'idle' | 'ready'
  /** Non-null once the user is signed in (hydrated from storage or a login). */
  session: LoginSession | null
  /** A sign-in request is in flight. */
  busy: boolean
  /** Failure text from the last sign-in attempt: a server message or a locale key. */
  error: string | null
}

/**
 * Read the persisted session, tolerating every malformed shape as signed out.
 * @returns the stored session, or null when absent, malformed, or unavailable.
 */
export function readStoredSession(): LoginSession | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage refusal (private mode, quota) only means a fresh sign-in per
    // visit; nothing else can reach the persisted fact.
    return null
  }
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupted value reads as signed out rather than bricking the gate.
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { account, avatar, apiKey } = parsed as Record<string, unknown>
  if (typeof account !== 'string' || account === '' || typeof apiKey !== 'string' || apiKey === '') return null
  return {
    account,
    avatar: typeof avatar === 'string' && avatar !== '' ? avatar : null,
    apiKey,
  }
}

function writeStoredSession(session: LoginSession | null): void {
  if (typeof localStorage === 'undefined') return
  if (session === null) localStorage.removeItem(SESSION_STORAGE_KEY)
  else localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

/** Host credential writes the store delegates after a session transition. */
export interface LoginCredentialAdapter {
  /**
   * Store the issued key and the server origin under the LLM credential
   * references; a rejection aborts the sign-in.
   */
  apply(session: LoginSession, baseUrl: string): Promise<void>
  /** Remove the references this plugin wrote; called on sign-out. */
  clear(): Promise<void>
}

/** The Remote faces the store reaches for catalog sync. */
export interface LoginApi {
  llm: Pick<ClientRemote['llm'], 'discoverModels'>
  settings: Pick<ClientRemote['settings'], 'describe' | 'mutate'>
}

/** Coordinates sign-in requests and the persisted session behind one store. */
export class LoginStore {
  /** uSES-safe state source shared by the registered gate. */
  readonly store: SnapshotStore<LoginState> = createSnapshotStore<LoginState>({
    status: 'idle', session: null, busy: false, error: null,
  })

  /**
   * @param authUrl - absolute account-server login endpoint this build was
   *   compiled with (`DSH_CLIENT_LOGIN_URL`).
   * @param credentials - host credential adapter invoked on session transitions.
   */
  constructor(
    private readonly authUrl: string,
    private readonly credentials: LoginCredentialAdapter,
    private readonly api: LoginApi,
  ) {}

  /**
   * The relay origin derived from the login endpoint; the base-URL credential value.
   * @returns the endpoint URL's origin.
   */
  baseUrl(): string {
    return new URL(this.authUrl).origin
  }

  /**
   * Fetch the token-scoped model list from the gateway and persist it into the
   * Deepagens provider settings (endpoint base plus catalog) so the selector
   * and the Models page see the live gateway models as their own group; an
   * unchanged catalog is left alone. Failures — a refused read or an
   * unreachable gateway — keep whatever is already stored.
   * @param apiKey - the API key the sign-in just issued.
   */
  private async syncCatalogFromGateway(apiKey: string): Promise<void> {
    const discovered = await this.api.llm.discoverModels('llm-deepagens', {
      baseURL: `${this.baseUrl()}/v1`,
      apiKey,
    })
    if (!discovered.ok) {
      console.warn(`[ui-login] gateway model discovery refused: ${discovered.error.code}`)
      return
    }
    const catalogModels = discovered.value.map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      description: '',
      contextWindow: m.contextWindow ?? 128_000,
      maxTokens: m.maxTokens ?? 4096,
      inputModalities: ['text'],
    }))
    const described = await this.api.settings.describe()
    if (!described.ok) {
      console.warn(`[ui-login] settings describe refused: ${described.error.message}`)
      return
    }
    const ns = described.value.namespaces.find(view => view.ns === 'llm-deepagens')
    const stored = (ns?.value as { models?: unknown } | undefined)?.models
    if (stored !== undefined && modelsEquivalent(stored, catalogModels)) {
      console.warn(`[ui-login] gateway catalog unchanged (${catalogModels.length} models); keeping stored`)
      return
    }
    const written = await this.api.settings.mutate('llm-deepagens', [
      { op: 'set', path: ['baseURL'], value: `${this.baseUrl()}/v1` },
      { op: 'set', path: ['models'], value: catalogModels },
    ], ns?.revision)
    if (!written.ok) {
      console.warn(`[ui-login] deepagens catalog write refused: ${written.error.message}`)
      return
    }
    console.warn(`[ui-login] refreshed deepagens catalog from gateway: ${catalogModels.length} models`)
  }

  /** Hydrate the persisted session into the store (idempotent). */
  load(): void {
    const session = readStoredSession()
    this.store.update((state) => {
      state.status = 'ready'
      state.session = session
    })
  }

  /**
   * POST one credential pair to the account server and persist success.
   * Wire contract (Deepagens Claw `POST /api/user/deepagens-claw/login`):
   * JSON `{username, password}` in; `200` with `{success, message?, data?}`
   * out, where a successful `data` carries `{display_name?, avatar?, api_key}`;
   * `success: false` carries a `message` shown verbatim.
   * @param username - account identifier as typed.
   * @param password - account password as typed.
   * @returns true when the session is now signed in.
   */
  async login(username: string, password: string): Promise<boolean> {
    this.store.update((state) => {
      state.busy = true
      state.error = null
    })
    let response: Response
    try {
      response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
    } catch {
      // fetch rejects on network/DNS/CORS refusal; the page stays usable.
      this.store.update((state) => {
        state.busy = false
        state.error = 'networkUnreachable'
      })
      return false
    }
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // A non-JSON body falls through to the status-based failure below.
      body = null
    }
    const fields = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    if (fields.success !== true) {
      this.store.update((state) => {
        state.busy = false
        state.error = errorKeyOf(response, fields)
      })
      return false
    }
    const data = typeof fields.data === 'object' && fields.data !== null ? fields.data as Record<string, unknown> : {}
    const apiKey = data.api_key
    if (typeof apiKey !== 'string' || apiKey === '') {
      this.store.update((state) => {
        state.busy = false
        state.error = 'invalidResponse'
      })
      return false
    }
    const session: LoginSession = {
      account: typeof data.display_name === 'string' && data.display_name !== '' ? data.display_name : username,
      avatar: typeof data.avatar === 'string' && data.avatar !== '' ? data.avatar : null,
      apiKey,
    }
    try {
      await this.credentials.apply(session, this.baseUrl())
    } catch {
      this.store.update((state) => {
        state.busy = false
        state.error = 'credentialWriteFailed'
      })
      return false
    }

    // After credentials are stored, seed the catalog from the gateway; a
    // failure here never aborts the sign-in (the UI falls back to the static
    // catalog or whatever models are already stored).
    try {
      await this.syncCatalogFromGateway(session.apiKey)
    } catch (error: unknown) {
      console.warn('[ui-login] gateway catalog sync failed after sign-in:', error instanceof Error ? error.message : String(error))
    }

    writeStoredSession(session)
    this.store.update((state) => {
      state.busy = false
      state.session = session
    })
    return true
  }

  /** Drop the persisted session, clear the written credentials, and return to the sign-in page. */
  logout(): void {
    writeStoredSession(null)
    void this.credentials.clear()
    this.store.update((state) => {
      state.session = null
      state.error = null
    })
  }
}

/**
 * Pick the failure copy for a refused sign-in.
 * @param response - the account server's response.
 * @param body - the parsed JSON body's fields, empty when it was not an object.
 * @returns the server's message when recognizable, else a generic key.
 */
function errorKeyOf(response: Response, body: Record<string, unknown>): string {
  const message = body.message
  if (typeof message === 'string' && message !== '') return message
  return response.status >= 500 || response.status === 0 ? 'networkUnreachable' : 'invalidResponse'
}

/**
 * Compare the catalog discovery produced against the one already stored. Both
 * sides are the fixed-shape rows this module writes (or the schema defaults a
 * first sign-in replaces), so serialized order is stable within a writer; a
 * real catalog change alters the serialization, and a transient writer-order
 * difference only costs one harmless rewrite.
 * @param stored - the `models` value currently in settings, when present.
 * @param discovered - the rows this login would persist.
 * @returns whether the two catalogs describe the same models.
 */
function modelsEquivalent(stored: unknown, discovered: unknown): boolean {
  return JSON.stringify(stored) === JSON.stringify(discovered)
}
