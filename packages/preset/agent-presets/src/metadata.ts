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
   * roster does not offer; a data URI goes in {@link avatar} instead.
   */
  readonly icon?: string
  /**
   * Attribution line under the card's name: author, publisher, or handle.
   *
   * Curator attribution rather than card content, which is why a copy drops it
   * (see `copyComposition`): a fork presenting itself under its source's
   * publisher would attribute the copy to someone who did not write it.
   */
  readonly subtitle?: string
  /** Curator badge beside the card's name, e.g. an invited-expert mark. Dropped by a copy, like {@link subtitle}. */
  readonly badge?: string
  /**
   * Card image: an HTTPS URL or a data URI, at most {@link AVATAR_CAP}. The
   * card's avatar tile renders it over the glyph.
   *
   * A data URI is accepted here rather than only through a marketplace install
   * because the roster already carries the whole card and the alternative is a
   * Host file channel the path-free roster deliberately does not offer. Length
   * is capped so one preset cannot bloat every roster read; no scheme is
   * screened, because a preset is a composition this deployment already runs —
   * anything a preset file could say, its composition could do anyway.
   */
  readonly avatar?: string
}

/** Display cap on published tags; the excess degrades silently. */
export const TAG_CAP = 8

/** Display cap on published suggested first messages; the excess degrades silently. */
export const QUICK_PROMPT_CAP = 3

/** Display cap, in UTF-16 code units, on the published glyph. */
export const ICON_CAP = 16

/** Display cap, in UTF-16 code units, on the published attribution line. */
export const SUBTITLE_CAP = 64

/** Display cap, in UTF-16 code units, on the published curator badge. */
export const BADGE_CAP = 16

/**
 * Display cap, in UTF-16 code units, on the published card image.
 *
 * Generous enough for an inline SVG — the shipped experts' avatars are a few
 * hundred code units — while keeping one preset from turning every roster read
 * into a megabyte. The excess degrades to no image rather than a truncated
 * one, since half a data URI renders as a broken image.
 */
export const AVATAR_CAP = 8192

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * A non-empty trimmed string within `cap`, or undefined for anything else.
 *
 * Over-cap values degrade to absent rather than being cut down: these fields
 * are single tokens (a glyph, a badge, an image reference), and a silently
 * halved one is worse than a missing one.
 * @param value - the parsed YAML value.
 * @param cap - the longest value display may carry, in UTF-16 code units.
 * @returns the usable value, or undefined.
 */
function cappedText(value: unknown, cap: number): string | undefined {
  const trimmed = text(value)
  return trimmed === undefined || trimmed.length > cap ? undefined : trimmed
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
  const subtitle = cappedText(record.subtitle, SUBTITLE_CAP)
  const badge = cappedText(record.badge, BADGE_CAP)
  const avatar = cappedText(record.avatar, AVATAR_CAP)
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...category === undefined ? {} : { category },
    ...tags === undefined ? {} : { tags },
    ...quickPrompts === undefined ? {} : { quickPrompts },
    ...icon === undefined ? {} : { icon },
    ...subtitle === undefined ? {} : { subtitle },
    ...badge === undefined ? {} : { badge },
    ...avatar === undefined ? {} : { avatar },
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
  const subtitle = cappedText(metadata.subtitle, SUBTITLE_CAP)
  const badge = cappedText(metadata.badge, BADGE_CAP)
  const avatar = cappedText(metadata.avatar, AVATAR_CAP)
  const document = {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...category === undefined ? {} : { category },
    ...tags === undefined ? {} : { tags: [...tags] },
    ...quickPrompts === undefined ? {} : { quickPrompts: [...quickPrompts] },
    ...icon === undefined ? {} : { icon },
    ...subtitle === undefined ? {} : { subtitle },
    ...badge === undefined ? {} : { badge },
    ...avatar === undefined ? {} : { avatar },
  }
  if (Object.keys(document).length === 0) return undefined
  return yaml.dump(document, { lineWidth: -1 })
}
