/** The API-key route serves its configured catalog and does not request GET /models. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import * as ApiKey from '../src/index.ts'

const LISTING_URL = 'https://api.deepseek.com/models'
const BUILT_IN = ['deepseek-flash', 'deepseek-v4-pro']

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Record every fetch; a hit on the official listing fails the test through the assertion, not the network. */
function recordFetches(): string[] {
  const urls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = new Request(input, init)
    urls.push(request.url)
    return Promise.reject(new Error(`unexpected request to ${request.url}`))
  })
  return urls
}

async function host(key: string | undefined = 'fixture-api-key') {
  vi.stubEnv('DEEPSEEK_API_KEY', key)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  return ctx
}
const ids = async (ctx: Context) => (await ctx.llm.listModels('deepseek-official')).map(model => model.id)

it('serves the built-in catalog on the official endpoint without requesting /models', async () => {
  const urls = recordFetches()
  const ctx = await host()
  await ctx.plugin(ApiKey, {})
  expect(await ids(ctx)).toEqual(BUILT_IN)
  expect(urls).not.toContain(LISTING_URL)
})

it('serves a customized catalog without requesting /models', async () => {
  const urls = recordFetches()
  const ctx = await host()
  await ctx.plugin(ApiKey, { models: [{ id: 'custom', name: 'Custom' }] })
  expect(await ids(ctx)).toEqual(['custom'])
  await expect(ctx.llm.resolveModelInfo('deepseek-official', 'custom')).resolves.toMatchObject({ name: 'Custom' })
  expect(urls).not.toContain(LISTING_URL)
})

it('serves the built-in catalog on another endpoint without requesting /models', async () => {
  const urls = recordFetches()
  const ctx = await host()
  await ctx.plugin(ApiKey, { baseURL: 'http://127.0.0.1:9/anthropic' })
  expect(await ids(ctx)).toEqual(BUILT_IN)
  expect(urls).not.toContain(LISTING_URL)
})

it.each([[{}], [{ models: [{ id: 'custom' }] }]])('hides the route without a key and requests nothing for %j', async (config) => {
  const urls = recordFetches()
  const ctx = await host('')
  await ctx.plugin(ApiKey, config)
  expect(await ids(ctx)).toEqual([])
  expect(urls).toEqual([])
})

it('reports a rejected configuration on the next discovery and recovers when it is replaced', async () => {
  const ctx = await host()
  const live = await liveConfig(ctx, ApiKey, {})
  expect(await ids(ctx)).toEqual(BUILT_IN)
  await live.update({ thinking: 'disabled', reasoningEffort: 'high' })
  await expect(ctx.llm.listModels('deepseek-official')).rejects.toThrow(/only reasoningEffort "off"/)
  await live.replace({})
  expect(await ids(ctx)).toEqual(BUILT_IN)
})
