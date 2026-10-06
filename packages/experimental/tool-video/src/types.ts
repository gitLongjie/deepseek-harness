/**
 * Types of the video-plan session domain: one plan document and its segment lifecycle. Plans are
 * durable JSON artifacts under the h3-video output directory (not session events), because a new
 * session-log event type would pull in the persistence catalog and format-version machinery. The
 * plan content also appears verbatim in the `video/plan` tool result, so replay reconstructs what
 * the model saw.
 * @module @deepseek-ai/dsh-experimental-tool-video/types
 */

import type { BackendChoice } from '@deepseek-ai/dsh-experimental-h3-video'

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
   * scene's location/set/props layout, or the prop's look. Wrapped by the generation spec template
   * when `video_asset_images` generates the anchor image.
   */
  readonly description?: string
  /** User-provided or generated reference image path or URL anchoring this asset. */
  readonly reference?: string
}

/** One storyboard shot inside a plan. */
export interface VideoSegment {
  /** Stable segment id chosen by the planner, e.g. `s1`, `s2`. */
  readonly id: string
  /** Model-facing shot description (the generation prompt). */
  readonly prompt: string
  /** Camera movement note folded into the prompt guidance. */
  readonly camera?: string
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
   * prompt carries the shot timeline, so style/subject/lighting stay coherent and the result is a
   * single clip; `per_segment` renders each segment as an independent task and concats them.
   */
  readonly mode: 'multi_shot' | 'per_segment'
  /** Reusable asset anchors (characters/scenes/props) confirmed with the user before rendering. */
  readonly assets?: readonly PlanAsset[]
  /** One-line visual style directive injected into generation prompts. */
  readonly style?: string
  /** Ordered segments; assembly follows this order. */
  readonly segments: readonly VideoSegment[]
  /** Epoch ms when the plan event was appended. */
  readonly createdAt: number
}

/** One segment submission record returned by the render tool. */
export interface RenderSubmission {
  readonly segmentId: string
  readonly backend: string
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
