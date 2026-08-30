import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GREETING_SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const
const CONFIG_KEYS = ['brandIcon', 'greetings', 'loginTagline', 'loginUrl', 'productName', 'updateUrl'] as const

/** One complete locale-specific set of blank-panel greetings. */
export type OemGreetings = Readonly<Record<(typeof GREETING_SLOTS)[number], string>>

/** Build-owned product identity and endpoint configuration. */
export interface OemConfig {
  readonly productName: string
  readonly brandIcon: string
  readonly loginUrl: string
  readonly updateUrl: string
  readonly loginTagline: { readonly zh: string; readonly en: string }
  readonly greetings: { readonly zh: OemGreetings; readonly en: OemGreetings }
}

/** Parse and validate an OEM config before any browser artifact is compiled. */
export function parseOemConfig(value: unknown, source: string): OemConfig {
  const root = objectWithKeys(value, CONFIG_KEYS, source)
  const productName = nonEmptyString(root.productName, `${source}.productName`)
  if (productName.length > 80) throw new Error(`${source}.productName must not exceed 80 characters`)
  assertWindowsFilename(productName, `${source}.productName`)
  const brandIcon = nonEmptyString(root.brandIcon, `${source}.brandIcon`)
  assertLocalBrandIcon(brandIcon, `${source}.brandIcon`)
  const loginUrl = nonEmptyString(root.loginUrl, `${source}.loginUrl`)
  if (!isHttpsUrl(loginUrl)) throw new Error(`${source}.loginUrl must be an HTTPS URL`)
  const updateUrl = nonEmptyString(root.updateUrl, `${source}.updateUrl`)
  if (!isHttpsUrl(updateUrl)) throw new Error(`${source}.updateUrl must be an HTTPS URL`)
  const loginTagline = objectWithKeys(root.loginTagline, ['en', 'zh'], `${source}.loginTagline`)
  const greetings = objectWithKeys(root.greetings, ['en', 'zh'], `${source}.greetings`)
  return {
    productName,
    brandIcon,
    loginUrl,
    updateUrl,
    loginTagline: {
      zh: nonEmptyString(loginTagline.zh, `${source}.loginTagline.zh`),
      en: nonEmptyString(loginTagline.en, `${source}.loginTagline.en`),
    },
    greetings: {
      zh: parseGreetings(greetings.zh, `${source}.greetings.zh`),
      en: parseGreetings(greetings.en, `${source}.greetings.en`),
    },
  }
}

/** Read the repository's single OEM configuration file. */
export function readOemConfig(root: string): OemConfig {
  const path = resolve(root, 'oem.config.json')
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot read OEM config ${path}: ${detail}`)
  }
  return parseOemConfig(value, path)
}

/** Project validated OEM fields into the public client build environment. */
export function oemClientBuildEnvironment(config: OemConfig): Readonly<Record<`DSH_CLIENT_${string}`, string>> {
  return {
    DSH_CLIENT_BRAND_ICON: config.brandIcon,
    DSH_CLIENT_BRAND_NAME: config.productName,
    DSH_CLIENT_GREETINGS_EN: JSON.stringify(config.greetings.en),
    DSH_CLIENT_GREETINGS_ZH: JSON.stringify(config.greetings.zh),
    DSH_CLIENT_LOGIN_TAGLINE_EN: config.loginTagline.en,
    DSH_CLIENT_LOGIN_TAGLINE_ZH: config.loginTagline.zh,
    DSH_CLIENT_LOGIN_URL: config.loginUrl,
    DSH_CLIENT_TITLE: config.productName,
  }
}

/** Project OEM identity into a parsed Web App Manifest. */
export function projectOemWebManifest(value: unknown, config: OemConfig): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Web App Manifest must be an object')
  }
  const iconType = webIconMediaType(config.brandIcon)
  return {
    ...value,
    name: config.productName,
    short_name: config.productName,
    icons: [{
      src: config.brandIcon,
      sizes: 'any',
      ...(iconType === undefined ? {} : { type: iconType }),
      purpose: 'any',
    }],
  }
}

function parseGreetings(value: unknown, subject: string): OemGreetings {
  const record = objectWithKeys(value, GREETING_SLOTS, subject)
  return Object.fromEntries(
    GREETING_SLOTS.map(slot => [slot, nonEmptyString(record[slot], `${subject}.${slot}`)]),
  ) as unknown as OemGreetings
}

function objectWithKeys(
  value: unknown,
  expected: readonly string[],
  subject: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`)
  }
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const keys = [...expected].sort()
  const extra = actual.filter(key => !keys.includes(key))
  const missing = keys.filter(key => !actual.includes(key))
  if (extra.length > 0 || missing.length > 0) {
    throw new Error(`${subject} has invalid fields; extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`)
  }
  return record
}

function nonEmptyString(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${subject} must be a non-empty string`)
  return value
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function assertLocalBrandIcon(value: string, subject: string): void {
  if (!value.startsWith('/')) throw new Error(`${subject} must be a local Web public path`)
  if (!value.toLowerCase().endsWith('.ico')) throw new Error(`${subject} must name a .ico file`)
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value)
    || value.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error(`${subject} must be a safe root-relative Web public path`)
  }
}

function assertWindowsFilename(value: string, subject: string): void {
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value) || reserved.test(value)) {
    throw new Error(`${subject} must be a valid Windows filename`)
  }
}

function webIconMediaType(value: string): string | undefined {
  const pathname = value.startsWith('/') ? value : new URL(value).pathname
  const extension = pathname.slice(pathname.lastIndexOf('.')).toLowerCase()
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.ico') return 'image/x-icon'
  return undefined
}
