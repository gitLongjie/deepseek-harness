/**
 * Help-menu link resolution for the desktop launcher: projects the OEM
 * deployment's documentation URL from the source oem.config.json into the
 * packaged manifest field, so the Help menu opens the same destination in a
 * source run and in an installed app — the same dual route the update feed,
 * knowledge base, and gateway display name take.
 * @module @deepseek-ai/dsh-desktop/desktop/help-links
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Packaged metadata carrying the baked Help-menu documentation URL. */
export interface DesktopHelpManifest {
  dsh?: {
    helpDocsUrl?: unknown
  }
}

/**
 * Resolve the documentation URL the Help menu opens. The source-tree
 * oem.config.json beside the app wins when present; the packaged manifest's
 * baked field answers otherwise.
 * @param installAnchor - absolute path of the app's package.json.
 * @param manifest - the parsed packaged application metadata.
 * @returns the validated HTTPS URL, or undefined when neither source declares
 *   one (the Help menu then omits the documentation entry).
 * @throws when a present field is empty or not an HTTPS URL.
 */
export function resolveDesktopHelpDocsUrl(
  installAnchor: string,
  manifest: DesktopHelpManifest,
): string | undefined {
  // The anchor is the app's package.json file (repo-root/apps/desktop/package.json
  // in the source layout), so the repository root sits three path segments up.
  const sourcePath = resolve(installAnchor, '../../../oem.config.json')
  if (existsSync(sourcePath)) {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(sourcePath, 'utf8')) as { helpDocsUrl?: unknown }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`desktop: cannot read OEM config ${sourcePath}: ${detail}`)
    }
    return parseHelpDocsUrl((value as { helpDocsUrl?: unknown }).helpDocsUrl, 'oem.config.json.helpDocsUrl')
  }
  return parseHelpDocsUrl(manifest.dsh?.helpDocsUrl, 'the packaged manifest dsh.helpDocsUrl')
}

/**
 * Validate one documentation URL wherever it came from.
 * @param value - the raw field value.
 * @param subject - the diagnostic subject naming the value's source.
 * @returns the URL, or undefined when the field is absent.
 */
function parseHelpDocsUrl(value: unknown, subject: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${subject} must be a non-empty string`)
  }
  let protocol: string
  try {
    protocol = new URL(value).protocol
  } catch {
    throw new Error(`${subject} must be an HTTPS URL`)
  }
  if (protocol !== 'https:') throw new Error(`${subject} must be an HTTPS URL`)
  return value
}
