/** Desktop packaging projection for the repository OEM configuration. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

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
  const helpDocsUrl = readOemHttpsUrl(oemConfig.helpDocsUrl, 'helpDocsUrl')
  const contactUrl = readOemHttpsUrl(oemConfig.contactUrl, 'contactUrl')
  return {
    productName,
    brandIcon,
    updateUrl,
    knowledgeBase,
    gatewayProviderName,
    ...(helpDocsUrl === undefined ? {} : { helpDocsUrl }),
    ...(contactUrl === undefined ? {} : { contactUrl }),
  }
}

/** Read one optional Help-menu HTTPS URL for packaging: absent stays absent. */
function readOemHttpsUrl(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`oem.config.json.${field} must be a non-empty string`)
  }
  if (!isHttpsUrl(value)) throw new Error(`oem.config.json.${field} must be an HTTPS URL`)
  return value
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

/**
 * Copy the configured Web icon into every native desktop icon slot.
 * Images below 256 px are stored as BMP so the Windows taskbar can draw them
 * from the executable. A 256 px image may stay PNG.
 * @param repoRoot - Repository root that contains `oem.config.json`.
 * @param desktopRoot - Desktop package root whose `build` directory receives the icons.
 * @param environment - Overrides for the OEM icon path. Defaults to `process.env`.
 * @returns Resolves after both icon files are written.
 */
export async function syncDesktopOemIcons(repoRoot, desktopRoot, environment = process.env) {
  const { brandIcon } = readDesktopOemConfig(repoRoot, environment)
  const source = resolve(repoRoot, 'apps', 'web', 'public', brandIcon.slice(1))
  const icon = readFileSync(source)
  const shellIcon = await windowsShellIco(icon, source)
  for (const name of ['icon.ico', 'tray.ico']) {
    const target = resolve(desktopRoot, 'build', name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, shellIcon)
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Return ICO bytes the Windows shell can embed in an executable.
 * @param ico - ICO bytes. PNG and BMP images are both accepted.
 * @param source - Path named when `ico` is not an ICO file.
 * @returns ICO bytes with the same images in the same order.
 */
async function windowsShellIco(ico, source) {
  const entries = readIcoEntries(ico, source)
  const images = []
  for (const entry of entries) {
    if (isPng(entry.data) && (entry.width !== 256 || entry.height !== 256)) {
      const pngSize = readPngSize(entry.data, source)
      if (pngSize.width !== entry.width || pngSize.height !== entry.height) {
        throw new Error(
          `oem.config.json.brandIcon image is ${String(pngSize.width)}x${String(pngSize.height)}, `
          + `expected ${String(entry.width)}x${String(entry.height)}: ${source}`,
        )
      }
      images.push({
        width: entry.width,
        height: entry.height,
        colors: 0,
        planes: 1,
        bitCount: 32,
        data: await pngToBmpDib(entry.data),
      })
    } else {
      images.push(entry)
    }
  }
  return writeIco(images)
}

/** @param {Buffer} ico @param {string} source */
function readIcoEntries(ico, source) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) invalidIco(source)
  const count = ico.readUInt16LE(4)
  if (count < 1) invalidIco(source)
  return Array.from({ length: count }, (_, index) => {
    const at = 6 + 16 * index
    if (at + 16 > ico.length) invalidIco(source)
    const width = ico.readUInt8(at) || 256
    const height = ico.readUInt8(at + 1) || 256
    const bytes = ico.readUInt32LE(at + 8)
    const offset = ico.readUInt32LE(at + 12)
    if (bytes < 1 || offset + bytes > ico.length) invalidIco(source)
    const data = Buffer.from(ico.subarray(offset, offset + bytes))
    if (!isPng(data) && (data.length < 40 || data.readUInt32LE(0) !== 40)) invalidIco(source)
    return {
      width,
      height,
      colors: ico.readUInt8(at + 2),
      planes: ico.readUInt16LE(at + 4),
      bitCount: ico.readUInt16LE(at + 6),
      data,
    }
  })
}

/** @param {string} source */
function invalidIco(source) {
  throw new Error(`oem.config.json.brandIcon is not a valid ICO file: ${source}`)
}

/** @param {Buffer} data */
function isPng(data) {
  return data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
}

/** @param {Buffer} png @param {string} source */
function readPngSize(png, source) {
  if (png.length < 24) invalidIco(source)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** @param {Buffer} png */
async function pngToBmpDib(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const xor = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 4
    const dstRow = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const src = srcRow + x * 4
      const dst = dstRow + x * 4
      xor[dst] = data[src + 2]
      xor[dst + 1] = data[src + 1]
      xor[dst + 2] = data[src]
      xor[dst + 3] = data[src + 3]
    }
  }
  const maskStride = Math.ceil(width / 32) * 4
  const mask = Buffer.alloc(maskStride * height)
  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 4
    for (let x = 0; x < width; x += 1) {
      if (data[srcRow + x * 4 + 3] === 0) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(xor.length + mask.length, 20)
  return Buffer.concat([header, xor, mask])
}

/** @param {readonly { width: number, height: number, colors: number, planes: number, bitCount: number, data: Buffer }[]} images */
function writeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, index) => {
    const at = 6 + 16 * index
    header.writeUInt8(image.width % 256, at)
    header.writeUInt8(image.height % 256, at + 1)
    header.writeUInt8(image.colors, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(image.planes, at + 4)
    header.writeUInt16LE(image.bitCount, at + 6)
    header.writeUInt32LE(image.data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += image.data.length
  })
  return Buffer.concat([header, ...images.map(image => image.data)])
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
    // DeepWorker identity: electron-builder derives APP_FILENAME from it to
    // sanitize the install directory, and an ASCII name keeps that check stable
    // while the display name may be non-ASCII.
    productName,
    extraMetadata: {
      name: 'DeepWorker',
      productName,
      dsh: {
        // No updateUrl means the packaged runtime disables auto-update
        // entirely (updater.ts skips wiring; the Help menu drops the entry).
        ...(updateUrl === undefined ? {} : { updateUrl }),
        ...(options.localUpdateFeed && updateUrl !== undefined ? { localUpdateTest: true } : {}),
        ...(options.knowledgeBase === undefined ? {} : { knowledgeBase: options.knowledgeBase }),
        ...(options.gatewayProviderName === undefined ? {} : { gatewayProviderName: options.gatewayProviderName }),
        ...(options.helpDocsUrl === undefined ? {} : { helpDocsUrl: options.helpDocsUrl }),
        ...(options.contactUrl === undefined ? {} : { contactUrl: options.contactUrl }),
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
