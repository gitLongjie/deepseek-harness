/** Desktop packaging projection for the repository OEM configuration. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Read the OEM identity used by Electron's native surfaces. */
export function readDesktopOemConfig(repoRoot, environment = process.env) {
  const path = resolve(repoRoot, 'oem.config.json')
  const oemConfig = JSON.parse(readFileSync(path, 'utf8'))
  const productName = environment.DSH_CLIENT_BRAND_NAME ?? oemConfig.productName
  if (typeof productName !== 'string' || productName.trim() === '') {
    throw new Error('oem.config.json.productName must be a non-empty string')
  }
  assertWindowsFilename(productName)
  const brandIcon = environment.DSH_CLIENT_BRAND_ICON ?? oemConfig.brandIcon
  if (typeof brandIcon !== 'string' || !brandIcon.startsWith('/')) {
    throw new Error('oem.config.json.brandIcon must be a local Web public path')
  }
  if (!brandIcon.toLowerCase().endsWith('.ico')) {
    throw new Error('oem.config.json.brandIcon must name a .ico file')
  }
  if (!/^\/[A-Za-z0-9._/-]+$/.test(brandIcon)
    || brandIcon.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('oem.config.json.brandIcon must be a safe root-relative Web public path')
  }
  const updateUrl = environment.DSH_DESKTOP_UPDATE_URL ?? oemConfig.updateUrl
  const localUpdateTest = environment.DSH_DESKTOP_LOCAL_UPDATE_TEST === '1'
  if (!isHttpsUrl(updateUrl) && !(localUpdateTest && isLoopbackHttpUrl(updateUrl))) {
    throw new Error('oem.config.json.updateUrl must be an HTTPS URL')
  }
  const knowledgeBase = readOemKnowledgeBase(oemConfig.knowledgeBase)
  return { productName, brandIcon, updateUrl, knowledgeBase }
}

/**
 * Read the OEM knowledge-base section for packaging: validated here so a bad
 * section fails the build, and baked into the packaged manifest so the
 * packaged runtime resolves the same connection a source run reads from the
 * repository file. The secret itself never enters the file — only the
 * credential-reference name does.
 */
function readOemKnowledgeBase(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('oem.config.json.knowledgeBase must be an object')
  }
  const allowed = ['apiKeyEnv', 'baseUrl', 'tenantId', 'webUiUrl']
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length > 0) throw new Error(`oem.config.json.knowledgeBase has invalid fields: ${extra.join(', ')}`)
  const baseUrl = nonEmptyString(value.baseUrl, 'oem.config.json.knowledgeBase.baseUrl')
  assertHttpUrl(baseUrl, 'oem.config.json.knowledgeBase.baseUrl')
  const apiKeyEnv = value.apiKeyEnv === undefined
    ? 'WEKNORA_API_KEY'
    : nonEmptyString(value.apiKeyEnv, 'oem.config.json.knowledgeBase.apiKeyEnv')
  const section = { baseUrl, apiKeyEnv }
  if (value.tenantId !== undefined) section.tenantId = nonEmptyString(value.tenantId, 'oem.config.json.knowledgeBase.tenantId')
  const webUiUrl = value.webUiUrl === undefined ? undefined : nonEmptyString(value.webUiUrl, 'oem.config.json.knowledgeBase.webUiUrl')
  if (webUiUrl !== undefined) {
    assertHttpUrl(webUiUrl, 'oem.config.json.knowledgeBase.webUiUrl')
    section.webUiUrl = webUiUrl
  }
  return section
}

function nonEmptyString(value, subject) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${subject} must be a non-empty string`)
  return value
}

function assertHttpUrl(value, subject) {
  try {
    const protocol = new URL(value).protocol
    if (protocol === 'http:' || protocol === 'https:') return
  } catch {
    // The diagnostic below owns malformed values.
  }
  throw new Error(`${subject} must be an HTTP or HTTPS URL`)
}

/** Copy the configured Web icon into every native desktop icon slot. */
export function syncDesktopOemIcons(repoRoot, desktopRoot, environment = process.env) {
  const { brandIcon } = readDesktopOemConfig(repoRoot, environment)
  const source = resolve(repoRoot, 'apps', 'web', 'public', brandIcon.slice(1))
  const icon = readFileSync(source)
  if (icon.length < 4 || !icon.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) {
    throw new Error(`oem.config.json.brandIcon is not a valid ICO file: ${source}`)
  }
  for (const name of ['icon.ico', 'tray.ico']) {
    const target = resolve(desktopRoot, 'build', name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, icon)
  }
}

/** Create the electron-builder overlay that carries the OEM product identity. */
export function createElectronBuilderOemConfig(productName, updateUrl, options = {}) {
  assertWindowsFilename(productName)
  if (!isHttpsUrl(updateUrl) && !(options.allowLoopbackHttp && isLoopbackHttpUrl(updateUrl))) {
    throw new Error('oem.config.json.updateUrl must be an HTTPS URL')
  }
  const config = {
    extends: 'electron-builder.yml',
    // Keep the Chinese runtime display name separate from the ASCII installer
    // identity used by Windows paths, shortcuts, and release assets.
    productName: 'MeowWork',
    extraMetadata: {
      name: 'meowwork',
      productName,
      dsh: {
        updateUrl,
        ...(options.localUpdateFeed ? { localUpdateTest: true } : {}),
        ...(options.knowledgeBase === undefined ? {} : { knowledgeBase: options.knowledgeBase }),
      },
    },
  }
  if (options.version !== undefined) config.extraMetadata.version = options.version
  // The asar-unpack manifest comes from the app's own single source of truth
  // (src/main/desktop/packaged-resources.ts), not from this overlay's callers.
  if (options.asarUnpack !== undefined) {
    if (!Array.isArray(options.asarUnpack)
      || options.asarUnpack.length === 0
      || !options.asarUnpack.every(glob => typeof glob === 'string' && glob !== '')) {
      throw new Error('the asarUnpack overlay must be a non-empty array of non-empty globs')
    }
    config.asarUnpack = [...options.asarUnpack]
  }
  return {
    ...config,
    ...(options.output === undefined ? {} : { directories: { output: options.output } }),
    ...(options.localUpdateFeed ? { publish: [{ provider: 'generic', url: updateUrl }] } : {}),
  }
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isLoopbackHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

function assertWindowsFilename(value) {
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value) || reserved.test(value)) {
    throw new Error('oem.config.json.productName must be a valid Windows filename')
  }
}
