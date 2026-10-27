/**
 * Types of the video-plan session domain: one plan document and its segment lifecycle. Plans are
 * durable JSON artifacts under the h3-video output directory (not session events), because a new
 * session-log event type would pull in the persistence catalog and format-version machinery. The
 * plan content also appears verbatim in the `video/plan` tool result, so replay reconstructs what
 * the model saw.
 * @module @deepseek-ai/dsh-tool-video/types
 */

import type { BackendChoice } from '@deepseek-ai/dsh-h3-video'

/** One reference material attached to a segment (an image, video, or audio file or URL). */
export interface SegmentReference {
  readonly type: 'image' | 'video' | 'audio'
  /** Local absolute path or `http(s)` URL of the material. */
  readonly source: string
  /**
   * How the material conditions generation: `first_frame`/`last_frame` for image-to-video,
   * `reference_image`/`reference_video`/`reference_audio` for reference-conditioned generation.
   */
  readonly role: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'
}

/** One reusable asset (character / scene / prop) that anchors visual consistency across shots. */
export interface PlanAsset {
  /** Stable asset id chosen by the planner, e.g. `char-1`, `scene-1`, `prop-1`. */
  readonly id: string
  /** Exact name the storyboard uses to reference this asset. */
  readonly name: string
  readonly kind: 'character' | 'scene' | 'prop'
  /**
   * Visual description the planner writes for this asset: the character's appearance/styling, the
   * scene's location/set/props layout, or the prop's look.
   */
  readonly description?: string
  /**
   * Canonical generation block for this asset, copied verbatim into every prompt that conditions
   * on it (full-body reference, keyframes, clips). Keeping one fixed block is what stops
   * separately rendered shots from drifting in wording; `description` is the short human-facing
   * summary used when no block is written.
   */
  readonly prompt?: string
  /** User-provided or generated image path or URL; generated character references show one full body. */
  readonly reference?: string
  /**
   * Legacy character master sheet retained only so old plan and library records can still be read.
   * New `video_asset_images` runs generate one full-body `reference` image and do not write this
   * field.
   */
  readonly sheet?: string
}

/** One storyboard shot inside a plan. */
export interface VideoSegment {
  /** Stable segment id chosen by the planner, e.g. `s1`, `s2`. */
  readonly id: string
  /** Model-facing shot description (the generation prompt). */
  readonly prompt: string
  /** Camera movement note folded into the prompt guidance. */
  readonly camera?: string
  /** How this shot relates to the preceding shot in the story timeline. */
  readonly continuity?: 'continue' | 'cut' | 'time_jump' | 'flashback'
  /** State that must be true when this shot starts. */
  readonly startState?: string
  /** The single story event this shot advances. */
  readonly event?: string
  /** State that the next shot may inherit after this shot ends. */
  readonly endState?: string
  /** Explicit asset ids used by this shot; an empty list declares an asset-free shot. */
  readonly assetIds?: readonly string[]
  /** Seconds for this segment. */
  readonly durationSeconds: number
  /** Resolution tier. */
  readonly resolution: '480P' | '768P' | '2K'
  /** Aspect ratio. */
  readonly ratio: 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  /** Routing policy per segment. */
  readonly backend: BackendChoice
  /** Reference materials (images/videos/audio) that condition this segment. */
  readonly references?: readonly SegmentReference[]
}

/** A versioned storyboard plan. */
export interface VideoPlan {
  /** Plan id (`vp-<n>`), allocated per session. */
  readonly id: string
  /** Monotonic revision within the session, starting at 1. */
  readonly revision: number
  /** Goal line the plan serves. */
  readonly goal: string
  /**
   * How the storyboard renders: `multi_shot` (default) folds every segment into ONE H3 task whose
   * prompt carries the shot states and timeline, conditioned on one opening frame, and returns a
   * single clip; `per_segment` renders each segment as an independent task and concats them.
   */
  readonly mode: 'multi_shot' | 'per_segment'
  /** Reusable asset anchors (characters/scenes/props) confirmed with the user before rendering. */
  readonly assets?: readonly PlanAsset[]
  /** One-line visual style directive injected into generation prompts. */
  readonly style?: string
  /**
   * Sampling seed shared by providers that support reproducibility; it does not preserve identity
   * or story continuity. Derived from the plan identity when the planner
   * supplies none; the hosted H3 API takes no seed and ignores it.
   */
  readonly seed?: number
  /** Ordered segments; assembly follows this order. */
  readonly segments: readonly VideoSegment[]
  /** Epoch ms when the plan event was appended. */
  readonly createdAt: number
}

/** One segment submission record returned by the render tool. */
export interface RenderSubmission {
  readonly segmentId: string
  /** Policy the caller asked for: `local`, `remote`, or `auto`. */
  readonly backend: string
  /**
   * Backend routing actually reached, present only on a successful submission. `auto` hides the
   * decision until this point, and only this field says whether the run billed the hosted API.
   */
  readonly resolved?: 'local' | 'remote'
  /** Backend task reference, present only on a successful submission. */
  readonly taskRef?: string
  /** Background job id that polls the task, present only on a successful submission. */
  readonly jobId?: string
  readonly state: 'submitted' | 'failed'
  /** Present only when submission failed before a job started. */
  readonly error?: string
}

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'h3-video': 'h3-video'
  }
}
