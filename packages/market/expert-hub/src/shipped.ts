/**
 * Read a deployment-shipped expert directory so it can be shown and uploaded.
 * Copies under `.agent-presets` are package installs and stay off this path.
 * @module @deepseek-ai/dsh-expert-hub/shipped
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expertDraftProblem, fitExpertDraft } from '@deepseek-ai/dsh-expert-publish/src/publish.ts'

/** Roster fields needed to turn a preset directory into an upload document. */
export interface ShippedPresetRow {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly category?: string
  readonly subtitle?: string
  readonly icon?: string
  readonly tags?: readonly string[]
  readonly quickPrompts?: readonly string[]
}

/** One shipped expert ready to upload or show. */
export interface ShippedExpert {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly persona: string
  readonly category: string
  readonly subtitle: string
  readonly icon: string
  readonly tags: readonly string[]
  readonly quickPrompts: readonly string[]
  readonly skillMarkdown: string
  readonly skillNames: readonly string[]
}

/**
 * Whether this directory is a package copy under the user preset root.
 * @param directory - preset directory.
 * @returns true when a path segment is `.agent-presets`.
 */
export function isPackagedPresetDirectory(directory: string): boolean {
  return directory.split(/[\\/]/).includes('.agent-presets')
}

/**
 * Whether the roster row is an expert card rather than a session mode.
 * Matches `isExpertPreset` in the preset registry.
 * @param row - roster display fields.
 * @returns true when the row publishes card metadata.
 */
export function isShippedExpertRow(row: ShippedPresetRow): boolean {
  if (row.category !== undefined) return true
  return (row.tags?.length ?? 0) > 0 || (row.quickPrompts?.length ?? 0) > 0
}

/** Roster lookup the gateway already has. */
export interface ShippedPresetSource {
  /**
   * Read the current roster.
   * @returns every declared preset.
   */
  list(): Promise<readonly ShippedPresetRow[]>
  /**
   * Directory recorded for one preset.
   * @param id - preset id.
   * @returns the directory, or undefined when the preset has none.
   */
  directoryOf(id: string): string | undefined
}

/**
 * Shipped experts the roster can upload.
 * @param source - roster and directories, or undefined when the registry is absent.
 * @returns experts with a persona file outside `.agent-presets`.
 */
export async function collectShippedExperts(source: ShippedPresetSource | undefined): Promise<ShippedExpert[]> {
  if (source === undefined) return []
  const rows = await source.list()
  const experts: ShippedExpert[] = []
  for (const row of rows) {
    const directory = source.directoryOf(row.id)
    if (directory === undefined) continue
    const expert = await readShippedExpert(directory, row)
    if (expert !== undefined) experts.push(expert)
  }
  return experts
}

/**
 * Read persona and skills from a shipped preset directory.
 * @param directory - directory that holds `agent.cordis.yml` and `skills/`.
 * @param row - roster metadata for the same id.
 * @returns the expert, or undefined when it is not an uploadable shipped expert.
 */
export async function readShippedExpert(directory: string, row: ShippedPresetRow): Promise<ShippedExpert | undefined> {
  if (!isShippedExpertRow(row) || isPackagedPresetDirectory(directory)) return undefined
  let composition: string
  try {
    composition = await readFile(join(directory, 'agent.cordis.yml'), 'utf8')
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const persona = personaBlock(composition)
  if (persona === undefined) return undefined
  const skills = await skillsIn(directory)
  const description = (row.description ?? row.name ?? row.id).trim()
  const draft = fitExpertDraft({
    id: row.id,
    name: (row.name ?? row.id).trim(),
    description: description === '' ? row.id : description,
    persona,
    category: row.category ?? 'general',
    ...(row.subtitle === undefined ? {} : { subtitle: row.subtitle }),
    ...(row.icon === undefined ? {} : { icon: row.icon }),
    ...(row.tags === undefined ? {} : { tags: [...row.tags] }),
    ...(row.quickPrompts === undefined ? {} : { quickPrompts: [...row.quickPrompts] }),
    ...(skills.markdown === '' ? {} : { skillMarkdown: skills.markdown }),
  })
  if (expertDraftProblem(draft) !== undefined) return undefined
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    persona: draft.persona,
    category: draft.category,
    subtitle: draft.subtitle ?? '',
    icon: draft.icon ?? '',
    tags: draft.tags ?? [],
    quickPrompts: draft.quickPrompts ?? [],
    skillMarkdown: draft.skillMarkdown ?? '',
    skillNames: skills.names,
  }
}

/**
 * Persona literal under `prefix: |` in an agent composition.
 * @param text - `agent.cordis.yml` text.
 * @returns the persona, or undefined when the file has none.
 */
export function personaBlock(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*prefix:\s*\|-?\s*$/.test(line))
  if (header < 0) return undefined
  const content: string[] = []
  let contentIndent: number | undefined
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === '') {
      if (contentIndent !== undefined) content.push('')
      continue
    }
    const indent = line.search(/\S/)
    if (contentIndent === undefined) contentIndent = indent
    if (indent < contentIndent) break
    content.push(line.slice(contentIndent))
  }
  const persona = content.join('\n').trim()
  return persona === '' ? undefined : persona
}

async function skillsIn(directory: string): Promise<{ names: string[]; markdown: string }> {
  let entries: string[]
  try {
    entries = await readdir(join(directory, 'skills'))
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return { names: [], markdown: '' }
    throw error
  }
  const names: string[] = []
  const parts: string[] = []
  for (const entry of entries) {
    let text: string
    try {
      text = await readFile(join(directory, 'skills', entry, 'SKILL.md'), 'utf8')
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') continue
      throw error
    }
    names.push(skillTitle(text, entry))
    parts.push(text.trim())
  }
  return { names, markdown: parts.join('\n\n') }
}

function skillTitle(markdown: string, fallback: string): string {
  const end = markdown.startsWith('---') ? markdown.indexOf('\n---', 3) : -1
  const head = end > 0 ? markdown.slice(0, end) : ''
  const named = /^name:\s*(.+)$/m.exec(head)
  if (named?.[1] !== undefined && named[1].trim() !== '') return named[1].trim()
  const heading = /^#\s+(.+)$/m.exec(markdown)
  if (heading?.[1] !== undefined && heading[1].trim() !== '') return heading[1].trim()
  return fallback
}

/* v8 ignore start -- Node filesystem rejections are objects with a string code; callers distinguish ENOENT from every other code. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' ? code : undefined
}
/* v8 ignore stop */
