/**
 * Deepagens Claw gateway provider: OpenAI-compatible chat completions over the
 * login-seeded `llm-deepagens` settings section and `DEEPAGENS_API_KEY`. When `ctx.image` is
 * mounted, the route also registers the `deepagens` image provider, usable once `imageModel` is set.
 */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-image'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { discoverModels } from './discovery.ts'
import { DeepSeekAdapter } from './adapter.ts'
import { requestImage } from './protocols/image-generation/generate.ts'
import { Config, plainOptions, resolveAdapterOptions, type ResolvedDeepSeekOptions } from './config.ts'

export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { ResolvedDeepSeekOptions } from './config.ts'

export const name = 'llm-deepagens'
export const inject = ['llm']

const PROVIDER = 'deepagens'

export function apply(ctx: Context, config: Config): void {
  const options = (): ResolvedDeepSeekOptions => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  const deepagensDisplayName = plainOptions(config).deepagensDisplayName
    ?? launchEnvironmentOf(ctx).get('DEEPAGENS_DISPLAY_NAME')?.value
    ?? 'Deepagens'
  options()

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepagens', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepagens', ref)
      }
    }
    throw new LlmError(
      `llm-deepagens: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service, or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const adapter = new DeepSeekAdapter({
    options,
    resolveApiKey,
    resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    providerName: deepagensDisplayName,
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })

  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: deepagensDisplayName,
      settingsNs,
      settingsPath: [],
      editorFamily: 'deepseek',
    },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) =>
    discoverModels(request, async () => {
      try { return await resolveApiKey(options()) } catch { return undefined }
    }, signal),
  )

  ctx.inject(['image'], (imageCtx) => {
    imageCtx.image.register({
      id: PROVIDER,
      available: () => config.imageModel.get() !== undefined,
      generate: async (request, signal) => {
        const connection = options()
        const model = connection.imageModel
        if (model === undefined) {
          throw new LlmError(`llm-deepagens: provider route "${PROVIDER}" has no imageModel configured`, 'INVALID_REQUEST')
        }
        const image = await requestImage({
          baseURL: connection.baseURL,
          apiKey: await resolveApiKey(connection),
          userId: userId ??= getOrCreateAnonymousUserId(),
          model,
          prompt: request.prompt,
          ...signal !== undefined ? { signal } : {},
        })
        return { data: image.data, mediaType: image.mediaType, model }
      },
    })
  })

  let registeredPolicy = options().retryPolicy
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.on('loader/volatile-update', () => {
    let policy: typeof registeredPolicy
    try { policy = options().retryPolicy }
    catch (error) { ctx.logger.warn(error); return }
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  })
}
