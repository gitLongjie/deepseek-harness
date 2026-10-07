/** Desktop packaging projection for the repository OEM configuration. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  if (updateUrl !== undefined && !isHttpsUrl(updateUrl) && !(localUpdateTest && isLoopbackHttpUrl(updateUrl))) {
    throw new Error('oem.config.json.updateUrl must be an HTTPS URL')
  }
  const knowledgeBase = readOemKnowledgeBase(oemConfig.knowledgeBase)
  const gatewayProviderName = readOemGatewayProviderName(oemConfig.gatewayProviderName)
  return { productName, brandIcon, updateUrl, knowledgeBase, gatewayProviderName }
}

/** Read the OEM Deepagens display name for packaging: absent stays absent. */
function readOemGatewayProviderName(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('oem.config.json.gatewayProviderName must be a non-empty string')
  }
  return value
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

/** Whether the optional ComfyUI staging directory carries a real program tree.
 *
 * A directory holding nothing but README files is the staging instructions,
 * not a payload: packaging it would deploy an empty tree on first launch and
 * mark it deployed, permanently blocking a later real payload on every
 * machine that ran that build.
 */
export function hasComfyDistPayload(dir) {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some(entry => !entry.toUpperCase().startsWith('README'))
}

/** Create the electron-builder overlay that carries the OEM product identity. */
export function createElectronBuilderOemConfig(productName, updateUrl, options = {}) {
  assertWindowsFilename(productName)
  if (updateUrl !== undefined
    && !isHttpsUrl(updateUrl)
    && !(options.allowLoopbackHttp && isLoopbackHttpUrl(updateUrl))) {
    throw new Error('oem.config.json.updateUrl must be an HTTPS URL')
  }
  const config = {
    extends: 'electron-builder.yml',
    // The installer identity (install dir, shortcuts, uninstall entry) carries
    // the configured OEM display name. The package `name` stays the ASCII
    // DeepagensWork identity: electron-builder derives APP_FILENAME from it to
    // sanitize the install directory, and an ASCII name keeps that check stable
    // while the display name is non-ASCII (民大工作台).
    productName,
    extraMetadata: {
      name: 'DeepagensWork',
      productName,
      dsh: {
        // No updateUrl means the packaged runtime disables auto-update
        // entirely (updater.ts skips wiring; the Help menu drops the entry).
        ...(updateUrl === undefined ? {} : { updateUrl }),
        ...(options.localUpdateFeed && updateUrl !== undefined ? { localUpdateTest: true } : {}),
        ...(options.knowledgeBase === undefined ? {} : { knowledgeBase: options.knowledgeBase }),
        ...(options.gatewayProviderName === undefined ? {} : { gatewayProviderName: options.gatewayProviderName }),
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
  // Optional out-of-asar payload directories (from → to under the installer's
  // resources/), e.g. the ComfyUI distribution that ships beside the app.
  if (options.extraResources !== undefined) {
    if (!Array.isArray(options.extraResources)
      || options.extraResources.length === 0
      || !options.extraResources.every(entry =>
        entry !== null && typeof entry === 'object'
        && typeof entry.from === 'string' && entry.from !== ''
        && typeof entry.to === 'string' && entry.to !== ''
        && !entry.to.includes('..') && !entry.from.includes('..'))) {
      throw new Error('the extraResources overlay must be a non-empty array of { from, to } pairs')
    }
    config.extraResources = options.extraResources.map(({ from, to }) => ({ from, to }))
  }
  return {
    ...config,
    ...(options.output === undefined ? {} : { directories: { output: options.output } }),
    ...(options.localUpdateFeed && updateUrl !== undefined ? { publish: [{ provider: 'generic', url: updateUrl }] } : {}),
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
