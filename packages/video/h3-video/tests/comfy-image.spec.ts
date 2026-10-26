/**
 * comfy-image provider tests: one submit → history → view round trip over a fetch stub, the
 * placeholder fill, and a run that finishes without an image.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComfyUIImageProvider } from '../src/comfy-image.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'comfy-image-'))
  tempDirs.push(dir)
  return dir
}

const TEMPLATE = JSON.stringify({
  1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  2: { class_type: 'EmptyLatent', inputs: { width: '{{width}}', height: '{{height}}' } },
  3: { class_type: 'Sampler', inputs: { seed: '{{seed}}' } },
  4: { class_type: 'SaveImage', inputs: {} },
})

function provider(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  referenceWorkflow = false,
) {
  const outputDir = tempDir()
  const workflowPath = join(tempDir(), 'image.json')
  writeFileSync(workflowPath, TEMPLATE)
  const referenceWorkflowPath = referenceWorkflow ? join(tempDir(), 'image-ref.json') : undefined
  if (referenceWorkflowPath !== undefined) {
    writeFileSync(referenceWorkflowPath, JSON.stringify({
      1: { class_type: 'LoadImage', inputs: { image: '{{reference}}' } },
      2: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    }))
  }
  return {
    outputDir,
    client: createComfyUIImageProvider({
      baseUrl: 'http://127.0.0.1:8188',
      workflowPath,
      ...(referenceWorkflowPath !== undefined ? { referenceWorkflowPath } : {}),
      outputDir,
      pollIntervalMs: 1,
      taskTimeoutMs: 5_000,
      fetchImpl,
    }),
  }
}

describe('comfy image provider', () => {
  it('submits the filled workflow, polls once, and writes the served image', async () => {
    const submitted: Array<{ prompt?: Record<string, { inputs: Record<string, unknown> }> }> = []
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/prompt')) {
        submitted.push(JSON.parse(String(init?.body)) as typeof submitted[number])
        return new Response(JSON.stringify({ prompt_id: 'p-1' }), { status: 200 })
      }
      if (input.includes('/history/')) {
        return new Response(JSON.stringify({ 'p-1': { outputs: { 4: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }), { status: 200 })
      }
      if (input.includes('/view?')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      throw new Error(`unexpected fetch ${input}`)
    })

    const { client, outputDir } = provider(fetchImpl)
    const file = await client.generate({ prompt: '雪林里的红狐狸', ratio: '16:9', seed: 7 }, new AbortController().signal)

    const workflow = submitted[0]?.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(workflow['1']?.inputs.text).toBe('雪林里的红狐狸')
    expect(workflow['2']?.inputs).toEqual({ width: 1280, height: 720 })
    expect(workflow['3']?.inputs.seed).toBe(7)
    expect(readFileSync(file)).toEqual(Buffer.from([1, 2, 3]))
    expect(file.startsWith(outputDir)).toBe(true)
  })

  it('uploads a confirmed portrait and renders from the reference workflow', async () => {
    const uploads: string[] = []
    const submitted: Array<Record<string, { inputs: Record<string, unknown> }>> = []
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/upload/image')) {
        uploads.push(String(input))
        return new Response(JSON.stringify({ name: 'ref.png', subfolder: '', type: 'input' }), { status: 200 })
      }
      if (input.endsWith('/prompt')) {
        const body = JSON.parse(String(init?.body)) as { prompt?: Record<string, { inputs: Record<string, unknown> }> }
        submitted.push(body.prompt ?? {})
        return new Response(JSON.stringify({ prompt_id: 'p-3' }), { status: 200 })
      }
      if (input.includes('/history/')) {
        return new Response(JSON.stringify({ 'p-3': { outputs: { 9: { images: [{ filename: 'sheet.png', subfolder: '', type: 'output' }] } } } }), { status: 200 })
      }
      return new Response(new Uint8Array([9]), { status: 200 })
    })

    const portrait = join(tempDir(), 'portrait.png')
    writeFileSync(portrait, new Uint8Array([1]))
    const { client } = provider(fetchImpl, true)
    await client.generate({ prompt: '三视图', ratio: '16:9', seed: 3, subjectReference: portrait }, new AbortController().signal)

    expect(uploads).toHaveLength(1)
    // The reference workflow is chosen and the uploaded name is wired into LoadImage.
    expect(submitted[0]?.['1']?.inputs.image).toBe('ref.png')
    expect(submitted[0]?.['2']?.inputs.text).toBe('三视图')
  })

  it('fails loud when the run finishes without a saved image', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'p-2' }), { status: 200 })
      return new Response(JSON.stringify({ 'p-2': { outputs: {} } }), { status: 200 })
    })
    const { client } = provider(fetchImpl)
    await expect(client.generate({ prompt: 'x', ratio: '1:1' }, new AbortController().signal))
      .rejects.toThrow(/without a saved image/u)
  })
})
