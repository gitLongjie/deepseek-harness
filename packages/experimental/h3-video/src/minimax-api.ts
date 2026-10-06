/**
 * Hosted MiniMax H3 video backend: creates V2 generation tasks, polls them to completion, and
 * downloads the time-limited result URL into the local output directory.
 * @module @deepseek-ai/dsh-experimental-h3-video/minimax-api
 */

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { diskFreeBytes } from './disk.ts'
import { H3TaskRef, type H3VideoProvider, type ProviderCapabilities, type SegmentRequest } from './types.ts'

/** HTTP fetch function injectable for tests; defaults to global fetch. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** A literal API key, or a resolver invoked per request so rotated credentials take effect. */
export type ApiKeySource = string | (() => Promise<string> | string)

/** Construction options for {@link createMiniMaxApiProvider}. */
export interface MiniMaxApiOptions {
  /** Account API key sent as a bearer token, or a per-request resolver. */
  apiKey: ApiKeySource
  /** API origin, e.g. `https://api.minimax.cn`. */
  baseUrl: string
  /** Model release id the account has enabled, e.g. `MiniMax-H3`. */
  model: string
  /**
   * Resolution tiers this release accepts. Omitted falls back to the published envelope for a
   * known release id; an id with no published envelope must carry one explicitly.
   */
  resolutions?: readonly SegmentRequest['resolution'][]
  /** Inclusive shortest segment this release accepts; falls back like `resolutions`. */
  minDurationSeconds?: number
  /** Inclusive longest segment this release accepts; falls back like `resolutions`. */
  maxDurationSeconds?: number
  /** Absolute directory that receives downloaded mp4 files. */
  outputDir: string
  /** Poll interval between task queries in milliseconds. */
  pollIntervalMs: number
  /** Wall-clock bound on one task from submit to settled file in milliseconds. */
  taskTimeoutMs: number
  /** Concurrent remote generations before submissions queue locally. */
  maxConcurrency: number
  /** Hard floor of free bytes the output volume must keep, in addition to the size estimate. */
  minFreeSpaceBytes: number
  /** Size estimate per second of output, used with the floor to refuse a disk-full download. */
  estimatedBytesPerSecond: number
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike
}

interface VideoTaskJson {
  id?: string
  status?: string
  error?: { code?: string; message?: string }
  content?: { url?: string }
}

/**
 * Published envelopes for known MiniMax releases. Which release an account has enabled — and what
 * it accepts — is deployment configuration: an unlisted model id must carry an explicit
 * `resolutions`/duration profile instead of guessing here.
 */
const PUBLISHED_ENVELOPES: Record<string, {
  readonly resolutions: readonly SegmentRequest['resolution'][]
  readonly minDurationSeconds: number
  readonly maxDurationSeconds: number
}> = {
  'MiniMax-H3': { resolutions: ['768P', '2K'], minDurationSeconds: 4, maxDurationSeconds: 15 },
  'MiniMax-H3-Max': { resolutions: ['480P', '768P'], minDurationSeconds: 5, maxDurationSeconds: 15 },
}

/**
 * Resolve one model's serving envelope from the explicit profile or the published table.
 * @param options - the provider options carrying the model id and optional explicit profile.
 * @returns the capabilities the provider advertises.
 * @throws Error - naming the model when neither an explicit profile nor a published envelope
 * covers every field.
 */
function resolveCapabilities(options: MiniMaxApiOptions): ProviderCapabilities {
  const published = PUBLISHED_ENVELOPES[options.model]
  const resolutions = options.resolutions ?? published?.resolutions
  const minDurationSeconds = options.minDurationSeconds ?? published?.minDurationSeconds
  const maxDurationSeconds = options.maxDurationSeconds ?? published?.maxDurationSeconds
  if (resolutions === undefined || minDurationSeconds === undefined || maxDurationSeconds === undefined) {
    throw new Error(
      `h3-video: model ${JSON.stringify(options.model)} has no published envelope; `
      + 'configure minimax.resolutions and minimax.minDurationSeconds/maxDurationSeconds for it',
    )
  }
  return {
    name: 'minimax-api',
    resolutions: [...resolutions],
    minDurationSeconds,
    maxDurationSeconds,
    multimodalInputs: true,
    maxConcurrency: options.maxConcurrency,
  }
}

/** Published per-modality caps on one inline (base64) reference, in bytes. */
const INLINE_REFERENCE_CAP_BYTES = {
  image: 30 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
} as const

/** Published cap on the whole creation body after base64 expansion, in bytes. */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024

function abortError(): Error {
  return Object.assign(new Error('H3 task cancelled'), { name: 'AbortError' })
}

async function readAbortable(response: Response, signal: AbortSignal): Promise<unknown> {
  const text = await response.text()
  if (signal.aborted) throw abortError()
  return JSON.parse(text) as unknown
}

/**
 * Build the hosted-API provider. One instance serves one account/model pair; polling sleeps are
 * interruptible through the caller's signal, and every succeeded task's media is downloaded locally
 * because remote URLs expire.
 * @param options - endpoint, credentials, and limits.
 * @returns a provider over the MiniMax V2 video API.
 */
export function createMiniMaxApiProvider(options: MiniMaxApiOptions): H3VideoProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const capabilities = resolveCapabilities(options)

  async function api(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${key}`)
    headers.set('content-type', 'application/json')
    const response = await doFetch(`${options.baseUrl}${path}`, {
      ...init,
      headers,
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`MiniMax API ${response.status} on ${path}: ${body.slice(0, 400)}`)
    }
    return await readAbortable(response, signal)
  }

  /**
   * Convert a local media path into a base64 data URI the hosted API accepts (keyframes are local
   * files after download); http(s) URLs and `mm_file://{file_id}` ids from the MiniMax file
   * service pass through unchanged. A local file beyond the published per-modality cap fails
   * before submission instead of sending a body the provider may reject.
   * @param source - the reference source as authored.
   * @param mediaType - MIME family for the data URI (`image`, `video`, or `audio`).
   * @returns the API-ready URL value.
   */
  async function toApiUrl(source: string, mediaType: 'image' | 'video' | 'audio'): Promise<string> {
    if (/^(https?|mm_file):\/\//iu.test(source)) return source
    const { readFile } = await import('node:fs/promises')
    const { extname } = await import('node:path') as { extname: (path: string) => string }
    const bytes = await readFile(source)
    const cap = INLINE_REFERENCE_CAP_BYTES[mediaType]
    if (bytes.byteLength > cap) {
      throw new Error(
        `reference ${source} is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, over the `
        + `${Math.round(cap / 1024 / 1024)} MB ${mediaType} cap; host it and pass an https URL instead`,
      )
    }
    const ext = extname(source).toLowerCase().replace('.', '') || 'bin'
    const base64 = bytes.toString('base64')
    return `data:${mediaType}/${ext};base64,${base64}`
  }

  async function toBody(request: SegmentRequest): Promise<string> {
    const content: unknown[] = []
    for (const input of request.inputs) {
      if (input.type === 'text') {
        content.push({ type: 'text', text: input.text })
      } else if (input.type === 'image') {
        content.push({ type: 'image_url', image_url: { url: await toApiUrl(input.url, 'image') }, role: input.role })
      } else if (input.type === 'video') {
        content.push({ type: 'video_url', video_url: { url: await toApiUrl(input.url, 'video') }, role: input.role })
      } else {
        content.push({ type: 'audio_url', audio_url: { url: await toApiUrl(input.url, 'audio') }, role: input.role })
      }
    }
    const body = JSON.stringify({
      model: options.model,
      content,
      resolution: request.resolution,
      duration: request.durationSeconds,
      ratio: request.ratio,
    })
    const bodyBytes = Buffer.byteLength(body, 'utf8')
    if (bodyBytes > MAX_REQUEST_BYTES) {
      throw new Error(
        `request body is ${Math.round(bodyBytes / 1024 / 1024)} MB after base64 expansion, over the `
        + `${Math.round(MAX_REQUEST_BYTES / 1024 / 1024)} MB cap; host the references and pass https URLs instead`,
      )
    }
    return body
  }

  /** Free bytes the output volume must keep for one segment before we commit a download. */
  function expectedBytesFor(durationSeconds: number): number {
    return options.minFreeSpaceBytes + Math.ceil(durationSeconds * options.estimatedBytesPerSecond)
  }

  /**
   * Refuse a generation when the output volume cannot hold the floor plus the size estimate.
   * @param expectedBytes - required free bytes for this segment.
   * @throws Error - a model-safe message naming free and required space; never a raw disk error.
   */
  async function assertDiskSpace(expectedBytes: number): Promise<void> {
    const free = await diskFreeBytes(options.outputDir)
    if (free !== undefined && free < expectedBytes) {
      throw new Error(
        `insufficient disk space on ${options.outputDir}: free ${Math.round(free / 1024 / 1024)} MB, need ${Math.round(expectedBytes / 1024 / 1024)} MB`,
      )
    }
  }

  async function download(url: string, taskId: string, expectedBytes: number, signal: AbortSignal): Promise<string> {
    await assertDiskSpace(expectedBytes)
    const target = join(options.outputDir, `${taskId}.mp4`)
    await mkdir(dirname(target), { recursive: true })
    try {
      const response = await doFetch(url, { signal })
      if (!response.ok || !response.body) {
        throw new Error(`MiniMax download failed with HTTP ${response.status}`)
      }
      await pipeline(response.body as ReadableStream<Uint8Array>, createWriteStream(target))
    } catch (error: unknown) {
      if (signal.aborted) throw abortError()
      if (error instanceof Error && error.message.includes('ENOSPC')) {
        throw new Error(`download failed: disk full on ${options.outputDir}`)
      }
      throw error
    }
    return target
  }

  const live = new Map<string, AbortController>()
  const expectedBytes = new Map<string, number>()

  return {
    capabilities,
    async submit(request, signal) {
      const required = expectedBytesFor(request.durationSeconds)
      await assertDiskSpace(required)
      const created = await api('/v2/video_generation', { method: 'POST', body: await toBody(request) }, signal) as
        { task_id?: string }
      const taskId = created.task_id
      if (typeof taskId !== 'string' || taskId.length === 0) {
        throw new Error('MiniMax API returned no task_id')
      }
      live.set(taskId, new AbortController())
      expectedBytes.set(taskId, required)
      return H3TaskRef(taskId)
    },
    async poll(ref, signal) {
      const taskId = String(ref)
      const deadline = Date.now() + options.taskTimeoutMs
      for (;;) {
        const polled = await api(`/v2/query/video_generation/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal) as
          { task?: VideoTaskJson }
        const task = polled.task
        if (task?.status === 'succeeded') {
          live.delete(taskId)
          const url = task.content?.url
          if (typeof url !== 'string' || url.length === 0) {
            return { state: 'failed', reason: 'succeeded task carried no media url' }
          }
          const localFile = await download(url, taskId, expectedBytes.get(taskId) ?? 0, signal)
          return { state: 'succeeded', localFile, remoteUrl: url }
        }
        if (task?.status === 'failed' || task?.status === 'cancelled') {
          live.delete(taskId)
          const reason = task.error?.message ?? task.status
          return { state: 'failed', reason }
        }
        if (Date.now() >= deadline) {
          live.delete(taskId)
          return { state: 'failed', reason: `task exceeded ${Math.round(options.taskTimeoutMs / 1000)}s` }
        }
        const remaining = deadline - Date.now()
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, Math.min(options.pollIntervalMs, remaining))
          const onAbort = (): void => { clearTimeout(timer); reject(abortError()) }
          signal.addEventListener('abort', onAbort, { once: true })
        })
        if (signal.aborted) throw abortError()
      }
    },
    cancel(ref) {
      const controller = live.get(String(ref))
      controller?.abort()
      live.delete(String(ref))
      return Promise.resolve()
    },
  }
}
