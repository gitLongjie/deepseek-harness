/**
 * Serve an `endpoint: 'image-generation'` catalog model through the OpenAI-compatible
 * `POST {baseURL}/images/generations` endpoint. One conversation request becomes one generation:
 * the latest user message's text is the prompt, and the generated image is committed to the
 * durable attachment store before it is emitted as a single assistant image block. The same
 * endpoint call, {@link requestImage}, serves the route's `ctx.image` provider.
 * @module dsh-llm-deepagens/image-generation
 */

import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { httpErrorCode } from '../../common/http-error.ts'
import type { WireError } from '../chat-completions/types.ts'

/** Request-local inputs resolved by the owning adapter for one generation. */
export interface ImageGenerationRequest {
  /** Validated endpoint root. */
  readonly baseURL: string
  /** Bearer token resolved from the same configuration generation as {@link baseURL}. */
  readonly apiKey: string
  /** Harness-home anonymous id sent as transport metadata. */
  readonly userId: AnonymousUserId
  /** Durable store receiving the generated image. */
  readonly attachments: AttachmentStore
  /** Combined caller and idle-watchdog cancellation. */
  readonly signal: AbortSignal
  /** Report provider activity to the idle watchdog. */
  readonly onActivity: () => void
}

/** One `data[]` entry of an images response; gateways return either encoding. */
interface WireImage {
  b64_json?: unknown
  url?: unknown
}

/** The images response fields this adapter reads. */
interface WireImagesResponse {
  data?: unknown
  usage?: { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown }
}

const EXTENSIONS: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Name the media type from magic bytes; the endpoint does not declare the encoding of `b64_json`.
 * @param bytes - decoded image bytes.
 * @returns the detected media type, or `undefined` for an unsupported format.
 */
function sniffMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  return undefined
}

/**
 * Select the prompt: the text of the latest user message. Image editing is not served, so a latest
 * user message carrying an image fails instead of silently dropping it.
 * @param options - the conversation request.
 * @returns the trimmed prompt text.
 */
function promptOf(options: GenerateOptions): string {
  const latest = options.messages.findLast(message => message.role === 'user')
  if (latest?.content.some(block => block.type === 'image') === true) {
    throw new LlmError(
      `image-generation model "${options.model}" does not accept reference images; send a text-only prompt`,
      'UNSUPPORTED_CONTENT',
    )
  }
  const prompt = (latest?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (prompt.length === 0) {
    throw new LlmError(`image-generation model "${options.model}" needs a text prompt in the latest user message`, 'INVALID_REQUEST')
  }
  return prompt
}

/**
 * Map the optional images usage block onto disjoint harness counts.
 * @param usage - the response `usage` field.
 * @returns harness usage, or `undefined` when input and output counts are not both present.
 */
function usageOf(usage: WireImagesResponse['usage']): TokenUsage | undefined {
  const input = usage?.input_tokens
  const output = usage?.output_tokens
  if (typeof input !== 'number' || typeof output !== 'number') return undefined
  return {
    inputTokens: input,
    outputTokens: output,
    ...typeof usage?.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {},
  }
}

/**
 * Read the first generated image's bytes from either response encoding. A `url` is downloaded
 * without credentials because it is a provider-issued object link, not the authenticated API.
 * @param body - the parsed response body.
 * @param signal - request cancellation.
 * @returns the encoded image bytes.
 */
async function imageBytes(body: WireImagesResponse, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const first = (Array.isArray(body.data) ? body.data[0] : undefined) as WireImage | undefined
  if (typeof first?.b64_json === 'string' && first.b64_json.length > 0) return Buffer.from(first.b64_json, 'base64')
  if (typeof first?.url === 'string' && first.url.length > 0) {
    const download = await fetch(first.url, signal !== undefined ? { signal } : {})
    if (!download.ok) {
      throw new LlmError(`generated image download failed (HTTP ${download.status})`, 'SERVER', { status: download.status })
    }
    return new Uint8Array(await download.arrayBuffer())
  }
  throw new LlmError('images response carries neither data[0].b64_json nor data[0].url', 'MALFORMED_RESPONSE')
}

/** Inputs of one `POST {baseURL}/images/generations` call. */
export interface ImagesEndpointRequest {
  /** Validated endpoint root. */
  readonly baseURL: string
  /** Bearer token for {@link baseURL}. */
  readonly apiKey: string
  /** Harness-home anonymous id sent as transport metadata. */
  readonly userId: AnonymousUserId
  /** Session id sent as transport metadata, when the call belongs to a session. */
  readonly sessionId?: string
  /** Backend image model id. */
  readonly model: string
  /** Visual description sent unchanged. */
  readonly prompt: string
  /** Request cancellation. */
  readonly signal?: AbortSignal
  /** Report provider activity, for example to an idle watchdog. */
  readonly onActivity?: () => void
}

/** One generated image read from the images endpoint. */
export interface ImagesEndpointResult {
  /** Encoded image bytes. */
  readonly data: Uint8Array
  /** Media type detected from the bytes. */
  readonly mediaType: ImageMediaType
  /** Usage reported by the endpoint, when it reports both input and output counts. */
  readonly usage?: TokenUsage
}

/**
 * Call the OpenAI-compatible images endpoint once and read the first image. Failures are
 * {@link LlmError}s with the HTTP status mapped onto the shared provider codes.
 * @param request - endpoint, credential, model, prompt, and cancellation.
 * @returns the image bytes, their detected media type, and optional usage.
 */
export async function requestImage(request: ImagesEndpointRequest): Promise<ImagesEndpointResult> {
  const response = await fetch(`${request.baseURL}/images/generations`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${request.apiKey}`,
      'content-type': 'application/json',
      'accept': 'application/json',
      ...attributionHeaders(),
      'x-deepseek-harness-user-id': String(request.userId),
      ...request.sessionId !== undefined
        ? { 'x-deepseek-harness-session-id': request.sessionId }
        : {},
    },
    body: JSON.stringify({ model: request.model, prompt: request.prompt, n: 1 }),
    redirect: 'error',
    ...request.signal !== undefined ? { signal: request.signal } : {},
  })
  request.onActivity?.()
  const raw = await response.text()
  if (!response.ok) {
    let providerError: WireError['error']
    try {
      providerError = (JSON.parse(raw) as WireError).error
    } catch {
      // The HTTP status remains authoritative when a gateway returns malformed JSON.
    }
    throw new LlmError(
      providerError?.message ?? `image generation failed (HTTP ${response.status})`,
      httpErrorCode(response.status, providerError),
      { cause: new Error(raw.length > 0 ? raw : `HTTP ${response.status}`), status: response.status },
    )
  }
  let body: WireImagesResponse
  try {
    body = JSON.parse(raw) as WireImagesResponse
  } catch (error: unknown) {
    throw new LlmError('images response is not JSON', 'MALFORMED_RESPONSE', { cause: error })
  }
  const data = await imageBytes(body, request.signal)
  request.onActivity?.()
  const mediaType = sniffMediaType(data)
  if (mediaType === undefined) {
    throw new LlmError('generated image is not PNG, JPEG, WebP, or GIF', 'MALFORMED_RESPONSE')
  }
  const usage = usageOf(body.usage)
  return { data, mediaType, ...usage !== undefined ? { usage } : {} }
}

/**
 * Run one image generation and emit it as an assistant turn.
 * @param options - the conversation request; tools, sampling, and earlier history are not sent.
 * @param request - endpoint, credential, store, and cancellation for this request.
 * @returns one image block, optional usage, and a `stop` finish.
 */
export async function * generateImage(
  options: GenerateOptions,
  request: ImageGenerationRequest,
): AsyncIterable<StreamChunk> {
  if (options.purpose !== undefined) {
    throw new LlmError(
      `image-generation model "${options.model}" cannot serve ${options.purpose} requests`,
      'UNSUPPORTED_CONTENT',
    )
  }
  const image = await requestImage({
    baseURL: request.baseURL,
    apiKey: request.apiKey,
    userId: request.userId,
    ...options.sessionId !== undefined ? { sessionId: String(options.sessionId) } : {},
    model: options.model,
    prompt: promptOf(options),
    signal: request.signal,
    onActivity: request.onActivity,
  })
  let block: ContentBlock
  try {
    const attachment = await request.attachments.saveImage({
      data: image.data,
      mediaType: image.mediaType,
      name: imageFileName(options.model, image.mediaType),
    })
    block = { type: 'image', attachment }
  } catch (error: unknown) {
    throw new LlmError('generated image could not be stored as an attachment', 'MALFORMED_RESPONSE', { cause: error })
  }
  yield { type: 'block-start', index: 0, blockType: 'image' }
  yield { type: 'block-end', index: 0, block }
  if (image.usage !== undefined) yield { type: 'usage', usage: image.usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Name a generated image file after its model and encoding.
 * @param model - backend model id.
 * @param mediaType - detected media type.
 * @returns `<model>.<extension>`.
 */
function imageFileName(model: string, mediaType: ImageMediaType): string {
  return `${model}.${EXTENSIONS[mediaType]}`
}
