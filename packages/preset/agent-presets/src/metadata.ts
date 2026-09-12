/**
 * A preset's display metadata: the name and description a picker shows.
 *
 * It lives in its own file because the composition is a top-level list of
 * plugin rows — YAML cannot carry sibling keys beside it, and faking a
 * metadata row would hand the Loader something to load. Keeping it separate
 * also keeps the composition exactly what its name says: a Cordis file the
 * loader owns and the cordis preset can author.
 *
 * The file carries display text ONLY. `id` is the directory name and `trust`
 * comes from the root a preset was discovered under, so neither is writable
 * here — otherwise a locally authored preset could claim to be a shipped one.
 *
 * Every read failure degrades to no metadata. A preset whose display text is
 * missing, malformed, or unreadable still mounts: presentation is not a
 * capability, and a broken name must never become an agent that cannot start.
 * @module @deepseek-ai/dsh-agent-presets/metadata
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The optional display-metadata file beside a preset's composition. */
export const METADATA_FILE = 'preset.yml'

/** Display text a preset may publish about itself. */
export interface PresetMetadata {
  /** Human-facing name; falls back to the preset id when absent. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /**
   * Position within its group; lower comes first. A preset that declares
   * none sorts after every preset that does, then by id — so the shipped set
   * can read in capability order while authored ones stay alphabetical.
   */
  readonly order?: number
  /**
   * Expert-style card grouping. A deployment-owned category id, not free
   * prose: the picker's filter bar owns the vocabulary, and a preset naming
   * an id its picker never registered simply matches no filter.
   */
  readonly category?: string
  /** Retrieval tags for an expert-style card, at most {@link TAG_CAP}. */
  readonly tags?: readonly string[]
  /** Suggested first messages for an expert-style card, at most {@link QUICK_PROMPT_CAP}. */
  readonly quickPrompts?: readonly string[]
  /**
   * Short display glyph for an expert-style card, typically one emoji. A
   * preset-relative asset path would need a Host file channel the path-free
   * roster does not offer; that, and data URIs, ride the marketplace install
   * work instead.
   */
  readonly icon?: string
}

/** Display cap on published tags; the excess degrades silently. */
export const TAG_CAP = 8

/** Display cap on published suggested first messages; the excess degrades silently. */
export const QUICK_PROMPT_CAP = 3

/** Display cap, in UTF-16 code units, on the published glyph. */
export const ICON_CAP = 16

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The non-empty trimmed strings from an array-like value, capped.
 * @param value - the parsed YAML value.
 * @param cap - how many entries display may carry; the excess degrades.
 * @returns the usable entries, or undefined when there are none.
 */
function strings(value: unknown, cap: number): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.map(text).filter((entry): entry is string => entry !== undefined)
  return kept.length === 0 ? undefined : kept.slice(0, cap)
}

/**
 * Read one preset directory's display metadata.
 *
 * Absent, unparsable, and wrongly-shaped files are all the same answer —
 * empty metadata — because the caller renders a picker, not a diagnostic.
 * @param directory - the preset directory.
 * @returns the display text the preset published, possibly empty.
 */
export async function readPresetMetadata(directory: string): Promise<PresetMetadata> {
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    // Absent is the common case: metadata is optional and most presets,
    // including every one authored by duplicating another, carry none.
    return {}
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // Malformed display text is not worth failing discovery over; the picker
    // falls back to the id, and the composition still mounts.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const name = text(record.name)
  const description = text(record.description)
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  const category = text(record.category)
  const tags = strings(record.tags, TAG_CAP)
  const quickPrompts = strings(record.quickPrompts, QUICK_PROMPT_CAP)
  const icon = text(record.icon)
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...category === undefined ? {} : { category },
    ...tags === undefined ? {} : { tags },
    ...quickPrompts === undefined ? {} : { quickPrompts },
    ...icon === undefined ? {} : { icon },
  }
}

/**
 * Render display metadata as the file's contents.
 *
 * Absent fields are omitted rather than written empty, so a preset with no
 * description does not ship a key that reads as an intentional blank.
 * @param metadata - the display text to store.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
export function renderPresetMetadata(metadata: PresetMetadata): string | undefined {
  const name = text(metadata.name)
  const description = text(metadata.description)
  const { order } = metadata
  const category = text(metadata.category)
  const tags = strings(metadata.tags, TAG_CAP)
  const quickPrompts = strings(metadata.quickPrompts, QUICK_PROMPT_CAP)
  const icon = text(metadata.icon)
  const document = {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...category === undefined ? {} : { category },
    ...tags === undefined ? {} : { tags: [...tags] },
    ...quickPrompts === undefined ? {} : { quickPrompts: [...quickPrompts] },
    ...icon === undefined ? {} : { icon },
  }
  if (Object.keys(document).length === 0) return undefined
  return yaml.dump(document, { lineWidth: -1 })
}
