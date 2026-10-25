/**
 * Login session state. A launch revalidates the API key the last sign-in
 * issued with one `/v1/models` read against the account server (the
 * deployment's Deepagens Claw gateway) and enters the app on acceptance; only
 * a refused key — revoked, expired, or short of quota — replays the stored
 * account pair through the sign-in path, which is what the server's login
 * session budget charges for. The session itself stays in memory; the pair,
 * the key, and the profile are stored locally, and the key is handed to the
 * host credential layer under the gateway route's own reference, so real
 * authorization stays with the servers that accept the key and a key stored
 * for the DeepSeek route is never rewritten.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * localStorage key holding the launch-time login record. The name predates the
 * key and profile it now carries; keeping it lets a build after an upgrade
 * keep the silent sign-in instead of forcing one manual sign-in.
 */
const STORAGE_KEY = 'dsh.login.pair'

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
  /** API key this session runs on: the last sign-in's, revalidated at launch; also handed to the host credential layer. */
  apiKey: string
}

/**
 * Credential reference this plugin writes while a session is signed in: the
 * Deepagens gateway route's own reference, never the DeepSeek route's
 * `DEEPSEEK_API_KEY`. The gateway issues this key at each sign-in, and a
 * shared reference made a launch-time sign-in overwrite the key a user stored
 * for the DeepSeek route. The gateway endpoint needs no credential — the
 * catalog sync writes it into the route's `llm-deepagens` settings section.
 */
export const GATEWAY_CREDENTIAL_REF = 'DEEPAGENS_API_KEY'

/** The launch-time login record: the pair a refused key is replaced from, plus the last session facts. */
export interface StoredLogin {
  /** Account identifier as typed at the sign-in that stored it. */
  username: string
  /** Account password as typed at the sign-in that stored it. */
  password: string
  /** Key the last sign-in issued, revalidated at the next launch; absent on records written before key reuse. */
  apiKey?: string
  /** Display name the last sign-in reported; absent on records written before key reuse. */
  account?: string
  /** Avatar URL the last sign-in reported, or null when the account has none. */
  avatar?: string | null
}

/**
 * Read the stored login record, tolerating every malformed shape as absent.
 * The pair is required; the key and profile are optional, so a record written
 * before key reuse still parses and drives one pair replay.
 * @returns the stored record, or null when absent, malformed, or unavailable.
 */
export function readStoredLogin(): StoredLogin | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
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
  const { username, password, apiKey, account, avatar } = parsed as Record<string, unknown>
  if (typeof username !== 'string' || username === '' || typeof password !== 'string' || password === '') return null
  const record: StoredLogin = { username, password }
  if (typeof apiKey === 'string' && apiKey !== '') record.apiKey = apiKey
  if (typeof account === 'string' && account !== '') record.account = account
  if (typeof avatar === 'string' && avatar !== '') record.avatar = avatar
  return record
}

function writeStoredLogin(record: StoredLogin | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (record === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Storage refusal only costs the next launch its silent sign-in; the
    // signed-in session itself lives in memory.
  }
}

/** State rendered by the login gate. */
export interface LoginState {
  /** The boot-time session restore is in flight; the gate renders only its backdrop. */
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
   * Store the issued key under the gateway route's credential reference; a
   * rejection aborts the sign-in.
   */
  apply(session: LoginSession): Promise<void>
  /** Remove the reference this plugin wrote; called on sign-out. */
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
    const described = await this.api.settings.describe()
    if (!described.ok) {
      console.warn(`[ui-login] settings describe refused: ${described.error.message}`)
      return
    }
    const namespaces = described.value.namespaces
    const ns = namespaces.find(view => view.ns === 'llm-deepagens')
    const stored = (ns?.value as { baseURL?: unknown; models?: unknown; followGatewayCatalog?: unknown } | undefined)
    // An explicit `false` hands the route to the user: the Models page's edits
    // to the endpoint and catalog are this deployment's own facts now, so a
    // sign-in must not re-point them at the gateway it happened to log into.
    if (stored?.followGatewayCatalog === false) {
      console.warn('[ui-login] deepagens catalog follow disabled; keeping the user-managed endpoint and catalog')
      return
    }
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
   * Restore the last session at boot. A stored key that the gateway still
   * accepts signs in without calling the login endpoint, so a launch costs no
   * login session; a refused key, and every record written before key reuse,
   * replays the stored pair through the sign-in path, which replaces the key.
   * Without a stored record this is a no-op and the gate shows its card; a
   * refused pair stays stored for the next launch and the gate shows the
   * failure. The gate renders only its backdrop while this is in flight.
   */
  async restore(): Promise<void> {
    const stored = readStoredLogin()
    if (stored === null) return
    this.store.update((state) => {
      state.restoring = true
    })
    try {
      if (stored.apiKey !== undefined && await this.storedKeyAccepted(stored.apiKey)) {
        await this.adoptStoredSession(stored, stored.apiKey)
      } else {
        await this.login(stored.username, stored.password)
      }
    } finally {
      this.store.update((state) => {
        state.restoring = false
      })
    }
  }

  /**
   * Ask the gateway whether the key the last sign-in issued is still accepted,
   * which is the launch-time stand-in for a new sign-in. A refusal means a
   * revoked, expired, or quota-exhausted key and the pair replay replaces it;
   * an unreachable or failing gateway answers the same way, and the sign-in
   * path then reports its own failure to the gate.
   * @param apiKey - the key stored by the last successful sign-in.
   * @returns whether `/v1/models` served the key.
   */
  private async storedKeyAccepted(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl()}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (response.ok) return true
      console.warn(`[ui-login] stored api key refused (HTTP ${response.status}); replaying the stored pair`)
    } catch {
      console.warn('[ui-login] gateway unreachable while revalidating the stored api key; replaying the stored pair')
    }
    return false
  }

  /**
   * Enter the app with the revalidated key: write it to the credential layer
   * under the gateway reference and refresh the gateway catalog, exactly as a
   * fresh sign-in does, but without the login-endpoint call that the server
   * charges a login session for.
   * @param stored - the record the key and profile came from.
   * @param apiKey - the key the gateway just accepted.
   */
  private async adoptStoredSession(stored: StoredLogin, apiKey: string): Promise<void> {
    const session: LoginSession = {
      account: stored.account ?? stored.username,
      avatar: stored.avatar ?? null,
      apiKey,
    }
    try {
      await this.credentials.apply(session)
    } catch {
      this.store.update((state) => {
        state.error = 'credentialWriteFailed'
      })
      return
    }
    try {
      await this.syncCatalogFromGateway(apiKey)
    } catch (error: unknown) {
      console.warn('[ui-login] gateway catalog sync failed after key reuse:', error instanceof Error ? error.message : String(error))
    }
    this.store.update((state) => {
      state.session = session
    })
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
      await this.credentials.apply(session)
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

    // Store the pair for the next launch's silent sign-in and the key this
    // sign-in issued for its revalidation; a refused write only costs that
    // launch its gate skip.
    writeStoredLogin({
      username,
      password,
      apiKey: session.apiKey,
      account: session.account,
      avatar: session.avatar,
    })
    this.store.update((state) => {
      state.busy = false
      state.session = session
    })
    return true
  }

  /** Drop the session, the stored record, and the written credentials; return to the sign-in page. */
  logout(): void {
    writeStoredLogin(null)
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
