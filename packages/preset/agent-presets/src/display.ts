/**
 * Display resolution for roster presets, shared by every surface that renders
 * preset names, and the expert-marker rule that splits market inventory from
 * session modes: shipped presets resolve through locale dictionary keys, and
 * user-authored metadata is never translated. A pure fold with no imports, so
 * browser bundles inline it and the Host uses the same single home for which
 * shipped id carries which copy key.
 * @module @deepseek-ai/dsh-agent-presets/display
 */

/** Dictionary keys carrying one shipped preset's display copy. */
export type BuiltInPresetCopyKey =
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetPtcName' | 'presetPtcDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'

/** Preset roster fields needed to resolve display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: BuiltInPresetCopyKey
  readonly description: BuiltInPresetCopyKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active locale lookup covering {@link BuiltInPresetCopyKey}.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: BuiltInPresetCopyKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}

/**
 * Whether a roster row publishes expert-card metadata, and this predicate owns
 * the rule in both directions: the expert market admits exactly these rows as
 * hireable cards, while the mode surfaces — the new-session chip and the
 * preset-management section — exclude them. The session-header label is
 * neither: it names a session already running an expert, so it resolves
 * names across the whole healthy roster.
 *
 * `category` is the committed marker, and it is no longer the only one. An
 * expert authored elsewhere — copied in, dropped into the user root, or
 * delivered as an installed package — arrives as a directory this deployment
 * never curated, so it carries whatever card fields its author published and
 * may well omit `category`. Reading only the committed marker would leave such
 * a row classified as a session MODE: absent from the market, and offered by
 * the chip as if it were a generic mode. So the card-content fields count too,
 * because a row publishing retrieval tags or suggested first messages is
 * describing an expert card whatever it called itself. `description` is
 * deliberately NOT a marker — every mode preset publishes one — and neither is
 * a lone `icon`, which is a decoration a mode preset may reasonably add.
 * Shipped modes publish none of these, so the built-in set is unaffected.
 * @param preset - the roster-row display fields; only the marker fields are read.
 * @returns whether the row is expert inventory rather than a session mode.
 */
export function isExpertPreset(preset: {
  readonly category?: string
  readonly tags?: readonly string[]
  readonly quickPrompts?: readonly string[]
  // Named only to be excluded: typing the non-markers lets a whole roster row
  // flow through excess-property checking while the rule keeps ignoring them.
  readonly description?: unknown
  readonly icon?: unknown
}): boolean {
  if (preset.category !== undefined) return true
  return (preset.tags?.length ?? 0) > 0 || (preset.quickPrompts?.length ?? 0) > 0
}
