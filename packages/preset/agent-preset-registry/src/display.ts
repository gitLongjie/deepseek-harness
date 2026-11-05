/**
 * Display resolution for roster presets, shared by every surface that renders
 * preset names, and the expert-marker rule that splits market inventory from
 * session modes: shipped presets resolve through locale dictionary keys, and
 * user-authored metadata is never translated. A pure fold with no imports, so
 * browser bundles inline it and the Host uses the same single home for which
 * shipped id carries which copy key.
 * @module @deepseek-ai/dsh-agent-preset-registry/display
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
 * Whether a roster row is one of the shipped presets whose copy the dictionaries carry.
 * A shipped preset publishes no `name`; a declaration that names itself owns its copy.
 * @param preset - roster row.
 * @returns true for a shipped preset id without a published name.
 */
export function isBuiltInPreset(preset: PresetDisplaySource): boolean {
  return preset.name === undefined && BUILT_IN_PRESET_KEYS[preset.id] !== undefined
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active locale lookup covering {@link BuiltInPresetCopyKey}.
 * @returns localized copy for a known shipped preset, otherwise declaration metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: BuiltInPresetCopyKey) => string,
): PresetDisplayText {
  const keys = isBuiltInPreset(preset) ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}

/**
 * Whether a roster row publishes expert-card metadata. The expert market
 * admits exactly these rows as hireable cards. The new-session chip offers
 * every healthy preset, shipped experts included, so one row can appear in
 * both places. The session-header label names a session already running any
 * healthy preset.
 *
 * `category` is the committed marker, and it is no longer the only one. An
 * expert authored elsewhere — copied in, dropped into the user root, or
 * delivered as an installed package — arrives as a directory this deployment
 * never curated, so it carries whatever card fields its author published and
 * may well omit `category`. Reading only the committed marker would leave such
 * a row classified as a generic preset: absent from the market, and offered by
 * the chip without expert-card metadata. So the card-content fields count too,
 * because a row publishing retrieval tags or suggested first messages is
 * describing an expert card whatever it called itself. `description` is
 * deliberately NOT a marker — every preset publishes one — and neither is
 * a lone `icon`, which is a decoration a preset may reasonably add.
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
