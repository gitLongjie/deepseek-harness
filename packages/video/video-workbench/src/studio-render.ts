/** Bounded local FFmpeg rendering of saved production timelines. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveWorkbenchFile } from './file-serve.ts'
import type { StudioDocument } from './studio-types.ts'

const run = promisify(execFile)

/** Deployment limits for local timeline export. */
export interface StudioRenderOptions {
  ffmpegPath: string
  ffprobePath: string
  timeoutMs: number
  maxDurationSeconds: number
  maxClips: number
  width: number
  height: number
  fps: number
}

/** Public export result points to a file served by the existing media route. */
export interface StudioRenderResult {
  path: string
  revision: number
  duration: number
}

function subtitleTime(seconds: number): string {
  const value = Math.round(seconds * 1000)
  return `${Math.floor(value / 3600000).toString().padStart(2, '0')}:${Math.floor(value / 60000 % 60).toString().padStart(2, '0')}:${Math.floor(value / 1000 % 60).toString().padStart(2, '0')},${(value % 1000).toString().padStart(3, '0')}`
}

/** Render a captured revision; publication happens only after FFmpeg completes.
 * @param root - controlled video directory for source resolution.
 * @param workDirectory - previously resolved work directory.
 * @param document - validated immutable authoring revision.
 * @param options - deployment rendering limits and executable paths.
 * @param signal - request cancellation, also terminating subprocesses.
 * @returns relative MP4 path, source revision and timeline duration.
 */
export async function renderStudio(
  root: string, workDirectory: string, document: StudioDocument, options: StudioRenderOptions, signal: AbortSignal,
): Promise<StudioRenderResult> {
  const clips = (document.edit?.tracks ?? []).flatMap(track => track.clips.map(clip => ({ ...clip, kind: track.kind })))
  if (clips.length === 0 || clips.length > options.maxClips) throw new Error('Timeline has no clips or exceeds the configured clip limit')
  const duration = Math.max(...clips.map(clip => clip.start + clip.duration))
  if (duration > options.maxDurationSeconds) throw new Error('Timeline exceeds the configured duration limit')
  const directory = await mkdtemp(join(workDirectory, 'export-'))
  const processOptions = { signal, timeout: options.timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  try {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i',
      `color=c=black:s=${options.width}x${options.height}:r=${options.fps}:d=${duration}`]
    const filters: string[] = []
    const sounds: string[] = []
    const subtitles: string[] = []
    let video = '0:v'
    let input = 1
    for (const clip of clips) {
      signal.throwIfAborted()
      if (clip.kind === 'subtitle') {
        const text = clip.name.replace(/\r/g, '').replace(/\n{2,}/g, '\n')
        subtitles.push(`${subtitles.length + 1}\n${subtitleTime(clip.start)} --> ${subtitleTime(clip.start + clip.duration)}\n${text}\n`)
        continue
      }
      if (clip.source === undefined || clip.source.trim() === '') throw new Error('Every media clip must select a source')
      const source = await resolveWorkbenchFile(root, clip.source)
      if ('reason' in source || !(source.contentType.startsWith('video/') || source.contentType.startsWith('audio/'))) {
        throw new Error('Timeline source is missing, unsupported or outside the video directory')
      }
      const probe = await run(options.ffprobePath, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,mp3,wav',
        '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', source.path,
      ], processOptions)
      const info: unknown = JSON.parse(probe.stdout)
      if (typeof info !== 'object' || info === null || !('streams' in info) || !Array.isArray(info.streams)) {
        throw new Error('Media stream metadata is invalid')
      }
      const streams = info.streams
      const hasStream = (type: string): boolean => streams.some((stream: unknown) =>
        typeof stream === 'object' && stream !== null && 'codec_type' in stream && stream.codec_type === type)
      if (!hasStream(clip.kind === 'video' ? 'video' : 'audio')) throw new Error('Media source does not match its track type')
      const offset = clip.sourceStart ?? 0
      if (!('format' in info) || typeof info.format !== 'object' || info.format === null || !('duration' in info.format)) {
        throw new Error('Media source has no finite duration')
      }
      const length = Number(info.format.duration)
      if (!Number.isFinite(length) || offset + clip.duration > length + 0.05) throw new Error('Clip extends beyond the source media')
      args.push('-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,mp3,wav', '-i', source.path)
      if (clip.kind === 'video') {
        filters.push(`[${input}:v]trim=start=${offset}:duration=${clip.duration},setpts=PTS-STARTPTS+${clip.start}/TB,` +
          `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,` +
          `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${input}]`)
        filters.push(`[${video}][v${input}]overlay=eof_action=pass:enable='gte(t,${clip.start})*lt(t,${clip.start + clip.duration})'[out${input}]`)
        video = `out${input}`
      }
      if (hasStream('audio')) {
        const delay = Math.round(clip.start * 1000)
        filters.push(`[${input}:a]atrim=start=${offset}:duration=${clip.duration},asetpts=PTS-STARTPTS,` +
          `volume=${clip.volume ?? 1},adelay=${delay}:all=1[a${input}]`)
        sounds.push(`[a${input}]`)
      }
      input += 1
    }
    if (subtitles.length > 0) {
      const path = join(directory, 'subtitles.srt')
      await writeFile(path, subtitles.join('\n'), 'utf8')
      args.push('-f', 'srt', '-i', path)
    }
    if (sounds.length > 0) filters.push(`${sounds.join('')}amix=inputs=${sounds.length}:normalize=0,apad[audio]`)
    if (filters.length > 0) args.push('-filter_complex', filters.join(';'))
    args.push('-map', video === '0:v' ? video : `[${video}]`)
    if (sounds.length > 0) args.push('-map', '[audio]', '-c:a', 'aac')
    if (subtitles.length > 0) args.push('-map', `${input}:s`, '-c:s', 'mov_text')
    args.push('-t', String(duration), '-r', String(options.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(directory, 'movie.mp4'))
    await run(options.ffmpegPath, args, processOptions)
    const folder = directory.slice(workDirectory.length + 1)
    return { path: `studio/${document.id}/${folder}/movie.mp4`, revision: document.revision, duration }
  } catch (error) {
    // Only the newly allocated export directory is removed; source revisions and media are untouched.
    await rm(directory, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      console.warn('Failed export cleanup could not finish', cleanupError)
    })
    throw error
  }
}
