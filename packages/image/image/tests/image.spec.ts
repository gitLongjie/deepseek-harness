import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ImageRuntime, { type GeneratedImage, type ImageGenerationProvider, type ImageGenerationRequest } from '@deepseek-ai/dsh-image'

const available = true
const unavailable = false

function image(marker: string): GeneratedImage {
  return { data: new TextEncoder().encode(marker), mediaType: 'image/png' }
}

function makeProvider(id: string, isAvailable: boolean, seen: ImageGenerationRequest[] = []): ImageGenerationProvider {
  return {
    id,
    available: () => isAvailable,
    generate: (request) => {
      seen.push(request)
      return Promise.resolve(image(id))
    },
  }
}

async function mountImage(config: { provider?: string } = {}): Promise<{ ctx: Context; image: ImageRuntime }> {
  const ctx = new Context()
  await ctx.plugin(ImageRuntime, config)
  return { ctx, image: ctx.image }
}

function decoded(result: GeneratedImage): string {
  return new TextDecoder().decode(result.data)
}

describe('ImageRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { image } = await mountImage()
    const seen: ImageGenerationRequest[] = []
    const dispose = image.register(makeProvider('gateway', available, seen))

    const signal = new AbortController().signal
    expect(decoded(await image.generate({ prompt: 'a bay' }, signal))).toBe('gateway')
    expect(seen).toEqual([{ prompt: 'a bay' }])

    dispose()
    await expect(image.generate({ prompt: 'a bay' })).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_UNAVAILABLE' }))
  })

  it('throws IMAGE_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { image } = await mountImage()
    image.register(makeProvider('gateway', available))
    expect(() => image.register(makeProvider('gateway', available)))
      .toThrow(expect.objectContaining({ name: 'ImageError', code: 'IMAGE_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, image } = await mountImage()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.image.register(makeProvider('gateway', available))
    }, { inject: ['image'] }))
    expect(decoded(await image.generate({ prompt: 'q' }))).toBe('gateway')
    await fiber.dispose()
    await expect(image.generate({ prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_UNAVAILABLE' }))
  })
})

describe('ImageRuntime execution resolution', () => {
  it('throws IMAGE_PROVIDER_UNAVAILABLE when no registered provider is usable', async () => {
    const { image } = await mountImage()
    image.register(makeProvider('gateway', unavailable))
    await expect(image.generate({ prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_UNAVAILABLE' }))
  })

  it('auto-selects the single usable provider regardless of registration order', async () => {
    const { image } = await mountImage()
    image.register(makeProvider('off', unavailable))
    image.register(makeProvider('on', available))
    expect(decoded(await image.generate({ prompt: 'q' }))).toBe('on')
  })

  it('throws IMAGE_PROVIDER_AMBIGUOUS when several providers are usable and none is configured', async () => {
    const { image } = await mountImage()
    image.register(makeProvider('a', available))
    image.register(makeProvider('b', available))
    await expect(image.generate({ prompt: 'q' })).rejects.toThrow(expect.objectContaining({
      code: 'IMAGE_PROVIDER_AMBIGUOUS',
      message: expect.stringContaining('a, b'),
    }))
  })

  it('uses the configured provider when several are usable', async () => {
    const { image } = await mountImage({ provider: 'b' })
    image.register(makeProvider('a', available))
    image.register(makeProvider('b', available))
    expect(decoded(await image.generate({ prompt: 'q' }))).toBe('b')
  })

  it('throws IMAGE_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { image } = await mountImage({ provider: 'missing' })
    image.register(makeProvider('a', available))
    await expect(image.generate({ prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured provider', async () => {
    const { image } = await mountImage({ provider: 'a' })
    image.register(makeProvider('a', unavailable))
    await expect(image.generate({ prompt: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })
})
