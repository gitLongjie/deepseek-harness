/**
 * Model-facing H3 video tools over `ctx.h3Video`: `video_plan` structures and persists a
 * storyboard, `video_render` submits segments to the chosen backend and backgrounds the
 * generation polls as jobs, and `video_assemble` concats finished segments with ffmpeg. Plans are
 * JSON artifacts under the h3-video output directory; the plan content also appears verbatim in
 * each tool result so replay reconstructs what the model saw.
 * @module @deepseek-ai/dsh-experimental-tool-video
 */

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  H3TaskRef,
  RoutedProvider,
  SegmentInput,
  SegmentRequest,
} from '@deepseek-ai/dsh-experimental-h3-video'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: resolves the required ctx.commands service declaration.
import type {} from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { RenderSubmission, PlanAsset, SegmentReference, VideoPlan, VideoSegment } from './types.ts'

export type * from './types.ts'

export const name = 'tool-video'
export const inject = ['tools', 'jobs', 'h3Video', 'commands'] as const

/** No deployment-variant tunables yet; per-call arguments own behavior. */
export interface Config {}

export const Config: z<Config> = z.object({})

/** Bounds applied to the complete plan document. */
const MAX_SEGMENTS = 64
const MAX_PROMPT_CHARS = 7000

/** Output shape mirroring {@link VideoPlan} plus its artifact path. */
const ASSET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['character', 'scene', 'prop'] },
    description: { type: 'string' },
    reference: { type: 'string' },
  },
} as const

const REFERENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', required: true, enum: ['image', 'video', 'audio'] },
    source: { type: 'string', required: true },
    role: {
      type: 'string',
      required: true,
      enum: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'],
    },
  },
} as const

const PLAN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    goal: { type: 'string', required: true },
    mode: { type: 'string', required: true, enum: ['multi_shot', 'per_segment'] },
    assets: { type: 'array', items: ASSET_SCHEMA },
    style: { type: 'string' },
    createdAt: { type: 'integer', required: true },
    segments: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
          camera: { type: 'string' },
          durationSeconds: { type: 'integer', required: true },
          resolution: { type: 'string', required: true, enum: ['480P', '768P', '2K'] },
          ratio: { type: 'string', required: true, enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
          backend: { type: 'string', required: true, enum: ['local', 'remote', 'auto'] },
          references: { type: 'array', items: REFERENCE_SCHEMA },
        },
      },
    },
    planFile: { type: 'string', required: true },
  },
} as const

const SUBMISSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    segmentId: { type: 'string', required: true },
    backend: { type: 'string', required: true },
    taskRef: { type: 'string' },
    jobId: { type: 'string' },
    state: { type: 'string', required: true, enum: ['submitted', 'failed'] },
    error: { type: 'string' },
  },
} as const

const RENDER_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planId: { type: 'string', required: true },
    submissions: { type: 'array', required: true, items: SUBMISSION_SCHEMA },
    notice: { type: 'string', required: true },
  },
} as const

const ASSEMBLE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planId: { type: 'string', required: true },
    outputFile: { type: 'string', required: true },
    segments: { type: 'array', required: true, items: { type: 'string' } },
    durationSeconds: { type: 'integer', required: true },
  },
} as const

const KEYFRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    segmentId: { type: 'string', required: true },
    keyframe: { type: 'string' },
    state: { type: 'string', required: true, enum: ['generated', 'failed'] },
    error: { type: 'string' },
  },
} as const

const KEYFRAME_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planId: { type: 'string', required: true },
    keyframes: { type: 'array', required: true, items: KEYFRAME_SCHEMA },
    notice: { type: 'string', required: true },
  },
} as const

const ASSET_IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assetId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    image: { type: 'string' },
    state: { type: 'string', required: true, enum: ['generated', 'skipped', 'failed'] },
    error: { type: 'string' },
  },
} as const

const ASSET_IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planId: { type: 'string', required: true },
    assets: { type: 'array', required: true, items: ASSET_IMAGE_SCHEMA },
    notice: { type: 'string', required: true },
  },
} as const

/** One canonical JSON output with a compact model-facing render. */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- video tools are Agent-scoped by the executor's discovery contract. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

function presentCall(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput !== undefined ? { rawInput } : {} }
}

/** Expand a relative plan artifact path against the output directory. */
function artifactPath(outputDir: string, ...parts: string[]): string {
  return join(outputDir, ...parts)
}

function plansDir(outputDir: string): string {
  return artifactPath(outputDir, 'plans')
}

function segmentsDir(outputDir: string): string {
  return artifactPath(outputDir, 'segments')
}

function canonicalSegmentFile(outputDir: string, planId: string, segmentId: string): string {
  return artifactPath(segmentsDir(outputDir), `${planId}-${segmentId}.mp4`)
}

function keyframesDir(outputDir: string): string {
  return artifactPath(outputDir, 'keyframes')
}

function canonicalKeyframeFile(outputDir: string, planId: string, segmentId: string): string {
  return artifactPath(keyframesDir(outputDir), `${planId}-${segmentId}.png`)
}

function assetsDir(outputDir: string): string {
  return artifactPath(outputDir, 'assets')
}

function canonicalAssetFile(outputDir: string, planId: string, assetId: string): string {
  return artifactPath(assetsDir(outputDir), `${planId}-${assetId}.png`)
}

/**
 * Wrap an asset's description in the generation-spec template for its kind, matching the reference
 * drama-production specs: characters get a turnaround reference sheet, scenes get a reusable
 * establishing shot without people, props get a neutral reference image.
 * @param asset - the plan asset whose description is wrapped.
 * @returns the image-01 prompt.
 */
function buildAssetPrompt(asset: PlanAsset): string {
  const description = (asset.description?.trim() || asset.name).trim()
  if (asset.kind === 'character') {
    return `角色设定参考图，左侧为正脸特写，右侧并列展示正面、90 度侧面、背面三张等高全身视图，特写与全身视图都是同一角色，全身入镜，中性 A 字站姿，三张全身视图等高并排、头顶脚底对齐，${description}，正脸特写与三个视图的脸、发型和服装完全一致，纯白背景，柔和均匀的光线，电影质感`
  }
  if (asset.kind === 'scene') {
    return `固定机位广角镜头，清晰的建立镜头，${description}，画面中没有任何人物，空场景，电影质感`
  }
  return `道具参考图，${description}，纯白背景，柔和均匀的光线，电影质感`
}

/** Map a segment ratio to the image-01 aspect ratio (falls back to 16:9 for adaptive). */
function keyframeRatio(ratio: VideoSegment['ratio']): '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' {
  if (ratio === 'adaptive') return '16:9'
  return ratio
}

/**
 * Attach a generated keyframe as the video request's first frame (image-to-video) when one exists;
 * otherwise the request stays text-to-video.
 * @param request - the base segment request.
 * @param keyframePath - canonical keyframe path for this segment.
 * @returns the request with the keyframe input appended when the file exists.
 */
async function withKeyframe(request: SegmentRequest, keyframePath: string): Promise<SegmentRequest> {
  try {
    await readFile(keyframePath)
  } catch {
    return request
  }
  // Frame-image requests determine their ratio from the image (H3 content rule), so force adaptive.
  return {
    ...request,
    ratio: 'adaptive',
    inputs: [...request.inputs, { type: 'image', url: keyframePath, role: 'first_frame' }],
  }
}

/**
 * Anchor a shot on the plan's reusable asset references (character/scene/prop images the user
 * provided) as reference-image conditioning — unless the shot already has a first/last frame, which
 * would conflict with reference conditioning on the backend.
 * @param request - the segment request (possibly keyframe-anchored).
 * @param plan - the plan carrying the asset anchors.
 * @returns the request with asset reference-image inputs appended when applicable.
 */
function withAssetReferences(request: SegmentRequest, plan: VideoPlan): SegmentRequest {
  const references = (plan.assets ?? [])
    .filter(asset => asset.reference !== undefined)
    .map(asset => asset.reference as string)
  if (references.length === 0) return request
  const frameAnchored = request.inputs.some(input =>
    input.type === 'image' && (input.role === 'first_frame' || input.role === 'last_frame'))
  if (frameAnchored) return request
  return {
    ...request,
    inputs: [...request.inputs, ...references.map(url => ({ type: 'image' as const, url, role: 'reference_image' as const }))],
  }
}

/** Validate a reference's type/role pairing and its source. */
function validateReference(segmentId: string, reference: SegmentReference): void {
  const source = reference.source.trim()
  if (source.length === 0) {
    throw new Error(`segment ${segmentId}: reference source must be a non-empty path or URL`)
  }
  const isHttp = /^https?:\/\//iu.test(source)
  const isPath = /^([a-zA-Z]:[\\/]|\/)/u.test(source)
  if (!isHttp && !isPath) {
    throw new Error(`segment ${segmentId}: reference source must be an absolute path or http(s) URL`)
  }
  const imageRoles = new Set(['first_frame', 'last_frame', 'reference_image'])
  const videoRoles = new Set(['reference_video'])
  const audioRoles = new Set(['reference_audio'])
  const role = reference.role
  if (reference.type === 'image' && !imageRoles.has(role)) {
    throw new Error(`segment ${segmentId}: image reference role must be one of first_frame/last_frame/reference_image`)
  }
  if (reference.type === 'video' && !videoRoles.has(role)) {
    throw new Error(`segment ${segmentId}: video reference role must be reference_video`)
  }
  if (reference.type === 'audio' && !audioRoles.has(role)) {
    throw new Error(`segment ${segmentId}: audio reference role must be reference_audio`)
  }
}

/** Validate segment structure beyond the ParameterSchemaSpec (uniqueness, bounds, references). */
function validateSegments(segments: readonly VideoSegment[]): void {
  if (segments.length === 0) throw new Error('a plan needs at least one segment')
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`a plan may have at most ${MAX_SEGMENTS} segments`)
  }
  const seen = new Set<string>()
  for (const segment of segments) {
    if (seen.has(segment.id)) throw new Error(`duplicate segment id ${JSON.stringify(segment.id)}`)
    seen.add(segment.id)
    const prompt = segment.prompt.trim()
    if (prompt.length === 0) throw new Error(`segment ${segment.id}: prompt must be non-empty`)
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`segment ${segment.id}: prompt exceeds ${MAX_PROMPT_CHARS} characters`)
    }
    if (!Number.isSafeInteger(segment.durationSeconds) || segment.durationSeconds < 1 || segment.durationSeconds > 120) {
      throw new Error(`segment ${segment.id}: duration_seconds must be an integer from 1 through 120`)
    }
    for (const reference of segment.references ?? []) validateReference(segment.id, reference)
  }
}

/** Convert a plan segment into a provider request, folding camera guidance and references. */
function toSegmentRequest(segment: VideoSegment): SegmentRequest {
  const text = segment.camera !== undefined && segment.camera.length > 0
    ? `${segment.prompt} [Camera: ${segment.camera}]`
    : segment.prompt
  const inputs: SegmentInput[] = [{ type: 'text', text }]
  for (const reference of segment.references ?? []) {
    if (reference.type === 'image') {
      inputs.push({ type: 'image', url: reference.source, role: reference.role as 'first_frame' | 'last_frame' | 'reference_image' })
    } else if (reference.type === 'video') {
      inputs.push({ type: 'video', url: reference.source, role: 'reference_video' })
    } else {
      inputs.push({ type: 'audio', url: reference.source, role: 'reference_audio' })
    }
  }
  return {
    inputs,
    resolution: segment.resolution,
    durationSeconds: segment.durationSeconds,
    ratio: segment.ratio,
  }
}

/** H3 single-task duration ceiling for a multi-shot clip (the trained 17k+5 frame range). */
const MAX_MULTI_SHOT_SECONDS = 15

/**
 * Build one H3 prompt that carries the whole storyboard as a shot timeline, the way the official H3
 * multi-shot workflow does: a scene overview, per-shot timecoded entries, and camera guidance.
 * @param goal - the plan goal line, used as the scene overview.
 * @param segments - ordered storyboard shots.
 * @returns the combined multi-shot prompt.
 */
function buildMultiShotPrompt(goal: string, segments: readonly VideoSegment[]): string {
  const parts: string[] = []
  parts.push(`Scene overview: ${goal}`)
  parts.push('')
  parts.push('Storyboard (each shot a separate scene, clean cuts):')
  let cursor = 0
  segments.forEach((segment, index) => {
    const start = cursor
    const end = cursor + segment.durationSeconds
    const camera = segment.camera !== undefined && segment.camera.length > 0 ? ` Camera: ${segment.camera}.` : ''
    parts.push(`[${start}s-${end}s] Shot ${index + 1}: ${segment.prompt}${camera}`)
    cursor = end
  })
  parts.push('')
  parts.push('Camera: per-shot angles, clean hard cuts, no dissolves.')
  parts.push('No text, subtitles, logos or watermarks of any kind unless the user requests them.')
  return parts.join('\n')
}

/**
 * Validate a multi-shot plan: the combined duration must fit the H3 single-task ceiling, and every
 * segment must share the resolution and ratio (one task has one canvas).
 * @param plan - the plan being validated.
 * @throws Error - naming the violated constraint and the per-segment alternative.
 */
function validateMultiShotPlan(plan: Pick<VideoPlan, 'mode' | 'segments'>): void {
  if (plan.mode !== 'multi_shot') return
  const total = plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
  if (total > MAX_MULTI_SHOT_SECONDS) {
    throw new Error(
      `multi_shot plan is ${total}s, exceeding the ${MAX_MULTI_SHOT_SECONDS}s single-task ceiling; use mode 'per_segment' for longer films`,
    )
  }
  const resolution = plan.segments[0]?.resolution
  const ratio = plan.segments[0]?.ratio
  for (const segment of plan.segments) {
    if (segment.resolution !== resolution || segment.ratio !== ratio) {
      throw new Error('multi_shot segments must share one resolution and ratio (one task has one canvas); use mode per_segment for mixed specs')
    }
  }
}

async function readPlan(outputDir: string, planId: string): Promise<VideoPlan> {
  const file = artifactPath(plansDir(outputDir), `${planId}.json`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw new Error(`plan ${planId} not found (expected ${file})`)
  }
  const parsed = JSON.parse(raw) as Partial<VideoPlan>
  if (typeof parsed.id !== 'string' || parsed.id !== planId || !Array.isArray(parsed.segments)) {
    throw new Error(`plan file ${file} is corrupt`)
  }
  return { ...parsed, mode: parsed.mode ?? 'multi_shot' } as VideoPlan
}

async function writePlan(outputDir: string, plan: VideoPlan): Promise<string> {
  const dir = plansDir(outputDir)
  await mkdir(dir, { recursive: true })
  const file = artifactPath(dir, `${plan.id}.json`)
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return file
}

/** Allocate the next per-session plan id; a replacement agent in the same session continues the series. */
function allocatePlanId(counters: Map<string, number>, sessionId: SessionId): string {
  const next = (counters.get(String(sessionId)) ?? 0) + 1
  counters.set(String(sessionId), next)
  return `vp-${next}`
}

/**
 * Poll one submitted segment to its terminal state and settle the job. The provider's `poll`
 * already loops to completion or timeout; this wrapper turns the outcome into job output.
 * @returns the producer hooks for one background render job.
 */
function renderJobHooks(
  ctx: Context,
  planId: string,
  segment: VideoSegment,
  target: RoutedProvider,
  ref: H3TaskRef,
): { cancel(reason?: string): void; done: Promise<JobOutcome>; readOutput(): string } {
  const controller = new AbortController()
  const chunks: string[] = []
  const done = (async (): Promise<JobOutcome> => {
    try {
      const status = await ctx.h3Video.poll(target, ref, controller.signal)
      if (status.state === 'succeeded') {
        const canonical = canonicalSegmentFile(ctx.h3Video.outputDir, planId, segment.id)
        await mkdir(dirname(canonical), { recursive: true })
        try {
          await rename(status.localFile, canonical)
        } catch {
          await copyFile(status.localFile, canonical)
        }
        chunks.push(`[succeeded] ${segment.id} -> ${canonical}`)
        return { status: 'completed', detail: segment.id, output: chunks.join('\n') }
      }
      if (status.state === 'failed') {
        chunks.push(`[failed] ${segment.id}: ${status.reason}`)
        return { status: 'failed', detail: status.reason, output: chunks.join('\n') }
      }
      chunks.push(`[failed] ${segment.id}: poll returned non-terminal state ${status.state}`)
      return { status: 'failed', detail: `unexpected poll state ${status.state}`, output: chunks.join('\n') }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        chunks.push(`[killed] ${segment.id}`)
        return { status: 'killed', detail: 'cancelled', output: chunks.join('\n') }
      }
      const message = error instanceof Error ? error.message : String(error)
      chunks.push(`[failed] ${segment.id}: ${message}`)
      return { status: 'failed', detail: message, output: chunks.join('\n') }
    }
  })()
  return {
    cancel: (_reason?: string) => {
      controller.abort()
      void ctx.h3Video.cancel(target, ref)
    },
    done,
    readOutput: () => {
      const output = chunks.join('\n')
      chunks.length = 0
      return output
    },
  }
}

/** Register the three model-facing video tools. */
export function apply(ctx: Context): void {
  const planCounters = new Map<string, number>()
  ctx.jobs.attachController('tool-video')

  ctx.tools.register(defineTool({
    name: 'video_plan',
    description: 'Structure the current conversation request into a versioned storyboard plan and persist it. The agent writes the shots; this tool validates and stores them. Pass an existing plan_id to revise it.',
    parameters: {
      goal: { type: 'string', required: true, description: 'One-line goal the plan serves.' },
      plan_id: { type: 'string', description: 'Existing plan id to revise; omit to create a new plan.' },
      mode: {
        type: 'string',
        enum: ['multi_shot', 'per_segment'],
        description: 'multi_shot (default) folds all segments into one coherent H3 task (≤15s, uniform resolution/ratio); per_segment renders each shot independently then concats. Use per_segment when a shot needs its own material or backend.',
      },
      assets: {
        type: 'array',
        description: 'Reusable asset anchors (characters/scenes/props) confirmed with the user; each may carry a user-provided reference image path or URL. The storyboard must reference these names exactly.',
        items: ASSET_SCHEMA,
      },
      style: { type: 'string', description: 'One-line visual style directive injected into generation prompts.' },
      segments: {
        type: 'array',
        required: true,
        description: 'Ordered storyboard shots; assembly follows this order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Stable segment id, e.g. s1, s2.' },
            prompt: { type: 'string', required: true, description: 'Shot description used as the generation prompt.' },
            camera: { type: 'string', description: 'Camera movement guidance appended to the prompt.' },
            duration_seconds: { type: 'integer', required: true, description: 'Segment length in seconds (1..120).' },
            resolution: { type: 'string', required: true, enum: ['480P', '768P', '2K'], description: 'Resolution tier.' },
            ratio: { type: 'string', required: true, enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], description: 'Aspect ratio.' },
            backend: { type: 'string', required: true, enum: ['local', 'remote', 'auto'], description: 'Routing policy for this segment.' },
            references: {
              type: 'array',
              description: 'Optional reference materials conditioning this segment (served by the remote API; local ComfyUI is text-only).',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string', required: true, enum: ['image', 'video', 'audio'], description: 'Material kind.' },
                  source: { type: 'string', required: true, description: 'Absolute path or http(s) URL of the material.' },
                  role: {
                    type: 'string',
                    required: true,
                    enum: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'],
                    description: 'How the material conditions generation (image: first_frame/last_frame/reference_image; video: reference_video; audio: reference_audio).',
                  },
                },
              },
            },
          },
        },
      },
    },
    output: jsonOutput(PLAN_VALUE_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'video_plan')
      const mode = args.mode ?? 'multi_shot'
      const segments: VideoSegment[] = args.segments.map(segment => ({
        id: segment.id,
        prompt: segment.prompt,
        ...segment.camera !== undefined ? { camera: segment.camera } : {},
        durationSeconds: segment.duration_seconds,
        resolution: segment.resolution,
        ratio: segment.ratio,
        backend: segment.backend,
        ...segment.references !== undefined
          ? { references: segment.references.map(reference => ({
            type: reference.type,
            source: reference.source,
            role: reference.role,
          })) }
          : {},
      }))
      validateSegments(segments)
      validateMultiShotPlan({ mode, segments })
      const assets: PlanAsset[] = (args.assets ?? []).map(asset => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...asset.description !== undefined ? { description: asset.description } : {},
        ...asset.reference !== undefined ? { reference: asset.reference } : {},
      }))
      const outputDir = ctx.h3Video.outputDir
      let plan: VideoPlan
      if (args.plan_id !== undefined) {
        const prior = await readPlan(outputDir, args.plan_id)
        plan = {
          id: prior.id,
          revision: prior.revision + 1,
          goal: args.goal,
          mode,
          ...assets.length > 0 ? { assets } : {},
          ...args.style !== undefined ? { style: args.style } : {},
          segments,
          createdAt: prior.createdAt,
        }
      } else {
        plan = {
          id: allocatePlanId(planCounters, agent.session.id),
          revision: 1,
          goal: args.goal,
          mode,
          ...assets.length > 0 ? { assets } : {},
          ...args.style !== undefined ? { style: args.style } : {},
          segments,
          createdAt: Date.now(),
        }
      }
      const planFile = await writePlan(outputDir, plan)
      return {
        id: plan.id,
        revision: plan.revision,
        goal: plan.goal,
        mode: plan.mode,
        ...plan.assets !== undefined ? { assets: plan.assets.map(asset => ({ ...asset })) } : {},
        ...plan.style !== undefined ? { style: plan.style } : {},
        createdAt: plan.createdAt,
        segments: plan.segments.map(segment => ({
          id: segment.id,
          prompt: segment.prompt,
          ...segment.camera !== undefined ? { camera: segment.camera } : {},
          durationSeconds: segment.durationSeconds,
          resolution: segment.resolution,
          ratio: segment.ratio,
          backend: segment.backend,
          ...segment.references !== undefined
            ? { references: segment.references.map(reference => ({
              type: reference.type,
              source: reference.source,
              role: reference.role,
            })) }
            : {},
        })),
        planFile,
      }
    },
    presentCall: args => presentCall(args.plan_id !== undefined ? 'Revise storyboard plan' : 'Create storyboard plan', args.goal),
  }))

  ctx.tools.register(defineTool({
    name: 'video_keyframes',
    description: 'Generate one still keyframe per selected segment (remote image model), establishing the scene and visual identity BEFORE video generation. Save keyframes to outputDir/keyframes and return their paths; present them to the user for confirmation, then render.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      segment_ids: { type: 'array', items: { type: 'string' }, description: 'Segment ids to keyframe; defaults to every segment.' },
    },
    output: jsonOutput(KEYFRAME_VALUE_SCHEMA),
    async execute(args, exec) {
      const outputDir = ctx.h3Video.outputDir
      const plan = await readPlan(outputDir, args.plan_id)
      const selected = args.segment_ids === undefined
        ? plan.segments
        : args.segment_ids.map((id) => {
          const segment = plan.segments.find(candidate => candidate.id === id)
          if (segment === undefined) throw new Error(`plan ${plan.id} has no segment ${JSON.stringify(id)}`)
          return segment
        })
      const keyframes: Array<{ segmentId: string; keyframe?: string; state: 'generated' | 'failed'; error?: string }> = []
      for (const segment of selected) {
        const prompt = segment.camera !== undefined && segment.camera.length > 0
          ? `${segment.prompt} [Camera: ${segment.camera}]`
          : segment.prompt
        try {
          const generated = await ctx.h3Video.keyframe(prompt, keyframeRatio(segment.ratio), exec.signal)
          const target = canonicalKeyframeFile(outputDir, plan.id, segment.id)
          await mkdir(dirname(target), { recursive: true })
          await rename(generated, target)
          keyframes.push({ segmentId: segment.id, keyframe: target, state: 'generated' })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          keyframes.push({ segmentId: segment.id, state: 'failed', error: message })
        }
      }
      const succeeded = keyframes.filter(keyframe => keyframe.state === 'generated').length
      const failed = keyframes.length - succeeded
      const notice = failed === 0
        ? `generated ${succeeded} keyframe(s) for plan ${plan.id}`
        : `generated ${succeeded} keyframe(s), ${failed} failed for plan ${plan.id}`
      return { planId: plan.id, keyframes, notice }
    },
    presentCall: args => presentCall('Generate keyframes', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_assets',
    description: 'Record the reusable asset anchors (characters/scenes/props) and their user-provided reference images on an existing plan, after asking the user for materials. Each asset reference must be an absolute local path or http(s) URL of an image the user supplied.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      assets: {
        type: 'array',
        description: 'Asset anchors with user-provided reference images; names must match the storyboard references exactly.',
        items: ASSET_SCHEMA,
      },
      style: { type: 'string', description: 'One-line visual style directive injected into generation prompts.' },
    },
    output: jsonOutput(PLAN_VALUE_SCHEMA),
    async execute(args) {
      const outputDir = ctx.h3Video.outputDir
      const prior = await readPlan(outputDir, args.plan_id)
      const assets: PlanAsset[] = (args.assets ?? []).map(asset => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...asset.description !== undefined ? { description: asset.description } : {},
        ...asset.reference !== undefined ? { reference: asset.reference } : {},
      }))
      for (const asset of assets) {
        if (asset.reference !== undefined) {
          const reference = asset.reference.trim()
          const isHttp = /^https?:\/\//iu.test(reference)
          const isPath = /^([a-zA-Z]:[\\/]|\/)/u.test(reference)
          if (!isHttp && !isPath) {
            throw new Error(`asset ${asset.id}: reference must be an absolute path or http(s) URL`)
          }
        }
      }
      const plan: VideoPlan = {
        ...prior,
        ...assets.length > 0 ? { assets } : {},
        ...args.style !== undefined ? { style: args.style } : {},
      }
      const planFile = await writePlan(outputDir, plan)
      return {
        id: plan.id,
        revision: plan.revision,
        goal: plan.goal,
        mode: plan.mode,
        ...plan.assets !== undefined ? { assets: plan.assets.map(asset => ({ ...asset })) } : {},
        ...plan.style !== undefined ? { style: plan.style } : {},
        createdAt: plan.createdAt,
        segments: plan.segments.map(segment => ({
          id: segment.id,
          prompt: segment.prompt,
          ...segment.camera !== undefined ? { camera: segment.camera } : {},
          durationSeconds: segment.durationSeconds,
          resolution: segment.resolution,
          ratio: segment.ratio,
          backend: segment.backend,
          ...segment.references !== undefined
            ? { references: segment.references.map(reference => ({
              type: reference.type,
              source: reference.source,
              role: reference.role,
            })) }
            : {},
        })),
        planFile,
      }
    },
    presentCall: args => presentCall('Record video assets', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_asset_images',
    description: 'Generate the reference image for plan assets that have none, via the hosted image model, using the production spec for each kind: characters get a turnaround reference sheet (front close-up + front/side/back full views), scenes get a reusable establishing shot without people, props get a neutral reference image. Saves each to outputDir/assets and records it on the plan, so rendering anchors on a generated visual instead of text alone. Present the images to the user for confirmation.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      asset_ids: { type: 'array', items: { type: 'string' }, description: 'Asset ids to generate; defaults to every asset without a reference.' },
    },
    output: jsonOutput(ASSET_IMAGE_VALUE_SCHEMA),
    async execute(args, exec) {
      const outputDir = ctx.h3Video.outputDir
      const prior = await readPlan(outputDir, args.plan_id)
      const allAssets = prior.assets ?? []
      const assetIds = args.asset_ids
      const selected = (assetIds === undefined ? allAssets : allAssets.filter(asset => assetIds.includes(asset.id)))
        .filter(asset => asset.reference === undefined)
      const results: Array<{ assetId: string; name: string; kind: string; image?: string; state: 'generated' | 'skipped' | 'failed'; error?: string }> = []
      const assets: PlanAsset[] = [...(prior.assets ?? [])]
      for (const asset of selected) {
        try {
          const ratio = asset.kind === 'character' || asset.kind === 'prop' ? '1:1' : '16:9'
          const generated = await ctx.h3Video.keyframe(buildAssetPrompt(asset), ratio, exec.signal)
          const target = canonicalAssetFile(outputDir, prior.id, asset.id)
          await mkdir(dirname(target), { recursive: true })
          await rename(generated, target)
          const index = assets.findIndex(candidate => candidate.id === asset.id)
          const current = index !== -1 ? assets[index] : undefined
          if (current !== undefined) {
            assets[index] = {
              id: current.id,
              name: current.name,
              kind: current.kind,
              ...current.description !== undefined ? { description: current.description } : {},
              reference: target,
            }
          }
          results.push({ assetId: asset.id, name: asset.name, kind: asset.kind, image: target, state: 'generated' })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ assetId: asset.id, name: asset.name, kind: asset.kind, state: 'failed', error: message })
        }
      }
      const skipped = (prior.assets ?? []).filter(asset => asset.reference !== undefined)
      if (skipped.length > 0) {
        results.push(...skipped.map(asset => ({ assetId: asset.id, name: asset.name, kind: asset.kind, state: 'skipped' as const })))
      }
      if (assets.length > 0) {
        const plan: VideoPlan = { ...prior, assets }
        await writePlan(outputDir, plan)
      }
      const generatedCount = results.filter(result => result.state === 'generated').length
      const failedCount = results.filter(result => result.state === 'failed').length
      const notice = `generated ${generatedCount} asset image(s) for plan ${prior.id}${failedCount > 0 ? `, ${failedCount} failed` : ''}`
      return { planId: prior.id, assets: results, notice }
    },
    presentCall: args => presentCall('Generate asset images', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_render',
    description: 'Submit one plan\'s segments (or a subset) to the chosen H3 backend and start one background job per segment that polls generation to completion. Returns submission records with job ids; collect results with job_output.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      segment_ids: { type: 'array', items: { type: 'string' }, description: 'Segment ids to render; defaults to every segment.' },
      backend: { type: 'string', enum: ['local', 'remote', 'auto'], description: 'Backend override for all selected segments.' },
    },
    output: jsonOutput(RENDER_VALUE_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'video_render')
      const outputDir = ctx.h3Video.outputDir
      const plan = await readPlan(outputDir, args.plan_id)
      const submissions: RenderSubmission[] = []

      // multi_shot: fold the whole storyboard into ONE H3 task so shots stay coherent. The
      // synthetic segment id `all` routes the job's output to segments/<planId>-all.mp4.
      if (plan.mode === 'multi_shot') {
        validateMultiShotPlan(plan)
        const first = plan.segments[0]
        if (first === undefined) throw new Error(`plan ${plan.id} has no segments`)
        const total = plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
        const combined: VideoSegment = {
          ...first,
          id: 'all',
          prompt: buildMultiShotPrompt(plan.goal, plan.segments),
          durationSeconds: total,
        }
        const backend = args.backend ?? first.backend
        try {
          const { target, ref } = await ctx.h3Video.submit(
            backend,
            withAssetReferences(
              await withKeyframe(toSegmentRequest(combined), canonicalKeyframeFile(outputDir, plan.id, plan.segments[0]?.id ?? 's0')),
              plan,
            ),
            exec.signal,
          )
          const jobId = ctx.jobs.start({
            kind: 'h3-video',
            label: `render ${plan.id}/multi-shot`,
            owner: agent,
            outputLimitBytes: 4000,
            run: () => renderJobHooks(ctx, plan.id, combined, target, ref),
          })
          submissions.push({ segmentId: 'all', backend, taskRef: String(ref), jobId, state: 'submitted' })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          submissions.push({ segmentId: 'all', backend, state: 'failed', error: message })
        }
      } else {
        const selected = args.segment_ids === undefined
          ? plan.segments
          : args.segment_ids.map((id) => {
            const segment = plan.segments.find(candidate => candidate.id === id)
            if (segment === undefined) throw new Error(`plan ${plan.id} has no segment ${JSON.stringify(id)}`)
            return segment
          })
        for (const segment of selected) {
          const backend = args.backend ?? segment.backend
          try {
            const { target, ref } = await ctx.h3Video.submit(
              backend,
              withAssetReferences(
                await withKeyframe(toSegmentRequest(segment), canonicalKeyframeFile(outputDir, plan.id, segment.id)),
                plan,
              ),
              exec.signal,
            )
            const jobId = ctx.jobs.start({
              kind: 'h3-video',
              label: `render ${plan.id}/${segment.id}`,
              owner: agent,
              outputLimitBytes: 4000,
              run: () => renderJobHooks(ctx, plan.id, segment, target, ref),
            })
            submissions.push({ segmentId: segment.id, backend, taskRef: String(ref), jobId, state: 'submitted' })
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            submissions.push({ segmentId: segment.id, backend, state: 'failed', error: message })
          }
        }
      }
      const succeeded = submissions.filter(submission => submission.state === 'submitted').length
      const failed = submissions.length - succeeded
      const notice = failed === 0
        ? `submitted ${succeeded} segment job(s) for plan ${plan.id}`
        : `submitted ${succeeded} segment job(s), ${failed} failed for plan ${plan.id}`
      return { planId: plan.id, submissions, notice }
    },
    presentCall: args => presentCall('Render video segments', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_assemble',
    description: 'Concatenate a plan\'s rendered segments in storyboard order with ffmpeg into one mp4. Fails listing any segment that has not been rendered yet.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      output_file: { type: 'string', description: 'Absolute output mp4 path; defaults to outputDir/final/<planId>.mp4.' },
      ffmpeg_path: { type: 'string', description: 'ffmpeg executable; defaults to ffmpeg on PATH.' },
    },
    output: jsonOutput(ASSEMBLE_VALUE_SCHEMA),
    async execute(args, exec) {
      const outputDir = ctx.h3Video.outputDir
      const plan = await readPlan(outputDir, args.plan_id)
      const total = plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
      // multi_shot renders one coherent clip already; assembly just confirms it and returns it.
      if (plan.mode === 'multi_shot') {
        const file = canonicalSegmentFile(outputDir, plan.id, 'all')
        try {
          await readFile(file)
        } catch {
          throw new Error(`plan ${plan.id} has not been rendered yet (missing ${file})`)
        }
        return { planId: plan.id, outputFile: file, segments: [file], durationSeconds: total }
      }
      const missing: string[] = []
      const files: string[] = []
      for (const segment of plan.segments) {
        const file = canonicalSegmentFile(outputDir, plan.id, segment.id)
        try {
          await readFile(file)
          files.push(file)
        } catch {
          missing.push(segment.id)
        }
      }
      if (missing.length > 0) {
        throw new Error(`plan ${plan.id} is missing rendered segments: ${missing.join(', ')}`)
      }
      const outputFile = args.output_file ?? artifactPath(outputDir, 'final', `${plan.id}.mp4`)
      await ctx.h3Video.assemble(
        files.map(file => ({ file })),
        {
          outputFile,
          ...args.ffmpeg_path !== undefined ? { ffmpegPath: args.ffmpeg_path } : {},
          signal: exec.signal,
        },
      )
      return { planId: plan.id, outputFile, segments: files, durationSeconds: total }
    },
    presentCall: args => presentCall('Assemble final video', args.plan_id),
  }))

  // Direct human entry point: `/video <description>` queues one user turn that drives the
  // plan → render → assemble → present pipeline through the model-facing tools.
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-experimental-tool-video'),
    name: 'video',
    description: '把文字需求直接变成视频：拆分镜、渲染、拼接、交付（MiniMax H3）',
    input: { hint: '<需求描述>' },
    handler: (invocation) => {
      const text = invocation.rawInput.trim()
      if (text.length === 0) {
        return {
          kind: 'error',
          text: '用法：/video <需求描述>。例如 /video 拍一段 8 秒的品牌片：一杯咖啡在清晨窗台冒着热气，特写拉远到城市。',
        }
      }
      invocation.agent.followup(createUserMessage({
        content: [{
          type: 'text',
          text: '用户请求生成视频：' + text + '\n\n'
            + '请按 H3 视频生成流程执行：'
            + '1) 先用 video_plan 把需求拆成带 id 的分镜（每段含 prompt、duration_seconds、resolution、ratio、backend，可选 references 参考素材）；'
            + '2) 把分镜呈现给用户确认（场景/镜头/提示词要点/时长/分辨率/路由与预估成本，并询问是否需要参考素材），未经确认不得渲染；'
            + '3) 确认后用 video_render 提交渲染并用 job_output 等待各段完成；'
            + '4) 全部成功后 video_assemble 拼接成片，最后用 present 交付。'
            + '本地失败时不得静默转远端 API：先说明失败原因并询问用户（远端按秒计费）后再用 remote。',
        }],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: `已收到视频请求，开始处理：${text}` }
    },
  })
}
