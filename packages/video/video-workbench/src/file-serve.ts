/**
 * Read-only file service for the video workbench routes. One resolver splits the caller's path
 * into segments and admits only plain names (no `..`, no drive letters, no separators), joins
 * them one at a time under the projected output directory, and re-checks containment after
 * symlink resolution so nothing outside the directory is ever answered.
 * @module @deepseek-ai/dsh-video-workbench/file-serve
 */

import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { Readable } from 'node:stream'

/** Served extensions with their MIME types; anything else is refused. */
const SERVED_TYPES: ReadonlyMap<string, string> = new Map([
  ['.json', 'application/json'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
])

/** Byte ceiling for one served file. */
const MAX_FILE_BYTES = 256 * 1024 * 1024

/** Characters a plain file-name segment never carries on the platforms served. */
const FORBIDDEN_SEGMENT = /[<>:"|?*\u0000]/u

/** One resolved service request. */
export interface ResolvedFile {
  /** Absolute path inside the output directory. */
  readonly path: string
  /** MIME type for the response. */
  readonly contentType: string
  /** Size in bytes. */
  readonly bytes: number
}

/** Why a service request was refused, with the detail the response names. */
export type FileRefusal =
  | { readonly reason: 'escape'; readonly value: string }
  | { readonly reason: 'extension'; readonly value: string }
  | { readonly reason: 'not-found' }
  | { readonly reason: 'too-large'; readonly value: number }

/**
 * Split one caller-supplied relative path into plain name segments. A path that is absolute,
 * empty, carries a NUL, or names a `.`/`..` hop yields no segments — the caller refuses it.
 * @param relativePath - the raw query value.
 * @returns the admitted segments, or undefined when the path is not a plain relative path.
 */
function pathSegments(relativePath: string): string[] | undefined {
  const trimmed = relativePath.trim()
  if (trimmed.length === 0) return undefined
  const segments: string[] = []
  for (const rawSegment of trimmed.split('/')) {
    const segment = rawSegment.trim()
    if (segment.length === 0 || segment === '.' || segment === '..' || FORBIDDEN_SEGMENT.test(segment)) {
      return undefined
    }
    segments.push(segment)
  }
  return segments
}

/**
 * Resolve one relative path against the output directory. The segment whitelist admits plain
 * names only; the joined target is then resolved through `realpath` on both ends and checked to
 * stay inside the root, so a symlink planted in the directory cannot lead the response outside
 * it, and a missing file is reported as not-found.
 * @param outputDir - the projected output directory root.
 * @param relativePath - the caller-supplied path value.
 * @returns the resolved file, or the refusal naming why.
 */
export async function resolveWorkbenchFile(
  outputDir: string,
  relativePath: string,
): Promise<ResolvedFile | FileRefusal> {
  const segments = pathSegments(relativePath)
  if (segments === undefined) return { reason: 'escape', value: relativePath.trim() }
  const extension = extname(segments[segments.length - 1] ?? '').toLowerCase()
  const contentType = SERVED_TYPES.get(extension)
  if (contentType === undefined) return { reason: 'extension', value: extension }
  const root = await realpath(outputDir)
  let target = root
  for (const segment of segments) {
    target = join(target, segment)
  }
  const real = await realpath(target).catch(() => undefined)
  if (real === undefined) return { reason: 'not-found' }
  const distance = relative(root, real)
  if (distance === '' || distance.startsWith('..')) return { reason: 'escape', value: relativePath.trim() }
  const bytes = (await stat(real)).size
  if (bytes > MAX_FILE_BYTES) return { reason: 'too-large', value: bytes }
  return { path: real, contentType, bytes }
}

/** One refusal of a service request as the response that answers it. */
function refusal(status: number, message: string, method: string): Response {
  return new Response(method === 'HEAD' ? null : message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Answer one resolved file: a refusal maps to its 403/404/413 line, an admitted file streams
 * whole with its length and MIME type. Only `GET`/`HEAD` reach this function.
 * @param resolved - the resolver's verdict for the requested path.
 * @param method - the request method; `HEAD` answers headers without a body.
 * @returns the response to settle.
 */
export function workbenchFileResponse(resolved: ResolvedFile | FileRefusal, method: string): Response {
  if ('reason' in resolved) {
    if (resolved.reason === 'escape') {
      return refusal(403, 'path escapes the video workbench directory', method)
    }
    if (resolved.reason === 'extension') {
      return refusal(403, `unsupported file type ${resolved.value}`, method)
    }
    if (resolved.reason === 'too-large') {
      return refusal(413, `file exceeds the ${String(Math.floor(MAX_FILE_BYTES / 1024 / 1024))} MB limit`, method)
    }
    return refusal(404, 'no such file in the video workbench directory', method)
  }
  const headers = {
    'content-type': resolved.contentType,
    'content-length': String(resolved.bytes),
  }
  if (method === 'HEAD') return new Response(null, { headers })
  const body = Readable.toWeb(createReadStream(resolved.path)) as ReadableStream<Uint8Array>
  return new Response(body, { headers })
}
