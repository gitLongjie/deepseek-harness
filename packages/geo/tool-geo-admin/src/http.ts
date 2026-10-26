/**
 * The GEO multi-site content backend's HTTP surface: sign-in, site listing,
 * article create and read-back, article deletion, GEO keyword tasks, and
 * brand-visibility reports. Every request carries JSON and is asked to refuse
 * redirects, because the sign-in request carries the account password and an
 * authenticated call carries its token; a relocated endpoint must fail here
 * rather than forward either to another origin.
 *
 * Responses are narrowed field by field: the backend answers documented
 * envelopes (a flat page for the content routes, `{code, data}` for the task
 * server's report routes), so a body that does not match its envelope is a
 * `response` failure with the endpoint named, never a silently half-read value.
 * @module @deepseek-ai/dsh-tool-geo-admin/http
 */

import { GeoAdminError } from './errors.ts'
import type {
  GeoArticle, GeoArticleDraft, GeoArticlePatch, GeoCategory, GeoNewsQuery, GeoNewsSummary, GeoPage, GeoReport,
  GeoReportBrand, GeoReportJob, GeoReportPage, GeoReportQuery, GeoReportRequest, GeoReportSummary, GeoTaskPage,
  GeoTaskQuery, GeoTaskRetry, GeoTaskSummary, GeoWebsite,
} from './types.ts'

/** Where and how to reach one backend account. */
export interface GeoAdminTarget {
  /** Backend origin; a trailing slash is tolerated. */
  baseUrl: string
  /** Publishing account name. */
  username: string
  /** Publishing account password; resolved per call and never echoed. */
  password: string
  /** Wall-clock bound on one HTTP exchange, in milliseconds. */
  timeoutMs: number
}

/** What a successful sign-in yields. */
export interface GeoSignIn {
  /** Bearer token for the calls that follow. */
  token: string
  /** Sites the account may publish to, as the login response reports them. */
  websites: GeoWebsite[]
}

/** The HTTP transport, injectable so a test can answer without a server. */
type Transport = typeof fetch

/** Envelope key holding the response payload on the success-shaped endpoints. */
const DATA = 'data'

/**
 * Build one absolute endpoint URL.
 * @param target - the backend and account the request is for.
 * @param path - the endpoint path, starting with `/`.
 * @returns the absolute URL.
 */
function endpoint(target: GeoAdminTarget, path: string): string {
  return `${target.baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * Narrow an unknown value to a JSON object.
 * @param value - the parsed response body or a nested field.
 * @param where - the endpoint and field the value came from, for the message.
 * @returns the object.
 * @throws GeoAdminError with code `response` when the value is not an object.
 */
function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GeoAdminError('response', `${where}: expected a JSON object`)
  }
  return value as Record<string, unknown>
}

/**
 * Read one required string field.
 * @param record - the object holding the field.
 * @param key - the field name.
 * @param where - the endpoint the object came from, for the message.
 * @returns the field value.
 * @throws GeoAdminError with code `response` when the field is absent or blank.
 */
function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GeoAdminError('response', `${where}: "${key}" must be a non-empty string`)
  }
  return value
}

/**
 * Read one optional string field, dropping a blank value.
 * @param record - the object holding the field.
 * @param key - the field name.
 * @param where - the endpoint the object came from, for the message.
 * @returns the field value, or `undefined` when absent or blank.
 * @throws GeoAdminError with code `response` when the field is present but not a string.
 */
function optionalString(record: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new GeoAdminError('response', `${where}: "${key}" must be a string`)
  return value.trim().length === 0 ? undefined : value
}

/**
 * Read one required number field.
 * @param record - the object holding the field.
 * @param key - the field name.
 * @param where - the endpoint the object came from, for the message.
 * @returns the field value.
 * @throws GeoAdminError with code `response` when the field is absent or not finite.
 */
function requiredNumber(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GeoAdminError('response', `${where}: "${key}" must be a number`)
  }
  return value
}

/**
 * Read one required boolean field.
 * @param record - the object holding the field.
 * @param key - the field name.
 * @param where - the endpoint the object came from, for the message.
 * @returns the field value.
 * @throws GeoAdminError with code `response` when the field is absent or not a boolean.
 */
function requiredBoolean(record: Record<string, unknown>, key: string, where: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new GeoAdminError('response', `${where}: "${key}" must be a boolean`)
  }
  return value
}

/**
 * Project one backend site record, dropping the fields this client does not use.
 * @param value - one element of a site list.
 * @param where - the endpoint the list came from, for the message.
 * @returns the site.
 * @throws GeoAdminError with code `response` when a required field is missing.
 */
function asWebsite(value: unknown, where: string): GeoWebsite {
  const record = asRecord(value, where)
  const code = optionalString(record, 'code', where)
  const domain = optionalString(record, 'domain', where)
  const role = optionalString(record, 'role', where)
  return {
    id: requiredNumber(record, 'id', where),
    name: requiredString(record, 'name', where),
    ...(code === undefined ? {} : { code }),
    ...(domain === undefined ? {} : { domain }),
    ...(role === undefined ? {} : { role }),
  }
}

/**
 * Project a site list, accepting only an array.
 * @param value - the list payload.
 * @param where - the endpoint the list came from, for the message.
 * @returns the sites.
 * @throws GeoAdminError with code `response` when the payload is not an array.
 */
function asWebsites(value: unknown, where: string): GeoWebsite[] {
  if (!Array.isArray(value)) throw new GeoAdminError('response', `${where}: expected an array of sites`)
  return value.map(item => asWebsite(item, where))
}

/**
 * Project the article record the create and read-back endpoints return.
 * @param value - the `data` payload.
 * @param where - the endpoint the record came from, for the message.
 * @returns the article.
 * @throws GeoAdminError with code `response` when a required field is missing.
 */
function asArticle(value: unknown, where: string): GeoArticle {
  const record = asRecord(value, where)
  const slug = optionalString(record, 'slug', where)
  return {
    id: requiredNumber(record, 'id', where),
    title: requiredString(record, 'title', where),
    website_id: requiredNumber(record, 'website_id', where),
    is_published: requiredBoolean(record, 'is_published', where),
    ...(slug === undefined ? {} : { slug }),
  }
}

/**
 * Read the backend's own message out of a failed response body.
 * @param body - the parsed body, when it was JSON.
 * @param text - the raw body text, used when no message field is present.
 * @returns a single-line explanation.
 */
function failureMessage(body: unknown, text: string): string {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    // The content routes answer `message`; the proxied task server answers
    // `detail` on its raw routes and `message` inside its success envelope.
    for (const key of ['message', 'detail', 'error']) {
      const message = record[key]
      if (typeof message === 'string' && message.trim().length > 0) return message
    }
  }
  const trimmed = text.trim()
  return trimmed.length === 0 ? '(empty response)' : trimmed.slice(0, 200)
}

/**
 * Describe a transport failure without leaking request headers.
 * @param error - the rejection reason.
 * @returns the reason's message, or its string form.
 */
function transportFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build one query string, dropping absent values and encoding present ones.
 * @param params - the query fields, in display order.
 * @returns the query string including its leading `?`, or the empty string.
 */
function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded.length === 0 ? '' : `?${encoded}`
}

/**
 * Read one required numeric page field.
 * @param record - the page envelope.
 * @param key - the field name.
 * @param where - the endpoint the envelope came from, for the message.
 * @returns the field value.
 * @throws GeoAdminError with code `response` when the field is absent or not finite.
 */
function pageNumber(record: Record<string, unknown>, key: string, where: string): number {
  return requiredNumber(record, key, where)
}

/**
 * Project one paginated list answer.
 * @param body - the parsed page envelope.
 * @param where - the endpoint the envelope came from, for the message.
 * @param project - projects one row into its client shape.
 * @returns the page.
 * @throws GeoAdminError with code `response` when the envelope is malformed.
 */
function asPage<T>(
  body: unknown,
  where: string,
  project: (row: unknown, where: string) => T,
): GeoPage<T> {
  const record = asRecord(body, where)
  const rows = record[DATA]
  if (!Array.isArray(rows)) throw new GeoAdminError('response', `${where}: "data" must be an array`)
  return {
    items: rows.map(row => project(row, where)),
    total: pageNumber(record, 'total', where),
    page: pageNumber(record, 'page', where),
    limit: pageNumber(record, 'limit', where),
    pages: pageNumber(record, 'pages', where),
  }
}

/**
 * Project one article-list row.
 * @param value - one row of the list.
 * @param where - the endpoint the list came from, for the message.
 * @returns the summary.
 * @throws GeoAdminError with code `response` when a required field is missing.
 */
function asNewsSummary(value: unknown, where: string): GeoNewsSummary {
  const record = asRecord(value, where)
  const slug = optionalString(record, 'slug', where)
  const createdAt = optionalString(record, 'created_at', where)
  const updatedAt = optionalString(record, 'updated_at', where)
  const categoryId = record.category_id
  return {
    id: requiredNumber(record, 'id', where),
    title: requiredString(record, 'title', where),
    website_id: requiredNumber(record, 'website_id', where),
    is_published: requiredBoolean(record, 'is_published', where),
    ...(slug === undefined ? {} : { slug }),
    ...(typeof categoryId === 'number' && Number.isFinite(categoryId) ? { category_id: categoryId } : {}),
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
  }
}

/**
 * Project one category row.
 * @param value - one row of the list.
 * @param where - the endpoint the list came from, for the message.
 * @returns the category.
 * @throws GeoAdminError with code `response` when a required field is missing.
 */
function asCategory(value: unknown, where: string): GeoCategory {
  const record = asRecord(value, where)
  const slug = optionalString(record, 'slug', where)
  const type = optionalString(record, 'type', where)
  const websiteId = record.website_id
  const parentId = record.parent_id
  const active = record.is_active
  return {
    id: requiredNumber(record, 'id', where),
    name: requiredString(record, 'name', where),
    ...(typeof websiteId === 'number' && Number.isFinite(websiteId) ? { website_id: websiteId } : {}),
    ...(slug === undefined ? {} : { slug }),
    ...(type === undefined ? {} : { type }),
    ...(typeof parentId === 'number' && Number.isFinite(parentId) ? { parent_id: parentId } : {}),
    ...(typeof active === 'boolean' ? { is_active: active } : {}),
  }
}

/**
 * Perform one JSON exchange and return its parsed body.
 * @param target - the backend the request goes to.
 * @param method - the HTTP method.
 * @param path - the endpoint path, starting with `/`.
 * @param body - the JSON body to send, when the endpoint takes one.
 * @param token - the bearer token, when the endpoint requires authentication.
 * @param signal - the caller's cancellation signal, combined with the timeout.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the parsed response body.
 * @throws GeoAdminError with code `http` on transport failure or a non-success status,
 *   and `response` when a successful status carries no JSON body.
 */
async function requestJson(
  target: GeoAdminTarget,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  token: string | undefined,
  signal: AbortSignal,
  transport: Transport,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(target.timeoutMs)
  const combined = AbortSignal.any([signal, timeout])
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await transport(endpoint(target, path), {
      method,
      headers,
      // A credential-bearing request must never be forwarded to another origin.
      redirect: 'error',
      signal: combined,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new GeoAdminError('http', `${method} ${path} could not be completed: ${transportFailure(error)}`)
  }
  const text = await response.text()
  let parsed: unknown
  let json = false
  try {
    parsed = JSON.parse(text)
    json = true
  } catch {
    // A non-JSON body is still reported through the status branch below; a
    // successful status with one is a `response` failure.
  }
  if (!response.ok) {
    throw new GeoAdminError('http', `${method} ${path} answered ${response.status}: ${failureMessage(json ? parsed : undefined, text)}`)
  }
  if (!json) throw new GeoAdminError('response', `${method} ${path} did not answer JSON`)
  return parsed
}

/**
 * Sign in and read the sites the account may publish to.
 * @param target - the backend and account to sign in as.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the bearer token and the sites the login response reported.
 * @throws GeoAdminError when the backend rejects the account or answers an unreadable body.
 */
export async function signIn(
  target: GeoAdminTarget,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoSignIn> {
  const body = asRecord(
    await requestJson(target, 'POST', '/api/v1/auth/login', { username: target.username, password: target.password }, undefined, signal, transport),
    'POST /api/v1/auth/login',
  )
  const token = requiredString(body, 'access_token', 'POST /api/v1/auth/login')
  const websites = body.websites === undefined || body.websites === null
    ? []
    : asWebsites(body.websites, 'POST /api/v1/auth/login')
  return { token, websites }
}

/**
 * List the sites the account may publish to: the login response's list, or the
 * site endpoint when that list is empty.
 * @param target - the backend and account to sign in as.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the publishable sites.
 */
export async function listWebsites(
  target: GeoAdminTarget,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoWebsite[]> {
  const signInResult = await signIn(target, signal, transport)
  if (signInResult.websites.length > 0) return signInResult.websites
  const body = asRecord(
    await requestJson(target, 'GET', '/api/v1/websites', undefined, signInResult.token, signal, transport),
    'GET /api/v1/websites',
  )
  return asWebsites(body[DATA], 'GET /api/v1/websites')
}

/**
 * Read one article by id.
 * @param target - the backend and account to sign in as.
 * @param id - the article id.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the stored article.
 */
export async function fetchArticle(
  target: GeoAdminTarget,
  id: number,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoArticle> {
  const { token } = await signIn(target, signal, transport)
  return readArticle(target, id, token, signal, transport)
}

/**
 * Read one article as an already signed-in account.
 * @param target - the backend the request goes to.
 * @param id - the article id.
 * @param token - the bearer token from this call's sign-in.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport.
 * @returns the stored article.
 */
async function readArticle(
  target: GeoAdminTarget,
  id: number,
  token: string,
  signal: AbortSignal,
  transport: Transport,
): Promise<GeoArticle> {
  const path = `/api/v1/news/${String(id)}`
  const body = asRecord(
    await requestJson(target, 'GET', path, undefined, token, signal, transport),
    `GET ${path}`,
  )
  return asArticle(body[DATA], `GET ${path}`)
}

/**
 * Create one article, then read it back so the caller reports the stored record
 * rather than the create response alone.
 * @param target - the backend and account to sign in as.
 * @param draft - the article to create.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the article as stored.
 * @throws GeoAdminError when create or read-back fails; a create is not retried,
 *   because the endpoint has no idempotency key and a blind retry would create a
 *   second article.
 */
export async function publishArticle(
  target: GeoAdminTarget,
  draft: GeoArticleDraft,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoArticle> {
  const { token } = await signIn(target, signal, transport)
  const body = asRecord(
    await requestJson(target, 'POST', '/api/v1/news', draft, token, signal, transport),
    'POST /api/v1/news',
  )
  const created = asArticle(body[DATA], 'POST /api/v1/news')
  return readArticle(target, created.id, token, signal, transport)
}

/**
 * List articles, newest first as the backend orders them.
 * @param target - the backend and account to sign in as.
 * @param query - the filters to apply; absent fields are not sent.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns one page of article summaries.
 */
export async function listNews(
  target: GeoAdminTarget,
  query: GeoNewsQuery,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoPage<GeoNewsSummary>> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/news${queryString({
    website_id: query.website_id,
    category_id: query.category_id,
    search: query.search,
    is_published: query.is_published,
    page: query.page,
    limit: query.limit,
  })}`
  const body = await requestJson(target, 'GET', path, undefined, token, signal, transport)
  return asPage(body, 'GET /api/v1/news', asNewsSummary)
}

/**
 * List content categories.
 * @param target - the backend and account to sign in as.
 * @param query - the filters to apply; absent fields are not sent.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns one page of categories.
 */
export async function listCategories(
  target: GeoAdminTarget,
  query: { website_id?: number; search?: string; page?: number; limit?: number },
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoPage<GeoCategory>> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/categories${queryString({
    website_id: query.website_id,
    search: query.search,
    page: query.page,
    limit: query.limit,
  })}`
  const body = await requestJson(target, 'GET', path, undefined, token, signal, transport)
  return asPage(body, 'GET /api/v1/categories', asCategory)
}

/**
 * Change some fields of an existing article, then read the stored record back.
 * @param target - the backend and account to sign in as.
 * @param id - the article id.
 * @param patch - the fields to change; the backend ignores absent ones.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the article as stored after the update.
 */
export async function updateArticle(
  target: GeoAdminTarget,
  id: number,
  patch: GeoArticlePatch,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoArticle> {
  const { token } = await signIn(target, signal, transport)
  await requestJson(target, 'PUT', `/api/v1/news/${String(id)}`, patch, token, signal, transport)
  return readArticle(target, id, token, signal, transport)
}

/**
 * Delete one article. The backend refuses while publish or placement records
 * reference it; that refusal surfaces as the endpoint's own message.
 * @param target - the backend and account to sign in as.
 * @param id - the article id.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns settlement after the backend accepted the deletion.
 * @throws GeoAdminError when the backend refuses (404, 409, or a permission denial).
 */
export async function deleteArticle(
  target: GeoAdminTarget,
  id: number,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<void> {
  const { token } = await signIn(target, signal, transport)
  await requestJson(target, 'DELETE', `/api/v1/news/${String(id)}`, undefined, token, signal, transport)
}

/**
 * Read one optional field that may arrive as a number or a numeric string, as
 * the task server's flexible integer columns do.
 * @param record - the object holding the field.
 * @param key - the field name.
 * @param where - the endpoint the object came from, for the message.
 * @returns the number, or `undefined` when the field is absent or blank.
 * @throws GeoAdminError with code `response` when the field is present but not numeric.
 */
function optionalNumberLike(record: Record<string, unknown>, key: string, where: string): number | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new GeoAdminError('response', `${where}: "${key}" must be a number`)
}

/**
 * Project one GEO task row.
 * @param value - one row of the dispatch list.
 * @param where - the endpoint the list came from, for the message.
 * @returns the task summary.
 * @throws GeoAdminError with code `response` when a required field is missing.
 */
function asTaskSummary(value: unknown, where: string): GeoTaskSummary {
  const record = asRecord(value, where)
  const websiteId = optionalNumberLike(record, 'website_id', where)
  const batchId = optionalString(record, 'batch_id', where)
  const attemptCount = record.attempt_count
  const maxAttempts = record.max_attempts
  const lastError = optionalString(record, 'last_error_message', where)
  const createdAt = optionalString(record, 'created_at', where)
  const updatedAt = optionalString(record, 'updated_at', where)
  return {
    id: requiredString(record, 'id', where),
    keyword: requiredString(record, 'keyword', where),
    platform: requiredString(record, 'platform', where),
    status: requiredString(record, 'status', where),
    ...(websiteId === undefined ? {} : { website_id: websiteId }),
    ...(batchId === undefined ? {} : { batch_id: batchId }),
    ...(typeof attemptCount === 'number' ? { attempt_count: attemptCount } : {}),
    ...(typeof maxAttempts === 'number' ? { max_attempts: maxAttempts } : {}),
    ...(lastError === undefined ? {} : { last_error_message: lastError }),
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
  }
}

/**
 * Project one page of GEO tasks, which the dispatch route returns flat.
 * @param body - the parsed page object.
 * @param where - the endpoint the page came from, for the message.
 * @returns the page.
 */
function asTaskPage(body: unknown, where: string): GeoTaskPage {
  const record = asRecord(body, where)
  const rows = record.items
  // A Go nil slice marshals as null; both spell "no rows".
  if (rows !== null && !Array.isArray(rows)) throw new GeoAdminError('response', `${where}: "items" must be an array`)
  const items = rows ?? []
  return {
    items: items.map(row => asTaskSummary(row, where)),
    total: requiredNumber(record, 'total_count', where),
    page: requiredNumber(record, 'page', where),
    page_size: requiredNumber(record, 'page_size', where),
  }
}

/**
 * Project the task a retry request returned.
 * @param body - the parsed retry response.
 * @param where - the endpoint the response came from, for the message.
 * @returns the retried task.
 */
function asTaskRetry(body: unknown, where: string): GeoTaskRetry {
  const record = asRecord(body, where)
  const task = asRecord(record.task, where)
  const attemptCount = task.attempt_count
  const maxAttempts = task.max_attempts
  const platform = optionalString(task, 'platform', where)
  const keyword = optionalString(task, 'keyword', where)
  return {
    id: requiredString(task, 'id', where),
    status: requiredString(task, 'status', where),
    ...(typeof attemptCount === 'number' ? { attempt_count: attemptCount } : {}),
    ...(typeof maxAttempts === 'number' ? { max_attempts: maxAttempts } : {}),
    ...(platform === undefined ? {} : { platform }),
    ...(keyword === undefined ? {} : { keyword }),
  }
}

/**
 * Unwrap the task server's `{code, message, data}` success envelope.
 * @param body - the parsed response body.
 * @param where - the endpoint the body came from, for the message.
 * @returns the payload.
 */
function envelopeData(body: unknown, where: string): unknown {
  const record = asRecord(body, where)
  if (!Object.hasOwn(record, 'data')) {
    throw new GeoAdminError('response', `${where}: response carries no "data"`)
  }
  return record.data
}

/**
 * Project one report row.
 * @param value - one row of the cross-site list.
 * @param where - the endpoint the list came from, for the message.
 * @returns the report summary.
 */
function asReportSummary(value: unknown, where: string): GeoReportSummary {
  const record = asRecord(value, where)
  const status = optionalString(record, 'status', where)
  const generatedAt = optionalString(record, 'generated_at', where)
  const submittedAt = optionalString(record, 'submitted_at', where)
  const source = optionalString(record, 'source', where)
  return {
    id: requiredString(record, 'id', where),
    website_id: requiredNumber(record, 'website_id', where),
    site_name: requiredString(record, 'site_name', where),
    total_qa_count: requiredNumber(record, 'total_qa_count', where),
    total_citation_count: requiredNumber(record, 'total_citation_count', where),
    ...(status === undefined ? {} : { status }),
    ...(generatedAt === undefined ? {} : { generated_at: generatedAt }),
    ...(submittedAt === undefined ? {} : { submitted_at: submittedAt }),
    ...(source === undefined ? {} : { source }),
  }
}

/**
 * Project one page of reports.
 * @param data - the unwrapped page payload.
 * @param where - the endpoint the page came from, for the message.
 * @returns the page.
 */
function asReportPage(data: unknown, where: string): GeoReportPage {
  const record = asRecord(data, where)
  const rows = record.items
  if (rows !== null && !Array.isArray(rows)) throw new GeoAdminError('response', `${where}: "items" must be an array`)
  const items = rows ?? []
  return {
    items: items.map(row => asReportSummary(row, where)),
    total: requiredNumber(record, 'total_count', where),
    page: requiredNumber(record, 'page', where),
    page_size: requiredNumber(record, 'page_size', where),
  }
}

/**
 * Project one brand row from a report's ranking.
 * @param value - one ranking entry.
 * @param where - the endpoint the report came from, for the message.
 * @returns the brand row.
 */
function asReportBrand(value: unknown, where: string): GeoReportBrand {
  const record = asRecord(value, where)
  return {
    name: requiredString(record, 'brand_name', where),
    is_self: requiredBoolean(record, 'is_self', where),
    visibility_score: requiredNumber(record, 'visibility_score', where),
    mention_count: requiredNumber(record, 'mention_count', where),
  }
}

/**
 * Project one stored report.
 * @param data - the unwrapped report payload.
 * @param id - the report id the request addressed (the payload omits it).
 * @param where - the endpoint the report came from, for the message.
 * @returns the projected report.
 */
function asReport(data: unknown, id: string, where: string): GeoReport {
  const record = asRecord(data, where)
  const cumulative = record.cumulative_mention_count
  const generatedAt = optionalString(record, 'generated_at', where)
  const qaStart = optionalString(record, 'qa_start_date', where)
  const qaEnd = optionalString(record, 'qa_end_date', where)
  const rankings = record.rankings
  if (rankings !== null && !Array.isArray(rankings)) {
    throw new GeoAdminError('response', `${where}: "rankings" must be an array`)
  }
  // A report whose QA run produced no ranking marshals the field as null.
  const brands = (rankings ?? []).map(entry => asReportBrand(entry, where))
  const self = brands.find(brand => brand.is_self)
  return {
    id,
    website_id: requiredNumber(record, 'website_id', where),
    site_name: requiredString(record, 'site_name', where),
    total_qa_count: requiredNumber(record, 'total_qa_count', where),
    total_citation_count: requiredNumber(record, 'total_citation_count', where),
    ...(typeof cumulative === 'number' ? { cumulative_mention_count: cumulative } : {}),
    ...(generatedAt === undefined ? {} : { generated_at: generatedAt }),
    ...(qaStart === undefined ? {} : { qa_start_date: qaStart }),
    ...(qaEnd === undefined ? {} : { qa_end_date: qaEnd }),
    ...(self === undefined ? {} : { visibility_score: self.visibility_score }),
    brands,
  }
}

/**
 * Project one report-generation job.
 * @param data - the unwrapped job payload.
 * @param where - the endpoint the job came from, for the message.
 * @returns the job.
 */
function asReportJob(data: unknown, where: string): GeoReportJob {
  const record = asRecord(data, where)
  const websiteId = optionalNumberLike(record, 'website_id', where)
  const reportId = optionalString(record, 'report_id', where)
  const error = optionalString(record, 'error_message', where)
  const source = optionalString(record, 'source', where)
  const createdAt = optionalString(record, 'created_at', where)
  const startedAt = optionalString(record, 'started_at', where)
  const finishedAt = optionalString(record, 'finished_at', where)
  return {
    id: requiredString(record, 'id', where),
    status: requiredString(record, 'status', where),
    ...(websiteId === undefined ? {} : { website_id: websiteId }),
    ...(reportId === undefined ? {} : { report_id: reportId }),
    ...(error === undefined ? {} : { error_message: error }),
    ...(source === undefined ? {} : { source }),
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
    ...(startedAt === undefined ? {} : { started_at: startedAt }),
    ...(finishedAt === undefined ? {} : { finished_at: finishedAt }),
  }
}

/**
 * List GEO keyword tasks dispatched to the browser clients that run them.
 * @param target - the backend and account to sign in as.
 * @param query - the filters to apply; absent fields are not sent.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns one page of tasks.
 */
export async function listTasks(
  target: GeoAdminTarget,
  query: GeoTaskQuery,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoTaskPage> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/geo-tasks${queryString({
    website_id: query.website_id,
    batch_id: query.batch_id,
    platform: query.platform,
    status: query.status,
    q: query.q,
    page: query.page,
    page_size: query.page_size,
  })}`
  return asTaskPage(await requestJson(target, 'GET', path, undefined, token, signal, transport), 'GET /api/v1/geo-tasks')
}

/**
 * Retry one failed GEO task.
 * @param target - the backend and account to sign in as.
 * @param id - the task id.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the task as the retry left it.
 * @throws GeoAdminError when the backend refuses the retry (unknown id or an
 *   attempt ceiling already reached).
 */
export async function retryTask(
  target: GeoAdminTarget,
  id: string,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoTaskRetry> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/geo-tasks/${encodeURIComponent(id)}/retry`
  return asTaskRetry(await requestJson(target, 'POST', path, undefined, token, signal, transport), `POST ${path}`)
}

/**
 * List brand-visibility reports across the account's sites.
 * @param target - the backend and account to sign in as.
 * @param query - the filters to apply; absent fields are not sent.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns one page of report summaries.
 */
export async function listReports(
  target: GeoAdminTarget,
  query: GeoReportQuery,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoReportPage> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/brand-visibility/admin/reports${queryString({
    website_id: query.website_id,
    site_name: query.site_name,
    status: query.status,
    source: query.source,
    start_date: query.start_date,
    end_date: query.end_date,
    page: query.page,
    page_size: query.page_size,
  })}`
  const body = await requestJson(target, 'GET', path, undefined, token, signal, transport)
  return asReportPage(envelopeData(body, 'GET /api/v1/brand-visibility/admin/reports'), 'GET /api/v1/brand-visibility/admin/reports')
}

/**
 * Read one stored brand-visibility report.
 * @param target - the backend and account to sign in as.
 * @param id - the report id.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the report, with its ranking.
 */
export async function getReport(
  target: GeoAdminTarget,
  id: string,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoReport> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/brand-visibility/admin/reports/${encodeURIComponent(id)}`
  const data = envelopeData(await requestJson(target, 'GET', path, undefined, token, signal, transport), `GET ${path}`)
  return asReport(data, id, `GET ${path}`)
}

/**
 * Start one report generation for a site.
 * @param target - the backend and account to sign in as.
 * @param request - the site and optional QA window.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the generation job the backend started.
 */
export async function generateReport(
  target: GeoAdminTarget,
  request: GeoReportRequest,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoReportJob> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/brand-visibility/report/generate${queryString({
    website_id: request.website_id,
    qa_start_date: request.qa_start_date,
    qa_end_date: request.qa_end_date,
    source: request.source,
    force: request.force === true ? true : undefined,
    run_async: true,
  })}`
  const data = envelopeData(await requestJson(target, 'POST', path, undefined, token, signal, transport), `POST ${path}`)
  return asReportJob(data, `POST ${path}`)
}

/**
 * Read one report-generation job.
 * @param target - the backend and account to sign in as.
 * @param id - the job id.
 * @param signal - the caller's cancellation signal.
 * @param transport - the HTTP transport; defaults to the platform fetch.
 * @returns the job.
 */
export async function getReportJob(
  target: GeoAdminTarget,
  id: string,
  signal: AbortSignal,
  transport: Transport = fetch,
): Promise<GeoReportJob> {
  const { token } = await signIn(target, signal, transport)
  const path = `/api/v1/brand-visibility/report/jobs/${encodeURIComponent(id)}`
  const data = envelopeData(await requestJson(target, 'GET', path, undefined, token, signal, transport), `GET ${path}`)
  return asReportJob(data, `GET ${path}`)
}
