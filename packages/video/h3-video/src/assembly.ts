/**
 * ffmpeg concat assembly of generated segments into one mp4, driven by a plan's segment order.
 * @module @deepseek-ai/dsh-h3-video/assembly
 */

import { strict as assert } from 'node:assert'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
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
  /**
   * Boundary treatment: `cut` joins clips directly, `dip` fades through black, and `crossfade`
   * overlaps adjacent pictures and audio. Seconds specify each dip half or crossfade overlap;
   * overlaps are capped at half of either adjacent clip. Omission uses a cut.
   */
  transition?: { kind: 'cut' | 'dip' | 'crossfade'; seconds: number }
  /** Each clip's planned duration; required for transitions. Clips are padded or trimmed to match. */
  durations?: readonly number[]
}

function abortError(): Error {
  return Object.assign(new Error('video assembly cancelled'), { name: 'AbortError' })
}

/**
 * Concatenate segments in order with the ffmpeg concat demuxer and re-encode to a uniform stream so
 * mixed backends and resolutions still produce one playable file. Transitions require positive
 * clip durations and ffprobe beside ffmpeg or on PATH; silent clips receive a silent audio stream.
 * @param segments - ordered existing segment files.
 * @param options - output location and ffmpeg override.
 * @returns the absolute output path.
 * @throws Error - for invalid transition timing, missing video, or failed ffprobe/ffmpeg execution.
 */
export async function assembleVideo(segments: readonly AssemblySegment[], options: AssemblyOptions): Promise<string> {
  if (segments.length === 0) throw new Error('assemble needs at least one segment')
  if (options.signal?.aborted) throw abortError()
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg'
  const workDir = options.workDir ?? dirname(options.outputFile)
  await mkdir(workDir, { recursive: true })
  await mkdir(dirname(options.outputFile), { recursive: true })
  if (options.transition !== undefined && options.transition.kind !== 'cut') {
    const durations = options.durations
    if (!Number.isFinite(options.transition.seconds) || options.transition.seconds <= 0) {
      throw new Error('transition seconds must be finite and positive')
    }
    if (durations === undefined || durations.length !== segments.length
      || durations.some(duration => !Number.isFinite(duration) || duration <= 0)) {
      throw new Error('transitions require one positive duration per clip')
    }
    await assembleWithTransition(ffmpeg, segments, options, durations, options.transition)
    return options.outputFile
  }
  const listFile = join(workDir, 'concat-list.txt')
  const body = segments.map(segment => `file '${segment.file.replaceAll("'", "'\\''")}'`).join('\n') + '\n'
  await writeFile(listFile, body, 'utf8')
  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '24',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    // Put the index at the front so a browser can start playing before the whole file arrives.
    '-movflags', '+faststart',
    options.outputFile,
  ]
  try {
    await run(ffmpeg, args, { maxBuffer: 16 * 1024 * 1024, signal: options.signal })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw abortError()
    const detail = error instanceof Error ? `${error.message}\n${(error as { stderr?: string }).stderr ?? ''}` : String(error)
    throw new Error(`ffmpeg concat failed: ${detail.slice(0, 2000)}`)
  }
  return options.outputFile
}

/** Metadata needed to normalize the transition inputs. */
interface ClipStreams {
  streams: Array<{ codec_type?: string; width?: number; height?: number }>
}

/**
 * Normalize video timing, dimensions, and audio before applying the selected transition.
 * Missing audio receives silence; processing failures reject instead of substituting a hard cut.
 * @param ffmpeg - ffmpeg executable; ffprobe is resolved beside it or through PATH.
 * @param segments - ordered clips.
 * @param options - output location, transition, and cancellation.
 * @param durations - planned clip durations in seconds.
 * @param transition - validated transition selection.
 */
async function assembleWithTransition(
  ffmpeg: string,
  segments: readonly AssemblySegment[],
  options: AssemblyOptions,
  durations: readonly number[],
  transition: NonNullable<AssemblyOptions['transition']>,
): Promise<void> {
  const probe = join(dirname(ffmpeg), `ffprobe${extname(ffmpeg)}`)
  const metadata: ClipStreams[] = []
  for (const segment of segments) {
    const { stdout } = await run(probe, [
      '-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', segment.file,
    ], { maxBuffer: 1024 * 1024, signal: options.signal })
    metadata.push(JSON.parse(stdout) as ClipStreams)
  }
  const firstVideo = metadata[0]?.streams.find(stream => stream.codec_type === 'video')
  if (firstVideo?.width === undefined || firstVideo.height === undefined) {
    throw new Error('transition input has no video stream')
  }
  const width = Math.floor(firstVideo.width / 2) * 2
  const height = Math.floor(firstVideo.height / 2) * 2
  const seconds = transition.seconds
  const chains: string[] = []
  segments.forEach((_, index) => {
    const duration = durations[index]
    assert(duration !== undefined)
    const clip = metadata[index]
    assert(clip !== undefined)
    const video = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1', 'fps=24', 'format=yuv420p', 'settb=AVTB', 'setpts=PTS-STARTPTS',
      `tpad=stop_mode=clone:stop_duration=${duration}`, `trim=duration=${duration}`,
    ]
    const audio = clip.streams.some(stream => stream.codec_type === 'audio')
      ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad`
      : 'anullsrc=r=48000:cl=stereo'
    const fades: string[] = []
    if (transition.kind === 'dip') {
      const half = Math.min(seconds, duration / 2)
      if (index > 0) fades.push(`fade=t=in:st=0:d=${half}`)
      if (index < segments.length - 1) fades.push(`fade=t=out:st=${duration - half}:d=${half}`)
    }
    chains.push(`[${index}:v]${[...video, ...fades].join(',')}[v${index}]`)
    chains.push(`${audio},atrim=duration=${duration},asetpts=PTS-STARTPTS${
      fades.length === 0 ? '' : ',' + fades.join(',').replaceAll('fade=', 'afade=')
    }[a${index}]`)
  })
  let video = 'v0'
  let audio = 'a0'
  let elapsed = durations[0]
  assert(elapsed !== undefined)
  if (transition.kind === 'crossfade') {
    for (let index = 1; index < segments.length; index += 1) {
      const previousDuration = durations[index - 1]
      const duration = durations[index]
      assert(previousDuration !== undefined && duration !== undefined)
      const overlap = Math.min(seconds, previousDuration / 2, duration / 2)
      chains.push(`[${video}][v${index}]xfade=transition=fade:duration=${overlap}:offset=${elapsed - overlap}[xv${index}]`)
      chains.push(`[${audio}][a${index}]acrossfade=d=${overlap}:c1=tri:c2=tri[xa${index}]`)
      video = `xv${index}`
      audio = `xa${index}`
      elapsed += duration - overlap
    }
  } else {
    chains.push(`${segments.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`)
    video = 'outv'
    audio = 'outa'
  }
  try {
    await run(ffmpeg, [
      '-y', ...segments.flatMap(segment => ['-i', segment.file]),
      '-filter_complex_threads', '1', '-filter_complex', chains.join(';'),
      '-map', `[${video}]`, '-map', `[${audio}]`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '24',
      '-c:a', 'aac', '-movflags', '+faststart', options.outputFile,
    ], { maxBuffer: 16 * 1024 * 1024, signal: options.signal })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw abortError()
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`ffmpeg ${transition.kind} transition failed: ${detail.slice(0, 2000)}`)
  }
}
