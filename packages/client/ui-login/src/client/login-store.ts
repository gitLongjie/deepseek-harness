/**
 * Login session state. Every launch replays the stored login pair against
 * the account server (the deployment's Deepagens Claw gateway): success
 * signs in without showing the gate, a refusal falls back to the sign-in
 * card. The server issues the API key at each sign-in; the session itself
 * stays in memory, only the pair is stored locally, and the key is handed
 * to the host credential layer, so real authorization stays with the
 * servers that accept the key.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/** localStorage key holding the login pair replayed at the next launch. */
const PAIR_STORAGE_KEY = 'dsh.login.pair'

/** Settings namespace carrying the default Agent model selection. */
const DEFAULT_MODEL_NS = 'agent-default-model'

/**
 * The provider route the login-seeded gateway catalog serves (`llm-deepseek`'s
 * Deepagens row); every default-model adoption points at it.
 */
const DEEPAGENS_PROVIDER = 'deepagens'

/** One authenticated session as the gate consumes it. */
export interface LoginSession {
  /** Display name shown beside the avatar; the username when the server omits one. */
  account: string
  /** Absolute avatar URL, or null when the account has none. */
  avatar: string | null
  /** API key the server issued at this sign-in; also handed to the host credential layer. */
  apiKey: string
}

/** Credential references this plugin writes while a session is signed in. */
export const LOGIN_CREDENTIAL_REFS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'] as const

/** The credential pair stored locally for the boot-time re-login. */
export interface StoredLoginPair {
  /** Account identifier as typed at the sign-in that stored it. */
  username: string
  /** Account password as typed at the sign-in that stored it. */
  password: string
}

/**
 * Read the stored login pair, tolerating every malformed shape as absent.
 * @returns the stored pair, or null when absent, malformed, or unavailable.
 */
export function readStoredPair(): StoredLoginPair | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(PAIR_STORAGE_KEY)
  } catch {
    // Storage refusal (private mode, quota) only means a manual sign-in this
    // launch; nothing else can reach the persisted fact.
    return null
  }
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupted value reads as absent rather than bricking the gate.
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { username, password } = parsed as Record<string, unknown>
  if (typeof username !== 'string' || username === '' || typeof password !== 'string' || password === '') return null
  return { username, password }
}

function writeStoredPair(pair: StoredLoginPair | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (pair === null) localStorage.removeItem(PAIR_STORAGE_KEY)
    else localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(pair))
  } catch {
    // Storage refusal only costs the next launch its silent re-login; the
    // signed-in session itself lives in memory.
  }
}

/** State rendered by the login gate. */
export interface LoginState {
  /** The boot-time re-login is in flight; the gate renders only its backdrop. */
  restoring: boolean
  /** Non-null while the user is signed in (set by a sign-in, dropped by sign-out). */
  session: LoginSession | null
  /** A sign-in request is in flight. */
  busy: boolean
  /** Failure text from the last sign-in attempt: a server message or a locale key. */
  error: string | null
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

/** The Remote faces the store reaches for catalog sync and default-model adoption. */
export interface LoginApi {
  llm: Pick<ClientRemote['llm'], 'discoverModels'>
  settings: Pick<ClientRemote['settings'], 'describe' | 'mutate' | 'replace'>
}

/** Coordinates sign-in requests and the persisted session behind one store. */
export class LoginStore {
  /** uSES-safe state source shared by the registered gate. */
  readonly store: SnapshotStore<LoginState> = createSnapshotStore<LoginState>({
    restoring: false, session: null, busy: false, error: null,
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
   * Fetch the token-scoped model list from the gateway, persist it into the
   * Deepagens provider settings (endpoint base plus catalog) so the selector
   * and the Models page see the live gateway models as their own group, and
   * point the default model at the first pulled model when the current
   * default is not one they serve; an unchanged catalog is left alone.
   * Failures — a refused read or an unreachable gateway — keep whatever is
   * already stored.
   * @param apiKey - the API key the sign-in just issued.
   */
  private async syncCatalogFromGateway(apiKey: string): Promise<void> {
    const gatewayBase = `${this.baseUrl()}/v1`
    const discovered = await this.api.llm.discoverModels('llm-deepagens', {
      baseURL: gatewayBase,
      apiKey,
    })
    if (!discovered.ok) {
      // The message carries the endpoint's own verdict (HTTP status, key hint);
      // the code alone says only that the Remote wrapper caught an LlmError.
      console.warn(`[ui-login] gateway model discovery refused: ${discovered.error.code}: ${discovered.error.message}`)
    }
    const described = await this.api.settings.describe()
    if (!described.ok) {
      console.warn(`[ui-login] settings describe refused: ${described.error.message}`)
      return
    }
    const namespaces = described.value.namespaces
    const ns = namespaces.find(view => view.ns === 'llm-deepagens')
    const stored = (ns?.value as { baseURL?: unknown; models?: unknown } | undefined)
    // The sign-in already applied this gateway's credentials, so the route's
    // endpoint must follow them even when the catalog read is refused: a base
    // left over from an earlier gateway sends every later request for the
    // fresh key to the wrong server.
    const baseURLOp = stored?.baseURL === gatewayBase
      ? []
      : [{ op: 'set' as const, path: ['baseURL'], value: gatewayBase }]
    // A catalog row carries only the capacities the gateway declared. Storing
    // a fabricated window would pin a fake fact on every silent endpoint —
    // absent capacities instead resolve at request time from the route's
    // defaultContextWindow and maxTokens, and the Models page shows its
    // provider-default placeholder.
    let catalogModels: GatewayCatalogRow[] | undefined
    let modelsOp: Array<{ op: 'set'; path: string[]; value: GatewayCatalogRow[] }> = []
    if (discovered.ok) {
      catalogModels = discovered.value.map((m): GatewayCatalogRow => ({
        id: m.id,
        name: m.name ?? m.id,
        description: '',
        ...m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow },
        ...m.maxTokens === undefined ? {} : { maxTokens: m.maxTokens },
        inputModalities: ['text'],
      }))
      if (modelsEquivalent(stored?.models, catalogModels)) {
        console.warn(`[ui-login] gateway catalog unchanged (${catalogModels.length} models); keeping stored`)
      } else {
        modelsOp = [{ op: 'set', path: ['models'], value: catalogModels }]
      }
    }
    const operations = [...baseURLOp, ...modelsOp]
    if (operations.length > 0) {
      const written = await this.api.settings.mutate('llm-deepagens', operations, ns?.revision)
      if (!written.ok) {
        console.warn(`[ui-login] deepagens catalog write refused: ${written.error.message}`)
      } else if (modelsOp.length > 0) {
        console.warn(`[ui-login] refreshed deepagens catalog from gateway: ${catalogModels?.length ?? 0} models`)
      } else {
        console.warn(`[ui-login] re-pointed the deepagens endpoint at ${gatewayBase}; catalog kept`)
      }
    }
    if (catalogModels !== undefined && catalogModels.length > 0) {
      await this.adoptFirstGatewayModel(namespaces, catalogModels)
    }
  }

  /**
   * Point the default model selection at the first login-pulled model when the
   * current selection is not one the pulled catalog serves — the installed
   * default names the static DeepSeek route, which the account session never
   * serves. A selection the pulled catalog already serves (the user's own
   * pick, or an earlier adoption) is left alone. Best effort: a refused write
   * keeps the previous default.
   * @param namespaces - the settings describe's namespace views.
   * @param models - the login-pulled catalog rows, in gateway order.
   */
  private async adoptFirstGatewayModel(
    namespaces: readonly { ns: string; value: unknown; revision: number }[],
    models: readonly { id: string }[],
  ): Promise<void> {
    const current = namespaces.find(view => view.ns === DEFAULT_MODEL_NS)
    if (current === undefined) {
      console.warn(`[ui-login] no "${DEFAULT_MODEL_NS}" namespace; default model left as composed`)
      return
    }
    const selection = current.value as { provider?: unknown; model?: unknown } | undefined
    const provider = typeof selection?.provider === 'string' ? selection.provider : undefined
    const model = typeof selection?.model === 'string' ? selection.model : undefined
    if (provider === DEEPAGENS_PROVIDER && model !== undefined
      && models.some(candidate => candidate.id === model)) {
      return
    }
    const first = models[0]
    if (first === undefined) return
    const written = await this.api.settings.replace(
      DEFAULT_MODEL_NS,
      { provider: DEEPAGENS_PROVIDER, model: first.id },
      current.revision,
    )
    if (!written.ok) {
      console.warn(`[ui-login] default model write refused: ${written.error.message}`)
      return
    }
    console.warn(`[ui-login] default model set to the first gateway model: ${first.id}`)
  }

  /**
   * Replay the stored login pair through the sign-in path — the boot-time
   * re-login every launch runs. Without a stored pair this is a no-op and
   * the gate shows its card; a refused pair stays stored for the next
   * launch and the gate shows the failure. The gate renders only its
   * backdrop while this is in flight.
   */
  async restore(): Promise<void> {
    const pair = readStoredPair()
    if (pair === null) return
    this.store.update((state) => {
      state.restoring = true
    })
    try {
      await this.login(pair.username, pair.password)
    } finally {
      this.store.update((state) => {
        state.restoring = false
      })
    }
  }

  /**
   * POST one credential pair to the account server and persist success.
   * Wire contract (Deepagens Claw `POST /api/claw/login`):
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
    let raw: string
    try {
      response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      raw = await response.text()
    } catch {
      // fetch rejects on network/DNS/CORS refusal and a cut-off body; the
      // page stays usable.
      this.store.update((state) => {
        state.busy = false
        state.error = 'networkUnreachable'
      })
      return false
    }
    let body: unknown = null
    try {
      body = JSON.parse(raw)
    } catch {
      // A non-JSON body falls through to the status-based failure below.
      console.warn(`[ui-login] login endpoint answered non-JSON (HTTP ${response.status}): ${replyExcerpt(raw)}`)
      body = null
    }
    const fields = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    if (fields.success !== true) {
      console.warn(`[ui-login] login refused (HTTP ${response.status}): ${replyExcerpt(raw)}`)
      this.store.update((state) => {
        state.busy = false
        state.error = errorKeyOf(response, fields)
      })
      return false
    }
    const data = typeof fields.data === 'object' && fields.data !== null ? fields.data as Record<string, unknown> : {}
    const apiKey = data.api_key
    if (typeof apiKey !== 'string' || apiKey === '') {
      console.warn(`[ui-login] login reply carries no usable data.api_key (HTTP ${response.status}): ${replyExcerpt(raw)}`)
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

    // Store the pair for the next launch's silent re-login; a refused write
    // only costs that launch its gate skip.
    writeStoredPair({ username, password })
    this.store.update((state) => {
      state.busy = false
      state.session = session
    })
    return true
  }

  /** Drop the session, the stored pair, and the written credentials; return to the sign-in page. */
  logout(): void {
    writeStoredPair(null)
    void this.credentials.clear()
    this.store.update((state) => {
      state.session = null
      state.error = null
    })
  }
}

/**
 * Cap a raw reply excerpt for the console log: an HTML error page or a large
 * JSON dump must not flood it, while enough of the body survives to compare
 * against the wire contract above.
 * @param raw - the unprocessed response body text.
 * @returns the trimmed body, truncated past 2000 characters.
 */
function replyExcerpt(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.length <= 2000 ? trimmed : `${trimmed.slice(0, 2000)}...(truncated)`
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

/** One catalog row this store persists for the login gateway's route. */
type GatewayCatalogRow = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly inputModalities: ['text']
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
