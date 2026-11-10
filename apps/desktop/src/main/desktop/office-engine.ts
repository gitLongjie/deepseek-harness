/** Resolve packaged Office engine manifests from their complete, unpacked resource directories. */

import { registerHooks, type ModuleHooks } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ENGINE_SPECIFIER = /^(@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-[^/]+)(?:\/(.*))?$/u
const ENGINE_PATH = /[/\\]node_modules[/\\]@deepseek-ai[/\\]libreoffice-kit-(?:darwin|win32|linux)-[^/\\]+[/\\]/u

interface EngineSpecifier {
  readonly name: string
  readonly rest: string
}

/**
 * Locate the `app.asar` archive that contains a packaged runtime.
 * @param runtimeDir - The archive itself, or a directory inside it.
 * @returns Archive path, or undefined when `runtimeDir` is not packaged.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  let current = runtimeDir
  for (;;) {
    if (basename(current) === 'app.asar') return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Keep engine executable and resource paths usable by native child processes outside Electron.
 * The desktop bundle unpacks `@deepseek-ai` packages beside `app.asar`. Resolution that stays
 * inside the archive cannot spawn that helper. Hooks apply only to this thread.
 * @param runtimeDir - `app.asar`, a directory inside it, or a prepared runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined when no archive is present.
 */
export function installOfficeEngineResolution(runtimeDir: string): ModuleHooks | undefined {
  if (!existsSync(runtimeDir)) return undefined
  const archive = runtimeArchivePath(runtimeDir)
  if (archive === undefined) return undefined
  const archiveRoot = realpathSync(archive)
  const unpackedRoot = `${archiveRoot}.unpacked`
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const request = engineSpecifier(specifier)
      try {
        const resolved = nextResolve(specifier, context)
        if (!resolved.url.startsWith('file:')) return resolved
        const file = fileURLToPath(resolved.url)
        if (request === undefined && !ENGINE_PATH.test(file)) return resolved
        const physical = rewriteToUnpacked(archiveRoot, unpackedRoot, file)
        if (physical === undefined) return resolved
        return { ...resolved, url: pathToFileURL(physical).href }
      } catch (error) {
        if (request === undefined) throw error
        const physical = engineFromParent(unpackedRoot, archiveRoot, context.parentURL, request)
        if (physical === undefined) throw error
        return { url: pathToFileURL(physical).href, shortCircuit: true }
      }
    },
  })
}

function engineSpecifier(specifier: string): EngineSpecifier | undefined {
  const match = ENGINE_SPECIFIER.exec(specifier)
  if (match === null) return undefined
  return { name: match[1] ?? specifier, rest: match[2] === undefined || match[2] === '' ? 'package.json' : match[2] }
}

/**
 * Map an archive path onto its unpacked twin when that file exists.
 * @param archiveRoot - Real `app.asar` path.
 * @param unpackedRoot - Real `app.asar.unpacked` path.
 * @param file - Path the default resolver returned.
 * @returns The unpacked file, or undefined when this archive has no twin.
 */
function rewriteToUnpacked(archiveRoot: string, unpackedRoot: string, file: string): string | undefined {
  let real = file
  try {
    real = realpathSync(file)
  } catch (error: unknown) {
    // A virtual app.asar path has no OS realpath; the unpacked twin is checked below.
    if (!(error instanceof Error)) throw error
  }
  const unpackedPrefix = unpackedRoot + sep
  if (real === unpackedRoot || real.startsWith(unpackedPrefix)) return realpathSync(real)
  const archivePrefix = archiveRoot + sep
  if (!real.startsWith(archivePrefix)) return undefined
  const candidate = unpackedRoot + real.slice(archiveRoot.length)
  if (!existsSync(candidate)) return undefined
  return realpathSync(candidate)
}

/**
 * Find an engine that electron-builder unpacked out of the archive entirely.
 * @param unpackedRoot - Real `app.asar.unpacked` directory.
 * @param archiveRoot - Real `app.asar` path.
 * @param parentURL - Module that requested the engine, when Node supplied one.
 * @param request - Engine package name and subpath.
 * @returns The unpacked file, or undefined when this parent has no twin.
 */
function engineFromParent(
  unpackedRoot: string, archiveRoot: string, parentURL: string | undefined, request: EngineSpecifier,
): string | undefined {
  if (parentURL === undefined || !parentURL.startsWith('file:')) return undefined
  const parent = fileURLToPath(parentURL)
  const archivePrefix = archiveRoot + sep
  if (!parent.startsWith(archivePrefix)) return undefined
  const parts = request.name.split('/')
  let dir = join(unpackedRoot, parent.slice(archivePrefix.length))
  const unpackedPrefix = unpackedRoot + sep
  while (dir === unpackedRoot || dir.startsWith(unpackedPrefix)) {
    const candidate = join(dir, 'node_modules', ...parts, request.rest)
    if (existsSync(candidate)) return realpathSync(candidate)
    if (dir === unpackedRoot) return undefined
    dir = dirname(dir)
  }
  return undefined
}
