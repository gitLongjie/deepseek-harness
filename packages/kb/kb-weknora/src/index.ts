/**
 * WeKnora Service Provider for the knowledge-base capability: lists the
 * knowledge bases a self-hosted WeKnora deployment exposes to the configured
 * credential. One `GET /knowledge-bases` call per read; the credential
 * reference resolves per operation so a rotated key reaches the next call
 * without a restart. The deployment's host is deployment-owned configuration
 * and is commonly intranet, so unlike the market transport this client runs
 * no public-address guard — the configured base URL is the trust decision.
 * @module @deepseek-ai/dsh-kb-weknora
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { KnowledgeBase } from '@deepseek-ai/dsh-kb'
import type {
  KnowledgeBaseId,
  KnowledgeBaseView,
  KnowledgeDocumentId,
  KnowledgeDocumentKind,
  KnowledgeDocumentPage,
  KnowledgeDocumentView,
} from '@deepseek-ai/dsh-kb'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Default API root of a stock `docker compose up` deployment. */
const DEFAULT_BASE_URL = 'http://localhost:8080/api/v1'

/** Plugin config (all fields optional — `static Config` supplies the defaults). */
export interface Config {
  /** WeKnora API root including its version prefix, e.g. `http://weknora.internal:8080/api/v1`. */
  baseUrl?: string
  /**
   * Credential reference (environment-variable name) resolved per operation;
   * default `WEKNORA_API_KEY`. Set the reference to the empty string in yml
   * (`apiKeyEnv: ''`) to declare an unauthenticated deployment.
   */
  apiKeyEnv?: string
  /** Workspace scope for a platform-level API key, sent as `X-Tenant-ID`. */
  tenantId?: string
  /** Per-request wall-time bound (ms, default 15,000). */
  requestTimeoutMs?: number
  /** Maximum accepted response body size (bytes, default 8 MiB). */
  maxResponseBytes?: number
  /** Browser-openable deployment console the client section's manage action opens. */
  webUiUrl?: string
}

/** The shape after schemastery applied the defaults (optional fields stay optional). */
type ResolvedConfig = Required<Omit<Config, 'tenantId' | 'webUiUrl'>> & Pick<Config, 'tenantId' | 'webUiUrl'>

/** One request rejected by the transport or the WeKnora response contract. The message never carries the credential. */
export class WeknoraKnowledgeBaseError extends Error {
  /** HTTP status of the failed response, when one arrived. */
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'WeknoraKnowledgeBaseError'
    this.status = status
  }
}

/** Validate one configured URL as an http(s) base this client may call. */
function assertHttpUrl(name: string, raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`kb-weknora: ${name} is not a valid URL: ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`kb-weknora: ${name} must be an http(s) URL: ${JSON.stringify(raw)}`)
  }
}

/**
 * The WeKnora knowledge-base implementation. Response payloads are
 * deployment-controlled but still contract-checked: a non-array listing or a
 * base without an id is a loud contract failure, not a silently emptied
 * sidebar.
 */
export default class WeknoraKnowledgeBase extends KnowledgeBase {
  static inject = ['credentials']

  static Config: z<Config> = z.object({
    baseUrl: z.string().default(DEFAULT_BASE_URL),
    apiKeyEnv: z.string().role('credential-ref').default('WEKNORA_API_KEY'),
    tenantId: z.string(),
    requestTimeoutMs: z.number().step(1).min(1).default(15_000),
    maxResponseBytes: z.number().step(1).min(1).default(8 * 1024 * 1024),
    webUiUrl: z.string(),
  })

  private readonly baseUrl: string
  private readonly apiKeyEnv: CredentialRef | undefined
  private readonly tenantId: string | undefined
  private readonly webUiUrl: string | undefined
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly credentials: CredentialProvider

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Parse through the schema here so a direct construction receives the same
    // defaults the loader applies before construction; a loader-parsed config
    // is idempotent under this second parse.
    const resolved = WeknoraKnowledgeBase.Config(config) as ResolvedConfig
    assertHttpUrl('baseUrl', resolved.baseUrl)
    if (resolved.webUiUrl !== undefined && resolved.webUiUrl !== '') {
      assertHttpUrl('webUiUrl', resolved.webUiUrl)
    }
    this.baseUrl = resolved.baseUrl.replace(/\/+$/, '')
    // An explicitly empty reference declares an unauthenticated deployment.
    this.apiKeyEnv = resolved.apiKeyEnv === '' ? undefined : credentialRef(resolved.apiKeyEnv)
    this.tenantId = resolved.tenantId
    this.webUiUrl = resolved.webUiUrl === '' ? undefined : resolved.webUiUrl
    this.timeoutMs = resolved.requestTimeoutMs
    this.maxResponseBytes = resolved.maxResponseBytes
    this.credentials = ctx.credentials
  }

  /**
   * The deployment console URL for client surfaces, or null when unconfigured.
   * @returns the configured console URL, or null.
   */
  webUi(): string | null {
    return this.webUiUrl ?? null
  }

  async list(): Promise<readonly KnowledgeBaseView[]> {
    const apiKey = await this.resolveApiKey()
    const envelope = await this.request('/knowledge-bases', apiKey)
    if (!Array.isArray(envelope.data)) {
      throw new WeknoraKnowledgeBaseError('GET /knowledge-bases returned a response without a base array')
    }
    return envelope.data.map(parseView)
  }

  async listDocuments(baseId: KnowledgeBaseId, query?: { keyword?: string }): Promise<KnowledgeDocumentPage> {
    const apiKey = await this.resolveApiKey()
    // One bounded page at the route's binding cap; the browser view renders it
    // whole and pagination UI stays deferred until a deployment outgrows it.
    const params = new URLSearchParams({ page: '1', page_size: '1000' })
    if (query?.keyword !== undefined && query.keyword !== '') params.set('keyword', query.keyword)
    const envelope = await this.request(`/knowledge-bases/${encodeURIComponent(baseId)}/knowledge?${params}`, apiKey)
    if (!Array.isArray(envelope.data)) {
      throw new WeknoraKnowledgeBaseError('GET /knowledge-bases/:id/knowledge returned a response without a document array')
    }
    return {
      documents: envelope.data.map(parseDocumentView),
      total: typeof envelope.total === 'number' ? envelope.total : envelope.data.length,
    }
  }

  /**
   * Resolve the configured credential reference for one operation.
   * @returns the current key, or undefined for an unauthenticated deployment.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    if (this.apiKeyEnv === undefined) return undefined
    const hit = await this.credentials.resolve(this.apiKeyEnv)
    return hit?.value
  }

  /**
   * Perform one bounded GET against the deployment and parse its envelope.
   * @param path - the API path below the configured base URL.
   * @param apiKey - the operation's credential, or undefined to send none.
   * @returns the parsed envelope body.
   */
  private async request(path: string, apiKey: string | undefined): Promise<{ data?: unknown; total?: unknown }> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey !== undefined) headers['x-api-key'] = apiKey
    if (this.tenantId !== undefined) headers['x-tenant-id'] = this.tenantId

    let response: Response
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      throw new WeknoraKnowledgeBaseError(`GET ${path} failed: ${cause}`)
    }
    if (!response.ok) {
      throw new WeknoraKnowledgeBaseError(`GET ${path} failed with HTTP ${response.status}`, response.status)
    }
    const text = await this.readBounded(response, url)
    try {
      return JSON.parse(text) as { data?: unknown; total?: unknown }
    } catch {
      throw new WeknoraKnowledgeBaseError(`GET ${path} returned a non-JSON body`)
    }
  }

  /**
   * Read one response body under the configured byte bound.
   * @param response - the response whose body to read.
   * @param url - the request URL, for the error message.
   * @returns the decoded body text.
   */
  private async readBounded(response: Response, url: string): Promise<string> {
    if (response.body === null) return ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    const parts: string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > this.maxResponseBytes) {
        await reader.cancel()
        throw new WeknoraKnowledgeBaseError(`response from ${url} exceeds the ${this.maxResponseBytes}-byte limit`)
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  }
}

/** One raw knowledge-base entry of the WeKnora listing envelope. */
interface RawKnowledgeBase {
  id?: unknown
  name?: unknown
  description?: unknown
}

/**
 * Validate one raw entry into its client view. The id is the only field every
 * consumer needs verbatim; a missing display name falls back to it.
 * @param input - the unvalidated envelope entry.
 * @returns the client view.
 */
function parseView(input: unknown): KnowledgeBaseView {
  const raw = (input ?? {}) as RawKnowledgeBase
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new WeknoraKnowledgeBaseError('GET /knowledge-bases returned a knowledge base without an id')
  }
  const id = raw.id as KnowledgeBaseId
  const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id
  const description = typeof raw.description === 'string' && raw.description !== '' ? raw.description : undefined
  return description === undefined ? { id, name } : { id, name, description }
}

/** One raw document entry of the WeKnora knowledge-listing envelope. */
interface RawKnowledgeDocument {
  id?: unknown
  title?: unknown
  file_name?: unknown
  type?: unknown
  file_type?: unknown
  file_size?: unknown
  updated_at?: unknown
}

/** The closed union of entry kinds WeKnora reports; anything else reads as a file. */
const DOCUMENT_KINDS: readonly KnowledgeDocumentKind[] = ['file', 'url', 'manual']

/**
 * Validate one raw document entry into its client view. The display title
 * falls back file name, then id; the kind is kept only when WeKnora reports a
 * known one.
 * @param input - the unvalidated envelope entry.
 * @returns the client view.
 */
function parseDocumentView(input: unknown): KnowledgeDocumentView {
  const raw = (input ?? {}) as RawKnowledgeDocument
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new WeknoraKnowledgeBaseError('GET /knowledge-bases/:id/knowledge returned a document without an id')
  }
  const id = raw.id as KnowledgeDocumentId
  const title = typeof raw.title === 'string' && raw.title !== ''
    ? raw.title
    : typeof raw.file_name === 'string' && raw.file_name !== '' ? raw.file_name : raw.id
  const kind = DOCUMENT_KINDS.includes(raw.type as KnowledgeDocumentKind) ? raw.type as KnowledgeDocumentKind : undefined
  const fileType = typeof raw.file_type === 'string' && raw.file_type !== '' ? raw.file_type : undefined
  const fileSize = typeof raw.file_size === 'number' && Number.isFinite(raw.file_size) ? raw.file_size : undefined
  const updatedAt = typeof raw.updated_at === 'string' && raw.updated_at !== '' ? raw.updated_at : undefined
  return {
    id,
    title,
    ...(kind === undefined ? {} : { kind }),
    ...(fileType === undefined ? {} : { fileType }),
    ...(fileSize === undefined ? {} : { fileSize }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}
