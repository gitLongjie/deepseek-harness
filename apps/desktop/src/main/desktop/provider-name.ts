/**
 * Deepagens gateway provider display-name resolution for the desktop
 * launcher: projects the OEM deployment's `gatewayProviderName` into the
 * environment name the llm-deepseek plugin resolves as its Deepagens route
 * display-name default. Source runs read the repository's oem.config.json;
 * packaged runs read the same field baked into the application manifest
 * (extraMetadata.dsh.gatewayProviderName), the same dual route the knowledge
 * base and the update feed take.
 * @module @deepseek-ai/dsh-desktop/provider-name
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Packaged metadata carrying the baked OEM gateway provider name. */
export interface DesktopProviderNameManifest {
  dsh?: {
    gatewayProviderName?: unknown
  }
}

/** The environment name llm-deepseek resolves the Deepagens display name through. */
export const DEEPAGENS_DISPLAY_NAME_ENV = 'DEEPAGENS_DISPLAY_NAME'

/**
 * Resolve the desktop's OEM Deepagens display name. The source-tree
 * oem.config.json beside the app wins when present; the packaged manifest's
 * baked field answers otherwise.
 * @param installAnchor - absolute path of the app's package.json.
 * @param manifest - the parsed packaged application metadata.
 * @returns the validated display name, or undefined when neither source
 *   declares one (the route keeps its own "Deepagens").
 * @throws when a present field fails validation.
 */
export function resolveDesktopGatewayProviderName(
  installAnchor: string,
  manifest: DesktopProviderNameManifest,
): string | undefined {
  // The anchor is the app's package.json file (repo-root/apps/desktop/package.json
  // in the source layout), so the repository root sits three path segments up.
  const sourcePath = resolve(installAnchor, '../../../oem.config.json')
  if (existsSync(sourcePath)) {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(sourcePath, 'utf8')) as { gatewayProviderName?: unknown }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`desktop: cannot read OEM config ${sourcePath}: ${detail}`)
    }
    return parseGatewayProviderName((value as { gatewayProviderName?: unknown }).gatewayProviderName, 'oem.config.json.gatewayProviderName')
  }
  return parseGatewayProviderName(manifest.dsh?.gatewayProviderName, 'the packaged manifest dsh.gatewayProviderName')
}

/**
 * Apply the resolved display name without replacing a value the launching
 * environment already owns — an exported variable outranks the OEM file.
 * @param target - the environment record to fill (the live process env).
 * @param name - the validated OEM display name.
 */
export function applyGatewayProviderNameEnvironment(
  target: Record<string, string | undefined>,
  name: string,
): void {
  if (target[DEEPAGENS_DISPLAY_NAME_ENV] === undefined) target[DEEPAGENS_DISPLAY_NAME_ENV] = name
}

/** Validate one OEM gateway provider name wherever it came from. */
function parseGatewayProviderName(value: unknown, subject: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${subject} must be a non-empty string`)
  }
  return value
}
