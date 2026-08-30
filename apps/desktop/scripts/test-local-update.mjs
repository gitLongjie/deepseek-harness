/** Build two packaged desktop versions and serve the newer update feed locally. */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { gt, parse } from 'semver'

const DEFAULT_PORT = 43119
const desktopRoot = fileURLToPath(new URL('../', import.meta.url))

/** Parse and validate the two package versions and optional loopback port. */
export function parseLocalUpdateArgs(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--base-version', '--update-version', '--port'].includes(name) || value === undefined) {
      throw new Error(usage())
    }
    values.set(name, value)
  }
  const baseVersion = values.get('--base-version')
  const updateVersion = values.get('--update-version')
  if (typeof baseVersion !== 'string' || parse(baseVersion) === null) {
    throw new Error(`${String(baseVersion)} is not a semantic version`)
  }
  if (typeof updateVersion !== 'string' || parse(updateVersion) === null) {
    throw new Error(`${String(updateVersion)} is not a semantic version`)
  }
  if (!gt(updateVersion, baseVersion)) {
    throw new Error(`update version ${updateVersion} must be newer than base version ${baseVersion}`)
  }
  const portText = values.get('--port') ?? String(DEFAULT_PORT)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`port must be an integer from 1 through 65535, received ${portText}`)
  }
  return { baseVersion, port, updateVersion }
}

/** Create the environment consumed by the guarded desktop packaging overrides. */
export function localUpdateBuildEnvironment(version, updateUrl, output) {
  const url = new URL(updateUrl)
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new Error('the local update test URL must be an HTTP loopback URL')
  }
  return {
    ...process.env,
    DSH_DESKTOP_BUILD_VERSION: version,
    DSH_DESKTOP_LOCAL_UPDATE_OUTPUT: output,
    DSH_DESKTOP_LOCAL_UPDATE_TEST: '1',
    DSH_DESKTOP_UPDATE_URL: url.href.replace(/\/$/, ''),
  }
}

/** Read and validate the Windows channel metadata emitted by electron-builder. */
export function readUpdateFeed(root, expectedVersion) {
  const value = readMetadata(root, expectedVersion)
  const artifact = resolveInside(root, value.path)
  if (artifact === undefined) throw new Error('update artifact must stay inside the feed directory')
  if (!existsSync(artifact)) throw new Error(`update feed is missing artifact ${artifact}`)
  if (!existsSync(`${artifact}.blockmap`)) throw new Error(`update feed is missing blockmap ${artifact}.blockmap`)
  return { artifact, version: value.version }
}

/** Copy electron-builder's local artifact to the safe name a publisher would upload. */
export function materializeLocalPublisherNames(root, expectedVersion) {
  const value = readMetadata(root, expectedVersion)
  const target = resolveInside(root, value.path)
  if (target === undefined) throw new Error('update artifact must stay inside the feed directory')
  if (existsSync(target)) return
  const file = Array.isArray(value.files)
    ? value.files.find(entry => isRecord(entry) && entry.url === value.path)
    : undefined
  if (!isRecord(file) || typeof file.size !== 'number') {
    throw new Error('update feed must record the published artifact size')
  }
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.exe'))
    .map(entry => resolve(root, entry.name))
    .filter(path => statSync(path).size === file.size)
  if (candidates.length !== 1) {
    throw new Error(`update feed expected one local artifact with size ${file.size}, found ${candidates.length}`)
  }
  const source = candidates[0]
  if (!existsSync(`${source}.blockmap`)) throw new Error(`update feed is missing blockmap ${source}.blockmap`)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  copyFileSync(`${source}.blockmap`, `${target}.blockmap`)
}

/** Resolve one HTTP request to a regular file inside the update feed. */
export function resolveFeedRequest(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const segments = decoded.replaceAll('\\', '/').split('/')
  if (segments.includes('..') || decoded.endsWith('/')) return undefined
  const target = resolveInside(root, segments.filter(Boolean).join('/'))
  if (target === undefined || !existsSync(target) || !statSync(target).isFile()) return undefined
  return target
}

/** Parse one HTTP byte range; null means syntactically invalid or unsatisfiable. */
export function parseByteRange(header, size) {
  if (header === undefined) return undefined
  if (typeof header !== 'string' || size < 1) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (match === null || (match[1] === '' && match[2] === '')) return null
  if (match[1] === '') {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
    || start >= size || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function resolveInside(root, path) {
  const target = resolve(root, path)
  const fromRoot = relative(resolve(root), target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return undefined
  return target
}

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readMetadata(root, expectedVersion) {
  const parsedVersion = parse(expectedVersion)
  if (parsedVersion === null) throw new Error(`${expectedVersion} is not a semantic version`)
  const channel = String(parsedVersion.prerelease[0] ?? 'latest')
  const metadataPath = resolve(root, `${channel}.yml`)
  if (!existsSync(metadataPath)) throw new Error(`update feed is missing ${metadataPath}`)
  const value = load(readFileSync(metadataPath, 'utf8'))
  if (!isRecord(value) || value.version !== expectedVersion) {
    throw new Error(`update feed expected version ${expectedVersion}, found ${String(value?.version)}`)
  }
  if (typeof value.path !== 'string' || value.path === '') {
    throw new Error('update feed channel metadata must contain a non-empty path')
  }
  return value
}

function usage() {
  return 'usage: pnpm run test:update:local -- --base-version <version> --update-version <newer-version> [--port <port>]'
}

function packageVersion(version, updateUrl, output) {
  const result = spawnSync(process.execPath, ['scripts/deploy-app.mjs'], {
    cwd: desktopRoot,
    env: localUpdateBuildEnvironment(version, updateUrl, output),
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
  materializeLocalPublisherNames(output, version)
  return readUpdateFeed(output, version)
}

export function serveFeed(root, port) {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const target = resolveFeedRequest(root, new URL(request.url ?? '/', 'http://localhost').pathname)
    if (target === undefined) {
      response.writeHead(404).end()
      return
    }
    const size = statSync(target).size
    const range = parseByteRange(request.headers.range, size)
    if (range === null) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    const start = range?.start ?? 0
    const end = range?.end ?? size - 1
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': target.endsWith('.yml') ? 'application/yaml' : 'application/octet-stream',
      ...(range === undefined ? {} : { 'Content-Range': `bytes ${start}-${end}/${size}` }),
    }
    response.writeHead(range === undefined ? 200 : 206, headers)
    if (request.method === 'HEAD') response.end()
    else createReadStream(target, { start, end }).pipe(response)
  })
  server.listen(port, '127.0.0.1')
  return server
}

async function main() {
  if (process.platform !== 'win32') throw new Error('the local packaged-update rehearsal currently supports Windows')
  const { baseVersion, port, updateVersion } = parseLocalUpdateArgs(process.argv.slice(2))
  const rehearsalRoot = resolve(desktopRoot, '.release', 'local-update')
  const baseRoot = resolve(rehearsalRoot, 'base')
  const feedRoot = resolve(rehearsalRoot, 'feed')
  const updateUrl = `http://127.0.0.1:${port}`

  console.log(`Building installed baseline ${baseVersion}...`)
  const base = packageVersion(baseVersion, updateUrl, baseRoot)
  console.log(`Building update feed ${updateVersion}...`)
  packageVersion(updateVersion, updateUrl, feedRoot)

  const server = serveFeed(feedRoot, port)
  server.on('listening', () => {
    console.log(`\nLocal update feed: ${updateUrl}`)
    console.log(`Baseline installer: ${base.artifact}`)
    console.log('Keep this process running, install the baseline, then launch it and check for updates.')
    console.log('Press Ctrl+C after the update rehearsal.')
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
