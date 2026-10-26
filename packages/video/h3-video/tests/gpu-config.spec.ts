/**
 * Composition-time rules for the cloud GPU row: a provisioned instance owns the ComfyUI endpoint,
 * so a static URL or a local input directory beside it is misconfiguration that fails at load.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import H3VideoService from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** A local backend row provisioning a GPU instance with one overridden field set. */
function gpuConfig(gpu: Record<string, unknown> = {}, comfy: Record<string, unknown> = {}): Config {
  return {
    comfy: {
      workflowPath: 'D:/ComfyUI/template.json',
      gpu: {
        gpuSpecUuid: 'v-32g-p',
        imageUuid: 'image-comfyui',
        apiToken: 'test-token',
        ...gpu,
      },
      ...comfy,
    },
  }
}

/** Mount the service and return its context; the caller disposes it. */
async function mounted(config: Config): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(H3VideoService, config as never)
  await fiber.await()
  return ctx
}

/** Mount the service expecting the load to fail, and return the failure. */
async function mountFailure(config: Config): Promise<unknown> {
  const ctx = new Context()
  try {
    const fiber = ctx.plugin(H3VideoService, config as never)
    await fiber.await()
  } catch (error: unknown) {
    return error
  } finally {
    await ctx.fiber.dispose()
  }
  throw new Error('expected the composition to fail at load')
}

describe('comfy.gpu composition rules', () => {
  it('rejects a local backend with no address at all', async () => {
    const error = await mountFailure({ comfy: { workflowPath: 'D:/ComfyUI/template.json' } })
    expect(String(error)).toMatch(/comfy\.url is required/u)
  })

  it('rejects a static URL beside a provisioned instance', async () => {
    const error = await mountFailure(gpuConfig({}, { url: 'http://127.0.0.1:8188' }))
    expect(String(error)).toMatch(/mutually exclusive/u)
  })

  it('rejects a local input directory beside a provisioned instance', async () => {
    const error = await mountFailure(gpuConfig({}, { inputDir: 'D:/ComfyUI/input' }))
    expect(String(error)).toMatch(/inputDir/u)
  })

  it('requires the boot image', async () => {
    const error = await mountFailure(gpuConfig({ imageUuid: '' }))
    expect(String(error)).toMatch(/imageUuid/u)
  })

  it('requires a token or a token reference', async () => {
    const error = await mountFailure(gpuConfig({ apiToken: '' }))
    expect(String(error)).toMatch(/apiToken/u)
  })

  it('reports the static local backend instead of claiming nothing is configured', async () => {
    // A static ComfyUI address is a real local backend: reporting it as "no cloud GPU" reads as
    // "no local backend" and sends callers to the paid API.
    const ctx = await mounted({
      comfy: { workflowPath: 'D:/ComfyUI/template.json', url: 'http://127.0.0.1:8188' },
    })
    const status = await ctx.h3Video.gpuStatus()
    expect(status).toMatchObject({ configured: true, vendor: 'static', serviceUrl: 'http://127.0.0.1:8188' })
    expect(['running', 'stopped']).toContain(status.state)
    await expect(ctx.h3Video.gpuDown('stop')).rejects.toThrow(/static address/u)
    await ctx.fiber.dispose()
  })

  it('reports no GPU at all when the composition configures only the hosted API', async () => {
    const ctx = await mounted({ minimax: { apiKey: 'test-key' } } as never)
    expect(await ctx.h3Video.gpuStatus()).toEqual({ configured: false, state: 'absent' })
    await ctx.fiber.dispose()
  })

  it('reports the configured instance as absent before the first boot', async () => {
    const ctx = await mounted(gpuConfig())
    const status = await ctx.h3Video.gpuStatus()
    expect(status).toMatchObject({ configured: true, vendor: 'autodl', state: 'absent' })
    await ctx.fiber.dispose()
  })
})
