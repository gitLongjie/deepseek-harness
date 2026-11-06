/**
 * Service Definition for the image-generation capability seam (`ctx.image`): a provider registry
 * and provider-selecting execution. Duplicate ids are rejected. At execution time, a configured
 * provider must exist and be usable; without one, exactly one usable provider is required, so
 * selection never depends on registration order.
 * @module @deepseek-ai/dsh-image
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GeneratedImage, ImageGenerationProvider, ImageGenerationRequest } from './types.ts'
import { ImageError } from './types.ts'

export { ImageError } from './types.ts'
export type { GeneratedImage, ImageErrorCode, ImageGenerationProvider, ImageGenerationRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    image: ImageRuntime
  }
}

/**
 * Config for the image seam. `provider` pins which registered provider generates images; omitted,
 * a single usable provider auto-selects. Each generation reads the current value, so a settings
 * change applies to the next request without remounting the service.
 */
export interface ImageRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one is usable. */
  readonly provider: Volatile<string | undefined>
}

/**
 * The image-generation service, registered as `ctx.image`.
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `IMAGE_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one usable provider → that provider.
 * - No id configured, several usable providers → `IMAGE_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `IMAGE_PROVIDER_UNAVAILABLE`.
 */
export class ImageRuntime extends Service {
  /** Provider selection config; see {@link ImageRuntimeConfig}. */
  static Config = z.object({
    provider: z.string().volatile().description('Image provider id. Omitted = the single usable provider.'),
  })

  private readonly providers = new Map<string, ImageGenerationProvider>()

  constructor(ctx: Context, private readonly config: ImageRuntimeConfig) {
    super(ctx, 'image')
  }

  /**
   * Register an image provider. Throws {@link ImageError} `IMAGE_DUPLICATE_PROVIDER` if its id is
   * already registered. The registration is disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  register(provider: ImageGenerationProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ImageError(`an image provider with id "${provider.id}" is already registered`, 'IMAGE_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'image.register()')
    return () => void dispose()
  }

  /**
   * Generate one image through the selected provider. Throws {@link ImageError} when no provider
   * can run; provider failures propagate unchanged.
   * @param request - the visual description.
   * @param signal - cancellation forwarded to the provider.
   * @returns the encoded image bytes and their media type.
   */
  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    return await this.select().generate(request, signal)
  }

  /** Select the provider with the rules above, throwing the matching {@link ImageError}. */
  private select(): ImageGenerationProvider {
    const configuredId = this.config.provider.get()
    if (configuredId !== undefined) {
      const provider = this.providers.get(configuredId)
      if (!provider) {
        throw new ImageError(`configured image provider "${configuredId}" is not registered`, 'IMAGE_PROVIDER_CONFIGURED_MISSING')
      }
      if (!provider.available()) {
        throw new ImageError(`configured image provider "${configuredId}" is registered but unavailable`, 'IMAGE_PROVIDER_CONFIGURED_UNAVAILABLE')
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new ImageError('no usable image provider is registered; configure an image model on an image provider', 'IMAGE_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      const ids = usable.map(provider => provider.id).join(', ')
      throw new ImageError(`multiple usable image providers are registered (${ids}); configure one explicitly`, 'IMAGE_PROVIDER_AMBIGUOUS')
    }
    return single
  }
}

export default ImageRuntime
