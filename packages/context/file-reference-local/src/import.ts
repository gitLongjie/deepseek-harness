/**
 * Workspace import for externally sourced composer files: bare-name
 * validation, canonical base64 admission, and a collision-free copy under the
 * workspace's imports directory.
 * @module @deepseek-ai/dsh-file-reference-local/import
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { FileImportRequest, FileImportValue } from '@deepseek-ai/dsh-file-reference'

/** Default byte ceiling for one imported file, before base64 expansion. */
export const DEFAULT_MAX_IMPORT_BYTES = 25 * 1024 * 1024

/** Default workspace directory receiving imported files. */
export const DEFAULT_IMPORTS_DIRECTORY = 'uploads'

/** Import admission policy deployment-resolved from plugin config. */
export interface ImportConfig {
  /** Maximum decoded byte size accepted for one imported file. */
  maxImportBytes: number
  /** Workspace-relative single-segment directory receiving imported files. */
  importsDirectory: string
}

/**
 * Validate one import policy at load: misconfiguration fails loud.
 * @param config - the deployment-resolved import policy.
 */
export function validateImportConfig(config: ImportConfig): void {
  if (!Number.isSafeInteger(config.maxImportBytes) || config.maxImportBytes <= 0) {
    throw new Error('file-reference-local: maxImportBytes must be a positive safe integer')
  }
  const directory = config.importsDirectory
  if (
    directory.length === 0 || directory.length > 64
    || directory === '.' || directory === '..'
    || /[/\\]|[:*?"<>|]|[\u0000-\u001f\u007f-\u009f]/u.test(directory)
  ) {
    throw new Error('file-reference-local: importsDirectory must be one safe path segment')
  }
}

/** Characters and names Windows forbids in a file name (device names included). */
const FORBIDDEN_NAME = /[/\\]|[:*?"<>|]|[\u0000-\u001f\u007f-\u009f]/u
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u
/** Suffix-probe bound before declaring the imports directory exhausted. */
const MAX_COLLISION_PROBES = 100

/**
 * Reduce one proposed name to a safe bare file name.
 * @param raw - proposed name; must already be bare (no path separators).
 * @returns the normalized name, safe for every supported filesystem.
 */
function safeName(raw: string): string {
  const proposed = raw.trim()
  if (proposed === '' || FORBIDDEN_NAME.test(proposed)) {
    throw new Error('file import requires a non-empty bare file name')
  }
  const stripped = proposed.replace(/[. ]+$/u, '')
  if (stripped === '' || stripped.length > 200) {
    throw new Error(`file import name is empty or too long: ${JSON.stringify(raw)}`)
  }
  return WINDOWS_RESERVED.test(stripped) ? `_${stripped}` : stripped
}

/**
 * Decode a canonical base64 payload after size admission.
 * @param data - the wire encoding.
 * @param maxBytes - decoded byte ceiling.
 * @returns the file bytes.
 */
function decode(data: string, maxBytes: number): Uint8Array {
  if (!CANONICAL_BASE64.test(data) || data.length % 4 !== 0) {
    throw new Error('file import data must be canonical base64')
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const bytes = data.length / 4 * 3 - padding
  if (bytes > maxBytes) {
    throw new Error(`file import exceeds the ${maxBytes}-byte limit`)
  }
  if (bytes === 0) throw new Error('file import requires non-empty bytes')
  return Buffer.from(data, 'base64')
}

/**
 * Store one imported file under the workspace root. The suffix probe hits the
 * filesystem directly (`wx` flag), so a name taken by anything — a prior
 * import or a racing one between probes — never overwrites.
 * @param rootDir - the agent workspace root (the session cwd).
 * @param config - validated import policy.
 * @param request - bare name plus canonical base64 bytes.
 * @param signal - caller cancellation; a partial copy is removed on abort.
 * @returns the stored copy's workspace-relative forward-slash path.
 */
export async function importFile(
  rootDir: string,
  config: ImportConfig,
  request: FileImportRequest,
  signal: AbortSignal,
): Promise<FileImportValue> {
  signal.throwIfAborted()
  const name = safeName(request.name)
  const bytes = decode(request.data, config.maxImportBytes)
  const directory = join(rootDir, config.importsDirectory)
  await mkdir(directory, { recursive: true })
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let probe = 0; probe < MAX_COLLISION_PROBES; probe += 1) {
    const candidate = probe === 0 ? name : `${stem}-${probe}${ext}`
    const absolute = join(directory, candidate)
    try {
      await writeFile(absolute, bytes, { flag: 'wx', signal })
      return { path: relative(rootDir, absolute).split(sep).join('/') }
    } catch (error: unknown) {
      if (signal.aborted) {
        // The abort may have left a partial copy behind; force clears a file.
        await rm(absolute, { force: true })
        throw signal.reason
      }
      /* v8 ignore next 1 -- disk-full and permission-class failures are terminal; no portable test trigger exists. */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`file import could not find a free name beside ${name} in ${config.importsDirectory}`)
}
