/**
 * ComfyUI provider tests against a mock HTTP server: submission fills the workflow template,
 * polling downloads produced media, history errors and timeouts fail the task, and cancellation
 * interrupts the queue.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComfyUIProvider } from '../src/comfyui.ts'
import type { ComfyUIOptions, FetchLike } from '../src/comfyui.ts'
import type { SegmentRequest } from '../src/types.ts'

const SIGNAL = new AbortController().signal
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function textRequest(overrides: Partial<SegmentRequest> = {}): SegmentRequest {
  return {
    inputs: [{ type: 'text', text: 'a robot walking' }],
    resolution: '768P',
    durationSeconds: 5,
    ratio: '16:9',
    ...overrides,
  }
}

function templateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h3-comfy-'))
  tempDirs.push(dir)
  const file = join(dir, 'workflow.json')
  writeFileSync(file, JSON.stringify({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1.5.safetensors' } },
    '5': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    '8': { class_type: 'VAEDecode', inputs: {} },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'h3-test' } },
    '10': { class_type: 'ResolutionText', inputs: { text: '{{resolution}}' } },
  }))
  return file
}

function outputDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h3-comfy-out-'))
  tempDirs.push(dir)
  return dir
}

interface Route {
  path: string
  handler: (init?: RequestInit) => { status: number; body: string }
}

type MockFetch = FetchLike & { seen: string[]; urls: URL[] }

function mockFetch(routes: Route[]): MockFetch {
  const seen: string[] = []
  const urls: URL[] = []
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input)
    const path = url.pathname + (url.search.length > 0 ? url.search : '')
    seen.push(path)
    urls.push(url)
    const route = routes.find(candidate => path.startsWith(candidate.path))
    if (route === undefined) throw new Error(`unexpected request ${path}`)
    const { status, body } = route.handler(init)
    return Promise.resolve(new Response(body, { status }))
  }
  return Object.assign(fetch, { seen, urls })
}

function makeOptions(overrides: Partial<ComfyUIOptions> = {}): ComfyUIOptions {
  return {
    baseUrl: 'http://127.0.0.1:8188',
    workflowPath: templateFile(),
    promptField: 'prompt',
    resolutionField: 'resolution',
    durationField: 'duration',
    ratioField: 'ratio',
    seedField: 'seed',
    outputDir: outputDir(),
    pollIntervalMs: 5,
    taskTimeoutMs: 10_000,
    maxConcurrency: 1,
    resolutions: ['768P'],
    minDurationSeconds: 1,
    maxDurationSeconds: 10,
    minFreeSpaceBytes: 0,
    estimatedBytesPerSecond: 1,
    ...overrides,
  }
}

describe('createComfyUIProvider', () => {
  it('submits the filled workflow and downloads the produced video on success', async () => {
    const fetcher = mockFetch([
      {
        path: '/prompt',
        handler: () => ({ status: 200, body: JSON.stringify({ prompt_id: 'p-1' }) }),
      },
      {
        path: '/history/p-1',
        handler: () => ({
          status: 200,
          body: JSON.stringify({
            'p-1': { outputs: { '9': { images: [{ filename: 'clip.png', subfolder: '', type: 'output' }] } } },
          }),
        }),
      },
      {
        path: '/view',
        handler: () => ({ status: 200, body: 'MP4BYTES' }),
      },
    ])
    const provider = createComfyUIProvider(makeOptions({ fetchImpl: fetcher }))
    const ref = await provider.submit(textRequest(), SIGNAL)
    expect(String(ref)).toBe('p-1')
    const status = await provider.poll(ref, SIGNAL)
    expect(status.state).toBe('succeeded')
    if (status.state === 'succeeded') {
      expect(readFileSync(status.localFile, 'utf8')).toBe('MP4BYTES')
    }
    expect(fetcher.seen).toContain('/prompt')
    expect(fetcher.seen).toContain('/history/p-1')
  })

  it('fails the task when history reports an execution error', async () => {
    const fetcher = mockFetch([
      { path: '/prompt', handler: () => ({ status: 200, body: JSON.stringify({ prompt_id: 'p-2' }) }) },
      {
        path: '/history/p-2',
        handler: () => ({
          status: 200,
          body: JSON.stringify({
            'p-2': { status: { status_str: 'error', messages: [['execution_error', { message: 'CUDA OOM' }]] } },
          }),
        }),
      },
    ])
    const provider = createComfyUIProvider(makeOptions({ fetchImpl: fetcher }))
    const ref = await provider.submit(textRequest(), SIGNAL)
    const status = await provider.poll(ref, SIGNAL)
    expect(status).toEqual({ state: 'failed', reason: 'CUDA OOM' })
  })

  it('times out when no output appears before the deadline', async () => {
    const fetcher = mockFetch([
      { path: '/prompt', handler: () => ({ status: 200, body: JSON.stringify({ prompt_id: 'p-3' }) }) },
      { path: '/history/p-3', handler: () => ({ status: 200, body: '{}' }) },
    ])
    const provider = createComfyUIProvider(makeOptions({ fetchImpl: fetcher, pollIntervalMs: 2, taskTimeoutMs: 60 }))
    const ref = await provider.submit(textRequest(), SIGNAL)
    const status = await provider.poll(ref, SIGNAL)
    expect(status.state).toBe('failed')
    if (status.state === 'failed') expect(status.reason).toMatch(/exceeded/)
  })

  it('cancels a live task by interrupting the queue', async () => {
    const fetcher = mockFetch([
      { path: '/prompt', handler: () => ({ status: 200, body: JSON.stringify({ prompt_id: 'p-4' }) }) },
      { path: '/interrupt', handler: () => ({ status: 200, body: '{}' }) },
    ])
    const provider = createComfyUIProvider(makeOptions({ fetchImpl: fetcher }))
    const ref = await provider.submit(textRequest(), SIGNAL)
    await provider.cancel(ref)
    expect(fetcher.seen).toContain('/interrupt')
  })

  it('refuses submission when the output volume cannot hold the floor plus estimate', async () => {
    const fetcher = mockFetch([])
    const provider = createComfyUIProvider(makeOptions({
      fetchImpl: fetcher,
      minFreeSpaceBytes: Number.MAX_SAFE_INTEGER,
    }))
    await expect(provider.submit(textRequest(), SIGNAL)).rejects.toThrow(/insufficient disk space/)
  })

  it('exposes capabilities used by routing', async () => {
    const provider = createComfyUIProvider(makeOptions({
      fetchImpl: mockFetch([]),
      resolutions: ['480P', '768P'],
      minDurationSeconds: 2,
      maxDurationSeconds: 8,
      maxConcurrency: 2,
    }))
    expect(provider.capabilities.name).toBe('comfyui-local')
    expect(provider.capabilities.resolutions).toEqual(['480P', '768P'])
    expect(provider.capabilities.maxDurationSeconds).toBe(8)
    expect(provider.capabilities.maxConcurrency).toBe(2)
    // The workflow serves image conditioning (keyframes and reference images) when inputDir is set.
    expect(provider.capabilities.multimodalInputs).toBe(true)
  })

  it('wires reference images into MiniMaxH3ReferenceToVideo for local reference conditioning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'h3-comfy-ref-'))
    tempDirs.push(dir)
    const inputDir = join(dir, 'input')
    const keyframe = join(dir, 'ref.png')
    writeFileSync(keyframe, 'PNGDATA')
    const workflowPath = join(dir, 'r2v-workflow.json')
    writeFileSync(workflowPath, JSON.stringify({
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'x.safetensors', type: 'minimax' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: 'y.safetensors' } },
      '10': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: '{{prompt}}', width: 1344, height: 768, length: '{{length}}' } },
    }))
    let posted: unknown
    const fetcher = mockFetch([
      { path: '/prompt', handler: (init) => { posted = init?.body; return { status: 200, body: JSON.stringify({ prompt_id: 'p-r2v' }) } } },
    ])
    const provider = createComfyUIProvider(makeOptions({ workflowPath, inputDir, fetchImpl: fetcher }))
    await provider.submit({
      inputs: [
        { type: 'text', text: 'the hero walks in' },
        { type: 'image', url: keyframe, role: 'reference_image' },
      ],
      resolution: '768P',
      durationSeconds: 5,
      ratio: '16:9',
    }, SIGNAL)
    const graph = JSON.parse(String(posted)) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }
    const h3 = graph.prompt['10']
    if (h3 === undefined) throw new Error('missing H3 node in posted workflow')
    expect(h3.class_type).toBe('MiniMaxH3ReferenceToVideo')
    expect(h3.inputs.ref_image_size).toBe('match')
    const links = h3.inputs.ref_images as Array<[string, number]>
    expect(links).toHaveLength(1)
    const loadNode = graph.prompt[links[0]![0]]
    expect(loadNode?.class_type).toBe('LoadImage')
    expect(existsSync(join(inputDir, loadNode?.inputs.image as string))).toBe(true)
  })

  it('wires a keyframe into the H3 first-frame input for local image-to-video', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'h3-comfy-i2v-'))
    tempDirs.push(dir)
    const inputDir = join(dir, 'input')
    const keyframe = join(dir, 'first.png')
    writeFileSync(keyframe, 'PNGDATA')
    const workflowPath = join(dir, 'i2v-workflow.json')
    writeFileSync(workflowPath, JSON.stringify({
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'x.safetensors', type: 'minimax' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: 'y.safetensors' } },
      '10': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: '{{prompt}}', width: 1344, height: 768, length: '{{length}}' } },
    }))
    let posted: unknown
    const fetcher = mockFetch([
      { path: '/prompt', handler: (init) => { posted = init?.body; return { status: 200, body: JSON.stringify({ prompt_id: 'p-i2v' }) } } },
    ])
    const provider = createComfyUIProvider(makeOptions({ workflowPath, inputDir, fetchImpl: fetcher }))
    await provider.submit({
      inputs: [
        { type: 'text', text: 'the hero walks in' },
        { type: 'image', url: keyframe, role: 'first_frame' },
      ],
      resolution: '768P',
      durationSeconds: 5,
      ratio: 'adaptive',
    }, SIGNAL)
    const graph = JSON.parse(String(posted)) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }
    const h3 = graph.prompt['10']
    if (h3 === undefined) throw new Error('missing H3 node in posted workflow')
    expect(h3.class_type).toBe('MiniMaxH3ImageToVideo')
    const link = h3.inputs.first_frame as [string, number]
    const loadNode = graph.prompt[link[0]]
    expect(loadNode?.class_type).toBe('LoadImage')
    expect(existsSync(join(inputDir, loadNode?.inputs.image as string))).toBe(true)
  })

  it('uploads image conditioning through the server when no input directory is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'h3-comfy-upload-'))
    tempDirs.push(dir)
    const keyframe = join(dir, 'remote-ref.png')
    writeFileSync(keyframe, 'PNGDATA')
    const workflowPath = join(dir, 'remote-workflow.json')
    writeFileSync(workflowPath, JSON.stringify({
      '10': { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: '{{prompt}}', length: '{{length}}' } },
    }))
    let posted: unknown
    let uploaded: FormData | undefined
    const fetcher = mockFetch([
      {
        path: '/upload/image',
        handler: (init) => {
          uploaded = init?.body as FormData
          return { status: 200, body: JSON.stringify({ name: 'remote-upload.png', subfolder: '' }) }
        },
      },
      { path: '/prompt', handler: (init) => { posted = init?.body; return { status: 200, body: JSON.stringify({ prompt_id: 'p-up' }) } } },
    ])
    const provider = createComfyUIProvider(makeOptions({ workflowPath, fetchImpl: fetcher }))
    await provider.submit({
      inputs: [
        { type: 'text', text: 'the hero walks in' },
        { type: 'image', url: keyframe, role: 'first_frame' },
      ],
      resolution: '768P',
      durationSeconds: 5,
      ratio: 'adaptive',
    }, SIGNAL)
    expect(fetcher.seen).toContain('/upload/image')
    expect(uploaded?.get('type')).toBe('input')
    const graph = JSON.parse(String(posted)) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }
    const link = graph.prompt['10']?.inputs.first_frame as [string, number]
    expect(graph.prompt[link[0]]?.inputs.image).toBe('remote-upload.png')
  })

  it('resolves its origin per operation for a provisioned GPU instance', async () => {
    const origins = ['https://gpu-1.example:8443', 'https://gpu-2.example:8443']
    let resolved = 0
    const fetcher = mockFetch([
      { path: '/prompt', handler: () => ({ status: 200, body: JSON.stringify({ prompt_id: 'p-gpu' }) }) },
      {
        path: '/history/p-gpu',
        handler: () => ({ status: 200, body: JSON.stringify({ 'p-gpu': { outputs: { '9': { images: [{ filename: 'clip.png', type: 'output' }] } } } }) }),
      },
      { path: '/view', handler: () => ({ status: 200, body: 'MP4BYTES' }) },
    ])
    const options = makeOptions({ fetchImpl: fetcher })
    delete options.baseUrl
    options.resolveBaseUrl = async () => origins[Math.min(resolved++, origins.length - 1)] as string
    const provider = createComfyUIProvider(options)
    const ref = await provider.submit(textRequest(), SIGNAL)
    expect((await provider.poll(ref, SIGNAL)).state).toBe('succeeded')
    expect(fetcher.urls[0]?.origin).toBe('https://gpu-1.example:8443')
    expect(fetcher.urls[1]?.origin).toBe('https://gpu-2.example:8443')
  })

  it('fills the workflow seed from the request when one is supplied', async () => {
    let posted: unknown
    const fetcher = mockFetch([
      { path: '/prompt', handler: (init) => { posted = init?.body; return { status: 200, body: JSON.stringify({ prompt_id: 'p-seed' }) } } },
    ])
    const provider = createComfyUIProvider(makeOptions({ fetchImpl: fetcher }))
    await provider.submit(textRequest({ seed: 4242 }), SIGNAL)
    const graph = JSON.parse(String(posted)) as { prompt: Record<string, { inputs: Record<string, unknown> }> }
    expect(graph.prompt['5']?.inputs.seed).toBe(4242)
  })

  it('requires a static or resolved origin', () => {
    const options = makeOptions()
    delete options.baseUrl
    expect(() => createComfyUIProvider(options)).toThrow(/baseUrl or resolveBaseUrl/u)
  })
})
