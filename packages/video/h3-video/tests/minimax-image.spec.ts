/**
 * The hosted image provider: character-subject conditioning for keyframes, the inline reference
 * formats the image API accepts, and the published caps that fail before submission.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniMaxImageProvider } from '../src/minimax-image.ts'
import type { MiniMaxImageOptions } from '../src/minimax-image.ts'
import type { FetchLike } from '../src/http.ts'

const SIGNAL = new AbortController().signal
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h3-image-'))
  tempDirs.push(dir)
  return dir
}

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** The image-generation body one recorded call sent. */
interface ImageGenerationBody {
  readonly prompt?: string
  readonly seed?: number
  readonly subject_reference?: ReadonlyArray<{ readonly type: string; readonly image_file: string }>
}

/** Parse the JSON body of a recorded call, failing when the call sent none. */
function jsonBody(call: Call | undefined): ImageGenerationBody {
  const body = call?.init?.body
  if (typeof body !== 'string') throw new Error('expected a JSON request body')
  return JSON.parse(body) as ImageGenerationBody
}

type MockFetch = FetchLike & { readonly calls: Call[] }

/** Answer the generation POST with one URL and every other request with image bytes. */
function mockFetch(generation?: (body: ImageGenerationBody) => { status?: number; body: string }): MockFetch {
  const calls: Call[] = []
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ url: input, init })
    if (input.endsWith('/v1/image_generation')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as ImageGenerationBody : {}
      const answer = generation?.(body) ?? {
        body: JSON.stringify({ data: { image_urls: ['https://cdn.example/keyframe.png'] } }),
      }
      return Promise.resolve(new Response(answer.body, { status: answer.status ?? 200 }))
    }
    return Promise.resolve(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }))
  }
  return Object.assign(fetchImpl, { calls })
}

function provider(fetchImpl: FetchLike, overrides: Partial<MiniMaxImageOptions> = {}): ReturnType<typeof createMiniMaxImageProvider> {
  const options: MiniMaxImageOptions = {
    apiKey: 'sk-test',
    baseUrl: 'https://api.minimax.cn',
    model: 'image-01',
    outputDir: tempDir(),
    minFreeSpaceBytes: 0,
    fetchImpl,
    ...overrides,
  }
  return createMiniMaxImageProvider(options)
}

describe('createMiniMaxImageProvider', () => {
  it('sends a local character reference as the API subject_reference data URI', async () => {
    const dir = tempDir()
    const character = join(dir, 'xiaoming.png')
    writeFileSync(character, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))
    const fetcher = mockFetch()
    await provider(fetcher).generate({ prompt: '小明站在山顶', ratio: '16:9', subjectReference: character }, SIGNAL)
    const call = fetcher.calls.find(entry => entry.url.endsWith('/v1/image_generation'))
    const body = jsonBody(call)
    expect(body.subject_reference).toHaveLength(1)
    expect(body.subject_reference?.[0]?.type).toBe('character')
    expect(body.subject_reference?.[0]?.image_file).toMatch(/^data:image\/png;base64,/u)
  })

  it('passes an https character reference through and forwards the seed', async () => {
    const fetcher = mockFetch()
    await provider(fetcher).generate({
      prompt: '小明站在山顶',
      ratio: '16:9',
      seed: 4242,
      subjectReference: 'https://cdn.example/character.png',
    }, SIGNAL)
    const call = fetcher.calls.find(entry => entry.url.endsWith('/v1/image_generation'))
    const body = jsonBody(call)
    expect(body.subject_reference?.[0]?.image_file).toBe('https://cdn.example/character.png')
    expect(body.seed).toBe(4242)
  })

  it('refuses a subject reference that is not a PNG or JPEG', async () => {
    const dir = tempDir()
    const character = join(dir, 'character.webp')
    writeFileSync(character, Buffer.from([0x52, 0x49, 0x46, 0x46]))
    await expect(provider(mockFetch()).generate({
      prompt: 'a portrait',
      ratio: '1:1',
      subjectReference: character,
    }, SIGNAL)).rejects.toThrow(/must be a PNG or JPEG/u)
  })

  it('refuses a subject reference past the published 10 MB cap', async () => {
    const dir = tempDir()
    const character = join(dir, 'huge.png')
    writeFileSync(character, Buffer.alloc(10 * 1024 * 1024 + 1, 1))
    await expect(provider(mockFetch()).generate({
      prompt: 'a portrait',
      ratio: '1:1',
      subjectReference: character,
    }, SIGNAL)).rejects.toThrow(/over the 10 MB image cap/u)
  })

  it('leaves subject_reference out when the request carries none', async () => {
    const fetcher = mockFetch()
    await provider(fetcher).generate({ prompt: 'an empty street', ratio: '16:9' }, SIGNAL)
    const call = fetcher.calls.find(entry => entry.url.endsWith('/v1/image_generation'))
    expect(jsonBody(call).subject_reference).toBeUndefined()
  })
})
