/** Plugin configuration and complete request-local resolution for the Deepagens gateway route. */
import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ModelModality, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions, DeepSeekProtocol } from './common/types.ts'
import { DEFAULT_MODELS } from './common/models.ts'
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES, DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM, DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM, DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM, DEFAULT_FILE_EXPIRY_SECONDS, DEFAULT_FILE_REFRESH_MARGIN_SECONDS, DEFAULT_FILE_QUOTA_CLEANUP_BATCH, DEFAULT_FILES_API_TIMEOUT_MS } from './common/defaults.ts'
import { DEFAULT_MAX_IMAGES_PER_REQUEST, DEFAULT_MAX_REQUEST_FILES_BYTES, DEFAULT_REQUEST_IMAGE_MAX_BYTES } from './common/request-pricing.ts'

const DEFAULT_API_KEY_ENV = 'DEEPAGENS_API_KEY'

const MODEL_MODALITIES = ['text', 'image'] as const satisfies readonly ModelModality[]

/** Live plugin and settings configuration for the `llm-deepagens` namespace. */
export interface Config {
  /** Wire protocol; the composition base pins chat completions for this route. */
  protocol?: DeepSeekProtocol
  apiKeyEnv: Volatile<string>
  baseURL: Volatile<string | undefined>
  thinking: Volatile<'enabled' | 'disabled' | undefined>
  reasoningEffort: Volatile<'off' | 'low' | 'high' | 'max' | undefined>
  maxTokens: Volatile<number>
  defaultContextWindow: Volatile<number>
  models: Volatile<DeepSeekCatalogModel[]>
  followGatewayCatalog: Volatile<boolean | undefined>
  deepagensDisplayName: Volatile<string | undefined>
  streamIdleTimeoutMs: Volatile<number>
  maxRequestFilesBytes: Volatile<number>
  maxInlineRequestImageBytes: Volatile<number>
  maxImagesPerRequest: Volatile<number>
  imageOffloadByteQuantum: Volatile<number>
  inlineImageOffloadByteQuantum: Volatile<number>
  imageOffloadCountQuantum: Volatile<number>
  filesApiTimeoutMs: Volatile<number>
  fileExpiresAfterSeconds: Volatile<number>
  fileRefreshMarginSeconds: Volatile<number>
  fileQuotaCleanupBatch: Volatile<number>
  retryPolicy: Volatile<RetryPolicyConfig | undefined>
  /** Model served through `POST {baseURL}/images/generations` for `ctx.image`; omitted = provider unavailable. */
  imageModel: Volatile<string | undefined>
}

const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
  imagePixelBudget: z.union([z.number().step(1).min(1), 'low']),
  imageMaxBytes: z.number().step(1).min(1),
  systemPromptUpdate: z.const('in-history'),
  endpoint: z.const('image-generation'),
})

export const Config = z.object({
  protocol: z.union(['chat-completions', 'messages']).default('messages'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().volatile(),
  thinking: z.union(['enabled', 'disabled']).volatile(),
  reasoningEffort: z.union(['off', 'low', 'high', 'max']).volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  models: z.array(catalogModel).default(DEFAULT_MODELS).volatile(),
  followGatewayCatalog: z.boolean().volatile(),
  deepagensDisplayName: z.string().volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  maxRequestFilesBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_FILES_BYTES).volatile(),
  maxInlineRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES).volatile(),
  maxImagesPerRequest: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_REQUEST).volatile(),
  imageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM).volatile(),
  inlineImageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM).volatile(),
  imageOffloadCountQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM).volatile(),
  filesApiTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_API_TIMEOUT_MS).volatile(),
  fileExpiresAfterSeconds: z.number().step(1).min(3_600).max(2_592_000).default(DEFAULT_FILE_EXPIRY_SECONDS).volatile(),
  fileRefreshMarginSeconds: z.number().step(1).min(0).default(DEFAULT_FILE_REFRESH_MARGIN_SECONDS).volatile(),
  fileQuotaCleanupBatch: z.number().step(1).min(1).max(1_000).default(DEFAULT_FILE_QUOTA_CLEANUP_BATCH).volatile(),
  retryPolicy: RetryPolicySchema.volatile(),
  imageModel: z.string().volatile(),
})

/** Plain options the resolver reads on each request. */
export type Options = { [K in keyof Config]?: Config[K] extends Volatile<infer T> ? T : Config[K] }

/** Detach live Config references into plain values for one resolution pass. */
export function plainOptions(config: Config): Options {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, isVolatile(value) ? value.get() : value]))
}

/** Public API default; the internal endpoint comes from $DEEPSEEK_BASE_URL. */
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Official Messages protocol root. */
export const MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic'

/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/** One resolution's complete request facts. */
export type ResolvedDeepSeekOptions = DeepSeekConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly DeepSeekCatalogModel[] | undefined): DeepSeekCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (Object.hasOwn(model, 'imageDetail')) {
      throw new Error('llm-deepagens: catalog model imageDetail is no longer supported; use imagePixelBudget')
    }
    if (model.id.length === 0) throw new Error('llm-deepagens: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-deepagens: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-deepagens: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-deepagens: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    const inputModalities = model.inputModalities ?? ['text']
    if (inputModalities.length === 0) {
      throw new Error(`llm-deepagens: catalog model "${model.id}" inputModalities must not be empty`)
    }
    if (inputModalities.some(modality => !MODEL_MODALITIES.includes(modality))) {
      throw new Error(
        `llm-deepagens: catalog model "${model.id}" inputModalities must contain only "text" and "image"`,
      )
    }
    if (new Set(inputModalities).size !== inputModalities.length) {
      throw new Error(`llm-deepagens: catalog model "${model.id}" inputModalities must not contain duplicates`)
    }
    const hasImage = inputModalities.includes('image')
    if (!hasImage && (model.imagePixelBudget !== undefined || model.imageMaxBytes !== undefined)) {
      throw new Error(`llm-deepagens: text-only catalog model "${model.id}" cannot declare image request limits`)
    }
    if (model.imagePixelBudget !== undefined
      && model.imagePixelBudget !== 'low'
      && (!Number.isSafeInteger(model.imagePixelBudget) || model.imagePixelBudget <= 0)) {
      throw new Error(`llm-deepagens: catalog model "${model.id}" imagePixelBudget must be "low" or a positive safe integer`)
    }
    if (model.imageMaxBytes !== undefined
      && (!Number.isSafeInteger(model.imageMaxBytes) || model.imageMaxBytes <= 0)) {
      throw new Error(`llm-deepagens: catalog model "${model.id}" imageMaxBytes must be a positive safe integer`)
    }
    const systemPromptUpdate: string | undefined = model.systemPromptUpdate
    if (systemPromptUpdate !== undefined && systemPromptUpdate !== 'in-history') {
      throw new Error(`llm-deepagens: catalog model "${model.id}" systemPromptUpdate must be "in-history" when present`)
    }
    const endpoint: string | undefined = model.endpoint
    if (endpoint !== undefined && endpoint !== 'image-generation') {
      throw new Error(`llm-deepagens: catalog model "${model.id}" endpoint must be "image-generation" when present`)
    }
    if (seen.has(model.id)) throw new Error(`llm-deepagens: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: model.systemPromptUpdate },
      ...model.endpoint === undefined ? {} : { endpoint: model.endpoint },
      inputModalities: [...inputModalities],
      ...hasImage
        ? {
          ...model.imagePixelBudget === undefined ? {} : { imagePixelBudget: model.imagePixelBudget },
          imageMaxBytes: model.imageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
        }
        : {},
    }
  })
}

/** Validate raw settings or composition config into connection facts for one request. */
export function resolveAdapterOptions(config: Options, environment?: LaunchEnvironmentSnapshot): ResolvedDeepSeekOptions {
  const protocol: string = config.protocol ?? 'messages'
  if (protocol !== 'chat-completions' && protocol !== 'messages') {
    throw new Error('llm-deepagens: protocol must be chat-completions or messages')
  }
  if (config.thinking === 'disabled'
    && config.reasoningEffort !== undefined
    && config.reasoningEffort !== 'off') {
    throw new Error('llm-deepagens: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-deepagens: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-deepagens: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-deepagens: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const maxRequestFilesBytes = config.maxRequestFilesBytes ?? DEFAULT_MAX_REQUEST_FILES_BYTES
  if (!Number.isSafeInteger(maxRequestFilesBytes) || maxRequestFilesBytes <= 0) {
    throw new Error('llm-deepagens: maxRequestFilesBytes must be a positive safe integer')
  }
  const maxInlineRequestImageBytes = config.maxInlineRequestImageBytes ?? DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES
  if (!Number.isSafeInteger(maxInlineRequestImageBytes) || maxInlineRequestImageBytes <= 0) {
    throw new Error('llm-deepagens: maxInlineRequestImageBytes must be a positive safe integer')
  }
  const maxImagesPerRequest = config.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST
  if (!Number.isSafeInteger(maxImagesPerRequest) || maxImagesPerRequest <= 0) {
    throw new Error('llm-deepagens: maxImagesPerRequest must be a positive safe integer')
  }
  const imageOffloadByteQuantum = config.imageOffloadByteQuantum ?? DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(imageOffloadByteQuantum) || imageOffloadByteQuantum <= 0) {
    throw new Error('llm-deepagens: imageOffloadByteQuantum must be a positive safe integer')
  }
  if (imageOffloadByteQuantum > maxRequestFilesBytes) {
    throw new Error('llm-deepagens: imageOffloadByteQuantum must not exceed maxRequestFilesBytes')
  }
  const inlineImageOffloadByteQuantum = config.inlineImageOffloadByteQuantum
    ?? DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(inlineImageOffloadByteQuantum) || inlineImageOffloadByteQuantum <= 0) {
    throw new Error('llm-deepagens: inlineImageOffloadByteQuantum must be a positive safe integer')
  }
  if (inlineImageOffloadByteQuantum > maxInlineRequestImageBytes) {
    throw new Error('llm-deepagens: inlineImageOffloadByteQuantum must not exceed maxInlineRequestImageBytes')
  }
  const imageOffloadCountQuantum = config.imageOffloadCountQuantum ?? DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM
  if (!Number.isSafeInteger(imageOffloadCountQuantum) || imageOffloadCountQuantum <= 0) {
    throw new Error('llm-deepagens: imageOffloadCountQuantum must be a positive safe integer')
  }
  if (imageOffloadCountQuantum > maxImagesPerRequest) {
    throw new Error('llm-deepagens: imageOffloadCountQuantum must not exceed maxImagesPerRequest')
  }
  const filesApiTimeoutMs = config.filesApiTimeoutMs ?? DEFAULT_FILES_API_TIMEOUT_MS
  if (!Number.isFinite(filesApiTimeoutMs)
    || filesApiTimeoutMs <= 0
    || filesApiTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-deepagens: filesApiTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const fileExpiresAfterSeconds = config.fileExpiresAfterSeconds ?? DEFAULT_FILE_EXPIRY_SECONDS
  if (!Number.isSafeInteger(fileExpiresAfterSeconds)
    || fileExpiresAfterSeconds < 3_600
    || fileExpiresAfterSeconds > 2_592_000) {
    throw new Error('llm-deepagens: fileExpiresAfterSeconds must be an integer from 3600 through 2592000')
  }
  const fileRefreshMarginSeconds = config.fileRefreshMarginSeconds ?? DEFAULT_FILE_REFRESH_MARGIN_SECONDS
  if (!Number.isSafeInteger(fileRefreshMarginSeconds)
    || fileRefreshMarginSeconds < 0
    || fileRefreshMarginSeconds >= fileExpiresAfterSeconds) {
    throw new Error('llm-deepagens: fileRefreshMarginSeconds must be a non-negative integer below fileExpiresAfterSeconds')
  }
  const fileQuotaCleanupBatch = config.fileQuotaCleanupBatch ?? DEFAULT_FILE_QUOTA_CLEANUP_BATCH
  if (!Number.isSafeInteger(fileQuotaCleanupBatch)
    || fileQuotaCleanupBatch < 1
    || fileQuotaCleanupBatch > 1_000) {
    throw new Error('llm-deepagens: fileQuotaCleanupBatch must be an integer from 1 through 1000')
  }
  if (config.imageModel !== undefined) {
    if (config.imageModel.length === 0) throw new Error('llm-deepagens: imageModel must be non-empty when present')
    if (protocol !== 'chat-completions') throw new Error('llm-deepagens: imageModel requires the chat-completions protocol')
  }
  const baseURL = config.baseURL ?? environment?.get(BASE_URL_ENV)?.value
    ?? (protocol === 'messages' ? MESSAGES_BASE_URL : PUBLIC_BASE_URL)
  if (protocol === 'messages') {
    const parsed = new URL(baseURL)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('llm-deepagens: Messages baseURL must be an HTTP(S) root without credentials, query, or fragment')
    }
  }
  return {
    protocol,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL,
    defaults: {
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    maxRequestFilesBytes,
    maxInlineRequestImageBytes,
    maxImagesPerRequest,
    imageOffloadByteQuantum,
    inlineImageOffloadByteQuantum,
    imageOffloadCountQuantum,
    filesApiTimeoutMs,
    filePolicy: {
      expiresAfterSeconds: fileExpiresAfterSeconds,
      refreshMarginSeconds: fileRefreshMarginSeconds,
      quotaCleanupBatch: fileQuotaCleanupBatch,
    },
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-deepagens: retryPolicy'),
    ...config.imageModel !== undefined ? { imageModel: config.imageModel } : {},
  }
}
