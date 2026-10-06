/**
 * Hosted MiniMax `image-01` text-to-image backend, used to generate per-shot keyframes before
 * video generation so the visuals are fixed and confirmed first. The same API key resolver and
 * disk-space guard serve this client; a local ComfyUI deployment has no H3 text-to-image node.
 * @module @deepseek-ai/dsh-experimental-h3-video/minimax-image
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diskFreeBytes } from './disk.ts'
import type { ApiKeySource } from './minimax-api.ts'

/** HTTP fetch function injectable for tests; defaults to global fetch. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Construction options for {@link createMiniMaxImageProvider}. */
export interface MiniMaxImageOptions {
  /** Account API key or per-request resolver. */
  apiKey: ApiKeySource
  /** API origin, e.g. `https://api.minimax.cn`. */
  baseUrl: string
  /** Model name: `image-01` or `image-01-live`. */
  model: 'image-01' | 'image-01-live'
  /** Absolute directory that receives downloaded keyframe PNGs. */
  outputDir: string
  /** Hard floor of free bytes the output volume must keep. */
  minFreeSpaceBytes: number
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike
}

/** One keyframe generation request. */
export interface KeyframeRequest {
  /** Text description of the scene/shot, at most 1500 characters. */
  prompt: string
  /** Output aspect ratio; `16:9` yields 1280x720. */
  ratio: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  /** Optional deterministic seed for reproducible keyframes. */
  seed?: number
}

function abortError(): Error {
  return Object.assign(new Error('keyframe generation cancelled'), { name: 'AbortError' })
}

/**
 * Build the hosted image provider over `POST /v1/image_generation`. The response is synchronous:
 * it returns downloadable image URLs, which are fetched into `outputDir` immediately because the
 * URLs expire after 24 hours.
 * @param options - endpoint, credentials, and limits.
 * @returns a client whose `generate` returns a local keyframe file path.
 */
export function createMiniMaxImageProvider(options: MiniMaxImageOptions): {
  generate(request: KeyframeRequest, signal: AbortSignal): Promise<string>
} {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))

  async function generate(request: KeyframeRequest, signal: AbortSignal): Promise<string> {
    const free = await diskFreeBytes(options.outputDir)
    if (free !== undefined && free < options.minFreeSpaceBytes) {
      throw new Error(
        `insufficient disk space on ${options.outputDir}: free ${Math.round(free / 1024 / 1024)} MB, need ${Math.round(options.minFreeSpaceBytes / 1024 / 1024)} MB`,
      )
    }
    const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey
    const response = await doFetch(`${options.baseUrl}/v1/image_generation`, {
      method: 'POST',
      headers: new Headers({ authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: options.model,
        prompt: request.prompt.slice(0, 1500),
        aspect_ratio: request.ratio,
        response_format: 'url',
        n: 1,
        aigc_watermark: false,
        ...request.seed !== undefined ? { seed: request.seed } : {},
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`MiniMax image API ${response.status}: ${body.slice(0, 400)}`)
    }
    const parsed = JSON.parse(await response.text()) as { data?: { image_urls?: string[] } }
    const url = parsed.data?.image_urls?.[0]
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('MiniMax image API returned no image url')
    }
    const fileResponse = await doFetch(url, { signal })
    if (!fileResponse.ok || !fileResponse.body) {
      throw new Error(`MiniMax keyframe download failed with HTTP ${fileResponse.status}`)
    }
    const bytes = new Uint8Array(await fileResponse.arrayBuffer())
    if (signal.aborted) throw abortError()
    await mkdir(options.outputDir, { recursive: true })
    const target = join(options.outputDir, `keyframe-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`)
    await writeFile(target, bytes)
    return target
  }

  return { generate }
}
