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
  return { productName, brandIcon, updateUrl }
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
  const extraMetadata = {
    name: 'deepagens-worker',
    productName,
    dsh: {
      updateUrl,
      ...(options.localUpdateFeed ? { localUpdateTest: true } : {}),
    },
  }
  if (options.version !== undefined) extraMetadata.version = options.version
  return {
    extends: 'electron-builder.yml',
    // Keep the Chinese runtime display name separate from the ASCII installer
    // identity used by Windows paths, shortcuts, and release assets.
    productName: 'Deepagens-Worker',
    extraMetadata,
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
