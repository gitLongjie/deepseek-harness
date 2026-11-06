/** Image-generation catalog models: one images-endpoint request per turn, answered as an assistant image. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, LlmError, LlmRuntime } from '@deepseek-ai/dsh-llm'
import ImageRuntime from '@deepseek-ai/dsh-image'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import AttachmentStore, { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,

  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as Deepagens from '../src/index.ts'
import { DeepSeekAdapter } from '../src/adapter.ts'
import { resolveAdapterOptions } from '../src/config.ts'
import { DeepSeekFileStore } from '../src/common/file-store.ts'
import { serializeRequestWithImages } from '../src/protocols/chat-completions/serialize.ts'

const BASE_URL = 'https://gateway.test/v1'
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const GENERATED: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: PNG.length,
  width: 1024,
  height: 1024,
  name: 'gpt-image-2.png',
}

class RecordingAttachments extends AttachmentStore {
  readonly saved: SaveImageAttachment[] = []
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 4096,
    maxImagePixels: 4_194_304,
    maxImageDimension: 2048,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return Promise.resolve(GENERATED)
  }

  readImage(ref: ImageAttachmentRef, _signal?: AbortSignal): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref, data: PNG })
  }

  override readImageRequest(ref: ImageAttachmentRef, _target: ImageRequestTarget, _signal?: AbortSignal): Promise<RequestImageAttachment> {
    return Promise.resolve({
      variantId: ImageVariantId(`sha256:${'d'.repeat(64)}`),
      attachment: ref,
      data: PNG,
      mediaType: ref.mediaType,
      bytes: PNG.length,
      width: ref.width,
      height: ref.height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: false,
    })
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface LlmRequestPurposeMap {
    'session-title': true
  }
}

interface Captured { url: string; init?: RequestInit }

function attachmentStore(): RecordingAttachments {
  return new RecordingAttachments(new Context())
}

function adapter(attachments: AttachmentStore | 'unmounted' = attachmentStore()): DeepSeekAdapter {
  const options = resolveAdapterOptions({
    protocol: 'chat-completions',
    baseURL: BASE_URL,
    models: [
      { id: 'gpt-image-2', inputModalities: ['text', 'image'], endpoint: 'image-generation' },
      { id: 'chat-model', inputModalities: ['text', 'image'] },
    ],
  })
  return new DeepSeekAdapter({
    options: () => options,
    resolveApiKey: () => Promise.resolve('sk-test'),
    resolveUserId: () => 'user-1' as AnonymousUserId,
    resolveAttachments: () => attachments === 'unmounted' ? undefined : attachments,
    resolveFiles: () => new DeepSeekFileStore(),
    prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  })
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'deepagens',
    model: 'gpt-image-2',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '生成一张海湾图片' }] })],
    tools: [{ name: 'read', description: 'Read a file', parameters: {} }],
    ...overrides,
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function stubFetch(...responses: Response[]): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    captured.push({ url, ...init === undefined ? {} : { init } })
    const next = responses.shift()
    if (next === undefined) throw new Error(`unexpected fetch ${url}`)
    return Promise.resolve(next)
  }))
  return captured
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image-generation catalog models', () => {
  it('sends the latest user text to the images endpoint and answers with one stored image block', async () => {
    const attachments = attachmentStore()
    const captured = stubFetch(Response.json({
      data: [{ b64_json: Buffer.from(PNG).toString('base64') }],
      usage: { input_tokens: 12, output_tokens: 4160, total_tokens: 4172 },
    }))

    const chunks = await collect(adapter(attachments).stream(request()))

    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe(`${BASE_URL}/images/generations`)
    const body = captured[0]?.init?.body
    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({ model: 'gpt-image-2', prompt: '生成一张海湾图片', n: 1 })
    expect(captured[0]?.init?.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    expect(attachments.saved).toEqual([{ data: Buffer.from(PNG), mediaType: 'image/png', name: 'gpt-image-2.png' }])
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'image' },
      { type: 'block-end', index: 0, block: { type: 'image', attachment: GENERATED } },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 4160, totalTokens: 4172 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('downloads a url-encoded result without sending the API credential', async () => {
    const captured = stubFetch(
      Response.json({ data: [{ url: 'https://cdn.test/bay.png' }] }),
      new Response(PNG),
    )

    const chunks = await collect(adapter().stream(request()))

    expect(captured[1]?.url).toBe('https://cdn.test/bay.png')
    expect(captured[1]?.init?.headers).toBeUndefined()
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('maps a provider rejection to its LlmError code and message', async () => {
    stubFetch(Response.json(
      { error: { message: 'prompt: Field required', type: 'invalid_request_error', code: 'invalid_value' } },
      { status: 400 },
    ))

    await expect(collect(adapter().stream(request()))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'prompt: Field required',
    })
  })

  it('refuses auxiliary purposes and reference images before any request', async () => {
    const captured = stubFetch()
    const withImage = createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: 'make it sunset' },
      { type: 'image', attachment: GENERATED },
    ] })

    await expect(collect(adapter().stream(request({ purpose: 'session-title' }))))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(collect(adapter().stream(request({ messages: [withImage] }))))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(collect(adapter('unmounted').stream(request()))).rejects.toBeInstanceOf(LlmError)
    expect(captured).toEqual([])
  })

  it('refuses an image-free response body as malformed', async () => {
    stubFetch(Response.json({ data: [] }))

    await expect(collect(adapter().stream(request()))).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})

describe('the deepagens ctx.image provider', () => {
  async function mount(config: Record<string, unknown>): Promise<Context> {
    const home = await mkdtemp(join(tmpdir(), 'dsh-deepagens-image-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DEEPAGENS_API_KEY', 'sk-gateway')
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ImageRuntime)
    await ctx.plugin(Deepagens, { protocol: 'chat-completions', baseURL: BASE_URL, models: [], ...config })
    return ctx
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('generates through the configured imageModel with the gateway credential', async () => {
    const ctx = await mount({ imageModel: 'gpt-image-2' })
    const captured = stubFetch(Response.json({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }] }))

    const image = await ctx.image.generate({ prompt: 'a quiet bay' }, new AbortController().signal)

    expect(image).toEqual({ data: Buffer.from(PNG), mediaType: 'image/png', model: 'gpt-image-2' })
    expect(captured[0]?.url).toBe(`${BASE_URL}/images/generations`)
    const body = captured[0]?.init?.body
    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({ model: 'gpt-image-2', prompt: 'a quiet bay', n: 1 })
    expect(captured[0]?.init?.headers).toMatchObject({ authorization: 'Bearer sk-gateway' })
    expect(captured[0]?.init?.headers).not.toHaveProperty('x-deepseek-harness-session-id')
  })

  it('stays unavailable until imageModel is configured', async () => {
    const ctx = await mount({})
    await expect(ctx.image.generate({ prompt: 'a quiet bay' })).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_UNAVAILABLE' })
  })

  it('rejects an empty imageModel and a Messages-protocol imageModel at load', () => {
    expect(() => resolveAdapterOptions({ protocol: 'chat-completions', imageModel: '' }))
      .toThrow('llm-deepagens: imageModel must be non-empty when present')
    expect(() => resolveAdapterOptions({ protocol: 'messages', imageModel: 'gpt-image-2' }))
      .toThrow('llm-deepagens: imageModel requires the chat-completions protocol')
    expect(resolveAdapterOptions({ protocol: 'chat-completions', imageModel: 'gpt-image-2' }).imageModel).toBe('gpt-image-2')
  })
})

describe('assistant images in chat-completions history', () => {
  it('follow their assistant turn as one user message', async () => {
    const generated = createAssistantMessage({
      content: [{ type: 'image', attachment: GENERATED }],
      source: { provider: 'deepagens', model: 'gpt-image-2' },
    })
    const options = request({
      model: 'chat-model',
      messages: [
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '生成一张海湾图片' }] }),
        generated,
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '描述这张图' }] }),
      ],
    })
    const version = await attachmentStore().readImageRequest(GENERATED, { width: 1024, height: 1024, maxBytes: 1024 })

    const body = await serializeRequestWithImages(options, {
      representation: { kind: 'base64' },
      requestImages: new Map([[GENERATED.attachmentId, version]]),
      maxRequestImageBytes: 1024,
    })

    expect(body.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'user'])
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '' })
    const images = body.messages[2]
    expect(images?.role).toBe('user')
    expect(Array.isArray(images?.content) && images.content[0]).toEqual({
      type: 'text',
      text: 'Image(s) generated in the previous assistant turn:',
    })
    expect(Array.isArray(images?.content) && images.content.at(-1)).toMatchObject({ type: 'image_url' })
  })
})
