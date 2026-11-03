/**
 * Model-facing H3 video tools over `ctx.h3Video`: `video_plan` structures and persists a
 * storyboard, `video_render` submits segments to the chosen backend and backgrounds the
 * generation polls as jobs, and `video_assemble` concats finished segments with ffmpeg. Plans are
 * JSON artifacts under the h3-video output directory; the plan content also appears verbatim in
 * each tool result so replay reconstructs what the model saw.
 * @module @deepseek-ai/dsh-tool-video
 */

import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, extname, join, basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BackendChoice,
  H3TaskRef,
  GpuStatus,
  RoutedProvider,
  SegmentInput,
  SegmentRequest,
} from '@deepseek-ai/dsh-h3-video'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: resolves the optional ctx.attachments service declaration and its reference vocabulary.
import type {} from '@deepseek-ai/dsh-attachment'
import type { AttachmentId, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
// Type-only: resolves the required ctx.commands service declaration.
import type {} from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { RenderSubmission, PlanAsset, SegmentReference, VideoPlan, VideoSegment } from './types.ts'
import { findLibraryAsset, libraryPath, readLibrary, saveLibraryAssets } from './library.ts'

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
    prompt: {
      type: 'string',
      description: 'Agent-authored canonical visual identity block. For characters, include observable age impression, body, face, hair, makeup, gaze, mouth/expression, clothing, shoes, accessories, posture, and negative constraints; the user does not need to write this prompt. For scenes, record fixed doors/windows, connected passages, furnishings, light sources, spatial directions, and travel routes; derive every camera view from this same layout.',
    },
    reference: { type: 'string' },
    referenceLayout: { type: 'string', enum: ['four-column'] },
    sheet: { type: 'string' },
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
    seed: { type: 'integer' },
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
          continuity: { type: 'string', enum: ['continue', 'cut', 'time_jump', 'flashback'], description: 'Relation to the preceding shot: continue the same event, cut to another place, jump in time, or show a flashback.' },
          startState: { type: 'string' },
          event: { type: 'string', description: 'The one observable event this shot advances.' },
          endState: { type: 'string' },
          assetIds: { type: 'array', items: { type: 'string' } },
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
    resolved: { type: 'string', enum: ['local', 'remote'] },
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
    durationSeconds: { type: 'number', required: true },
  },
} as const

/** Resolve per-call assembly defaults before invoking the video service. */
function resolveAssemblyTransition(args: {
  transition?: 'cut' | 'dip' | 'crossfade'
  transition_seconds?: number
}): { kind: 'cut' | 'dip' | 'crossfade'; seconds: number } {
  const kind = args.transition ?? 'crossfade'
  const seconds = args.transition_seconds ?? (kind === 'dip' ? 0.25 : 0.4)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('transition_seconds must be finite and positive')
  return { kind, seconds }
}

const GPU_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    configured: { type: 'boolean', required: true },
    vendor: { type: 'string' },
    instanceId: { type: 'string' },
    state: {
      type: 'string',
      required: true,
      enum: ['absent', 'starting', 'running', 'stopping', 'stopped', 'releasing', 'failed'],
    },
    serviceUrl: { type: 'string' },
    idleTimeoutMs: { type: 'integer' },
    idleAction: { type: 'string', enum: ['power_off', 'release'] },
    error: { type: 'string' },
    notice: { type: 'string', required: true },
  },
} as const

/** Actions the cloud GPU tool accepts. */
type GpuAction = 'status' | 'up' | 'stop' | 'release'

/**
 * The model-facing line beside one GPU lifecycle result: which instance, where it serves, and
 * when the idle policy acts.
 * @param action - the requested lifecycle action.
 * @param status - the service's view after the action.
 * @returns the notice text.
 */
function gpuNotice(action: GpuAction, status: GpuStatus): string {
  if (!status.configured) return 'no cloud GPU is configured for the local H3 backend'
  if (status.vendor === 'static') {
    const where = status.serviceUrl ?? 'its configured address'
    return status.state === 'running'
      ? `the local ComfyUI backend answers at ${where} (static address, no cloud GPU row)`
      : `the local ComfyUI backend at ${where} is not answering right now (static address, no cloud GPU row)`
  }
  if (action === 'release' && status.state === 'absent') return 'cloud GPU instance released'
  const where = status.instanceId !== undefined ? `instance ${status.instanceId}` : 'no instance'
  const endpoint = status.serviceUrl !== undefined ? ` at ${status.serviceUrl}` : ''
  const idle = status.idleTimeoutMs !== undefined && status.idleTimeoutMs > 0
    ? `; the idle policy applies after ${Math.round(status.idleTimeoutMs / 1000)}s without generation`
    : ''
  return `cloud GPU ${where} is ${status.state}${endpoint}${idle}`
}

/**
 * The durable image reference a material result carries, mirroring the shape the attachment
 * service returns and the client's image card understands. Persisted beside the file path so a
 * rendered material survives replay without re-reading the file.
 */
const IMAGE_ATTACHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
} as const

const KEYFRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    segmentId: { type: 'string', required: true },
    keyframe: { type: 'string' },
    attachment: IMAGE_ATTACHMENT_SCHEMA,
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
    attachment: IMAGE_ATTACHMENT_SCHEMA,
    referenceLayout: { type: 'string', enum: ['four-column'] },
    sheet: { type: 'string' },
    sheetAttachment: IMAGE_ATTACHMENT_SCHEMA,
    state: { type: 'string', required: true, enum: ['generated', 'skipped', 'failed'] },
    error: { type: 'string' },
  },
} as const

const LIBRARY_ASSET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    description: { type: 'string' },
    prompt: { type: 'string' },
    reference: { type: 'string' },
    referenceLayout: { type: 'string', enum: ['four-column'] },
    sheet: { type: 'string' },
  },
} as const

const LIBRARY_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assets: { type: 'array', required: true, items: LIBRARY_ASSET_SCHEMA },
    notice: { type: 'string', required: true },
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

/**
 * A declared output whose model-facing content is the images themselves rather than JSON, so a
 * generated material is visible in the conversation and not only as a path.
 * @param schema - the structured value schema.
 * @param toBlocks - maps the value to its text and image content blocks.
 * @returns the output declaration for a material tool.
 */
function imageOutput<const S extends ValueSchemaSpec>(
  schema: S,
  toBlocks: (value: InferValue<S>) => ContentBlock[],
): {
  schema: S
  render: (_args: unknown, value: InferValue<S>) => ContentBlock[]
} {
  return { schema, render: (_args: unknown, value: InferValue<S>) => toBlocks(value) }
}

/** Media types the hosted image model returns, keyed by the extension the file was written with. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Render a thrown value as the text a tool result and notice carry.
 * @param error - whatever a provider or the filesystem threw.
 * @returns its message, or the value itself when it is not an `Error`.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Commit one generated material image to the durable attachment store, so the tool result can
 * carry the image itself beside its path.
 * @param ctx - plugin context carrying the optional attachments service.
 * @param filePath - absolute path of the generated image.
 * @returns the durable reference, or undefined when no attachment store is mounted.
 */
async function saveImageAttachment(ctx: Context, filePath: string): Promise<ImageAttachmentRef | undefined> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return undefined
  const mediaType = IMAGE_MEDIA_TYPES[extname(filePath).toLowerCase()]
  if (mediaType === undefined) return undefined
  let data: Buffer
  try {
    data = await readFile(filePath)
  } catch {
    // A reference the user supplied as a URL, or one this host cannot read, still anchors
    // generation; only the in-conversation copy is missing, so the envelope falls back to a path.
    return undefined
  }
  return await attachments.saveImage({ data, mediaType, name: basename(filePath) })
}

/** The durable reference as the tool result schema carries it, before re-branding for a content block. */
type MaterialAttachment = {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/**
 * The model-facing envelope beside one material image: which material it is, where the file lives,
 * and the image's measured size — the same block shape `read_image` writes, so one image-card
 * derivation serves both tools.
 * @param label - the segment or asset this image belongs to.
 * @param filePath - absolute path of the image file.
 * @param attachment - the durable reference carrying the measured size.
 * @returns the envelope text.
 */
function materialEnvelope(label: string, filePath: string, attachment: MaterialAttachment): string {
  return `<path>${label} → ${filePath}</path>
<type>image</type>
<content>
${attachment.mediaType} image, ${attachment.width}x${attachment.height} px, ${attachment.bytes} bytes
</content>`
}

/**
 * Content blocks for one material image: its envelope plus the image, or a path-only line when the
 * deployment has no attachment store to commit it to.
 * @param label - the segment or asset this image belongs to.
 * @param filePath - absolute path of the image file.
 * @param attachment - the durable reference, absent without an attachment store.
 * @returns the ordered content blocks for this material.
 */
function materialBlocks(label: string, filePath: string, attachment: MaterialAttachment | undefined): ContentBlock[] {
  if (attachment === undefined) return [{ type: 'text', text: `${label} → ${filePath}` }]
  const ref: ImageAttachmentRef = {
    // The schema already validated the id as a non-empty string, so this re-brands the same
    // value the store minted without taking a runtime dependency on the attachment package.
    attachmentId: attachment.attachmentId as AttachmentId,
    mediaType: attachment.mediaType,
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
    ...attachment.name !== undefined ? { name: attachment.name } : {},
  }
  return [
    { type: 'text', text: materialEnvelope(label, filePath, attachment) },
    { type: 'image', attachment: ref },
  ]
}

/** Model-facing content for a keyframe run: each shot's image, then its failures and the notice. */
function keyframeContent(value: InferValue<typeof KEYFRAME_VALUE_SCHEMA>): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const keyframe of value.keyframes) {
    const label = `segment ${keyframe.segmentId}`
    if (keyframe.keyframe !== undefined) {
      blocks.push(...materialBlocks(label, keyframe.keyframe, keyframe.attachment))
    } else {
      blocks.push({
        type: 'text',
        text: `${label}: ${keyframe.state}${keyframe.error !== undefined ? ` — ${keyframe.error}` : ''}`,
      })
    }
  }
  blocks.push({ type: 'text', text: value.notice })
  return blocks
}

/** Model-facing content for an asset-image run: each asset's reference image, then failures and the notice. */
function assetImageContent(value: InferValue<typeof ASSET_IMAGE_VALUE_SCHEMA>): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const asset of value.assets) {
    const label = `${asset.kind} ${asset.name}`
    if (asset.image !== undefined) {
      blocks.push(...materialBlocks(label, asset.image, asset.attachment))
    }
    if (asset.sheet !== undefined) {
      blocks.push(...materialBlocks(`${label} sheet`, asset.sheet, asset.sheetAttachment))
    }
    if (asset.image === undefined && asset.sheet === undefined) {
      blocks.push({
        type: 'text',
        text: `${label}: ${asset.state}${asset.error !== undefined ? ` — ${asset.error}` : ''}`,
      })
    } else if (asset.state === 'failed') {
      blocks.push({ type: 'text', text: `${label}: failed — ${asset.error ?? 'unknown error'}` })
    }
  }
  blocks.push({ type: 'text', text: value.notice })
  return blocks
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

function assetsDir(outputDir: string): string {
  return artifactPath(outputDir, 'assets')
}

/** Extensions the hosted image model can return; the canonical name follows the real bytes. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.webp'] as const

/**
 * Canonical artifact base path (no extension) for a generated image; the extension follows what
 * the image endpoint actually returned, so callers append `extname(generated)` when writing.
 * @param dir - the artifact directory (`keyframes` or `assets`).
 * @param planId - owning plan id.
 * @param id - segment or asset id.
 * @returns the extension-less absolute path.
 */
function imageArtifactBase(dir: string, planId: string, id: string): string {
  return artifactPath(dir, `${planId}-${id}`)
}

/**
 * Move one generated image into the plan's asset artifact path.
 * @param source - the generated file.
 * @param outputDir - the h3-video output directory.
 * @param planId - owning plan id.
 * @param assetId - asset id.
 * @returns the absolute target path.
 */
async function commitAssetImage(
  source: string,
  outputDir: string,
  planId: string,
  assetId: string,
): Promise<string> {
  const base = imageArtifactBase(assetsDir(outputDir), planId, assetId)
  const target = `${base}${extname(source)}`
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  return target
}

/**
 * Locate a previously generated image artifact by probing the extensions the endpoint can return.
 * @param base - extension-less absolute path from {@link imageArtifactBase}.
 * @returns the existing path, or undefined when no artifact was written yet.
 */
function findImageArtifact(base: string): string | undefined {
  for (const extension of IMAGE_EXTENSIONS) {
    if (existsSync(`${base}${extension}`)) return `${base}${extension}`
  }
  return undefined
}

/**
 * The canonical text block one asset contributes to every prompt: the fixed `prompt` block when
 * the planner wrote one, else the short description, else the name. Reusing one block verbatim in
 * the full-body reference, every keyframe, and every clip is the prompt half of consistency.
 * @param asset - the plan asset.
 * @returns the block copied into generation prompts.
 */
function assetBlock(asset: PlanAsset): string {
  return asset.prompt?.trim() || asset.description?.trim() || asset.name
}

/**
 * Append the plan's style line to a generation prompt.
 * @param style - the plan's one-line style directive, when it has one.
 * @returns the suffix, or an empty string.
 */
function styleSuffix(style: string | undefined): string {
  return style !== undefined && style.trim().length > 0 ? `，视觉风格：${style.trim()}` : ''
}

/**
 * Four-column character design prompt. Single-subject consumers use the front-column crop.
 * @param asset - the character asset.
 * @param style - the plan's one-line style directive, when it has one.
 * @returns the image-01 prompt.
 */
function buildCharacterReferencePrompt(asset: PlanAsset, style: string | undefined): string {
  return [
    '输出一张横向 16:9 的角色设定板，不是单人海报。画布必须被三条竖直分隔线分成四个等宽、都被内容填满的独立面板；四个面板必须同时出现在同一张图片中。',
    '四栏顺序摘要：正面全身、左侧面全身、背面全身、正面面部特写。',
    '从左到右严格标记并绘制：PANEL 1 FRONT FULL BODY 正面全身（full-body）；PANEL 2 LEFT SIDE FULL BODY 左侧面全身（full-body）；PANEL 3 BACK FULL BODY 背面全身（full-body）；PANEL 4 FACE CLOSE-UP 正面面部特写。',
    '前三个面板各自从头顶到鞋底完整入画，头顶到鞋底必须可见，双脚可见，人物不能跨越面板分隔线；第四个面板只做清晰面部特写。四个面板缺一不可，不能留白。',
    '禁止输出单一居中的正面人物、3:4 竖图、单视图、半身像（不要半身像）、只有一栏、空白栏、重复正面视图或把四个视图叠在同一位置。',
    '第四栏清晰展示脸型、下颌线、眼神、眼线和嘴角表情，不要美化成另一张脸。',
    `四栏共享同一角色外观：${assetBlock(asset)}。`,
    '各视角保持相同年龄、体型、发型、服装结构、颜色、材质、鞋子和所有配饰，正侧背对应同一个人。',
    '纯白背景，柔和均匀棚拍光，四栏边界清楚，不重叠，不跨栏，不额外增加人物、视角或图片文件，不要文字、水印、logo。',
    styleSuffix(style),
  ].join('')
}

/**
 * Still prompt for a scene or prop asset.
 * @param asset - the scene or prop asset.
 * @param style - the plan's one-line style directive, when it has one.
 * @returns the image generation prompt.
 */
function buildStillPrompt(asset: PlanAsset, style: string | undefined): string {
  if (asset.kind === 'scene') {
    return `固定机位广角镜头，清晰的建立镜头，${assetBlock(asset)}，画面中没有任何人物，空场景。`
      + '单张透视场景主图，不是四宫格、拼贴或平面图；遵循固定空间布局，保持门窗、通道、主要陈设与光源的位置关系，保留可通行的动作路线。'
      + `电影质感${styleSuffix(style)}`
  }
  return `道具参考图，${assetBlock(asset)}，纯白背景，柔和均匀的光线，电影质感${styleSuffix(style)}`
}

/** Map a segment ratio to the image-01 aspect ratio (falls back to 16:9 for adaptive). */
function keyframeRatio(ratio: VideoSegment['ratio']): '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' {
  if (ratio === 'adaptive') return '16:9'
  return ratio
}

/**
 * Assemble the final segment request: apply the keyframe and asset anchors under the H3
 * conditioning rules. Frame conditioning (`first_frame`/`last_frame`) and reference conditioning
 * are mutually exclusive on the backend, so when any reference material exists — plan asset
 * anchors or authored reference inputs — the whole request unifies on full-reference: frame
 * inputs degrade to `reference_image` instead of silently dropping the anchors. Reference
 * conditioning also needs the prompt to label each attached item, so a contract line naming
 * `<Picture N>`/`<Video N>`/`<Audio N>` in content order is appended to the prompt.
 * @param segment - the plan segment.
 * @param plan - the plan carrying the asset anchors, style line, and seed.
 * @param keyframeBase - extension-less canonical keyframe path for this segment.
 * @returns the provider-ready request.
 */
function buildSegmentRequest(segment: VideoSegment, plan: VideoPlan, keyframeBase: string): SegmentRequest {
  const assets = referencedAssetsFor(segment, plan)
  const request = toSegmentRequest(segment, segmentPrompt(segment, plan, assets), plan.seed)
  const keyframePath = findImageArtifact(keyframeBase)
  const hasAuthoredMaterial = request.inputs.some(input => input.type !== 'text')
  if (!hasAuthoredMaterial && keyframePath !== undefined) {
    // The keyframe was drawn from the confirmed reference images, so it already carries the cast
    // and the set. Starting the clip from it anchors every frame to that still; passing the
    // references as loose inputs instead makes the model re-invent the scene on every shot, which
    // is exactly the drift the references were supposed to prevent.
    // Frame-image requests determine their ratio from the image (H3 content rule), so force adaptive.
    return {
      ...request,
      ratio: 'adaptive',
      inputs: [...request.inputs, { type: 'image', url: keyframePath, role: 'first_frame' }],
    }
  }
  const frameInputs = request.inputs.filter((input): input is Extract<SegmentInput, { type: 'image' }> =>
    input.type === 'image' && (input.role === 'first_frame' || input.role === 'last_frame'))
  const hasFrameInputs = frameInputs.length > 0
  const hasReferenceInputs = request.inputs.some(input =>
    input.type === 'video' || input.type === 'audio' || (input.type === 'image' && input.role === 'reference_image'))
  if (hasFrameInputs) {
    const textInput = request.inputs.find((input): input is Extract<SegmentInput, { type: 'text' }> => input.type === 'text')
    return { ...request, ratio: 'adaptive', inputs: [
      ...(textInput !== undefined ? [textInput] : []),
      ...frameInputs,
      ...(keyframePath !== undefined && !frameInputs.some(input => input.role === 'first_frame')
        ? [{ type: 'image' as const, url: keyframePath, role: 'first_frame' as const }] : []),
    ] }
  }
  if (!hasReferenceInputs && assets.length === 0) return request
  const labeled: Array<{ input: SegmentInput; label: string }> = []
  const counters = { picture: 0, video: 0, audio: 0 }
  const add = (input: SegmentInput, description: string): void => {
    if (input.type === 'image') {
      labeled.push({ input, label: `<Picture ${++counters.picture}> ${description}` })
    } else if (input.type === 'video') {
      labeled.push({ input, label: `<Video ${++counters.video}> ${description}` })
    } else {
      labeled.push({ input, label: `<Audio ${++counters.audio}> ${description}` })
    }
  }
  for (const input of request.inputs) {
    if (input.type === 'image' && (input.role === 'first_frame' || input.role === 'last_frame')) {
      add({ type: 'image', url: input.url, role: 'reference_image' }, input.role === 'first_frame' ? 'opening frame' : 'closing frame')
    } else if (input.type !== 'text') {
      add(input, input.role)
    }
  }
  if (keyframePath !== undefined) add({ type: 'image', url: keyframePath, role: 'reference_image' }, 'opening keyframe')
  for (const asset of assets) {
    add({ type: 'image', url: asset.reference, role: 'reference_image' }, `${asset.name} (${asset.kind})`)
  }
  const prompt = request.inputs.find(input => input.type === 'text')
  const baseText = prompt?.type === 'text' ? prompt.text : ''
  const text = `${baseText}\nReferences: ${labeled.map(entry => entry.label).join('; ')}`
  return { ...request, inputs: [{ type: 'text', text }, ...labeled.map(entry => entry.input)] }
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

/**
 * Prompt markers that declare a deliberate change of place. A shot that opens with one of these is
 * allowed to share no anchor with the shot before it; anything else is an unexplained jump, which
 * reads as two unrelated clips spliced together.
 */
const CUT_MARKERS = /切至|切到|转到|硬切|cut to|cut into|transition to/iu

/**
 * Refuse a storyboard whose neighbouring shots share neither a character nor a set and declare no
 * cut. Each shot renders as its own clip, so the only thing tying two of them together is what
 * their prompts name: with nothing in common the viewer sees an unexplained jump — the office in
 * one clip, somewhere else in the next.
 * @param segments - the ordered storyboard.
 * @param assets - the plan's recorded anchors, the vocabulary a prompt can name.
 * @throws Error - naming the pair and the two ways to fix it.
 */
function validateContinuity(segments: readonly VideoSegment[], assets: readonly PlanAsset[]): void {
  const assetIds = new Set(assets.map(asset => asset.id))
  for (const segment of segments) {
    for (const id of segment.assetIds ?? []) {
      if (!assetIds.has(id)) throw new Error(`segment ${segment.id}: unknown asset id ${JSON.stringify(id)}`)
    }
  }
  const anchored = assets.filter(asset => asset.name.length > 0)
  // Without recorded anchors there is no vocabulary to carry over, so continuity is the planner's
  // prose and nothing here can judge it.
  if (anchored.length === 0 || segments.length < 2) return
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]
    const current = segments[index]
    if (previous === undefined || current === undefined) continue
    const namedInPrevious = anchored.filter(asset => previous.assetIds !== undefined
      ? previous.assetIds.includes(asset.id) : previous.prompt.includes(asset.name))
    const namedInCurrent = anchored.filter(asset => current.assetIds !== undefined
      ? current.assetIds.includes(asset.id) : current.prompt.includes(asset.name))
    // Neither shot names an anchor: the storyboard is prose-only here, and there is nothing to
    // compare. Enforcement starts as soon as one side names a character or set.
    if (namedInPrevious.length === 0 && namedInCurrent.length === 0) continue
    if (current.continuity !== undefined && current.continuity !== 'continue') continue
    if (current.continuity === undefined && CUT_MARKERS.test(current.prompt)) continue
    const previousSets = namedInPrevious.filter(asset => asset.kind === 'scene')
    const currentSets = namedInCurrent.filter(asset => asset.kind === 'scene')
    const carriedSet = currentSets.some(asset => previousSets.includes(asset))
    if (carriedSet) continue
    // Naming the same character is not continuity when the two shots name different rooms: that is
    // the "same person, somewhere else" jump this rule exists to catch.
    const changedPlace = previousSets.length > 0 && currentSets.length > 0 && !carriedSet
    const physicalTransition = current.continuity === 'continue'
      && previous.endState !== undefined && previous.endState.trim().length > 0
      && current.startState?.trim() === previous.endState.trim()
      && current.event !== undefined && current.event.trim().length > 0
    const carriedCharacter = namedInCurrent.some(asset =>
      asset.kind === 'character' && namedInPrevious.includes(asset))
    if (carriedCharacter && (!changedPlace || physicalTransition)) continue
    throw new Error(
      `segments ${previous.id} and ${current.id} share no character or set, so the two clips have nothing in common. `
      + (changedPlace
        ? `${previous.id} is in ${previousSets.map(asset => asset.name).join('/')} and ${current.id} moves to ${currentSets.map(asset => asset.name).join('/')}. For continuous movement, declare continue, copy the previous end_state into start_state, and describe the physical route in event. `
        : `Name the character or set of ${previous.id} that carries over into ${current.id}`)
      + `Open ${current.id} with "切至：<场景名>" when the storyboard really moves somewhere else.`,
    )
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

/**
 * Convert a plan segment into a provider request, carrying the composed prompt, the authored
 * references, and the plan's shared seed.
 * @param segment - the plan segment.
 * @param text - the composed generation prompt.
 * @param seed - the plan's shared sampling seed, when it has one.
 * @returns the request before keyframe/asset anchoring.
 */
function toSegmentRequest(segment: VideoSegment, text: string, seed: number | undefined): SegmentRequest {
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
    ...(seed !== undefined ? { seed } : {}),
  }
}

/** H3 single-task duration ceiling for a multi-shot clip (the trained 17k+5 frame range). */
const MAX_MULTI_SHOT_SECONDS = 15

/**
 * Build one H3 prompt that carries the whole storyboard as a shot timeline, the way the official H3
 * multi-shot workflow does: a scene overview, per-shot timecoded entries, and camera guidance.
 * @param plan - the story, assets, style, and ordered shots.
 * @returns the combined multi-shot prompt.
 */
function buildMultiShotPrompt(plan: VideoPlan): string {
  const { goal, segments } = plan
  const parts: string[] = []
  parts.push('integrated_multimodal_description:')
  parts.push(`Story: ${goal}`)
  parts.push('The supplied image is the opening frame of the whole film. Animate from its starting state; do not use a later action or a montage as the opening.')
  const assets = (plan.assets ?? []).filter(asset => segments.some(segment => segment.assetIds !== undefined
    ? segment.assetIds.includes(asset.id) : segment.prompt.includes(asset.name)))
  for (const asset of assets) parts.push(`Keep ${asset.name} (${asset.kind}): ${assetBlock(asset)}`)
  if (plan.style?.trim()) parts.push(`Visual style: ${plan.style.trim()}`)
  parts.push('')
  parts.push('Storyboard (one continuous story timeline; a shot changes framing only unless its relation declares a cut, time jump, or flashback):')
  let cursor = 0
  segments.forEach((segment, index) => {
    const start = cursor
    const end = cursor + segment.durationSeconds
    const camera = segment.camera !== undefined && segment.camera.length > 0 ? ` Camera: ${segment.camera}.` : ''
    const relation = index === 0 ? 'opening' : segment.continuity ?? 'continue'
    const state = [
      segment.startState !== undefined ? `Start state: ${segment.startState}` : undefined,
      segment.event !== undefined ? `Event: ${segment.event}` : undefined,
      segment.endState !== undefined ? `End state: ${segment.endState}` : undefined,
    ].filter((value): value is string => value !== undefined)
    parts.push(`[${start}s-${end}s] Shot ${index + 1} (${relation}): ${segment.prompt}${camera}${state.length > 0 ? ` ${state.join('. ')}.` : ''}`)
    cursor = end
  })
  parts.push('')
  parts.push('Use clean hard cuts between shot angles, no dissolves. An angle change does not change place or time. Continue from each preceding end state; do not repeat completed actions. A cut changes place, not established facts; time jumps and flashbacks follow their stated times. Preserve identities, wardrobe, prop ownership, set layout, and lighting unless the timeline explicitly changes them.')
  parts.push('For every continue transition, show the complete physical action from the preceding end state. When moving between spaces, show the exit, threshold crossing, travel direction, entry, and arrival. Do not teleport or omit walking, object contact, or handoffs. Preserve screen direction and prop ownership across angle changes. A new location name alone does not describe a route.')
  parts.push('overall_soundscape: Preserve location-specific room tone and action sounds continuously across the timeline; footsteps, door movement, and threshold contact must occur at the corresponding visual moments.')
  parts.push('non_diegetic_music: N/A unless the story explicitly requests music.')
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
  for (const [index, segment] of plan.segments.entries()) {
    if (segment.resolution !== resolution || segment.ratio !== ratio) {
      throw new Error('multi_shot segments must share one resolution and ratio (one task has one canvas); use mode per_segment for mixed specs')
    }
    if (segment.backend !== plan.segments[0]?.backend) {
      throw new Error('multi_shot segments must share one backend; use per_segment for independent routing')
    }
    if (index > 0 && (segment.references?.length ?? 0) > 0) {
      throw new Error(`multi_shot segment ${segment.id}: later-shot references cannot condition one task; use per_segment`)
    }
    for (const reference of segment.references ?? []) {
      if (reference.type !== 'image' || reference.role !== 'first_frame' || segment.references?.length !== 1) {
        throw new Error('multi_shot accepts one opening first_frame image on its first shot; use per_segment for other material')
      }
    }
    if (plan.segments.length > 1) {
      for (const [field, value] of [['start_state', segment.startState], ['event', segment.event], ['end_state', segment.endState]]) {
        if (value === undefined || value.trim().length === 0) {
          throw new Error(`multi_shot segment ${segment.id}: ${field} must describe the story state or event`)
        }
      }
      if (index > 0 && segment.continuity === undefined) {
        throw new Error(`multi_shot segment ${segment.id}: continuity must declare continue, cut, time_jump, or flashback`)
      }
    }
  }
}

/** Build the complete multi-shot request with exactly one opening frame; later stills are previews. */
function buildMultiShotRequest(plan: VideoPlan, outputDir: string): SegmentRequest {
  const first = plan.segments[0]
  if (first === undefined) throw new Error(`plan ${plan.id} has no segments`)
  const authored = first.references?.[0]?.source
  const opening = authored ?? findImageArtifact(imageArtifactBase(keyframesDir(outputDir), plan.id, first.id))
  if (opening === undefined) {
    throw new Error(`multi_shot plan ${plan.id} needs an opening frame; run video_keyframes or supply first_frame on its first shot`)
  }
  const prompt = buildMultiShotPrompt(plan)
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`multi_shot prompt exceeds ${MAX_PROMPT_CHARS} characters after combining story, assets, style, and shot states; shorten the plan`)
  }
  return {
    inputs: [{ type: 'text', text: prompt }, { type: 'image', url: opening, role: 'first_frame' }],
    durationSeconds: plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    resolution: first.resolution,
    ratio: 'adaptive',
    ...(plan.seed !== undefined ? { seed: plan.seed } : {}),
  }
}

/**
 * Guidance injected by the direct `/video` command before the model starts planning. The tool
 * validates fields and provider limits, while this workflow makes the narrative decisions that
 * cannot be inferred from prose validation: a short screenplay beat sheet, physical action
 * coverage, and a review gate before rendering.
 */
const STORYBOARD_WORKFLOW_GUIDANCE = [
  '先做剧本分析，再做分镜：把用户需求归纳为故事目标、角色与身份锚点、地点/时间、道具归属、镜头风格和声音要求。不要直接从一句话跳到 render。',
  '时长不决定镜头数量：用户未要求切镜且动作可连续拍摄时，优先一个完整 15 秒长镜头（或用户指定时长），不要机械拆成 3×5 秒或 2×5 秒。节拍是动作顺序，不等于切镜；一个长镜头可以连续完成多个动作节拍。确需换机位时按剧情分配不等长镜头，并在 ≤15 秒内合并为一次 multi_shot 请求。保留用户明确指定的时长和镜头数；8 秒保持 8 秒，15 秒保持 15 秒，不擅自压缩或扩长。',
  '把每个节拍转换为可执行分镜：写清机位、开场状态、一个动作事件、收尾状态、空间路径、人物朝向、左右手和道具归属，并加入环境声/动作音。抽象结果（例如“到了走廊”）必须拆成出口、跨门槛、沿路径移动、到达。',
  '场景先定空间再定机位：由导演自动把固定门窗、通道连接、主要陈设、光源、空间方向和行走路线写入场景 asset.prompt。涉及出入门或跨区域移动时先展示文字/示意布局，标出机位和路线，再生成一张无人物场景主图；不默认生成四面图。各机位必须从同一布局派生，在 camera 写清摄影机位置、朝向和视野，在 start_state/end_state 写清人物位置与移动方向，不能独立重设计场景。',
  '只为实际换向的分镜补机位预览：用 video_keyframes 显式选择 segment_ids；无人镜头自动使用所选场景主图作参考，有角色时优先使用角色图，场景布局由文字约束，当前图片接口一次只用一个参考源。multi_shot 后续预览不会逐张约束视频，只有第一镜开场图参与整片条件；严禁把布局图或多宫格作为视频首帧。需要每镜图片约束时选 per_segment，并保留实际尾帧衔接。渲染前核对门窗、通道、机位轴线、人物朝向及出口到入口的完整路线，冲突先修分镜或预览。',
  '分镜审查门禁：后一镜 start_state 必须复用前一镜 end_state 的可观察事实；continue 不得用 cut 省略路程；同一地点的连续动作不得重置人物、道具或光线。发现状态不一致时先修改 video_plan，不得带病 render。',
  '只在分镜和开场图通过审查后渲染。渲染完成后检查实际时长、镜头跳跃、动作重复、人物/道具变化和声音连续性，再交付成片。',
].join('\n')

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

/**
 * Copy one stored or authored asset into the plan document, omitting absent optional fields.
 * @param asset - the asset record.
 * @returns the plan asset.
 */
function copyAsset(asset: PlanAsset): PlanAsset {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    ...(asset.description !== undefined ? { description: asset.description } : {}),
    ...(asset.prompt !== undefined ? { prompt: asset.prompt } : {}),
    ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
    ...(asset.sheet !== undefined ? { sheet: asset.sheet } : {}),
    ...(asset.referenceLayout !== undefined ? { referenceLayout: asset.referenceLayout } : {}),
  }
}

/**
 * Resolve library references (asset names or ids) into plan assets.
 * @param outputDir - the h3-video output directory holding the library.
 * @param references - names or ids the plan asked to reuse.
 * @returns the stored assets.
 * @throws Error - naming the first reference the library does not carry.
 */
async function importLibraryAssets(outputDir: string, references: readonly string[]): Promise<PlanAsset[]> {
  if (references.length === 0) return []
  const library = await readLibrary(outputDir)
  return references.map((reference) => {
    const found = findLibraryAsset(library, reference)
    if (found === undefined) {
      throw new Error(`asset ${JSON.stringify(reference)} is not in the project library; record it with video_assets first`)
    }
    return copyAsset(found)
  })
}

/**
 * Merge library imports with the assets this call authored, keyed by name — the name a storyboard
 * references; authored fields update the imported record of the same name.
 * @param imported - assets attached from the project library.
 * @param authored - assets written in this call.
 * @returns the merged asset list.
 */
function mergeAssetsByName(imported: readonly PlanAsset[], authored: readonly PlanAsset[]): PlanAsset[] {
  const byName = new Map<string, PlanAsset>()
  for (const asset of imported) byName.set(asset.name, asset)
  for (const asset of authored) byName.set(asset.name, mergeAsset(byName.get(asset.name), asset))
  return [...byName.values()]
}

/**
 * Merge recorded assets into a plan's existing set by id. Recording is additive because each call
 * carries only the material the user just supplied: replacing the list would drop the characters a
 * previous call anchored, and the plan would silently render without them.
 * @param prior - the plan's current assets, in order.
 * @param authored - assets this call records; an id already present is updated in place.
 * @returns the merged set, prior order preserved and new ids appended.
 */
function mergePlanAssets(prior: readonly PlanAsset[], authored: readonly PlanAsset[]): PlanAsset[] {
  const byId = new Map(prior.map(asset => [asset.id, asset]))
  const order = prior.map(asset => asset.id)
  for (const asset of authored) {
    if (!byId.has(asset.id)) order.push(asset.id)
    byId.set(asset.id, mergeAsset(byId.get(asset.id), asset))
  }
  return order.flatMap((id) => {
    const asset = byId.get(id)
    return asset === undefined ? [] : [asset]
  })
}

/**
 * Preserve omitted asset fields; image layout and legacy sheets belong to their original reference.
 * @param prior - existing asset, if any.
 * @param authored - supplied asset fields.
 * @returns the updated asset without inherited metadata for a replacement image or different kind.
 */
function mergeAsset(prior: PlanAsset | undefined, authored: PlanAsset): PlanAsset {
  if (prior === undefined || prior.kind !== authored.kind) return authored
  if (authored.reference !== undefined && authored.reference !== prior.reference) {
    const { referenceLayout: _layout, sheet: _sheet, ...retained } = prior
    return { ...retained, ...authored }
  }
  return { ...prior, ...authored }
}

/** Run one ffmpeg invocation with a bounded buffer. */
const runFfmpeg = promisify(execFile)

/**
 * Derive the single front-facing subject from a generated four-column character design.
 * @param asset - the approved character reference and its recorded layout.
 * @param outputDir - directory owning derived conditioning images.
 * @param signal - cancellation for the image crop.
 * @returns the original reference or a local front-column crop; never another generated identity.
 */
async function characterSubjectImage(asset: AnchoredAsset, outputDir: string, signal: AbortSignal): Promise<string> {
  if (asset.referenceLayout !== 'four-column') return asset.reference
  const directory = join(outputDir, 'assets', 'conditioning')
  await mkdir(directory, { recursive: true })
  const target = join(await mkdtemp(join(directory, 'subject-')), 'front.png')
  await runFfmpeg('ffmpeg', ['-y', '-i', asset.reference, '-vf', 'crop=iw/4:ih:0:0', '-frames:v', '1', target], { signal })
  return target
}

/** Extract the final frame of one rendered segment, for chaining the next shot onto it.
 * @param file - the rendered segment.
 * @param target - where to write the frame.
 * @returns the frame path, or undefined when ffmpeg could not decode a tail frame.
 */
async function extractLastFrame(file: string, target: string): Promise<string | undefined> {
  await mkdir(dirname(target), { recursive: true })
  try {
    await runFfmpeg('ffmpeg', ['-y', '-sseof', '-0.2', '-i', file, '-frames:v', '1', '-q:v', '2', target])
    return target
  } catch (error: unknown) {
    // The chain owner reports the missing frame and stops before submitting a continued shot.
    void error
    return undefined
  }
}

/**
 * Attach the previous shot's actual final frame as first_frame, replacing loose references because
 * H3 cannot mix reference conditioning and frame conditioning in one request.
 * @param request - the built segment request.
 * @param chainFrame - the previous shot's last frame, when one was extracted.
 * @param segment - the authored shot, including an optional target last frame.
 * @returns the request with the chained frame attached.
 */
function withChainFrame(request: SegmentRequest, chainFrame: string | undefined, segment: VideoSegment): SegmentRequest {
  if (chainFrame === undefined) return request
  // The previous shot's final frame is the strongest anchor there is: same face, same wardrobe,
  // same light, one frame apart. It replaces the reference images rather than joining them, because
  // the backend cannot condition on a frame and loose references in the same request.
  const text = request.inputs
    .filter((input): input is { type: 'text'; text: string } => input.type === 'text')
    .map(input => ({ type: 'text' as const, text: `${input.text.replace(/\nReferences: .*$/u, '')}\nThe supplied image is the actual final frame of the preceding clip and the first frame at 0 seconds of this clip. Continue the unfinished movement from this exact pose, position, wardrobe, and prop ownership. Show the physical route to the destination; do not restart or teleport.` }))
  return {
    ...request,
    ratio: 'adaptive',
    inputs: [...text, { type: 'image', url: chainFrame, role: 'first_frame' },
      ...(segment.references ?? []).filter(reference => reference.type === 'image' && reference.role === 'last_frame')
        .map(reference => ({ type: 'image' as const, url: reference.source, role: 'last_frame' as const })),
    ],
  }
}

/**
 * One background job that renders the selected shots in plan order, feeding each shot's final frame
 * into the next one. Sequential by construction: the frame only exists once its own shot has
 * finished, which is the price of continuity.
 * @param ctx - plugin context.
 * @param plan - the plan being rendered.
 * @param segments - the shots to render, in order.
 * @param backend - the call-level backend override, when the caller passed one.
 * @returns the job hooks the registry runs.
 */
function chainJobHooks(
  ctx: Context,
  plan: VideoPlan,
  segments: readonly VideoSegment[],
  backend: BackendChoice | undefined,
): { cancel(reason?: string): void; done: Promise<JobOutcome>; readOutput(): string } {
  const controller = new AbortController()
  const chunks: string[] = []
  const done = (async (): Promise<JobOutcome> => {
    let chainFrame: string | undefined
    for (const [index, segment] of segments.entries()) {
      try {
        const outputDir = ctx.h3Video.outputDir
        const base = buildSegmentRequest(
          segment,
          plan,
          imageArtifactBase(keyframesDir(outputDir), plan.id, segment.id),
        )
        const { target, ref } = await ctx.h3Video.submit(
          backend ?? segment.backend,
          withChainFrame(base, chainFrame, segment),
          controller.signal,
        )
        const status = await ctx.h3Video.poll(target, ref, controller.signal)
        if (status.state !== 'succeeded') {
          chunks.push(`[failed] ${segment.id}: ${status.state}`)
          return { status: 'failed', detail: `${segment.id} ${status.state}`, result: chunks.join('\n') }
        }
        const canonical = canonicalSegmentFile(outputDir, plan.id, segment.id)
        await mkdir(dirname(canonical), { recursive: true })
        try {
          await rename(status.localFile, canonical)
        } catch {
          await copyFile(status.localFile, canonical)
        }
        chunks.push(`[succeeded] ${segment.id} -> ${canonical}`)
        const next = segments[index + 1]
        chainFrame = next === undefined || (next.continuity !== undefined && next.continuity !== 'continue')
          ? undefined
          : await extractLastFrame(canonical, join(keyframesDir(outputDir), `${plan.id}-${next.id}-chain.png`))
        if (next !== undefined && (next.continuity === undefined || next.continuity === 'continue') && chainFrame === undefined) {
          throw new Error(`cannot continue ${next.id}: extracting the actual final frame of ${segment.id} failed; the next shot was not submitted`)
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          chunks.push(`[killed] ${segment.id}`)
          return { status: 'killed', detail: 'cancelled', result: chunks.join('\n') }
        }
        const message = error instanceof Error ? error.message : String(error)
        chunks.push(`[failed] ${segment.id}: ${message}`)
        return { status: 'failed', detail: message, result: chunks.join('\n') }
      }
    }
    return { status: 'completed', detail: `${segments.length} chained shot(s)`, result: chunks.join('\n') }
  })()
  return {
    cancel: () => { controller.abort() },
    done,
    readOutput: () => chunks.join('\n'),
  }
}

/**
 * Allocate the next plan id for this output directory. Plan artifacts share one directory across
 * sessions (`segments/<planId>-<segmentId>.mp4` and friends), so the id series lives with the
 * artifacts rather than with the session that wrote them: a counter that restarts per session hands
 * the next session `vp-1` and overwrites the previous project's plan, keyframes, and cuts.
 * @param outputDir - the h3-video output directory holding `plans/`.
 * @param reserved - ids allocated in this process but not yet written, so two concurrent calls
 *   cannot choose the same id before either plan file exists.
 * @returns a plan id no file in the directory uses.
 */
async function allocatePlanId(outputDir: string, reserved: Set<string>): Promise<string> {
  const dir = plansDir(outputDir)
  let highest = 0
  try {
    for (const name of await readdir(dir)) {
      const match = /^vp-(\d+)\.json$/u.exec(name)
      if (match !== null) highest = Math.max(highest, Number(match[1]))
    }
  } catch {
    // No plans directory yet: this is the first plan, so the series starts at 1.
  }
  let next = highest + 1
  while (reserved.has(`vp-${next}`) || existsSync(join(dir, `vp-${next}.json`))) next += 1
  const id = `vp-${next}`
  reserved.add(id)
  return id
}

/** Paid exposure of one submission: which segments would bill the hosted API, and for how long. */
interface PaidExposure {
  /** Segment ids that would render on the hosted API, in plan order. */
  readonly ids: readonly string[]
  /** Their combined duration in seconds, the unit the hosted API bills in. */
  readonly seconds: number
}

/**
 * The segments one call would bill on the hosted API. A segment counts only when its effective
 * policy is `remote`, the one label that spends money by construction: `auto` reaches the hosted
 * API only when the caller configured no local backend, and that is reported where it happens
 * rather than guessed here.
 * @param segments - the segments this call would submit.
 * @param override - the call-level backend override, present when the caller passed one.
 * @returns the paid segment ids and their combined duration.
 */
function paidExposure(segments: readonly VideoSegment[], override: BackendChoice | undefined): PaidExposure {
  const paid = segments.filter(segment => (override ?? segment.backend) === 'remote')
  return {
    ids: paid.map(segment => segment.id),
    seconds: paid.reduce((sum, segment) => sum + segment.durationSeconds, 0),
  }
}

/**
 * Refuse a paid submission the caller did not acknowledge. The hosted API bills per second of
 * generated video, and a plan authored while the local backend was unavailable freezes `remote`
 * into every later render, so without this the spend happens with nothing in the conversation
 * asking for it. The acknowledgement flag is what turns that into a decision the user made.
 * @param exposure - paid segments and their combined duration.
 * @param acknowledged - whether the call carried `allow_remote`.
 * @throws Error - naming the segments, their total seconds, and the flag that confirms the spend.
 */
function requireRemoteConsent(exposure: PaidExposure, acknowledged: boolean): void {
  if (exposure.ids.length === 0 || acknowledged) return
  throw new Error(
    `segments ${exposure.ids.join(', ')} render on the hosted MiniMax API, which bills per second`
    + ` (${exposure.seconds}s total). Confirm the cost with the user, then pass allow_remote=true.`,
  )
}

/**
 * Derive the plan's shared sampling seed from its identity, so a plan the planner left unseeded
 * still reproduces and every one of its segments samples the same noise.
 * @param planId - plan id (`vp-<n>`).
 * @param createdAt - creation epoch ms, part of the plan document.
 * @returns a 32-bit unsigned seed.
 */
function deriveSeed(planId: string, createdAt: number): number {
  let hash = 0x811c9dc5
  for (const char of `${planId}:${createdAt}`) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** An asset anchor whose reference image exists, so it can be attached and described. */
type AnchoredAsset = PlanAsset & { readonly reference: string }

/**
 * The plan's asset anchors that carry a reference image, in declaration order.
 * @param plan - the plan carrying the anchors.
 * @returns the anchors that can condition generation.
 */
function anchoredAssets(plan: VideoPlan): readonly AnchoredAsset[] {
  return (plan.assets ?? []).filter((asset): asset is AnchoredAsset => asset.reference !== undefined)
}

/**
 * Refuse to draw stills for shots whose cast the plan cannot show. A character recorded without a
 * reference image is invented from its description alone, which is how a keyframe comes back with
 * the wrong (or no) person and every later shot inherits that stranger.
 * @param segments - the shots about to be drawn.
 * @param plan - the plan carrying the assets.
 * @throws Error - naming the characters and the call that fixes it.
 */
function requireCharacterAnchors(segments: readonly VideoSegment[], plan: VideoPlan): void {
  const unanchored = (plan.assets ?? []).filter(asset => asset.kind === 'character' && asset.reference === undefined)
  if (unanchored.length === 0) return
  const missing = new Set<string>()
  for (const segment of segments) {
    for (const asset of unanchored) {
      const used = segment.assetIds !== undefined ? segment.assetIds.includes(asset.id) : segment.prompt.includes(asset.name)
      if (used) missing.add(asset.name)
    }
  }
  if (missing.size === 0) return
  throw new Error(
    `plan ${plan.id} records ${[...missing].join('、')} without a reference image, so a still would invent them from text. `
    + `Run video_asset_images(plan_id="${plan.id}", asset_ids=[…]) first, then draw the stills.`,
  )
}

/**
 * The asset anchors one shot is conditioned on: the anchored assets whose name its prompt
 * mentions. A shot that names nothing falls back to the sets and props only — a shot that never
 * names a character must not acquire one from a reference image, which is how people appear in an
 * establishing shot that was written as an empty room.
 * @param segment - the shot being generated.
 * @param plan - the plan carrying the anchors.
 * @returns the assets to attach and describe for this shot.
 */
function referencedAssetsFor(segment: VideoSegment, plan: VideoPlan): readonly AnchoredAsset[] {
  const anchored = anchoredAssets(plan)
  if (segment.assetIds !== undefined) return anchored.filter(asset => segment.assetIds?.includes(asset.id))
  const named = anchored.filter(asset => segment.prompt.includes(asset.name))
  return named.length > 0 ? named : anchored.filter(asset => asset.kind !== 'character')
}

/**
 * Compose the generation prompt shared by a shot's keyframe and its clip: the shot text, camera
 * guidance, the appearance of every attached asset, and the plan's style line. Describing and
 * conditioning the same anchors in both passes is what keeps the still and the clip, and every
 * shot of a plan, on one look.
 * @param segment - the shot being generated.
 * @param plan - the plan carrying the style line.
 * @param assets - the anchors this shot attaches.
 * @returns the composed prompt.
 */
function segmentPrompt(
  segment: VideoSegment,
  plan: VideoPlan,
  assets: readonly PlanAsset[],
  keepFace = false,
): string {
  const camera = segment.camera !== undefined && segment.camera.length > 0 ? ` [Camera: ${segment.camera}]` : ''
  const parts = [`${segment.prompt}${camera}`]
  if (keepFace) {
    // The still is an edit of the character's confirmed reference: say so explicitly, or the model
    // treats the reference as loose inspiration and repaints a different person.
    parts.push('保持参考图中人物的脸、发型、妆容、服装、裤子、鞋子、配饰与身体比例不变，只改变场景、姿态与构图。')
  }
  for (const asset of assets) {
    const block = assetBlock(asset)
    if (block.length > 0) parts.push(`${asset.name} (${asset.kind}): ${block}`)
  }
  const style = plan.style?.trim() ?? ''
  if (style.length > 0) parts.push(`Visual style: ${style}`)
  return parts.join('\n')
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
        return { status: 'completed', detail: segment.id, result: chunks.join('\n') }
      }
      if (status.state === 'failed') {
        chunks.push(`[failed] ${segment.id}: ${status.reason}`)
        return { status: 'failed', detail: status.reason, result: chunks.join('\n') }
      }
      chunks.push(`[failed] ${segment.id}: poll returned non-terminal state ${status.state}`)
      return { status: 'failed', detail: `unexpected poll state ${status.state}`, result: chunks.join('\n') }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        chunks.push(`[killed] ${segment.id}`)
        return { status: 'killed', detail: 'cancelled', result: chunks.join('\n') }
      }
      const message = error instanceof Error ? error.message : String(error)
      chunks.push(`[failed] ${segment.id}: ${message}`)
      return { status: 'failed', detail: message, result: chunks.join('\n') }
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
  const reservedPlanIds = new Set<string>()
  ctx.jobs.attachController('tool-video')

  ctx.tools.register(defineTool({
    name: 'video_plan',
    description: 'Structure the current conversation request into a versioned storyboard plan and persist it. Duration does not determine shot count. Prefer one continuous shot for the requested duration when no cuts are requested and the action permits it; a 15-second story can be one 15-second segment. Action beats do not require cuts. Use multiple shots only when the story or user requires them, with story-driven durations in one multi_shot request of at most 15 seconds. Use per_segment only when real tail-frame chaining, independent closing frames, different materials, or different routing is required. The agent must first analyze the screenplay into short observable beats, then write an executable action sequence and concrete start/end states for every shot; a continuous route must include exit, threshold crossing, travel direction, entry, and arrival. Before calling this tool, the agent must analyze each character from the story and any supplied reference image, then write an observable identity anchor in the asset prompt: age impression, build, face shape, hair, makeup, gaze, mouth/expression, wardrobe, shoes, accessories, posture, and explicit negative constraints. The agent owns this prompt writing; the user only describes the story and characters. This tool validates and stores the plan. Pass an existing plan_id to revise it.',
    parameters: {
      goal: { type: 'string', required: true, description: 'One-line goal the plan serves.' },
      plan_id: { type: 'string', description: 'Existing plan id to revise; omit to create a new plan.' },
      mode: {
        type: 'string',
        enum: ['multi_shot', 'per_segment'],
        description: 'multi_shot (default) sends one story timeline and one opening frame to H3 (≤15s, uniform resolution/ratio/backend). Multiple shots require start_state, event, end_state, and continuity after the opening. Review state continuity before rendering. per_segment renders independent tasks for shot-specific material or routing.',
      },
      assets: {
        type: 'array',
        description: 'Reusable asset anchors (characters/scenes/props). For characters, the agent must derive a complete observable visual prompt from the story and references, including positive identity facts and negative constraints that prevent contradictory age, face, expression, makeup, clothing, or body-proportion choices. Do not make the user hand-write an image prompt. The storyboard must reference these names exactly.',
        items: ASSET_SCHEMA,
      },
      library_assets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset names or ids to attach from the project library instead of redefining them; video_library lists what is saved. An authored entry of the same name wins.',
      },
      style: { type: 'string', description: 'One-line visual style directive injected into generation prompts.' },
      allow_remote: {
        type: 'boolean',
        description: 'Confirm that the user agreed to pay for hosted-API seconds. Required when any segment names backend remote; the refusal names the segments and their total seconds.',
      },
      seed: {
        type: 'integer',
        description: 'Sampling seed for reproducibility on providers that support it; it does not preserve character identity or story continuity. Omit to derive one from the plan identity. Hosted H3 ignores seed.',
      },
      segments: {
        type: 'array',
        required: true,
        description: 'Ordered storyboard shots; assembly follows this order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Stable segment id, e.g. s1, s2.' },
            prompt: { type: 'string', required: true, description: 'Shot description used as the generation prompt. H3 generates audio in the same pass: state the ambience/SFX layer, wrap Chinese dialogue as <d>[Chinese] 逐字台词</d>, and write non_diegetic_music: N/A when no music is wanted.' },
            camera: { type: 'string', description: 'Camera movement guidance appended to the prompt.' },
            asset_ids: { type: 'array', items: { type: 'string' }, description: 'Exact plan asset ids appearing in this shot; an empty list means no assets. Prefer this over matching names in prose.' },
            continuity: { type: 'string', enum: ['continue', 'cut', 'time_jump', 'flashback'], description: 'Required after the opening in a multi-shot story: continue changes framing within continuous action; cut changes place; time_jump and flashback declare time changes.' },
            start_state: { type: 'string', description: 'Required in multi-shot stories: observable starting state, including positions, held objects, and established facts.' },
            event: { type: 'string', description: 'Required in multi-shot stories: the single event advanced by this shot.' },
            end_state: { type: 'string', description: 'Required in multi-shot stories: observable ending state. Review it against the next start_state before rendering; prose is not checked for semantic equality.' },
            duration_seconds: { type: 'integer', required: true, description: 'Segment length in seconds (1..120).' },
            resolution: { type: 'string', required: true, enum: ['480P', '768P', '2K'], description: 'Resolution tier.' },
            ratio: { type: 'string', required: true, enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], description: 'Aspect ratio.' },
            backend: { type: 'string', required: true, enum: ['local', 'remote', 'auto'], description: 'Routing policy for this segment.' },
            references: {
              type: 'array',
              description: 'Conditioning material supported by the selected provider. multi_shot accepts only one image first_frame on its opening shot; later-shot images are previews, not video constraints. Use per_segment for separate material per shot.',
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
    async execute(args) {
      const mode = args.mode ?? 'multi_shot'
      const segments: VideoSegment[] = args.segments.map(segment => ({
        id: segment.id,
        prompt: segment.prompt,
        ...segment.asset_ids !== undefined ? { assetIds: segment.asset_ids } : {},
        ...segment.continuity !== undefined ? { continuity: segment.continuity } : {},
        ...segment.start_state !== undefined ? { startState: segment.start_state } : {},
        ...segment.event !== undefined ? { event: segment.event } : {},
        ...segment.end_state !== undefined ? { endState: segment.end_state } : {},
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
      requireRemoteConsent(paidExposure(segments, undefined), args.allow_remote === true)
      const outputDir = ctx.h3Video.outputDir
      const authored: PlanAsset[] = (args.assets ?? []).map(asset => copyAsset({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...asset.description !== undefined ? { description: asset.description } : {},
        ...asset.prompt !== undefined ? { prompt: asset.prompt } : {},
        ...asset.reference !== undefined ? { reference: asset.reference } : {},
        ...asset.sheet !== undefined ? { sheet: asset.sheet } : {},
        ...asset.referenceLayout !== undefined ? { referenceLayout: asset.referenceLayout } : {},
      }))
      const imported = await importLibraryAssets(outputDir, args.library_assets ?? [])
      const authoredAssets = mergeAssetsByName(imported, authored)
      let plan: VideoPlan
      if (args.plan_id !== undefined) {
        const prior = await readPlan(outputDir, args.plan_id)
        // A revision carries only the assets it changes; the plan keeps the rest.
        const assets = mergePlanAssets(prior.assets ?? [], authoredAssets)
        validateContinuity(segments, assets)
        const seed = args.seed ?? prior.seed
        plan = {
          id: prior.id,
          revision: prior.revision + 1,
          goal: args.goal,
          mode,
          ...assets.length > 0 ? { assets } : {},
          ...(args.style ?? prior.style) !== undefined ? { style: args.style ?? prior.style } : {},
          ...seed !== undefined ? { seed } : {},
          segments,
          createdAt: prior.createdAt,
        }
      } else {
        const id = await allocatePlanId(outputDir, reservedPlanIds)
        const createdAt = Date.now()
        validateContinuity(segments, authoredAssets)
        plan = {
          id,
          revision: 1,
          goal: args.goal,
          mode,
          ...authoredAssets.length > 0 ? { assets: authoredAssets } : {},
          ...args.style !== undefined ? { style: args.style } : {},
          seed: args.seed ?? deriveSeed(id, createdAt),
          segments,
          createdAt,
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
        ...plan.seed !== undefined ? { seed: plan.seed } : {},
        createdAt: plan.createdAt,
        segments: plan.segments.map(segment => ({
          id: segment.id,
          prompt: segment.prompt,
          ...segment.assetIds !== undefined ? { assetIds: [...segment.assetIds] } : {},
          ...segment.continuity !== undefined ? { continuity: segment.continuity } : {},
          ...segment.startState !== undefined ? { startState: segment.startState } : {},
          ...segment.event !== undefined ? { event: segment.event } : {},
          ...segment.endState !== undefined ? { endState: segment.endState } : {},
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
    description: 'Generate stills using the configured image provider. multi_shot defaults to one opening frame showing the first shot start_state before its event; explicitly selected later stills are storyboard previews and do not condition the video. per_segment defaults to all shots. A named or explicitly selected character supplies one full-body reference image; local generation requires a reference-image workflow. Uncast shots use the first selected scene master as the single image reference; character shots prioritize character identity and describe scene layout in text. Use asset_ids to select the intended scene. Layout diagrams and collages are review material, never video first frames. Present the images for confirmation before rendering.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      segment_ids: { type: 'array', items: { type: 'string' }, description: 'Shot ids to draw; defaults to the opening shot for multi_shot, or every shot for per_segment.' },
      frame: { type: 'string', enum: ['opening', 'closing'], description: 'Defaults to opening. In per_segment, closing draws end_state into a separate target image; pass its returned path as image/last_frame in video_plan before rendering. It never replaces the actual preceding tail frame.' },
      seed: {
        type: 'integer',
        description: 'Image seed for this batch; defaults to the plan seed, so re-running reproduces the same stills. Pass another value to try a different take.',
      },
      identity: {
        type: 'string',
        enum: ['auto', 'text', 'portrait'],
        description: 'How the still is conditioned on the cast. "auto" (default) keeps the face, clothing, shoes, and body proportions when the shot names a character the plan carries an image for, by editing that full-body reference into the scene; uncast shots use the first selected scene reference to derive the requested viewpoint; without one they draw from text alone. "text" forces text-to-image; "portrait" forces the reference edit even when no character is named.',
      },
    },
    output: imageOutput(KEYFRAME_VALUE_SCHEMA, keyframeContent),
    async execute(args, exec) {
      const outputDir = ctx.h3Video.outputDir
      const plan = await readPlan(outputDir, args.plan_id)
      const seed = args.seed ?? plan.seed
      const closing = args.frame === 'closing'
      if (closing && plan.mode === 'multi_shot') throw new Error('closing targets require per_segment; multi_shot uses only its opening frame')
      const selected = args.segment_ids === undefined
        ? plan.mode === 'multi_shot' ? plan.segments.slice(0, 1) : plan.segments
        : args.segment_ids.map((id) => {
          const segment = plan.segments.find(candidate => candidate.id === id)
          if (segment === undefined) throw new Error(`plan ${plan.id} has no segment ${JSON.stringify(id)}`)
          return segment
        })
      const keyframes: Array<{
        segmentId: string
        keyframe?: string
        attachment?: ImageAttachmentRef
        state: 'generated' | 'failed'
        error?: string
      }> = []
      requireCharacterAnchors(selected, plan)
      for (const segment of selected) {
        const assets = referencedAssetsFor(segment, plan)
        // One character reference per still: the subject is a single character, and the shot's own
        // prompt picks which anchored character it is about.
        const subject = assets.find(asset => asset.kind === 'character')
        const keepFace = args.identity === 'portrait'
          || (args.identity !== 'text' && subject !== undefined)
        const scene = args.identity !== 'text' && !keepFace
          ? assets.find(asset => asset.kind === 'scene') : undefined
        try {
          if (closing && !segment.endState?.trim()) {
            throw new Error(`segment ${segment.id}: end_state is required for a closing target`)
          }
          const sceneGuidance = scene === undefined ? ''
            : '\n根据场景主参考图生成指定机位的单张透视画面，遵循同一固定布局；门窗、通道、陈设、光源不能随换向移动，不新增人物。不是平面图、多宫格或拼贴。'
          const generated = await ctx.h3Video.keyframe({
            prompt: closing
              ? `${segmentPrompt({ ...segment, prompt: segment.endState ?? segment.prompt }, plan, assets, keepFace)}\nDraw one scene still at this shot's end_state. No columns or collage.${sceneGuidance}`
              : plan.mode === 'multi_shot'
                ? `${segmentPrompt({ ...segment, prompt: segment.startState ?? segment.prompt }, plan, assets, keepFace)}\nDraw one still at this shot's starting state, before its event begins. No montage, timeline, or event outcome. Render one scene, not character design columns.${sceneGuidance}`
                : segmentPrompt(segment, plan, assets, keepFace) + sceneGuidance,
            ratio: keyframeRatio(segment.ratio),
            ...(seed !== undefined ? { seed } : {}),
            // The reference edit redraws the whole frame around the approved identity, so the still
            // keeps the character and the shot's own scene.
            ...(keepFace && subject !== undefined
              ? { subjectReference: await characterSubjectImage(subject, outputDir, exec.signal) }
              : scene !== undefined ? { subjectReference: scene.reference } : {}),
          }, exec.signal)
          const base = imageArtifactBase(keyframesDir(outputDir), plan.id, closing ? `${segment.id}-closing` : segment.id)
          const target = `${base}${extname(generated)}`
          await mkdir(dirname(target), { recursive: true })
          await rename(generated, target)
          const attachment = await saveImageAttachment(ctx, target)
          keyframes.push({
            segmentId: segment.id,
            keyframe: target,
            ...attachment !== undefined ? { attachment } : {},
            state: 'generated',
          })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          keyframes.push({ segmentId: segment.id, state: 'failed', error: message })
        }
      }
      const succeeded = keyframes.filter(keyframe => keyframe.state === 'generated').length
      const failed = keyframes.length - succeeded
      const notice = (failed === 0
        ? `generated ${succeeded} keyframe(s) for plan ${plan.id}`
        : `generated ${succeeded} keyframe(s), ${failed} failed for plan ${plan.id}`)
        + (plan.mode === 'multi_shot' ? '; only the first shot image conditions the complete film; later images are storyboard previews' : '')
      return { planId: plan.id, keyframes, notice }
    },
    presentCall: args => presentCall('Generate keyframes', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_assets',
    description: 'Record reusable asset anchors on an existing plan. The agent must first analyze the story and any supplied reference image, then write each character\'s complete observable visual prompt and negative constraints into asset.prompt; the user only supplies the story, character facts, and optional image path. Each reference must be an absolute local path or http(s) URL.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      assets: {
        type: 'array',
        description: 'Asset anchors; names must match the storyboard references exactly. For characters, asset.prompt is an agent-authored identity block covering age impression, body, face, hair, makeup, gaze, mouth/expression, clothing, shoes, accessories, posture, and forbidden contradictory traits. Do not ask the user to hand-write an image prompt.',
        items: ASSET_SCHEMA,
      },
      style: { type: 'string', description: 'One-line visual style directive injected into generation prompts.' },
    },
    output: jsonOutput(PLAN_VALUE_SCHEMA),
    async execute(args) {
      const outputDir = ctx.h3Video.outputDir
      const prior = await readPlan(outputDir, args.plan_id)
      const assets: PlanAsset[] = (args.assets ?? []).map(asset => copyAsset({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...asset.description !== undefined ? { description: asset.description } : {},
        ...asset.prompt !== undefined ? { prompt: asset.prompt } : {},
        ...asset.reference !== undefined ? { reference: asset.reference } : {},
        ...asset.sheet !== undefined ? { sheet: asset.sheet } : {},
        ...asset.referenceLayout !== undefined ? { referenceLayout: asset.referenceLayout } : {},
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
      // Additive: this call records the material just supplied and keeps the anchors already on
      // the plan, so recording one character cannot drop the rest.
      const merged = assets.length > 0 ? mergePlanAssets(prior.assets ?? [], assets) : (prior.assets ?? [])
      const plan: VideoPlan = {
        ...prior,
        ...merged.length > 0 ? { assets: merged } : {},
        ...args.style !== undefined ? { style: args.style } : {},
      }
      const planFile = await writePlan(outputDir, plan)
      // Recorded assets become the project's base setting layer, so a later episode attaches the
      // same reference and prompt block instead of redefining them.
      await saveLibraryAssets(outputDir, plan.assets ?? [])
      return {
        id: plan.id,
        revision: plan.revision,
        goal: plan.goal,
        mode: plan.mode,
        ...plan.assets !== undefined ? { assets: plan.assets.map(asset => ({ ...asset })) } : {},
        ...plan.style !== undefined ? { style: plan.style } : {},
        ...plan.seed !== undefined ? { seed: plan.seed } : {},
        createdAt: plan.createdAt,
        segments: plan.segments.map(segment => ({
          id: segment.id,
          prompt: segment.prompt,
          ...segment.assetIds !== undefined ? { assetIds: [...segment.assetIds] } : {},
          ...segment.continuity !== undefined ? { continuity: segment.continuity } : {},
          ...segment.startState !== undefined ? { startState: segment.startState } : {},
          ...segment.event !== undefined ? { event: segment.event } : {},
          ...segment.endState !== undefined ? { endState: segment.endState } : {},
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
    description: 'Generate the anchor images for plan assets that need them. The agent analyzes the story and reference material before this call and stores the resulting character identity prompt in asset.prompt; the user does not hand-write image prompts. A character gets exactly one 16:9 four-column design image: front, side, and back full-body views (head to shoes visible), plus a face close-up. Single-subject keyframes use a crop of its front column, never a second generated identity. Scenes get a reusable establishing shot without people; props get a neutral reference image. Existing character portraits without a four-column design are upgraded using the portrait as identity reference. Images are saved under outputDir/assets and recorded on the plan; pass regenerate with a new seed to try another take. No separate turnaround file is generated; the four views share one image.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      asset_ids: { type: 'array', items: { type: 'string' }, description: 'Asset ids to generate; defaults to missing references and characters without a four-column design. Existing character portraits condition their replacement design.' },
      regenerate: {
        type: 'boolean',
        description: 'Regenerate the selected assets even when they already carry a reference image, replacing it on the plan.',
      },
      seed: {
        type: 'integer',
        description: 'Image seed for reproducible designs; omit to draw a fresh one, which is what makes regenerate produce another take.',
      },
    },
    output: imageOutput(ASSET_IMAGE_VALUE_SCHEMA, assetImageContent),
    async execute(args, exec) {
      const outputDir = ctx.h3Video.outputDir
      const prior = await readPlan(outputDir, args.plan_id)
      const allAssets = prior.assets ?? []
      const assetIds = args.asset_ids
      const scoped = assetIds === undefined ? allAssets : allAssets.filter(asset => assetIds.includes(asset.id))
      const regenerate = args.regenerate === true
      const needsWork = (asset: PlanAsset): boolean => regenerate || asset.reference === undefined
        || (asset.kind === 'character' && asset.referenceLayout !== 'four-column')
      const selected = scoped.filter(needsWork)
      const results: Array<{
        assetId: string
        name: string
        kind: string
        image?: string
        attachment?: ImageAttachmentRef
        sheet?: string
        sheetAttachment?: ImageAttachmentRef
        state: 'generated' | 'skipped' | 'failed'
        error?: string
      }> = []
      const assets: PlanAsset[] = [...allAssets]
      // One draw path for the run: the same plan seed and the same cancellation signal.
      const drawImage = (prompt: string, ratio: '16:9' | '1:1', subjectReference?: string): Promise<string> =>
        ctx.h3Video.keyframe({
          prompt, ratio,
          ...(subjectReference !== undefined ? { subjectReference } : {}),
          ...(args.seed !== undefined ? { seed: args.seed } : {}),
        }, exec.signal)
      for (const asset of selected) {
        let reference = asset.reference
        let attachment: ImageAttachmentRef | undefined
        let failure: string | undefined
        try {
          reference = await commitAssetImage(
            await drawImage(
              asset.kind === 'character'
                ? buildCharacterReferencePrompt(asset, prior.style)
                : buildStillPrompt(asset, prior.style),
              asset.kind === 'prop' ? '1:1' : '16:9',
              asset.kind === 'character' && asset.referenceLayout !== 'four-column' ? asset.reference : undefined,
            ),
            outputDir,
            prior.id,
            asset.id,
          )
          attachment = await saveImageAttachment(ctx, reference)
        } catch (error: unknown) {
          failure = errorText(error)
        }
        results.push({
          assetId: asset.id,
          name: asset.name,
          kind: asset.kind,
          ...(asset.kind === 'character' && failure === undefined ? { referenceLayout: 'four-column' as const } : {}),
          ...(failure === undefined && reference !== undefined ? { image: reference } : {}),
          ...(attachment !== undefined ? { attachment } : {}),
          state: failure === undefined ? 'generated' : 'failed',
          ...(failure !== undefined ? { error: failure } : {}),
        })
        const index = assets.findIndex(candidate => candidate.id === asset.id)
        const current = index !== -1 ? assets[index] : undefined
        if (current !== undefined && failure === undefined) {
          const copied = copyAsset(current)
          const nextAsset = asset.kind === 'character'
            ? (({ sheet: _legacySheet, ...withoutLegacySheet }) => withoutLegacySheet)(copied)
            : copied
          assets[index] = {
            ...nextAsset,
            ...(reference !== undefined ? { reference } : {}),
            ...(asset.kind === 'character' ? { referenceLayout: 'four-column' as const } : {}),
          }
        }
      }
      const skipped = scoped.filter(asset => !selected.includes(asset))
      if (skipped.length > 0) {
        results.push(...skipped.map(asset => ({ assetId: asset.id, name: asset.name, kind: asset.kind, state: 'skipped' as const })))
      }
      if (assets.length > 0) {
        await writePlan(outputDir, { ...prior, assets })
        await saveLibraryAssets(outputDir, assets.filter(asset => asset.reference !== undefined))
      }
      const generatedCount = results.filter(result => result.state === 'generated').length
      const failedCount = results.filter(result => result.state === 'failed').length
      const notice = `generated ${generatedCount} asset image(s) for plan ${prior.id}${failedCount > 0 ? `, ${failedCount} failed` : ''}`
      return { planId: prior.id, assets: results, notice }
    },
    presentCall: args => presentCall('Generate asset images', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_library',
    description: 'List the project asset library: characters, scenes, and props confirmed in earlier plans, each with its canonical prompt block and reference image. Legacy turnaround fields may still be listed for older records, but new runs have one reference image per character. Attach one to a new plan with video_plan library_assets instead of redefining it.',
    parameters: {},
    output: jsonOutput(LIBRARY_VALUE_SCHEMA),
    async execute() {
      const assets = await readLibrary(ctx.h3Video.outputDir)
      const listed = assets.map(asset => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...(asset.description !== undefined ? { description: asset.description } : {}),
        ...(asset.prompt !== undefined ? { prompt: asset.prompt } : {}),
        ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
        ...(asset.sheet !== undefined ? { sheet: asset.sheet } : {}),
        ...(asset.referenceLayout !== undefined ? { referenceLayout: asset.referenceLayout } : {}),
      }))
      const notice = listed.length === 0
        ? `the project asset library at ${libraryPath(ctx.h3Video.outputDir)} is empty`
        : `${listed.length} saved asset(s) in the project library`
      return { assets: listed, notice }
    },
    presentCall: () => presentCall('Project asset library'),
  }))

  ctx.tools.register(defineTool({
    name: 'video_render',
    description: 'Submit the complete multi_shot story once, using its opening first_frame or generated opening still; missing opening images fail before submission. Later stills are previews. multi_shot rejects segment_ids and chain=true. per_segment submits selected independent shots and supports chaining. Returns background job ids; collect results with job_output. Local submission boots the configured cloud GPU when needed.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      segment_ids: { type: 'array', items: { type: 'string' }, description: 'per_segment only: shot ids to render; defaults to every shot. Omit for multi_shot.' },
      backend: { type: 'string', enum: ['local', 'remote', 'auto'], description: 'Backend override for all selected segments.' },
      allow_remote: {
        type: 'boolean',
        description: 'Confirm that the user agreed to pay for hosted-API seconds. Required when the selected segments would render remote; the refusal names them and their total seconds.',
      },
      chain: {
        type: 'boolean',
        description: 'per_segment only: render serially and use the previous clip final frame for the next shot. This carries the picture across tasks but does not validate story continuity. Omit for multi_shot.',
      },
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
        validateContinuity(plan.segments, plan.assets ?? [])
        if (args.segment_ids !== undefined || args.chain === true) {
          throw new Error('multi_shot renders the complete storyboard once; omit segment_ids and chain, or use per_segment')
        }
        const first = plan.segments[0]
        if (first === undefined) throw new Error(`plan ${plan.id} has no segments`)
        const total = plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
        const combined: VideoSegment = {
          ...first,
          id: 'all',
          prompt: buildMultiShotPrompt(plan),
          durationSeconds: total,
        }
        const backend = args.backend ?? first.backend
        requireRemoteConsent(paidExposure([combined], args.backend), args.allow_remote === true)
        try {
          const { target, ref } = await ctx.h3Video.submit(
            backend,
            buildMultiShotRequest(plan, outputDir),
            exec.signal,
          )
          const jobId = ctx.jobs.start({
            kind: 'h3-video',
            label: `render ${plan.id}/multi-shot`,
            owner: agent.id,
            outputLimitBytes: 4000,
            run: () => renderJobHooks(ctx, plan.id, combined, target, ref),
          })
          submissions.push({ segmentId: 'all', backend, resolved: target.choice, taskRef: String(ref), jobId, state: 'submitted' })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          submissions.push({ segmentId: 'all', backend, state: 'failed', error: message })
        }
      } else {
        validateContinuity(plan.segments, plan.assets ?? [])
        const selected = args.segment_ids === undefined
          ? plan.segments
          : args.segment_ids.map((id) => {
            const segment = plan.segments.find(candidate => candidate.id === id)
            if (segment === undefined) throw new Error(`plan ${plan.id} has no segment ${JSON.stringify(id)}`)
            return segment
          })
        for (const segment of selected) {
          const position = plan.segments.indexOf(segment)
          if (segment.continuity !== 'continue' || position === 0) continue
          const previous = plan.segments[position - 1]
          const selectedPosition = selected.indexOf(segment)
          if (args.chain !== true || selectedPosition === 0 || selected[selectedPosition - 1] !== previous) {
            throw new Error(`segment ${segment.id} continues ${previous?.id}; render the predecessor and this shot together in storyboard order with chain=true`)
          }
        }
        requireRemoteConsent(paidExposure(selected, args.backend), args.allow_remote === true)
        requireCharacterAnchors(selected, plan)
        if (args.chain === true) {
          // One job for the whole chain: each shot waits for its predecessor's final frame, which is
          // what makes the sequence continuous instead of a set of unrelated clips.
          const jobId = ctx.jobs.start({
            kind: 'h3-video',
            label: `render ${plan.id}/chain`,
            owner: agent.id,
            outputLimitBytes: 8000,
            run: () => chainJobHooks(ctx, plan, selected, args.backend),
          })
          for (const segment of selected) {
            submissions.push({
              segmentId: segment.id,
              backend: args.backend ?? segment.backend,
              taskRef: jobId,
              jobId,
              state: 'submitted',
            })
          }
          return {
            planId: plan.id,
            submissions,
            notice: `chained render of ${selected.length} shot(s) queued as job ${jobId}: each shot starts from the previous shot's final frame`,
          }
        }
        for (const segment of selected) {
          const backend = args.backend ?? segment.backend
          try {
            const { target, ref } = await ctx.h3Video.submit(
              backend,
              buildSegmentRequest(
                segment,
                plan,
                imageArtifactBase(keyframesDir(outputDir), plan.id, segment.id),
              ),
              exec.signal,
            )
            const jobId = ctx.jobs.start({
              kind: 'h3-video',
              label: `render ${plan.id}/${segment.id}`,
              owner: agent.id,
              outputLimitBytes: 4000,
              run: () => renderJobHooks(ctx, plan.id, segment, target, ref),
            })
            submissions.push({ segmentId: segment.id, backend, resolved: target.choice, taskRef: String(ref), jobId, state: 'submitted' })
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
    description: 'Assemble rendered segments in storyboard order. Per-segment plans use a short crossfade by default, overlapping pictures and sound; choose cut for a direct join or dip for a scene change. Fails listing any segment that has not been rendered yet.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Plan id from video_plan.' },
      output_file: { type: 'string', description: 'Absolute output mp4 path; defaults to outputDir/final/<planId>.mp4.' },
      ffmpeg_path: { type: 'string', description: 'ffmpeg executable; defaults to ffmpeg on PATH.' },
      transition: {
        type: 'string',
        enum: ['cut', 'dip', 'crossfade'],
        description: 'Defaults to crossfade: overlap adjacent pictures and audio. cut joins directly; dip fades through black. Only per_segment assembly applies transitions.',
      },
      transition_seconds: { type: 'number', description: 'Positive overlap duration for crossfade (default 0.4s), or dip half-width (default 0.25s). Capped at half of either adjacent clip. Crossfades shorten the total by their overlaps.' },
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
      const transition = resolveAssemblyTransition(args)
      await ctx.h3Video.assemble(
        files.map(file => ({ file })),
        {
          outputFile,
          ...args.ffmpeg_path !== undefined ? { ffmpegPath: args.ffmpeg_path } : {},
          transition,
          durations: plan.segments.map(segment => segment.durationSeconds),
          signal: exec.signal,
        },
      )
      let overlap = 0
      let previous: VideoSegment | undefined
      for (const segment of plan.segments) {
        if (previous !== undefined && transition.kind === 'crossfade') {
          overlap += Math.min(transition.seconds, previous.durationSeconds / 2, segment.durationSeconds / 2)
        }
        previous = segment
      }
      return { planId: plan.id, outputFile, segments: files, durationSeconds: total - overlap }
    },
    presentCall: args => presentCall('Assemble final video', args.plan_id),
  }))

  ctx.tools.register(defineTool({
    name: 'video_gpu',
    description: 'Manage the cloud GPU instance behind the local H3 backend. status reports it, up boots or reuses it and waits until ComfyUI answers, stop powers it off keeping its disk, and release deletes it. GPU time is billed while the instance runs; a local render boots it implicitly and the configured idle policy stops or releases it after the last segment settles.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'up', 'stop', 'release'],
        description: 'status: report the instance; up: boot or reuse it and wait for ComfyUI; stop: power it off; release: delete it.',
      },
    },
    output: jsonOutput(GPU_STATUS_SCHEMA),
    async execute(args) {
      const action: GpuAction = args.action
      let status: GpuStatus
      if (action === 'status') status = await ctx.h3Video.gpuStatus()
      else if (action === 'up') status = await ctx.h3Video.gpuUp()
      else status = await ctx.h3Video.gpuDown(action === 'release' ? 'release' : 'stop')
      return { ...status, notice: gpuNotice(action, status) }
    },
    presentCall: args => presentCall('Cloud GPU instance', args.action),
  }))

  // Direct human entry point: `/video <description>` queues one user turn that drives the
  // plan → render → assemble → present pipeline through the model-facing tools.
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-tool-video'),
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
            + STORYBOARD_WORKFLOW_GUIDANCE + '\n'
            + '1) ≤15 秒短片优先 mode=multi_shot，一次生成完整故事；不按时长固定拆镜，15 秒可用一个连续长镜头；确需切镜时按剧情分配时长，仍合并为一次 H3 任务；只有需要真实尾帧链、独立 closing frame、不同素材或不同路由时才用 per_segment。默认一位主角、一个地点、连续时间，长镜头内按顺序推进动作。用 video_plan 保存素材 id 与分镜，每镜含 prompt、asset_ids、start_state、event、end_state、duration_seconds、resolution、ratio、backend，第二镜起声明 continuity。逐镜审查上一镜 end_state 与下一镜 start_state，避免重复动作、道具换手和无解释跳时空；程序只校验字段与素材引用，不判断剧情语义；'
            + '2) 先由导演智能体自动分析剧情和已有参考图中的角色身份：把年龄感、职业与生活状态、体型、脸型、发型、妆感、眼神、嘴角/表情、服装、鞋子、配饰和姿态改写为可观察的 asset.prompt，并根据该角色的剧情要求写明负面约束，禁止与设定相反的年龄感、脸型、表情、服装或比例；不要把某个角色的冷感或疲惫套给所有角色。角色提示词由智能体编写，用户只需描述剧情和人物，无需手写提示词；已有参考图要继承稳定身份特征，只补足全身构图并修正与剧情冲突的表现。复用素材库角色时也要调用 video_asset_images 补全未标记 four-column 的旧单视图；不能因已有 reference 就跳过。记录或生成角色/场景/道具素材，展示分镜与成本。用 video_keyframes 默认只生成开场图，画第一镜 start_state、事件尚未发生；展示并确认画面。后续镜头图片仅是分镜预览，不会分别约束整片。用户提供开场图时放在第一镜 references 的 first_frame；生成角色图后逐项检查年龄、脸型、眼神、表情、服装、鞋子和全身完整性，不符合就用 regenerate 重抽；'
            + '3) 确认分镜与开场图后用 video_render 渲染整片，不传 segment_ids 或 chain。multi_shot 统一后端/分辨率/比例，不能附加后续镜头参考素材；确需逐镜材料或独立路由才用 per_segment。用 job_output 等待完成；配置了云 GPU 时可先用 video_gpu action=up 确认实例就绪；'
            + '4) 全部成功后 video_assemble 拼接成片，最后用 present 交付。\n'
            + 'H3 音画同生（视频与音频同一次生成），写分镜 prompt 时要声明声音层：'
            + '写清环境声与音效（overall_soundscape）；有中文对白时逐字写进 <d>[Chinese] 台词</d>，时长要容得下台词；'
            + '不要配乐时显式写 non_diegetic_music: N/A（留空易出多余配乐），无对白镜头也要写环境声或静默。\n'
            + '本地失败时不得静默转远端 API：先说明失败原因并询问用户（远端按秒计费）后再用 remote。',
        }],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: `已收到视频请求，开始处理：${text}` }
    },
  })
}
