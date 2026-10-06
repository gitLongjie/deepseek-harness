/**
 * Hosted MiniMax API provider tests against a mock HTTP server: V2 creation, status polling with
 * result download, failure surfaces the task error, and timeouts fail the task.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniMaxApiProvider } from '../src/minimax-api.ts'
import type { FetchLike } from '../src/minimax-api.ts'
import type { SegmentRequest } from '../src/types.ts'

const SIGNAL = new AbortController().signal
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h3-mm-out-'))
  tempDirs.push(dir)
  return dir
}

function textRequest(overrides: Partial<SegmentRequest> = {}): SegmentRequest {
  return {
    inputs: [{ type: 'text', text: 'a spaceship jumping to warp' }],
    resolution: '2K',
    durationSeconds: 5,
    ratio: '16:9',
    ...overrides,
  }
}

interface Route {
  path: string
  handler: (init?: RequestInit) => { status: number; body: string }
}

type MockFetch = FetchLike & { calls: Array<{ path: string; init?: RequestInit }> }

function mockFetch(routes: Route[]): MockFetch {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input)
    const path = url.pathname + url.search
    calls.push({ path, ...init !== undefined ? { init } : {} })
    const route = routes.find(candidate => path.startsWith(candidate.path))
    if (route === undefined) throw new Error(`unexpected request ${path}`)
    const { status, body } = route.handler(init)
    return Promise.resolve(new Response(body, { status }))
  }
  return Object.assign(fetch, { calls })
}

interface Base {
  outputDir: string
  fetcher: MockFetch
}

function base(fetcher: MockFetch): Base {
  return { outputDir: outDir(), fetcher }
}

describe('createMiniMaxApiProvider', () => {
  it('creates a task, polls to success, and downloads the media url', async () => {
    let queried = 0
    const fetcher = mockFetch([
      {
        path: '/v2/video_generation',
        handler: (init) => {
          const body = JSON.parse(init?.body as string) as Record<string, unknown>
          expect(body.model).toBe('MiniMax-H3')
          expect(body.content).toEqual([{ type: 'text', text: 'a spaceship jumping to warp' }])
          expect(body.resolution).toBe('2K')
          expect(body.duration).toBe(5)
          expect(body.ratio).toBe('16:9')
          return { status: 200, body: JSON.stringify({ task_id: 't-1' }) }
        },
      },
      {
        path: '/v2/query/video_generation/t-1',
        handler: () => {
          queried += 1
          if (queried === 1) {
            return { status: 200, body: JSON.stringify({ task: { id: 't-1', status: 'running' } }) }
          }
          return {
            status: 200,
            body: JSON.stringify({ task: { id: 't-1', status: 'succeeded', content: { url: 'https://cdn.example.com/out.mp4' } } }),
          }
        },
      },
      { path: '/out.mp4', handler: () => ({ status: 200, body: 'MP4DATA' }) },
    ])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    const ref = await provider.submit(textRequest(), SIGNAL)
    expect(String(ref)).toBe('t-1')
    const status = await provider.poll(ref, SIGNAL)
    expect(status.state).toBe('succeeded')
    if (status.state === 'succeeded') {
      expect(readFileSync(status.localFile, 'utf8')).toBe('MP4DATA')
      expect(status.remoteUrl).toBe('https://cdn.example.com/out.mp4')
    }
    const createCall = fetcher.calls.find(call => call.path === '/v2/video_generation')
    expect(new Headers(createCall?.init?.headers).get('authorization')).toBe('Bearer sk-test')
  })

  it('reports the backend error when the task fails', async () => {
    const fetcher = mockFetch([
      { path: '/v2/video_generation', handler: () => ({ status: 200, body: JSON.stringify({ task_id: 't-2' }) }) },
      {
        path: '/v2/query/video_generation/t-2',
        handler: () => ({
          status: 200,
          body: JSON.stringify({ task: { id: 't-2', status: 'failed', error: { code: '1026', message: 'video description contains sensitive content' } } }),
        }),
      },
    ])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    const ref = await provider.submit(textRequest(), SIGNAL)
    const status = await provider.poll(ref, SIGNAL)
    expect(status).toEqual({ state: 'failed', reason: 'video description contains sensitive content' })
  })

  it('times out when the task never settles', async () => {
    const fetcher = mockFetch([
      { path: '/v2/video_generation', handler: () => ({ status: 200, body: JSON.stringify({ task_id: 't-3' }) }) },
      {
        path: '/v2/query/video_generation/t-3',
        handler: () => ({ status: 200, body: JSON.stringify({ task: { id: 't-3', status: 'queued' } }) }),
      },
    ])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 2,
      taskTimeoutMs: 60,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    const ref = await provider.submit(textRequest(), SIGNAL)
    const status = await provider.poll(ref, SIGNAL)
    expect(status.state).toBe('failed')
    if (status.state === 'failed') expect(status.reason).toMatch(/exceeded/)
  })

  it('throws when the account is unauthorized', async () => {
    const fetcher = mockFetch([
      { path: '/v2/video_generation', handler: () => ({ status: 401, body: JSON.stringify({ error: { message: 'login fail' } }) }) },
    ])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    await expect(provider.submit(textRequest(), SIGNAL)).rejects.toThrow(/401/)
  })

  it('resolves a function apiKey per request (credential rotation)', async () => {
    let calls = 0
    const fetcher = mockFetch([
      {
        path: '/v2/video_generation',
        handler: () => ({ status: 200, body: JSON.stringify({ task_id: 't-4' }) }),
      },
      {
        path: '/v2/query/video_generation/t-4',
        handler: () => ({
          status: 200,
          body: JSON.stringify({ task: { id: 't-4', status: 'succeeded', content: { url: 'https://cdn.example.com/out2.mp4' } } }),
        }),
      },
      { path: '/out2.mp4', handler: () => ({ status: 200, body: 'MP4' }) },
    ])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: async () => {
        calls += 1
        return `sk-rotated-${calls}`
      },
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    const ref = await provider.submit(textRequest(), SIGNAL)
    await provider.poll(ref, SIGNAL)
    expect(calls).toBeGreaterThanOrEqual(2)
    const createCall = fetcher.calls.find(call => call.path === '/v2/video_generation')
    expect(new Headers(createCall?.init?.headers).get('authorization')).toBe('Bearer sk-rotated-1')
  })

  it('exposes the MiniMax-H3 capabilities', async () => {
    const ctx = base(mockFetch([]))
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: 0,
      estimatedBytesPerSecond: 1,
      fetchImpl: ctx.fetcher,
    })
    expect(provider.capabilities.name).toBe('minimax-api')
    expect(provider.capabilities.resolutions).toEqual(['768P', '2K'])
    expect(provider.capabilities.minDurationSeconds).toBe(4)
    expect(provider.capabilities.maxDurationSeconds).toBe(15)
    expect(provider.capabilities.multimodalInputs).toBe(true)
  })

  it('refuses submission when the output volume cannot hold the floor plus estimate', async () => {
    const fetcher = mockFetch([])
    const ctx = base(fetcher)
    const provider = createMiniMaxApiProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: 'MiniMax-H3',
      outputDir: ctx.outputDir,
      pollIntervalMs: 5,
      taskTimeoutMs: 10_000,
      maxConcurrency: 3,
      minFreeSpaceBytes: Number.MAX_SAFE_INTEGER,
      estimatedBytesPerSecond: 1,
      fetchImpl: fetcher,
    })
    await expect(provider.submit(textRequest(), SIGNAL)).rejects.toThrow(/insufficient disk space/)
  })
})
