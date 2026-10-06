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
  /** Model name: `MiniMax-H3` or `MiniMax-H3-Max`. */
  model: 'MiniMax-H3' | 'MiniMax-H3-Max'
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
  const capabilities: ProviderCapabilities = options.model === 'MiniMax-H3'
    ? {
      name: 'minimax-api',
      resolutions: ['768P', '2K'],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      multimodalInputs: true,
      maxConcurrency: options.maxConcurrency,
    }
    : {
      name: 'minimax-api',
      resolutions: ['480P', '768P'],
      minDurationSeconds: 5,
      maxDurationSeconds: 15,
      multimodalInputs: true,
      maxConcurrency: options.maxConcurrency,
    }

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
   * files after download); http(s) URLs pass through unchanged.
   * @param source - the reference source as authored.
   * @param mediaType - MIME family for the data URI (`image`, `video`, or `audio`).
   * @returns the API-ready URL value.
   */
  async function toApiUrl(source: string, mediaType: 'image' | 'video' | 'audio'): Promise<string> {
    if (/^https?:\/\//iu.test(source)) return source
    const { readFile } = await import('node:fs/promises')
    const { extname } = await import('node:path') as { extname: (path: string) => string }
    const ext = extname(source).toLowerCase().replace('.', '') || 'bin'
    const bytes = await readFile(source)
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
    return JSON.stringify({
      model: options.model,
      content,
      resolution: request.resolution,
      duration: request.durationSeconds,
      ratio: request.ratio,
    })
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
