/**
 * Persist one expert under the harness home and register it on the live roster.
 * @module @deepseek-ai/dsh-expert-publish/publish
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { fallbackPersona, type ParsedExpertShare } from './share.ts'

/** Fields the model supplies. Limits are checked here, not only by the tool schema. */
export interface ExpertDraft {
  /** Roster id. Lowercase slug. */
  readonly id: string
  /** Card title. */
  readonly name: string
  /** Card description. */
  readonly description: string
  /** System prompt for sessions hired as this expert. */
  readonly persona: string
  /** Expert-page category. Defaults to marketing. */
  readonly category?: string
  /** Card subtitle. */
  readonly subtitle?: string
  /** Card tags. */
  readonly tags?: readonly string[]
  /** Suggested first messages. */
  readonly quickPrompts?: readonly string[]
  /** Card glyph. */
  readonly icon?: string
  /** Skill body. A missing body gets a short default. */
  readonly skillMarkdown?: string
  /** Published semver. Omitted on a card that has not been uploaded. */
  readonly version?: string
  /** Plaza slug, when this card was uploaded or installed from the plaza. */
  readonly remoteSlug?: string
  /** `mine` for a card this account uploaded; `plaza` for one it installed. */
  readonly origin?: 'mine' | 'plaza'
}

/** Live registration the publisher keeps so a later publish of the same id can replace it. */
export interface ExpertPublisher {
  /** Directory that holds one subdirectory per published expert. */
  readonly root: string
  /** Ids this publisher registered, with the disposer that removes that registration. */
  readonly owned: Map<string, () => Promise<void>>
  /**
   * Register one definition on the roster.
   * @param definition - card metadata and child plugins.
   * @returns the disposer that removes the registration.
   */
  register(definition: PresetDefinition): Promise<() => Promise<void>>
  /**
   * Whether the roster already has this id, including definitions this publisher does not own.
   * @param id - roster id.
   * @returns true when a row with that id is registered.
   */
  hasId(id: string): Promise<boolean>
}

/** Outcome returned to the model. */
export type PublishOutcome =
  | { ok: true; id: string; name: string; replaced: boolean }
  | { ok: false; id: string; name: string; replaced: false; reason: string }

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const CATEGORY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const LIMITS = {
  name: 80,
  description: 500,
  persona: 32000,
  skill: 64000,
  tag: 24,
  tags: 8,
  prompts: 6,
  prompt: 200,
  subtitle: 40,
  icon: 8,
} as const

/**
 * Write the expert and register it. An id this publisher already owns is replaced.
 * An id owned by the deployment is refused.
 * @param publisher - roster registration and the directory that persists experts.
 * @param draft - the expert to publish.
 * @returns the roster outcome. Validation failures stay in the value.
 */
export async function publishExpert(publisher: ExpertPublisher, draft: ExpertDraft): Promise<PublishOutcome> {
  const reason = problemWith(draft)
  if (reason !== undefined) return { ok: false, id: draft.id, name: draft.name, replaced: false, reason }
  const replaced = publisher.owned.has(draft.id)
  if (!replaced && await publisher.hasId(draft.id)) {
    return { ok: false, id: draft.id, name: draft.name, replaced: false, reason: `id "${draft.id}" is already on the roster` }
  }
  const directory = join(publisher.root, draft.id)
  const stored = storedOf(draft)
  await mkdir(join(directory, 'skills', 'published-expert'), { recursive: true })
  await writeFile(join(directory, 'skills', 'published-expert', 'SKILL.md'), skillDocument(stored), 'utf8')
  await writeFile(join(directory, 'expert.json'), `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  if (replaced) {
    const previous = publisher.owned.get(draft.id)
    publisher.owned.delete(draft.id)
    /* v8 ignore next -- owned.has(id) was true on this map in the same call. */
    if (previous !== undefined) await previous()
  }
  const dispose = await publisher.register(definitionOf(publisher.root, stored))
  publisher.owned.set(draft.id, dispose)
  return { ok: true, id: draft.id, name: stored.name, replaced }
}

/**
 * Register every expert JSON file under `publisher.root`.
 * A missing directory is the first-run case. A directory that is not a directory throws.
 * One unreadable expert is skipped.
 * @param publisher - roster registration and the directory that persists experts.
 */
/**
 * Read one saved expert. A missing or unreadable file is an empty result.
 * @param root - directory that holds one subdirectory per expert.
 * @param id - roster id.
 * @returns the saved expert, or undefined when the id has no readable file.
 */
export async function readPublishedExpert(root: string, id: string): Promise<StoredExpert | undefined> {
  if (!ID_PATTERN.test(id)) return undefined
  return readStored(join(root, id, 'expert.json'))
}

/**
 * Read every saved expert. A missing directory is an empty list.
 * @param root - directory that holds one subdirectory per expert.
 * @returns the experts whose files parsed.
 */
export async function listPublishedExperts(root: string): Promise<StoredExpert[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const stored: StoredExpert[] = []
  for (const name of names) {
    const expert = await readStored(join(root, name, 'expert.json'))
    if (expert !== undefined) stored.push(expert)
  }
  return stored
}

export async function loadPublishedExperts(publisher: ExpertPublisher): Promise<void> {
  let names: string[]
  try {
    names = await readdir(publisher.root)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  for (const name of names) {
    const stored = await readStored(join(publisher.root, name, 'expert.json'))
    if (stored === undefined || publisher.owned.has(stored.id)) continue
    if (await publisher.hasId(stored.id)) continue
    const dispose = await publisher.register(definitionOf(publisher.root, stored))
    publisher.owned.set(stored.id, dispose)
  }
}

/**
 * Resolve the directory published experts live in.
 * @param configured - explicit directory from plugin config, or undefined for the harness home.
 * @param fallback - directory used when config omits `root`.
 * @returns the absolute directory.
 */
export function resolveExpertRoot(configured: string | undefined, fallback: string): string {
  if (configured === undefined) return fallback
  const root = configured.trim()
  if (root === '') throw new Error('expert-publish: `root` must be a non-empty directory path')
  return root
}

/**
 * Why a draft cannot be stored, or undefined when it meets the field limits.
 * @param draft - the expert to check.
 * @returns the first limit it breaks.
 */
export function expertDraftProblem(draft: ExpertDraft): string | undefined {
  return problemWith(draft)
}

/**
 * Trim card fields to the store limits. An invalid category becomes `general`.
 * @param draft - the expert to fit.
 * @returns a draft whose text fields are within the limits.
 */
export function fitExpertDraft(draft: ExpertDraft): ExpertDraft & { readonly category: string } {
  const category = draft.category !== undefined && CATEGORY_PATTERN.test(draft.category) ? draft.category : 'general'
  return {
    ...draft,
    name: draft.name.slice(0, LIMITS.name),
    description: draft.description.slice(0, LIMITS.description),
    persona: draft.persona.slice(0, LIMITS.persona),
    category,
    ...(draft.subtitle === undefined ? {} : { subtitle: draft.subtitle.slice(0, LIMITS.subtitle) }),
    ...(draft.icon === undefined ? {} : { icon: draft.icon.slice(0, LIMITS.icon) }),
    ...(draft.skillMarkdown === undefined ? {} : { skillMarkdown: draft.skillMarkdown.slice(0, LIMITS.skill) }),
    ...(draft.tags === undefined ? {} : {
      tags: draft.tags.slice(0, LIMITS.tags).map(tag => tag.slice(0, LIMITS.tag)).filter(tag => tag.trim() !== ''),
    }),
    ...(draft.quickPrompts === undefined ? {} : {
      quickPrompts: draft.quickPrompts
        .slice(0, LIMITS.prompts)
        .map(prompt => prompt.slice(0, LIMITS.prompt))
        .filter(prompt => prompt.trim() !== ''),
    }),
  }
}

function problemWith(draft: ExpertDraft): string | undefined {
  if (!ID_PATTERN.test(draft.id)) return 'id must be a lowercase slug (letters, digits, hyphens)'
  if (draft.name.trim() === '' || draft.name.length > LIMITS.name) return `name must be 1–${String(LIMITS.name)} characters`
  if (draft.description.trim() === '' || draft.description.length > LIMITS.description) {
    return `description must be 1–${String(LIMITS.description)} characters`
  }
  if (draft.persona.trim() === '' || draft.persona.length > LIMITS.persona) {
    return `persona must be 1–${String(LIMITS.persona)} characters`
  }
  if (draft.category !== undefined && !CATEGORY_PATTERN.test(draft.category)) return 'category must be a lowercase slug'
  if (draft.subtitle !== undefined && draft.subtitle.length > LIMITS.subtitle) return 'subtitle is too long'
  if (draft.icon !== undefined && draft.icon.length > LIMITS.icon) return 'icon is too long'
  if (draft.skillMarkdown !== undefined && draft.skillMarkdown.length > LIMITS.skill) return 'skillMarkdown is too long'
  const tags = draft.tags ?? []
  if (tags.length > LIMITS.tags || tags.some(tag => tag.trim() === '' || tag.length > LIMITS.tag)) {
    return `tags accepts at most ${String(LIMITS.tags)} items of ${String(LIMITS.tag)} characters`
  }
  const prompts = draft.quickPrompts ?? []
  if (prompts.length > LIMITS.prompts || prompts.some(prompt => prompt.trim() === '' || prompt.length > LIMITS.prompt)) {
    return `quickPrompts accepts at most ${String(LIMITS.prompts)} items of ${String(LIMITS.prompt)} characters`
  }
  return undefined
}

interface StoredExpert {
  id: string
  name: string
  description: string
  persona: string
  category: string
  subtitle: string
  tags: string[]
  quickPrompts: string[]
  icon: string
  skillMarkdown: string
  version?: string
  remoteSlug?: string
  origin?: 'mine' | 'plaza'
}

function storedOf(draft: ExpertDraft): StoredExpert {
  const share: ParsedExpertShare = { name: draft.name.trim(), description: draft.description.trim() }
  return {
    id: draft.id,
    name: share.name,
    description: share.description,
    persona: draft.persona,
    category: draft.category ?? 'marketing',
    subtitle: draft.subtitle ?? '我的专家',
    tags: [...draft.tags ?? []],
    quickPrompts: [...draft.quickPrompts ?? []],
    icon: draft.icon ?? '🎯',
    skillMarkdown: draft.skillMarkdown ?? fallbackPersona(share),
    ...(draft.version === undefined ? {} : { version: draft.version }),
    ...(draft.remoteSlug === undefined ? {} : { remoteSlug: draft.remoteSlug }),
    ...(draft.origin === undefined ? {} : { origin: draft.origin }),
  }
}

function definitionOf(root: string, stored: StoredExpert): PresetDefinition {
  const directory = join(root, stored.id)
  const windows = process.platform === 'win32'
  return {
    id: stored.id,
    name: stored.name,
    description: stored.description,
    order: 200,
    category: stored.category,
    subtitle: stored.subtitle,
    tags: stored.tags,
    quickPrompts: stored.quickPrompts,
    icon: stored.icon,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: stored.persona } },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: !windows },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: windows },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      {
        id: 'tool-fs-search',
        name: '@deepseek-ai/dsh-tool-fs-search',
        config: { sampleOverCapGlobResults: false },
      },
      { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
      {
        id: 'skill-filesystem',
        name: '@deepseek-ai/dsh-skill-filesystem',
        config: { customSkillDirs: [join(directory, 'skills')] },
      },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    ],
  }
}

function skillDocument(stored: StoredExpert): string {
  const body = stored.skillMarkdown.startsWith('---\n')
    ? stored.skillMarkdown
    : `---\nname: published-expert\ndescription: ${stored.description.replaceAll(/\s+/g, ' ')}\n---\n\n${stored.skillMarkdown.trim()}\n`
  return body.endsWith('\n') ? body : `${body}\n`
}

async function readStored(path: string): Promise<StoredExpert | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isStored(value)) return undefined
  const row = value as StoredExpert & Record<string, unknown>
  return {
    ...value,
    ...(typeof row.version === 'string' && row.version !== '' ? { version: row.version } : {}),
    ...(typeof row.remoteSlug === 'string' && row.remoteSlug !== '' ? { remoteSlug: row.remoteSlug } : {}),
    ...(row.origin === 'mine' || row.origin === 'plaza' ? { origin: row.origin } : {}),
  }
}

function isStored(value: unknown): value is StoredExpert {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && ID_PATTERN.test(row.id)
    && typeof row.name === 'string' && row.name.trim() !== ''
    && typeof row.description === 'string'
    && typeof row.persona === 'string' && row.persona.trim() !== ''
    && typeof row.category === 'string'
    && typeof row.subtitle === 'string'
    && typeof row.icon === 'string'
    && typeof row.skillMarkdown === 'string'
    && stringList(row.tags)
    && stringList(row.quickPrompts)
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/* v8 ignore start -- Node filesystem rejections are objects with a string code; callers distinguish ENOENT from every other code. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' ? code : undefined
}
/* v8 ignore stop */
