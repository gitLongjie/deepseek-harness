/** Register DeepSeek with protocol selection and request-local settings and credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { DeepSeekAdapter } from './adapter.ts'
import { Config, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'
import { discoverModels } from './discovery.ts'

export { Config, resolveAdapterOptions, PUBLIC_BASE_URL, MESSAGES_BASE_URL } from './config.ts'
export type { ResolvedDeepSeekOptions } from './config.ts'
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './common/defaults.ts'
export { DeepSeekAdapter } from './adapter.ts'
export type { DeepSeekProtocol } from './common/types.ts'
export type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from './common/types.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_MAX_DIMENSION,
  deepSeekImageRequestPricing,
  resolveRequestImageMaxBytes,
  resolveRequestImageTarget,
} from './common/request-pricing.ts'
export { deepSeekImageTokens, deepSeekRequestImageDimensions } from './common/image-tokens.ts'
export { DeepSeekFileStore, MAX_IMAGE_BYTES } from './common/file-store.ts'
export type { DeepSeekFileConnection, DeepSeekFilePolicy, DeepSeekFileReference } from './common/file-store.ts'
export { DeepSeekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './common/files-api.ts'
export type { DeepSeekFileObject, DeepSeekFilePage } from './common/files-api.ts'
export { DeepSeekFileId } from './common/file-id.ts'
export type { DeepSeekFileId as DeepSeekFileIdType } from './common/file-id.ts'
export { DeepSeekUploadIndex, deepSeekFileScope } from './common/upload-index.ts'
export type { DeepSeekUploadRecord } from './common/upload-index.ts'
export type { RequestDefaults } from './common/types.ts'
export type * from './protocols/chat-completions/types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

const NS = 'llm-deepseek'
const PROVIDER = 'deepseek-official'
/** The Deepagens Claw gateway route; its catalog and endpoint are seeded by the login flow. */
const DEEPAGENS_NS = 'llm-deepagens'
const DEEPAGENS_PROVIDER = 'deepagens'

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedDeepSeekOptions | undefined
  const options = (): ResolvedDeepSeekOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-deepseek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({
    options,
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  // ── Deepagens Claw gateway: a second OpenAI-compatible provider route whose
  // endpoint and catalog the login flow seeds from the account server. It
  // shares the adapter class (chat completions over the gateway's /v1) and the
  // `DEEPSEEK_API_KEY` credential, but owns a separate settings namespace.
  let deepagensCurrent: () => Config = () => ({ models: [] })
  let deepagensRaw: Config | undefined
  let deepagensGood: ResolvedDeepSeekOptions | undefined
  const deepagensOptions = (): ResolvedDeepSeekOptions => {
    const raw = deepagensCurrent()
    if (raw === deepagensRaw && deepagensGood !== undefined) return deepagensGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      deepagensRaw = raw
      deepagensGood = next
      return next
    } catch (error) {
      if (deepagensGood === undefined) throw error
      ctx.logger.error('llm-deepseek: keeping the last good deepagens configuration after an invalid settings section')
      ctx.logger.error(error)
      return deepagensGood
    }
  }
  deepagensOptions()

  const deepagensAdapter = new DeepSeekAdapter({
    options: deepagensOptions,
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    providerName: 'Deepagens',
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  ctx.llm.registerConfigurableProviders([
    {
      provider: DEEPAGENS_PROVIDER,
      displayName: 'Deepagens',
      settingsNs: DEEPAGENS_NS,
      settingsPath: [],
      // Same adapter class and section schema as the DeepSeek route, so the
      // settings page renders the same curated card for it.
      editorFamily: 'deepseek',
    },
  ])
  const deepagensRegistration = ctx.llm.registerAdapter([DEEPAGENS_PROVIDER], deepagensAdapter)
  ctx.llm.registerModelDiscovery(DEEPAGENS_NS, (request, signal) =>
    discoverModels(request, async () => {
      try { return await resolveApiKey(deepagensOptions()) } catch { return undefined }
    }, signal),
  )
  let registeredDeepagensPolicy = deepagensOptions().retryPolicy
  const ensureDeepagensFacts = (): void => {
    const policy = deepagensOptions().retryPolicy
    if (deepEqualJson(policy, registeredDeepagensPolicy)) return
    deepagensRegistration.replace([DEEPAGENS_PROVIDER])
    registeredDeepagensPolicy = policy
  }
  ctx.inject(['settings'], (settingsCtx) => {
    // The base layer carries the wire protocol: the login flow seeds a baseURL
    // ending in /v1 and the gateway serves chat completions there, while the
    // shared Config schema defaults to `messages`, whose request path appends
    // a second /v1. The user layer still overrides this base.
    settingsCtx.settings.installSection(ctx, DEEPAGENS_NS, Config, { models: [], protocol: 'chat-completions' }, {
      setSource: (source) => {
        deepagensCurrent = source
      },
      onChange: ensureDeepagensFacts,
    })
  })
  // The DeepSeek route registers after Deepagens so the gateway group leads the
  // provider directories; both share the same adapter class and the DEEPSEEK_*
  // credentials, differing only in their settings namespace.
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: NS, settingsPath: [], editorFamily: 'deepseek' },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.llm.registerModelDiscovery(NS, (request, signal) =>
    discoverModels(request, async () => {
      try { return await resolveApiKey(options()) } catch { return undefined }
    }, signal),
  )
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}
