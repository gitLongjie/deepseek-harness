/**
 * The `generate_image` tool over the real tool pipeline, `ctx.image` seam, and local attachment
 * store: durable commit plus image-block rendering, the image-input route gate, prompt and media
 * type validation, attachment failures, configuration, presentation, and dispose behavior.
 */
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import ImageRuntime, { type GeneratedImage, type ImageGenerationRequest } from '@deepseek-ai/dsh-image'
import * as ToolImage from '@deepseek-ai/dsh-tool-image'
import { formatGeneratedImageOutput, generatedImageLabel } from '@deepseek-ai/dsh-tool-image'

/** The client image-card envelope; keep generate_image results matching it. */
const IMAGE_ENVELOPE = /^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*\n<\/content>$/u

/** 1x1 red PNG. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly models: LlmModelInfo[]) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const resolved = this.models.find(candidate => candidate.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...resolved?.inputModalities === undefined ? {} : { inputModalities: [...resolved.inputModalities] },
    })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('generate_image tests never stream')
  }
}

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-tool-image-home-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

interface Generation {
  requests: ImageGenerationRequest[]
  signals: (AbortSignal | undefined)[]
}

interface SetupOptions {
  result?: GeneratedImage
  attachments?: typeof LocalAttachmentStore
  llm?: boolean
  toolImage?: ToolImage.Config
}

async function setup(options: SetupOptions = {}): Promise<{ ctx: Context; generation: Generation }> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(options.attachments ?? LocalAttachmentStore, { dshHome: home })
  if (options.llm !== false) {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['visual'], new CatalogAdapter([
      { provider: 'visual', id: 'vision-model', name: 'Vision', inputModalities: ['text', 'image'] },
      { provider: 'visual', id: 'text-model', name: 'Text', inputModalities: ['text'] },
    ]))
  }
  await ctx.plugin(ImageRuntime)
  const generation: Generation = { requests: [], signals: [] }
  ctx.image.register({
    id: 'fake',
    available: () => true,
    generate: (request, signal) => {
      generation.requests.push(request)
      generation.signals.push(signal)
      return Promise.resolve(options.result ?? { data: PNG_1X1, mediaType: 'image/png', model: 'image-model' })
    },
  })
  await ctx.plugin(ToolImage, options.toolImage ?? {})
  return { ctx, generation }
}

function agentOn(model: string | undefined, provider = 'visual'): object {
  return {
    options: {},
    session: {
      header: { cwd: home },
      requestHeader: () => (model === undefined ? undefined : { config: { provider, model } }),
      deriveMessages: () => [],
      append: () => undefined,
    },
  }
}

let callCounter = 0
const signal = new AbortController().signal

function generate(ctx: Context, args: unknown, agent: object | undefined = agentOn('vision-model')) {
  return executeToolFixture(ctx, {
    signal,
    callId: ToolCallId(`gen-${++callCounter}`),
    name: 'generate_image',
    arguments: args,
    ...agent ? { agent: agent as never } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('generate_image', () => {
  it('generates through ctx.image, commits the image, and renders the envelope beside an image block', async () => {
    const { ctx, generation } = await setup()
    const result = await generate(ctx, { prompt: '  a quiet bay at dawn  ' })

    expect(result.isError).toBe(false)
    expect(generation.requests).toEqual([{ prompt: 'a quiet bay at dawn' }])
    expect(generation.signals[0]).toBeInstanceOf(AbortSignal)
    expect(result.content).toHaveLength(2)
    const image = result.content[1] as { type: string; attachment: ImageAttachmentRef }
    expect(image.type).toBe('image')
    expect(image.attachment).toMatchObject({ mediaType: 'image/png', width: 1, height: 1, bytes: PNG_1X1.length, name: 'generated-image.png' })
    const value = {
      model: 'image-model',
      image: {
        attachmentId: image.attachment.attachmentId,
        mediaType: 'image/png' as const,
        bytes: PNG_1X1.length,
        width: 1,
        height: 1,
        name: 'generated-image.png',
      },
    }
    expect(text(result)).toBe(formatGeneratedImageOutput(value))
    expect(text(result)).toMatch(IMAGE_ENVELOPE)
    expect(generatedImageLabel(value)).toBe('generated-image.png')
    expect(ctx.tools.get('generate_image')?.output.presentationMeta?.({ prompt: 'a quiet bay at dawn' }, value))
      .toEqual({ path: 'generated-image.png' })
    const stored = await ctx.attachments.readImage(image.attachment)
    expect(Buffer.from(stored.data)).toEqual(PNG_1X1)
  })

  it('omits the model from the envelope when the provider does not report it', async () => {
    const { ctx } = await setup({ result: { data: PNG_1X1, mediaType: 'image/png' } })
    const result = await generate(ctx, { prompt: 'a bay' })
    expect(result.isError).toBe(false)
    expect(text(result)).toMatch(IMAGE_ENVELOPE)
    expect(text(result)).toContain('Generated and shown to the user: image/png image, 1x1 px')
  })

  it('refuses a blank prompt before generation', async () => {
    const { ctx, generation } = await setup()
    const result = await generate(ctx, { prompt: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('prompt must be a non-empty string')
    expect(generation.requests).toEqual([])
  })

  it('refuses a text-only calling route before generation', async () => {
    const { ctx, generation } = await setup()
    const result = await generate(ctx, { prompt: 'a bay' }, agentOn('text-model'))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('model "text-model" does not declare image input')
    expect(generation.requests).toEqual([])
  })

  it('refuses when the calling route cannot be resolved', async () => {
    const { ctx: noAgent } = await setup()
    expect(text(await generate(noAgent, { prompt: 'a bay' }, agentOn(undefined)))).toContain('the current model route could not be resolved')
    const { ctx: noLlm } = await setup({ llm: false })
    expect(text(await generate(noLlm, { prompt: 'a bay' }))).toContain('the current model route could not be resolved')
  })

  it('refuses an unsupported provider media type', async () => {
    const { ctx } = await setup({ result: { data: PNG_1X1, mediaType: 'image/bmp' } })
    const result = await generate(ctx, { prompt: 'a bay' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unsupported media type image/bmp')
  })

  it('reports an attachment admission failure as a storage error', async () => {
    class RefusingStore extends LocalAttachmentStore {
      override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new AttachmentError('image is too large', 'IMAGE_TOO_LARGE'))
      }
    }
    const { ctx } = await setup({ attachments: RefusingStore })
    const result = await generate(ctx, { prompt: 'a bay' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the generated image could not be stored: image is too large')
  })

  it('propagates other attachment failures unchanged', async () => {
    class BrokenStore extends LocalAttachmentStore {
      override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error('disk offline'))
      }
    }
    const { ctx } = await setup({ attachments: BrokenStore })
    const result = await generate(ctx, { prompt: 'a bay' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('disk offline')
    expect(text(result)).not.toContain('could not be stored')
  })

  it('attaches the configured timeout and presents a generic call card', async () => {
    const { ctx } = await setup({ toolImage: { timeoutMs: 90_000 } })
    const tool = ctx.tools.get('generate_image')
    expect(tool?.timeoutMs).toBe(90_000)
    expect(tool?.isConcurrencySafe?.({ prompt: 'a bay' })).toBe(true)
    expect(tool?.presentCall?.({ prompt: 'a bay' })).toEqual({ card: 'generic', title: 'Generate image', kind: 'other', rawInput: 'a bay' })
  })

  it('defaults the timeout and rejects a non-positive configured timeout', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('generate_image')?.timeoutMs).toBe(180_000)
    expect(() => ToolImage.apply(ctx, { timeoutMs: 0 })).toThrow('tool-image: timeoutMs must be a positive integer')
  })

  it('unregisters the tool when the plugin is disposed', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await ctx.plugin(ImageRuntime)
    const fiber = await ctx.plugin(ToolImage)
    expect(ctx.tools.get('generate_image')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('generate_image')).toBeUndefined()
  })
})
