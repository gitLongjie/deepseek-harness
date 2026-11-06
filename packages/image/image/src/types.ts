/**
 * Vocabulary for the image-generation capability seam (`ctx.image`): the request a consumer
 * sends, the bytes a provider returns, the provider protocol, and the structured error taxonomy.
 * @module @deepseek-ai/dsh-image/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** What one image-generation backend is asked to draw. Each request produces one image. */
export interface ImageGenerationRequest {
  /** The visual description sent to the backend unchanged. */
  readonly prompt: string
}

/**
 * One generated image. `mediaType` is the type the provider detected from the bytes; consumers
 * that persist the image validate it against their own accepted types.
 */
export interface GeneratedImage {
  /** Encoded image bytes. */
  readonly data: Uint8Array
  /** IANA media type of `data`, for example `image/png`. */
  readonly mediaType: string
  /** The backend model that produced the image, when the provider knows it. */
  readonly model?: string
}

/**
 * One image-generation backend. The registry key is `id`; selection calls `available()`
 * without network access and `generate()` only on the selected provider.
 */
export interface ImageGenerationProvider {
  readonly id: string
  /** Cheap local usability check, such as whether a model is configured; must not make network calls. */
  available(): boolean
  /**
   * Generate one image; honor `signal` for cancellation.
   * @param request - the visual description.
   * @param signal - cancellation for the backend request.
   * @returns the encoded image bytes and their media type.
   */
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage>
}

/**
 * Structured failure codes of the image seam and its providers.
 * - `IMAGE_DUPLICATE_PROVIDER`: a provider id is already registered.
 * - `IMAGE_PROVIDER_CONFIGURED_MISSING`: the configured provider id is not registered.
 * - `IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE`: the configured provider is registered but unusable.
 * - `IMAGE_PROVIDER_UNAVAILABLE`: no provider is configured and none is usable.
 * - `IMAGE_PROVIDER_AMBIGUOUS`: no provider is configured and several are usable.
 */
export type ImageErrorCode =
  | 'IMAGE_DUPLICATE_PROVIDER'
  | 'IMAGE_PROVIDER_CONFIGURED_MISSING'
  | 'IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'IMAGE_PROVIDER_UNAVAILABLE'
  | 'IMAGE_PROVIDER_AMBIGUOUS'

/** Structured failure from the image seam; `code` is one of {@link ImageErrorCode}. */
export class ImageError extends HarnessError {
  declare readonly code: ImageErrorCode
}
