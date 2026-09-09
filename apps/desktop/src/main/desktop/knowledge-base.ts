/**
 * Knowledge-base connection resolution for the desktop launcher: projects
 * the OEM deployment's WeKnora endpoint into the environment names the
 * kb-weknora plugin resolves as its config defaults. Source runs read the
 * repository's oem.config.json; packaged runs read the same section baked
 * into the application manifest (extraMetadata.dsh.knowledgeBase), the same
 * dual route the update feed takes. The secret itself never appears here —
 * only the credential-reference name does.
 * @module @deepseek-ai/dsh-desktop/knowledge-base
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Packaged metadata carrying the baked OEM knowledge-base section. */
export interface DesktopKnowledgeManifest {
  dsh?: {
    knowledgeBase?: unknown
  }
}

/** The validated OEM knowledge-base connection. */
export interface DesktopKnowledgeBase {
  readonly baseUrl: string
  readonly apiKeyEnv: string
  readonly tenantId?: string
  readonly webUiUrl?: string
}

/**
 * Parse and validate one OEM knowledge-base section wherever it came from.
 * @param value - the raw section value.
 * @param subject - the diagnostic subject naming the value's source.
 * @returns the validated connection.
 * @throws when required fields are missing or a URL is not http(s).
 */
export function parseDesktopKnowledgeBase(value: unknown, subject: string): DesktopKnowledgeBase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  const record = value as Record<string, unknown>
  const allowed = ['apiKeyEnv', 'baseUrl', 'tenantId', 'webUiUrl']
  const extra = Object.keys(record).filter(key => !allowed.includes(key))
  if (extra.length > 0) throw new Error(`${subject} has invalid fields: ${extra.join(', ')}`)
  const baseUrl = nonEmptyString(record.baseUrl, `${subject}.baseUrl`)
  assertHttpUrl(baseUrl, `${subject}.baseUrl`)
  const apiKeyEnv = record.apiKeyEnv === undefined ? 'WEKNORA_API_KEY' : nonEmptyString(record.apiKeyEnv, `${subject}.apiKeyEnv`)
  const tenantId = record.tenantId === undefined ? undefined : nonEmptyString(record.tenantId, `${subject}.tenantId`)
  const webUiUrl = record.webUiUrl === undefined ? undefined : nonEmptyString(record.webUiUrl, `${subject}.webUiUrl`)
  if (webUiUrl !== undefined) assertHttpUrl(webUiUrl, `${subject}.webUiUrl`)
  return {
    baseUrl,
    apiKeyEnv,
    ...tenantId === undefined ? {} : { tenantId },
    ...webUiUrl === undefined ? {} : { webUiUrl },
  }
}

/**
 * Resolve the desktop's OEM knowledge-base connection. The source-tree
 * oem.config.json beside the app wins when present; the packaged manifest's
 * baked section answers otherwise.
 * @param installAnchor - absolute path of the app's package.json.
 * @param manifest - the parsed packaged application metadata.
 * @returns the validated connection, or undefined when neither source
 *   declares one (the plugin falls back to its own defaults).
 * @throws when a present section fails validation.
 */
export function resolveDesktopKnowledgeBase(
  installAnchor: string,
  manifest: DesktopKnowledgeManifest,
): DesktopKnowledgeBase | undefined {
  // The anchor is the app's package.json file (repo-root/apps/desktop/package.json
  // in the source layout), so the repository root sits three path segments up.
  const sourcePath = resolve(installAnchor, '../../../oem.config.json')
  if (existsSync(sourcePath)) {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(sourcePath, 'utf8')) as { knowledgeBase?: unknown }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`desktop: cannot read OEM config ${sourcePath}: ${detail}`)
    }
    const section = (value as { knowledgeBase?: unknown }).knowledgeBase
    if (section === undefined) return undefined
    return parseDesktopKnowledgeBase(section, 'oem.config.json.knowledgeBase')
  }
  const section = manifest.dsh?.knowledgeBase
  if (section === undefined) return undefined
  return parseDesktopKnowledgeBase(section, 'the packaged manifest dsh.knowledgeBase')
}

/**
 * Project the resolved connection into the environment names kb-weknora
 * resolves as its config defaults.
 * @param connection - the validated OEM connection.
 * @returns the `WEKNORA_*` environment record to apply if-unset.
 */
export function desktopKnowledgeBaseEnvironment(connection: DesktopKnowledgeBase): Readonly<Record<string, string>> {
  return {
    WEKNORA_API_KEY_ENV: connection.apiKeyEnv,
    WEKNORA_BASE_URL: connection.baseUrl,
    ...connection.tenantId === undefined ? {} : { WEKNORA_TENANT_ID: connection.tenantId },
    ...connection.webUiUrl === undefined ? {} : { WEKNORA_WEB_UI_URL: connection.webUiUrl },
  }
}

/**
 * Apply the OEM knowledge-base environment without replacing values the
 * launching environment already owns — an exported variable outranks the
 * OEM file.
 * @param target - the environment record to fill (the live process env).
 * @param values - the projected OEM values.
 */
export function applyKnowledgeBaseEnvironment(
  target: Record<string, string | undefined>,
  values: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (target[name] === undefined) target[name] = value
  }
}

function nonEmptyString(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${subject} must be a non-empty string`)
  return value
}

function assertHttpUrl(value: string, subject: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${subject} must be an HTTP or HTTPS URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${subject} must be an HTTP or HTTPS URL`)
  }
}
