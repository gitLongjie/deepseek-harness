/**
 * Local ComfyUI text-to-image backend for keyframes and asset stills. A deployment that already
 * runs ComfyUI for video also has image models on the same GPU, so generating stills there costs
 * nothing per image and keeps the whole pipeline on one machine. The workflow template carries
 * `"{{prompt}}"`, `"{{seed}}"`, `"{{width}}"`, and `"{{height}}"` placeholders.
 * @module @deepseek-ai/dsh-h3-video/comfy-image
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KeyframeRequest } from './minimax-image.ts'

/** HTTP fetch function injectable for tests; defaults to global fetch. */
export type ImageFetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Construction options for {@link createComfyUIImageProvider}. */
export interface ComfyImageOptions {
  /** ComfyUI origin, e.g. `http://127.0.0.1:8188`. */
  baseUrl: string
  /** JSON workflow template with the placeholder fields below. */
  workflowPath: string
  /**
   * JSON workflow template for a request that carries `subjectReference`. It gets the same
   * placeholders plus `"{{reference}}"`, the uploaded reference image name, so the still is drawn
   * from the confirmed portrait instead of from the prompt alone.
   */
  referenceWorkflowPath?: string
  /** Placeholder replaced with the prompt text. */
  promptField?: string
  /** Placeholder replaced with the uploaded reference image name (reference workflow only). */
  referenceField?: string
  /** Placeholder replaced with the seed integer. */
  seedField?: string
  /** Placeholder replaced with the pixel width. */
  widthField?: string
  /** Placeholder replaced with the pixel height. */
  heightField?: string
  /** Absolute directory that receives the generated stills. */
  outputDir: string
  /** Milliseconds between history polls. */
  pollIntervalMs?: number
  /** Wall-clock bound on one generation. */
  taskTimeoutMs?: number
  /** Injectable fetch for tests. */
  fetchImpl?: ImageFetchLike
}

/** Pixel dimensions one aspect ratio renders at, matching the hosted API's 720p ladder. */
const RATIO_SIZES: Record<KeyframeRequest['ratio'], { width: number; height: number }> = {
  '21:9': { width: 1680, height: 720 },
  '16:9': { width: 1280, height: 720 },
  '4:3': { width: 960, height: 720 },
  '1:1': { width: 720, height: 720 },
  '3:4': { width: 720, height: 960 },
  '9:16': { width: 720, height: 1280 },
}

/** One `SaveImage` output as `/history` reports it. */
interface HistoryImage {
  filename?: string
  subfolder?: string
  type?: string
}

/**
 * Replace every `"{{name}}"` placeholder with its JSON value, leaving unknown placeholders alone.
 * @param template - the workflow JSON text.
 * @param values - placeholder values by field name.
 * @returns the filled workflow text.
 */
function fillImageTemplate(template: string, values: Record<string, string | number>): string {
  let result = template
  for (const [name, value] of Object.entries(values)) {
    result = result.split(`"{{${name}}}"`).join(JSON.stringify(value))
  }
  return result
}

/**
 * Read one abortable JSON response.
 * @param response - the fetch response.
 * @param signal - cancellation.
 * @returns the parsed body.
 */
async function readJson<T>(response: Response, signal: AbortSignal): Promise<T> {
  const text = await response.text()
  if (signal.aborted) throw Object.assign(new Error('image generation cancelled'), { name: 'AbortError' })
  return JSON.parse(text) as T
}

/**
 * Pick the served image out of one history entry.
 * @param entry - one `/history` record.
 * @returns the first saved image, when the run produced one.
 */
function savedImage(entry: unknown): HistoryImage | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const outputs = (entry as { outputs?: unknown }).outputs
  if (typeof outputs !== 'object' || outputs === null) return undefined
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    const images = (node as { images?: unknown }).images
    if (!Array.isArray(images)) continue
    for (const image of images) {
      if (typeof image === 'object' && image !== null) return image as HistoryImage
    }
  }
  return undefined
}

/**
 * Build the local image provider over ComfyUI's `/prompt`, `/history`, and `/view` HTTP API.
 * @param options - endpoint, template, and timings.
 * @returns a client whose `generate` returns a local still path.
 */
export function createComfyUIImageProvider(options: ComfyImageOptions): {
  generate(request: KeyframeRequest, signal: AbortSignal): Promise<string>
} {
  const doFetch: ImageFetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const base = options.baseUrl.replace(/\/+$/u, '')
  const pollIntervalMs = options.pollIntervalMs ?? 3_000
  const taskTimeoutMs = options.taskTimeoutMs ?? 600_000
  const promptField = options.promptField ?? 'prompt'
  const seedField = options.seedField ?? 'seed'
  const widthField = options.widthField ?? 'width'
  const heightField = options.heightField ?? 'height'
  const referenceField = options.referenceField ?? 'reference'

  /**
   * Upload one reference image into ComfyUI's input directory.
   * @param source - local path or public URL of the image.
   * @param signal - cancellation.
   * @returns the name the `LoadImage` node refers to.
   */
  async function uploadReference(source: string, signal: AbortSignal): Promise<string> {
    const bytes = /^https?:\/\//u.test(source)
      ? new Uint8Array(await (await doFetch(source, { signal })).arrayBuffer())
      : new Uint8Array(await readFile(source))
    const form = new FormData()
    const name = `h3-reference-${Date.now()}.png`
    form.append('image', new Blob([bytes]), name)
    const response = await doFetch(`${base}/upload/image`, { method: 'POST', body: form, signal })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`ComfyUI /upload/image failed with HTTP ${response.status}: ${body.slice(0, 200)}`)
    }
    const uploaded = await readJson<{ name?: string; subfolder?: string }>(response, signal)
    if (typeof uploaded.name !== 'string' || uploaded.name.length === 0) {
      throw new Error('ComfyUI /upload/image returned no filename')
    }
    return uploaded.subfolder !== undefined && uploaded.subfolder.length > 0
      ? `${uploaded.subfolder}/${uploaded.name}`
      : uploaded.name
  }

  async function generate(request: KeyframeRequest, signal: AbortSignal): Promise<string> {
    const size = RATIO_SIZES[request.ratio]
    const usesReference = request.subjectReference !== undefined && options.referenceWorkflowPath !== undefined
    const templatePath = usesReference ? options.referenceWorkflowPath as string : options.workflowPath
    const template = await readFile(templatePath, 'utf8')
    const reference = usesReference
      ? await uploadReference(request.subjectReference as string, signal)
      : undefined
    const workflow = JSON.parse(fillImageTemplate(template, {
      [promptField]: request.prompt,
      [referenceField]: reference ?? '',
      [seedField]: request.seed ?? Math.floor(Math.random() * 2 ** 53),
      [widthField]: size.width,
      [heightField]: size.height,
    })) as unknown

    const created = await doFetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      signal,
    })
    if (!created.ok) {
      const body = await created.text().catch(() => '')
      throw new Error(`ComfyUI /prompt failed with HTTP ${created.status}: ${body.slice(0, 400)}`)
    }
    const submitted = await readJson<{ prompt_id?: string }>(created, signal)
    if (typeof submitted.prompt_id !== 'string') throw new Error('ComfyUI returned no prompt_id')

    const deadline = Date.now() + taskTimeoutMs
    while (Date.now() < deadline) {
      const history = await doFetch(`${base}/history/${encodeURIComponent(submitted.prompt_id)}`, { signal })
      if (!history.ok) throw new Error(`ComfyUI /history failed with HTTP ${history.status}`)
      const records = await readJson<Record<string, unknown>>(history, signal)
      const entry = records[submitted.prompt_id]
      if (entry !== undefined) {
        const image = savedImage(entry)
        if (image === undefined) throw new Error('ComfyUI finished without a saved image')
        const view = `${base}/view?filename=${encodeURIComponent(image.filename ?? '')}`
          + `&subfolder=${encodeURIComponent(image.subfolder ?? '')}&type=output`
        const file = await doFetch(view, { signal })
        if (!file.ok) throw new Error(`ComfyUI /view failed with HTTP ${file.status}`)
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (signal.aborted) throw Object.assign(new Error('image generation cancelled'), { name: 'AbortError' })
        await mkdir(options.outputDir, { recursive: true })
        const target = join(
          options.outputDir,
          `keyframe-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
        )
        await writeFile(target, bytes)
        return target
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    throw new Error(`ComfyUI image generation timed out after ${Math.round(taskTimeoutMs / 1000)}s`)
  }

  return { generate }
}
