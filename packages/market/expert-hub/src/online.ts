/**
 * HTTP client for the token-api expert hub: plaza listing, per-user upload,
 * and module download. The host stamps nothing itself; the signed-in gateway
 * key is the author.
 * @module @deepseek-ai/dsh-expert-hub/online
 */

import { listPublishedExperts, publishExpert, readPublishedExpert, type ExpertPublisher } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'
import type { ExpertModuleCard, ExpertModuleResult, ExpertVersionRow } from './types.ts'

/** Gateway origin used when the plugin config omits one. */
export const DEFAULT_EXPERT_HUB_ORIGIN = 'https://claw.deepagens.com'

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

interface ModuleDocument {
  id: string
  name: string
  description: string
  persona: string
  skillMarkdown: string
  category: string
  subtitle: string
  icon: string
  tags: string[]
  quickPrompts: string[]
  slug: string
  version: string
}

/**
 * List published expert modules.
 * @param origin - token-api origin, without a trailing slash.
 * @param fetchImpl - HTTP implementation; tests pass a stub.
 * @returns the plaza cards, or a failure message.
 */
export async function fetchExpertPlaza(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; cards: ExpertModuleCard[] } | { ok: false; message: string }> {
  return readCards(await callJson(origin, '/api/expert-hub/items?kind=expert&pageSize=100', undefined, fetchImpl), 'id')
}

/**
 * Upload one local expert. The same version with different text is rejected by
 * the server, so a rejection that names the version is retried once at the next patch.
 * @param origin - token-api origin.
 * @param token - the signed-in gateway key.
 * @param publisher - the local expert directory and roster.
 * @param id - roster id of a saved expert.
 * @param fetchImpl - HTTP implementation.
 * @returns the public slug and version, or why the upload stopped.
 */
export async function publishLocalExpert(
  origin: string,
  token: string,
  publisher: ExpertPublisher,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExpertModuleResult> {
  const stored = await readPublishedExpert(publisher.root, id)
  if (stored === undefined) return { ok: false, message: '这个专家还没有保存在本机，不能上传' }
  if (stored.origin === 'plaza') return { ok: false, message: '从广场安装的专家不能再上传' }
  const version = stored.version ?? '1.0.0'
  const first = await postModule(origin, token, stored, version, fetchImpl)
  if (first.ok || !first.message.includes(version)) return finishPublish(publisher, stored, first)
  const bumped = bumpVersion(version)
  const second = await postModule(origin, token, stored, bumped, fetchImpl)
  return finishPublish(publisher, stored, second)
}

/**
 * Download one plaza module and register it on the live roster.
 * @param origin - token-api origin.
 * @param publisher - the local expert directory and roster.
 * @param slug - public slug.
 * @param fetchImpl - HTTP implementation.
 * @returns the installed slug and version, or why it stopped.
 */
export async function installExpertModule(
  origin: string,
  publisher: ExpertPublisher,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExpertModuleResult> {
  if (!ID_PATTERN.test(slug)) return { ok: false, message: '专家 id 不能安装到本机名单' }
  const response = await callJson(origin, `/api/expert-hub/items/${encodeURIComponent(slug)}/module`, undefined, fetchImpl)
  if (!response.ok) return response
  const data = response.data
  if (data === undefined) return { ok: false, message: '专家内容是空的' }
  const document = moduleOf(data, slug)
  if (document === undefined) return { ok: false, message: '专家内容缺少名称或人设' }
  const outcome = await publishExpert(publisher, {
    id: slug,
    name: document.name,
    description: document.description,
    persona: document.persona,
    category: document.category,
    subtitle: document.subtitle,
    icon: document.icon,
    tags: document.tags,
    quickPrompts: document.quickPrompts,
    skillMarkdown: document.skillMarkdown,
    version: document.version,
    remoteSlug: slug,
    origin: 'plaza',
  })
  if (!outcome.ok) return { ok: false, message: outcome.reason }
  return { ok: true, slug, version: document.version }
}

/**
 * Roster ids whose saved file this account may upload.
 * @param root - published-experts directory.
 * @returns ids that are not plaza installs.
 */
export async function uploadableExpertIds(root: string): Promise<readonly string[]> {
  const stored = await listPublishedExperts(root)
  return stored.filter(expert => expert.origin !== 'plaza').map(expert => expert.id)
}

/**
 * Pair saved versions with the plaza version a plaza install can update to.
 * A card this account uploaded keeps its local version only: downloading the
 * public slug would register a second roster id.
 * @param stored - experts saved on this machine.
 * @param remote - plaza slug to published version.
 * @param shipped - versions recorded for shipped presets that have no saved file.
 * @returns one row per saved or shipped version.
 */
export function versionRows(
  stored: readonly {
    id: string
    version?: string
    remoteSlug?: string
    origin?: 'mine' | 'plaza'
  }[],
  remote: ReadonlyMap<string, string>,
  shipped: ReadonlyMap<string, string> = new Map(),
): ExpertVersionRow[] {
  const entries: ExpertVersionRow[] = []
  const seen = new Set<string>()
  for (const expert of stored) {
    if (expert.version === undefined) continue
    seen.add(expert.id)
    const remoteVersion = expert.origin === 'plaza'
      ? remote.get(expert.remoteSlug ?? expert.id)
      : undefined
    entries.push({
      id: expert.id,
      version: expert.version,
      ...(remoteVersion === undefined ? {} : { remoteVersion }),
    })
  }
  for (const [id, version] of shipped) {
    if (seen.has(id)) continue
    entries.push({ id, version })
  }
  return entries
}

/**
 * Versions already saved locally, keyed by plaza slug.
 * @param root - published-experts directory.
 * @returns slug to version.
 */
/**
 * Local roster id encoded in a slug this account published.
 * The public id is `u{ownerId}-{localId}`.
 * @param slug - plaza slug.
 * @param ownerId - account id stamped on that module.
 * @returns the local id, when the slug uses that prefix and the remainder is a roster id.
 */
export function localIdFromOwnerSlug(slug: string, ownerId: number): string | undefined {
  if (!Number.isInteger(ownerId) || ownerId <= 0) return undefined
  const prefix = `u${String(ownerId)}-`
  if (!slug.startsWith(prefix)) return undefined
  const localId = slug.slice(prefix.length)
  return /^[a-z][a-z0-9-]{0,63}$/.test(localId) ? localId : undefined
}

/** One module this account published, tied back to its local roster id. */
export interface OwnedExpertModule {
  readonly slug: string
  readonly version: string
  readonly localId: string
}

/**
 * List modules the signed-in account published.
 * @param origin - token-api origin.
 * @param token - the signed-in gateway key.
 * @param fetchImpl - HTTP implementation.
 * @returns those modules. A transport failure names the reason.
 */
export async function fetchOwnedExpertModules(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; modules: OwnedExpertModule[] } | { ok: false; message: string }> {
  const response = await callJson(origin, '/api/expert-hub/mine', { token }, fetchImpl)
  if (!response.ok) return response
  const items = response.data?.items
  if (!Array.isArray(items)) return { ok: true, modules: [] }
  const modules: OwnedExpertModule[] = []
  for (const item of items) {
    if (!isRecord(item)) continue
    const slug = item.slug
    const version = item.version
    const ownerId = item.owner_id
    if (typeof slug !== 'string' || typeof version !== 'string' || typeof ownerId !== 'number') continue
    const localId = localIdFromOwnerSlug(slug, ownerId)
    if (localId === undefined) continue
    modules.push({ slug, version, localId })
  }
  return { ok: true, modules }
}

export async function installedExpertVersions(root: string): Promise<ReadonlyMap<string, string>> {
  const stored = await listPublishedExperts(root)
  const versions = new Map<string, string>()
  for (const expert of stored) {
    if (expert.version === undefined) continue
    versions.set(expert.remoteSlug ?? expert.id, expert.version)
  }
  return versions
}

async function finishPublish(
  publisher: ExpertPublisher,
  stored: Awaited<ReturnType<typeof readPublishedExpert>> & object,
  result: ExpertModuleResult,
): Promise<ExpertModuleResult> {
  if (!result.ok) return result
  const outcome = await publishExpert(publisher, {
    ...stored,
    version: result.version,
    remoteSlug: result.slug,
    origin: 'mine',
  })
  if (!outcome.ok) return { ok: false, message: outcome.reason }
  return result
}

/** Fields posted as one expert module. */
export interface ExpertUploadDocument {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly persona: string
  readonly skillMarkdown: string
  readonly category: string
  readonly subtitle: string
  readonly icon: string
  readonly tags: readonly string[]
  readonly quickPrompts: readonly string[]
  readonly remoteSlug?: string
  readonly version: string
}

/**
 * Upload one expert document. A rejection that names the sent version is retried once at the next patch.
 * @param origin - token-api origin.
 * @param token - the signed-in gateway key.
 * @param document - card fields, persona, and skill text.
 * @param fetchImpl - HTTP implementation.
 * @returns the public slug and version, or why the upload stopped.
 */
export async function publishExpertDocument(
  origin: string,
  token: string,
  document: ExpertUploadDocument,
  fetchImpl: typeof fetch = fetch,
): Promise<ExpertModuleResult> {
  const first = await postModule(origin, token, document, document.version, fetchImpl)
  if (first.ok || !first.message.includes(document.version)) return first
  return postModule(origin, token, document, bumpVersion(document.version), fetchImpl)
}

/**
 * Read one published module without installing it.
 * @param origin - token-api origin.
 * @param slug - public slug.
 * @param fetchImpl - HTTP implementation.
 * @returns the module, or undefined when the id cannot be read.
 */
export async function readRemoteExpert(
  origin: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ slug: string; name: string; description: string; persona: string; skillMarkdown: string } | undefined> {
  if (!ID_PATTERN.test(slug)) return undefined
  const response = await callJson(origin, `/api/expert-hub/items/${encodeURIComponent(slug)}/module`, undefined, fetchImpl)
  if (!response.ok || response.data === undefined) return undefined
  return moduleOf(response.data, slug)
}

async function postModule(
  origin: string,
  token: string,
  stored: ExpertUploadDocument | NonNullable<Awaited<ReturnType<typeof readPublishedExpert>>>,
  version: string,
  fetchImpl: typeof fetch,
): Promise<ExpertModuleResult> {
  const response = await callJson(origin, '/api/expert-hub/items', {
    token,
    body: {
      id: stored.id,
      ...(stored.remoteSlug === undefined ? {} : { slug: stored.remoteSlug }),
      name: stored.name,
      description: stored.description,
      persona: stored.persona,
      skill_markdown: stored.skillMarkdown,
      version,
      category: stored.category,
      subtitle: stored.subtitle,
      icon: stored.icon,
      tags: stored.tags,
      quick_prompts: stored.quickPrompts,
    },
  }, fetchImpl)
  if (!response.ok) return response
  const data = response.data
  if (data === undefined) return { ok: false, message: '上传没有返回专家 id' }
  const slug = typeof data.slug === 'string' ? data.slug : undefined
  const nextVersion = typeof data.version === 'string' ? data.version : undefined
  if (slug === undefined || nextVersion === undefined) return { ok: false, message: '上传没有返回专家 id' }
  return { ok: true, slug, version: nextVersion }
}

function bumpVersion(version: string): string {
  const [major, minor = '0', patchText = '0'] = version.split('.')
  const patch = Number(patchText)
  const next = Number.isFinite(patch) ? patch + 1 : 1
  return `${major}.${minor}.${String(next)}`
}

async function readCards(
  response: { ok: true; data?: Record<string, unknown> } | { ok: false; message: string },
  idKey: 'id' | 'slug',
): Promise<{ ok: true; cards: ExpertModuleCard[] } | { ok: false; message: string }> {
  if (!response.ok) return response
  const items = response.data?.items
  if (!Array.isArray(items)) return { ok: true, cards: [] }
  const cards: ExpertModuleCard[] = []
  for (const item of items) {
    const card = cardOf(item, idKey)
    if (card !== undefined) cards.push(card)
  }
  return { ok: true, cards }
}

function cardOf(value: unknown, idKey: 'id' | 'slug'): ExpertModuleCard | undefined {
  if (!isRecord(value)) return undefined
  const slug = value[idKey]
  const name = value.name
  const version = value.version
  if (typeof slug !== 'string' || slug === '' || typeof name !== 'string' || typeof version !== 'string') return undefined
  const description = typeof value.description === 'string' && value.description !== '' ? value.description : undefined
  const category = typeof value.category === 'string' && value.category !== '' ? value.category : undefined
  const tags = stringList(value.tags)
  const author = authorName(value.author)
  return {
    slug,
    name,
    version,
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    ...(tags === undefined ? {} : { tags }),
    ...(author === undefined ? {} : { author }),
  }
}

function moduleOf(data: Record<string, unknown>, slug: string): ModuleDocument | undefined {
  const name = data.name
  const description = data.description
  const persona = data.persona
  const version = data.version
  if (typeof name !== 'string' || typeof description !== 'string' || typeof persona !== 'string' || typeof version !== 'string') {
    return undefined
  }
  return {
    id: typeof data.id === 'string' && data.id !== '' ? data.id : slug,
    name,
    description,
    persona,
    skillMarkdown: typeof data.skill_markdown === 'string' ? data.skill_markdown : '',
    category: categoryOf(data.category),
    subtitle: typeof data.subtitle === 'string' ? data.subtitle : '',
    icon: typeof data.icon === 'string' ? data.icon : '',
    tags: stringList(data.tags) ?? [],
    quickPrompts: stringList(data.quick_prompts) ?? [],
    slug,
    version,
  }
}

function categoryOf(value: unknown): string {
  if (typeof value !== 'string') return 'general'
  const category = value.trim().toLowerCase()
  return /^[a-z][a-z0-9-]{0,31}$/.test(category) ? category : 'general'
}

function authorName(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (!isRecord(value)) return undefined
  return typeof value.name === 'string' && value.name !== '' ? value.name : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined
  return value
}

async function callJson(
  origin: string,
  path: string,
  init: { token?: string; body?: unknown } | undefined,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: init?.body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init?.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return { ok: false, message: '专家广场没有返回 JSON' }
  }
  if (!isRecord(parsed) || parsed.success !== true) {
    const message = isRecord(parsed) && typeof parsed.message === 'string' && parsed.message !== ''
      ? parsed.message
      : `专家广场请求失败 (${String(response.status)})`
    return { ok: false, message }
  }
  return { ok: true, ...(isRecord(parsed.data) ? { data: parsed.data } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
