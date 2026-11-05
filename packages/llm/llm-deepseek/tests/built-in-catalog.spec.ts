/** Recognizing the built-in catalog, which is how an uncustomized `models` setting resolves. */
import { expect, it } from 'vitest'
import { Config, isBuiltInCatalog, plainOptions, resolveAdapterOptions } from '../src/config.ts'
import { DEFAULT_MODELS } from '../src/models.ts'

it('recognizes the built-in catalog however it was supplied', () => {
  const parsed = Config({})
  const built = {
    baseURL: parsed.baseURL,
    thinking: parsed.thinking,
    reasoningEffort: parsed.reasoningEffort,
    maxTokens: parsed.maxTokens,
    defaultContextWindow: parsed.defaultContextWindow,
    models: parsed.models,
    streamIdleTimeoutMs: parsed.streamIdleTimeoutMs,
    maxRequestFilesBytes: parsed.maxRequestFilesBytes,
    maxInlineRequestImageBytes: parsed.maxInlineRequestImageBytes,
    maxImagesPerRequest: parsed.maxImagesPerRequest,
    imageOffloadByteQuantum: parsed.imageOffloadByteQuantum,
    inlineImageOffloadByteQuantum: parsed.inlineImageOffloadByteQuantum,
    imageOffloadCountQuantum: parsed.imageOffloadCountQuantum,
    filesApiTimeoutMs: parsed.filesApiTimeoutMs,
    fileExpiresAfterSeconds: parsed.fileExpiresAfterSeconds,
    fileRefreshMarginSeconds: parsed.fileRefreshMarginSeconds,
    fileQuotaCleanupBatch: parsed.fileQuotaCleanupBatch,
    retryPolicy: parsed.retryPolicy,
  } satisfies Config
  expect(isBuiltInCatalog(resolveAdapterOptions({}).models)).toBe(true)
  expect(isBuiltInCatalog(resolveAdapterOptions({ models: structuredClone(DEFAULT_MODELS) }).models)).toBe(true)
  expect(isBuiltInCatalog(resolveAdapterOptions(plainOptions(built)).models)).toBe(true)
})

it('treats any other catalog as customized', () => {
  const [flash, pro] = resolveAdapterOptions({}).models
  expect(isBuiltInCatalog([flash!])).toBe(false)
  expect(isBuiltInCatalog([{ ...flash!, contextWindow: 524_288 }, pro!])).toBe(false)
  expect(isBuiltInCatalog([pro!, flash!])).toBe(false)
  expect(isBuiltInCatalog([])).toBe(false)
})
