/**
 * Types of the H3 video-provider seam: segment requests, task references, polled statuses, and
 * backend capabilities. Runtime code lives in `./index.ts` and the backend implementations.
 * @module @deepseek-ai/dsh-h3-video/types
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Opaque reference to one submitted generation task at a backend. */
export type H3TaskRef = Branded<'H3TaskRef'>

/** Apply the {@link H3TaskRef} brand to a backend-owned task id string. */
export const H3TaskRef = (value: string): H3TaskRef => brandString<H3TaskRef>(value)

/** One multimodal input part of a segment request. */
export type SegmentInput =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly url: string; readonly role: 'first_frame' | 'last_frame' | 'reference_image' }
  | { readonly type: 'video'; readonly url: string; readonly role: 'reference_video' }
  | { readonly type: 'audio'; readonly url: string; readonly role: 'reference_audio' }

/** Request for one generated video segment, mirroring the MiniMax H3 V2 creation body. */
export interface SegmentRequest {
  /** Multimodal content; must contain exactly one non-empty text item (the prompt). */
  readonly inputs: readonly SegmentInput[]
  /** Output resolution tier. */
  readonly resolution: '480P' | '768P' | '2K'
  /** Segment length in whole seconds. */
  readonly durationSeconds: number
  /** Aspect ratio; `adaptive` is valid only when image inputs determine the ratio. */
  readonly ratio: 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
}

/** Live polling state of one submitted task. */
export type TaskStatus =
  | { readonly state: 'queued' }
  | { readonly state: 'running' }
  | { readonly state: 'succeeded'; readonly localFile: string; readonly remoteUrl?: string }
  | { readonly state: 'failed'; readonly reason: string }

/** What one backend can produce; consumers validate requests against it before submitting. */
export interface ProviderCapabilities {
  /** Backend identity used in routing decisions and diagnostics. */
  readonly name: string
  /** Resolution tiers this backend serves. */
  readonly resolutions: readonly SegmentRequest['resolution'][]
  /** Inclusive second range per segment. */
  readonly minDurationSeconds: number
  /** Inclusive upper bound on segment length this backend accepts. */
  readonly maxDurationSeconds: number
  /** Whether image/video/audio inputs are supported beyond plain text prompts. */
  readonly multimodalInputs: boolean
  /** Concurrent generations this backend serves before submissions queue locally. */
  readonly maxConcurrency: number
}

/**
 * One H3 generation backend. Implementations own their transport (local ComfyUI queue or the hosted
 * MiniMax API), submit-to-file download, and cancellation; they do not own retry policy or routing.
 */
export interface H3VideoProvider {
  /** Static description used by {@link resolve} and request validation. */
  readonly capabilities: ProviderCapabilities
  /**
   * Submit one segment generation. Returns after the backend accepts the task; the produced file
   * appears only through {@link poll}.
   * @param request - validated segment request.
   * @param signal - caller cancellation of the submission itself.
   * @returns the backend task reference.
   */
  submit(request: SegmentRequest, signal: AbortSignal): Promise<H3TaskRef>
  /**
   * Observe one task once. A succeeded status carries the downloaded local file.
   * @param ref - reference returned by {@link submit}.
   * @param signal - caller cancellation of this observation.
   */
  poll(ref: H3TaskRef, signal: AbortSignal): Promise<TaskStatus>
  /**
   * Best-effort cancellation of a live task. Settled tasks ignore it.
   * @param ref - reference returned by {@link submit}.
   */
  cancel(ref: H3TaskRef): Promise<void>
}
