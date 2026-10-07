/**
 * Local ComfyUI backend for H3 video generation: enqueues a parameterized workflow on the
 * ComfyUI HTTP queue, polls history until the prompt settles, and downloads the produced media
 * into the local output directory. A failed or interrupted task is reported through history
 * errors or the timeout, never as a silent success.
 * @module @deepseek-ai/dsh-h3-video/comfyui
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { diskFreeBytes } from './disk.ts'
import { H3TaskRef, type H3VideoProvider, type ProviderCapabilities, type SegmentInput, type SegmentRequest, type TaskStatus } from './types.ts'

/** HTTP fetch function injectable for tests; defaults to global fetch. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Construction options for {@link createComfyUIProvider}. */
export interface ComfyUIOptions {
  /** ComfyUI server origin, e.g. `http://127.0.0.1:8188`. */
  baseUrl: string
  /** Absolute path of the JSON workflow template with `"{{field}}"` placeholders. */
  workflowPath: string
  /** Workflow placeholder filled with the text prompt. */
  promptField: string
  /** Workflow placeholder filled with the resolution tier text. */
  resolutionField: string
  /** Workflow placeholder filled with the duration in seconds. */
  durationField: string
  /** Workflow placeholder filled with the aspect ratio text. */
  ratioField: string
  /** Workflow placeholder filled with the seed integer. */
  seedField: string
  /** Workflow placeholder filled with the frame count computed from the duration (default `length`). */
  lengthField?: string
  /** ComfyUI `input` directory; required for image-to-video keyframe uploads. */
  inputDir?: string
  /** Directory that receives downloaded outputs. */
  outputDir: string
  /** Poll interval between history queries in milliseconds. */
  pollIntervalMs: number
  /** Wall-clock bound on one generation in milliseconds. */
  taskTimeoutMs: number
  /** Concurrent generations before submissions queue locally. */
  maxConcurrency: number
  /** Resolution tiers this deployment serves. */
  resolutions: readonly SegmentRequest['resolution'][]
  /** Inclusive minimum segment seconds on this deployment. */
  minDurationSeconds: number
  /** Inclusive maximum segment seconds on this deployment. */
  maxDurationSeconds: number
  /** Hard floor of free bytes the output volume must keep, in addition to the size estimate. */
  minFreeSpaceBytes: number
  /** Size estimate per second of output, used with the floor to refuse a disk-full download. */
  estimatedBytesPerSecond: number
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike
}

interface HistoryOutputMedia {
  filename?: string
  subfolder?: string
  type?: string
}

interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryOutputMedia[]; videos?: HistoryOutputMedia[]; gifs?: HistoryOutputMedia[] }>
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
}

function abortError(): Error {
  return Object.assign(new Error('H3 task cancelled'), { name: 'AbortError' })
}

async function readAbortableJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const text = await response.text()
  if (signal.aborted) throw abortError()
  return JSON.parse(text) as unknown
}

/** Replace every `"{{name}}"` placeholder occurrence in the workflow template with its JSON value. */
function fillTemplate(template: string, values: Record<string, string | number>): string {
  let result = template
  for (const [name, value] of Object.entries(values)) {
    result = result.split(`"{{${name}}}"`).join(JSON.stringify(value))
  }
  return result
}

/**
 * Snap a duration in seconds to the H3 frame grid at 24 fps: the model's valid clip lengths follow
 * `17k + 5` frames, so the rounded frame count is rounded up to the next grid value (min 5 frames).
 * @param seconds - requested duration.
 * @returns the snapped frame count.
 */
export function snapH3Frames(seconds: number): number {
  const base = Math.max(5, Math.round(seconds * 24))
  return base + ((5 - (base % 17) + 17) % 17)
}

function pickMedia(entry: HistoryEntry | undefined): HistoryOutputMedia | undefined {
  for (const outputs of Object.values(entry?.outputs ?? {})) {
    const media = outputs.videos?.[0] ?? outputs.gifs?.[0] ?? outputs.images?.find(image => image.type === 'output')
    if (typeof media?.filename === 'string' && media.filename.length > 0) return media
  }
  return undefined
}

function failureReason(entry: HistoryEntry | undefined): string | undefined {
  if (entry?.status?.status_str !== 'error') return undefined
  for (const item of entry.status.messages ?? []) {
    if (!Array.isArray(item) || typeof item[1] !== 'object' || item[1] === null) continue
    const detail = item[1] as { message?: unknown }
    if (typeof detail.message === 'string' && detail.message.length > 0) return detail.message
  }
  return 'ComfyUI reported the task as failed'
}

/**
 * Build the local ComfyUI provider over the `/prompt`, `/history`, and `/view` HTTP API.
 * @param options - endpoint, field mapping, and limits.
 * @returns a provider submitting workflows to the local queue.
 */
export function createComfyUIProvider(options: ComfyUIOptions): H3VideoProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const capabilities: ProviderCapabilities = {
    name: 'comfyui-local',
    resolutions: options.resolutions,
    minDurationSeconds: options.minDurationSeconds,
    maxDurationSeconds: options.maxDurationSeconds,
    // The workflow serves text-to-video, first/last-frame image-to-video, and reference conditioning
    // (MiniMaxH3ReferenceToVideo) when `inputDir` is configured; video/audio references still need
    // the hosted API and are rejected by validateSegmentRequest.
    multimodalInputs: true,
    maxConcurrency: options.maxConcurrency,
  }
  const submittedAt = new Map<string, number>()

  /** Type guard: an image input used as a first/last-frame keyframe for image-to-video. */
  function isFrameImage(input: SegmentInput): input is Extract<SegmentInput, { type: 'image' }> {
    return input.type === 'image' && (input.role === 'first_frame' || input.role === 'last_frame')
  }

  /** Type guard: an image input used as reference conditioning (character/scene/prop anchor). */
  function isReferenceImage(input: SegmentInput): input is Extract<SegmentInput, { type: 'image' }> {
    return input.type === 'image' && input.role === 'reference_image'
  }

  async function submit(request: SegmentRequest, signal: AbortSignal): Promise<H3TaskRef> {
    const { readFile, copyFile } = await import('node:fs/promises')
    const { extname } = await import('node:path') as { extname: (path: string) => string }
    const required = options.minFreeSpaceBytes + Math.ceil(request.durationSeconds * options.estimatedBytesPerSecond)
    const free = await diskFreeBytes(options.outputDir)
    if (free !== undefined && free < required) {
      throw new Error(
        `insufficient disk space on ${options.outputDir}: free ${Math.round(free / 1024 / 1024)} MB, need ${Math.round(required / 1024 / 1024)} MB`,
      )
    }
    const template = await readFile(options.workflowPath, 'utf8')
    const graph = JSON.parse(template) as Record<string, { class_type: string; inputs: Record<string, unknown> }>

    /**
     * Copy one local image into the ComfyUI input directory and return a fresh LoadImage node id.
     * @param source - absolute local path of the image.
     * @param prefix - uploaded filename prefix (`h3-frame-` for keyframes, `h3-ref-` for references).
     * @returns the id of the added LoadImage node.
     */
    async function uploadInputImage(source: string, prefix: string): Promise<string> {
      if (options.inputDir === undefined) {
        throw new Error('h3-video: configure comfy.inputDir (ComfyUI/input) to use image-conditioned generation')
      }
      if (!/^([a-zA-Z]:[\\/]|\/)/u.test(source)) {
        throw new Error('local image conditioning requires absolute local paths')
      }
      const { mkdir } = await import('node:fs/promises')
      const { randomUUID } = await import('node:crypto')
      await mkdir(options.inputDir, { recursive: true })
      let nextId = Math.max(...Object.keys(graph).map(Number), 0) + 1
      const uploadName = `${prefix}${randomUUID()}${extname(source) || '.png'}`
      await copyFile(source, `${options.inputDir}/${uploadName}`)
      const loadId = String(nextId++)
      graph[loadId] = { class_type: 'LoadImage', inputs: { image: uploadName } }
      return loadId
    }

    // Image-to-video: copy each first/last-frame keyframe into the ComfyUI input directory, add a
    // LoadImage node, and wire it to the H3 node's frame input.
    const frameImages = request.inputs.filter(isFrameImage)
    if (frameImages.length > 0) {
      const h3Entry = Object.entries(graph).find(([, node]) => node.class_type === 'MiniMaxH3ImageToVideo')
      if (h3Entry === undefined) {
        throw new Error(`workflow ${options.workflowPath} has no MiniMaxH3ImageToVideo node; cannot attach keyframes`)
      }
      const [, h3Node] = h3Entry
      for (const frame of frameImages) {
        const loadId = await uploadInputImage(frame.url, 'h3-frame-')
        h3Node.inputs[frame.role] = [loadId, 0]
      }
    }

    // Reference conditioning: swap the H3 node to ReferenceToVideo and wire the asset reference
    // images into its `ref_images` autogrow input, so confirmed characters/scenes/props anchor the
    // generation locally instead of through the hosted API.
    const referenceImages = request.inputs.filter(isReferenceImage)
    if (referenceImages.length > 0) {
      if (frameImages.length > 0) {
        throw new Error('cannot combine first/last frame keyframes with reference images in one request')
      }
      const h3Entry = Object.entries(graph).find(([, node]) => node.class_type === 'MiniMaxH3ImageToVideo')
      if (h3Entry === undefined) {
        throw new Error(`workflow ${options.workflowPath} has no MiniMaxH3ImageToVideo node; cannot condition on references`)
      }
      const [, h3Node] = h3Entry
      h3Node.class_type = 'MiniMaxH3ReferenceToVideo'
      h3Node.inputs.ref_image_size = 'match'
      delete h3Node.inputs.first_frame
      delete h3Node.inputs.last_frame
      const links: Array<[string, number]> = []
      for (const reference of referenceImages) {
        const loadId = await uploadInputImage(reference.url, 'h3-ref-')
        links.push([loadId, 0])
      }
      h3Node.inputs.ref_images = links
    }
    const promptInput = request.inputs.find(input => input.type === 'text')
    const workflow = fillTemplate(JSON.stringify(graph), {
      [options.promptField]: promptInput?.type === 'text' ? promptInput.text : '',
      [options.resolutionField]: request.resolution,
      [options.durationField]: request.durationSeconds,
      [options.ratioField]: request.ratio,
      [options.seedField]: Math.floor(Math.random() * 2 ** 53),
      [options.lengthField ?? 'length']: snapH3Frames(request.durationSeconds),
    })
    const response = await doFetch(`${options.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: JSON.parse(workflow) as unknown }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`ComfyUI /prompt failed with HTTP ${response.status}: ${body.slice(0, 400)}`)
    }
    const created = await readAbortableJson(response, signal) as { prompt_id?: string }
    if (typeof created.prompt_id !== 'string') {
      throw new Error('ComfyUI returned no prompt_id')
    }
    submittedAt.set(created.prompt_id, Date.now())
    return H3TaskRef(created.prompt_id)
  }

  async function poll(ref: H3TaskRef, signal: AbortSignal): Promise<TaskStatus> {
    const promptId = String(ref)
    const started = submittedAt.get(promptId) ?? Date.now()
    const deadline = started + options.taskTimeoutMs
    for (;;) {
      const response = await doFetch(`${options.baseUrl}/history/${encodeURIComponent(promptId)}`, { signal })
      if (!response.ok) throw new Error(`ComfyUI /history failed with HTTP ${response.status}`)
      const history = await readAbortableJson(response, signal) as Record<string, HistoryEntry>
      const entry = history[promptId]
      const reason = failureReason(entry)
      if (reason !== undefined) {
        submittedAt.delete(promptId)
        return { state: 'failed', reason }
      }
      const media = pickMedia(entry)
      if (media !== undefined) {
        // Re-check the volume before committing the write: space may have changed since submit.
        const free = await diskFreeBytes(options.outputDir)
        const required = options.minFreeSpaceBytes
        if (free !== undefined && free < required) {
          submittedAt.delete(promptId)
          return {
            state: 'failed',
            reason: `insufficient disk space on ${options.outputDir}: free ${Math.round(free / 1024 / 1024)} MB, need ${Math.round(required / 1024 / 1024)} MB`,
          }
        }
        const viewUrl = `${options.baseUrl}/view?filename=${encodeURIComponent(media.filename ?? '')}&subfolder=${encodeURIComponent(media.subfolder ?? '')}&type=output`
        const fileResponse = await doFetch(viewUrl, { signal })
        if (!fileResponse.ok) throw new Error(`ComfyUI /view failed with HTTP ${fileResponse.status}`)
        const bytes = new Uint8Array(await fileResponse.arrayBuffer())
        if (signal.aborted) throw abortError()
        const target = join(options.outputDir, media.filename ?? `${promptId}.mp4`)
        await mkdir(dirname(target), { recursive: true })
        const temp = `${target}.part`
        try {
          await writeFile(temp, bytes)
          await rename(temp, target)
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes('ENOSPC')) {
            return { state: 'failed', reason: `download failed: disk full on ${options.outputDir}` }
          }
          throw error
        }
        submittedAt.delete(promptId)
        return { state: 'succeeded', localFile: target }
      }
      if (Date.now() >= deadline) {
        submittedAt.delete(promptId)
        return { state: 'failed', reason: `ComfyUI task exceeded ${Math.round(options.taskTimeoutMs / 1000)}s` }
      }
      const remaining = deadline - Date.now()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(options.pollIntervalMs, remaining))
        const onAbort = (): void => { clearTimeout(timer); reject(abortError()) }
        signal.addEventListener('abort', onAbort, { once: true })
      })
      if (signal.aborted) throw abortError()
    }
  }

  return {
    capabilities,
    submit,
    poll,
    async cancel(ref) {
      submittedAt.delete(String(ref))
      await doFetch(`${options.baseUrl}/interrupt`, { method: 'POST' }).catch(() => undefined)
    },
  }
}
