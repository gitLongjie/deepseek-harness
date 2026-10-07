/**
 * ffmpeg concat assembly of generated segments into one mp4, driven by a plan's segment order.
 * @module @deepseek-ai/dsh-h3-video/assembly
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** One ordered contribution to the final video. */
export interface AssemblySegment {
  /** Absolute path of the downloaded segment file. */
  readonly file: string
}

/** Options for {@link assembleVideo}. */
export interface AssemblyOptions {
  /** ffmpeg executable; defaults to `ffmpeg` on PATH. */
  ffmpegPath?: string
  /** Absolute path of the output mp4. */
  outputFile: string
  /** Working directory for the concat list file (defaults to the output's directory). */
  workDir?: string
  /** Cancellation of the assembly; an aborted signal rejects with an AbortError. */
  signal?: AbortSignal
}

function abortError(): Error {
  return Object.assign(new Error('video assembly cancelled'), { name: 'AbortError' })
}

/**
 * Concatenate segments in order with the ffmpeg concat demuxer and re-encode to a uniform stream so
 * mixed backends and resolutions still produce one playable file.
 * @param segments - ordered existing segment files.
 * @param options - output location and ffmpeg override.
 * @returns the absolute output path.
 * @throws Error - when no segments are given or ffmpeg exits non-zero.
 */
export async function assembleVideo(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string> {
  if (segments.length === 0) throw new Error('assemble needs at least one segment')
  if (options.signal?.aborted) throw abortError()
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg'
  const workDir = options.workDir ?? dirname(options.outputFile)
  await mkdir(workDir, { recursive: true })
  await mkdir(dirname(options.outputFile), { recursive: true })
  const listFile = join(workDir, 'concat-list.txt')
  const body = segments.map(segment => `file '${segment.file.replaceAll("'", "'\\''")}'`).join('\n') + '\n'
  await writeFile(listFile, body, 'utf8')
  try {
    await run(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', '24',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      options.outputFile,
    ], { maxBuffer: 16 * 1024 * 1024, signal: options.signal })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw abortError()
    const detail = error instanceof Error ? `${error.message}\n${(error as { stderr?: string }).stderr ?? ''}` : String(error)
    throw new Error(`ffmpeg concat failed: ${detail.slice(0, 2000)}`)
  }
  return options.outputFile
}
