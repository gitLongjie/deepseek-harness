/**
 * The model-facing `generate_image` tool: one text prompt becomes one image generated through
 * `ctx.image`, committed to the durable attachment store, and returned as an image block beside
 * a text envelope. The block both shows the image to the user and lets the calling model inspect
 * it, so the tool refuses before generation when the calling route does not declare image input.
 * @module @deepseek-ai/dsh-tool-image
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-image'

export const name = 'tool-image'
export const inject = ['tools', 'image', 'attachments']

/** Default cooperative budget for one generation; image backends commonly take 20–60 s. */
const DEFAULT_TIMEOUT_MS = 180_000

/** Plugin configuration. */
export interface Config {
  /** Cooperative timeout budget (ms) for one `generate_image` call. Defaults to 180000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS)
    .description('Cooperative timeout budget (ms) for one generate_image call.'),
})

const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const satisfies readonly ImageMediaType[]

/** The structured outcome declared by the `generate_image` output schema. */
export interface GeneratedImageValue {
  /** Backend model that produced the image, when the provider reports it. */
  model?: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

/**
 * Re-brand the structured image outcome into the attachment reference an `ImageBlock` carries.
 * @param image - the image metadata from the output schema.
 * @returns the branded attachment reference.
 */
function imageRef(image: GeneratedImageValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Display label for the image card. Generated images are not workspace files; the
 * client image card still requires a `<path>` envelope (same contract as
 * `read_image` / video materials) so the gallery renders instead of flattening
 * the image block to JSON.
 * @param value - the generation outcome.
 * @returns a stable label, preferring the stored attachment name.
 */
export function generatedImageLabel(value: GeneratedImageValue): string {
  return value.image.name ?? 'generated-image.png'
}

/**
 * Format the model-facing envelope beside the generated image block.
 * The `<path>` / `<type>` / `<content>` layout must match the client image-card
 * envelope so the tool row shows the gallery rather than a path-only fallback.
 * @param value - the generation outcome.
 * @returns the envelope text; the image itself rides the adjacent image block.
 */
export function formatGeneratedImageOutput(value: GeneratedImageValue): string {
  const by = value.model === undefined ? '' : ` by ${value.model}`
  return `<path>${generatedImageLabel(value)}</path>
<type>image</type>
<content>
Generated${by} and shown to the user: ${value.image.mediaType} image, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes
</content>`
}

/**
 * Project one generation outcome into its model-facing content.
 * @param value - the generation outcome.
 * @returns the envelope text block followed by the image block.
 */
function generatedImageContent(value: GeneratedImageValue): ContentBlock[] {
  return [
    { type: 'text', text: formatGeneratedImageOutput(value) },
    { type: 'image', attachment: imageRef(value.image) },
  ]
}

/**
 * Refuse unless the calling route declares image input; a text-only route would reject the
 * next model request that carries the generated image.
 * @param ctx - context used to resolve the optional `llm` service.
 * @param exec - the tool execution supplying the calling agent.
 */
async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('cannot generate an image: the current model route could not be resolved')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities?.includes('image') !== true) {
    throw new Error(`cannot generate an image: model "${model}" does not declare image input; switch to an image-capable model to generate images`)
  }
}

/**
 * Register `generate_image`. Registration is effect-scoped and unregisters on plugin dispose.
 * @param ctx - context with `tools`, `image`, and `attachments` mounted.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('tool-image: timeoutMs must be a positive integer')
  }
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate one image from a text description and show it to the user in the tool result. '
      + 'Write a complete visual prompt: subject, composition, style, lighting, colors, and any text that must appear in the image. '
      + 'Each call produces a new image; to change a result, call again with a revised prompt. '
      + 'Do not paste attachment filesystem paths; the user already sees the image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete visual description of the image to generate.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', description: 'Backend model that produced the image.' },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: MEDIA_TYPES, required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => generatedImageContent(value),
      // The client image card reads this path as the gallery label. The
      // attachment reference stays only in the content image block.
      presentationMeta: (_args, value) => ({ path: generatedImageLabel(value) }),
    },
    timeoutMs,
    // Each call is an independent backend request plus an idempotent content-addressed write.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt.length === 0) throw new Error('prompt must be a non-empty string')
      await assertImageCapableRoute(ctx, exec)
      const generated = await ctx.image.generate({ prompt }, exec.signal)
      const mediaType = MEDIA_TYPES.find(type => type === generated.mediaType)
      if (mediaType === undefined) {
        throw new Error(`the image provider returned unsupported media type ${generated.mediaType}`)
      }
      let ref: ImageAttachmentRef
      try {
        ref = await ctx.attachments.saveImage({ data: generated.data, mediaType, name: `generated-image.${mediaType.slice('image/'.length)}` })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError)) throw error
        throw new Error(`the generated image could not be stored: ${error.message}`, { cause: error })
      }
      const value: GeneratedImageValue = {
        ...generated.model === undefined ? {} : { model: generated.model },
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
      return value
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: 'Generate image', kind: 'other', rawInput: args.prompt }
    },
  }))
}
