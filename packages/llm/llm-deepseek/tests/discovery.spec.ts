import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userAgent } from '@deepseek-ai/dsh-llm'
import { discoverModels } from '../src/discovery.ts'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      // No declared length: the ceiling has to hold on what is read.
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      // Left open so a caller's cancellation lands while the body is still
      // being read rather than after it completed.
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

describe('deepseek model discovery', () => {
  it('reads an OpenAI-compatible listing and keeps the capacities it discloses', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'deepseek-large', name: 'DeepSeek Large', context_window: 100_000, max_tokens: 8192 },
          { id: 'deepseek-vision', display_name: 'DeepSeek Vision', context_length: 65_536, max_output_tokens: 4096 },
          { id: 'deepseek-small' },
        ],
      }),
    })

    const models = await discoverModels({ baseURL: `${server.url}/v1`, apiKey: 'probe-key' })

    expect(models).toEqual([
      { id: 'deepseek-large', name: 'DeepSeek Large', contextWindow: 100_000, maxTokens: 8192 },
      { id: 'deepseek-vision', name: 'DeepSeek Vision', contextWindow: 65_536, maxTokens: 4096 },
      { id: 'deepseek-small' },
    ])
    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('keeps a deployment path instead of resolving it away', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })

    await discoverModels({ baseURL: `${server.url}/deepseek/v1/` })

    expect(server.paths).toEqual(['/deepseek/v1/models'])
  })

  it('offers no credential when the request names none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })

    await discoverModels({ baseURL: server.url })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('uses the stored key when the request names none', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })

    await discoverModels({ baseURL: server.url }, async () => 'stored-key')

    expect(server.headers[0]?.authorization).toBe('Bearer stored-key')
  })

  it('lets the supplied key win over the stored one', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })

    await discoverModels({ baseURL: server.url, apiKey: 'typed' }, async () => 'stored-key')

    expect(server.headers[0]?.authorization).toBe('Bearer typed')
  })

  it('drops unusable rows rather than failing the whole listing', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'good' },
          { id: '' },
          { name: 'no id at all' },
          null,
          { id: 'zero-capacity', context_length: 0, max_tokens: -1 },
        ],
      }),
    })

    expect(await discoverModels({ baseURL: server.url }))
      .toEqual([{ id: 'good' }, { id: 'zero-capacity' }])
  })

  it('points at the credential for a rejected one, and only then', async () => {
    for (const status of [401, 403]) {
      const refused = await listingServer({ status, body: '{"error":"nope"}' })
      await expect(discoverModels({ baseURL: refused.url, apiKey: 'wrong' }))
        .rejects.toThrow(new RegExp(`answered ${status}; check the API key`))
    }

    const broken = await listingServer({ status: 500, body: '{"error":"boom"}' })
    await expect(discoverModels({ baseURL: broken.url, apiKey: 'fine' }))
      .rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a model listing', async () => {
    const server = await listingServer({ body: '{"models":[]}' })
    await expect(discoverModels({ baseURL: server.url }))
      .rejects.toThrow(/no "data" array; enter this provider's models by hand/)

    const broken = await listingServer({ body: 'not json at all' })
    await expect(discoverModels({ baseURL: broken.url }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or streamed', async () => {
    const oversized = `{"data":[{"id":"m","pad":"${'x'.repeat(4 * 1024 * 1024)}"}]}`

    const declared = await listingServer({ body: oversized })
    await expect(discoverModels({ baseURL: declared.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)

    const streamed = await listingServer({ chunks: ['{"data":[{"id":"m","pad":"', 'x'.repeat(4 * 1024 * 1024), '"}]}'] })
    await expect(discoverModels({ baseURL: streamed.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(discoverModels({ baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it('needs a baseURL', async () => {
    await expect(discoverModels({}))
      .rejects.toThrow(/deepseek model discovery needs a baseURL/)

    await expect(discoverModels({ baseURL: '' }))
      .rejects.toThrow(/deepseek model discovery needs a baseURL/)
  })

  it('reports a blank probe key as a credential fault too', async () => {
    await expect(discoverModels({ baseURL: 'https://acme.test', apiKey: '' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('reports an illegal probe key as a credential fault, not an unreachable endpoint', async () => {
    await expect(discoverModels({ baseURL: 'https://acme.test', apiKey: 'sk-\u{1F600}' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('leaves a probe with no key unauthenticated', async () => {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await discoverModels({ baseURL: 'https://acme.test' })

    const headers = new Headers(requests[0]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })

  it('reports cancellation during the body read as an abort, not a raw reason', async () => {
    const controller = new AbortController()
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    const probe = discoverModels(
      { baseURL: 'https://slow.example/v1' },
      undefined,
      controller.signal,
    )
    await bodyRead.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation', async () => {
    const aborted = AbortSignal.abort('test cancellation')
    await expect(discoverModels(
      { baseURL: 'http://127.0.0.1:9/v1' },
      undefined,
      aborted,
    )).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('reports a network rejection that is not a cancellation', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed') })
    await expect(discoverModels({ baseURL: 'https://acme.test/v1' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })
})
