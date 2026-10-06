/**
 * Model-facing video tools driven through the REAL tool registry: video_plan persists a plan,
 * video_render submits segments and starts polling jobs, video_assemble checks rendered segments
 * and invokes assembly. The jobs and h3Video services are stubs; the tools and session are the
 * shipping code.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BackendChoice, SegmentInput, SegmentRequest } from '@deepseek-ai/dsh-experimental-h3-video'
import { H3TaskRef, type H3Video } from '@deepseek-ai/dsh-experimental-h3-video'

import * as tool from '../src/index.ts'

const SIGNAL = new AbortController().signal
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tool-video-'))
  tempDirs.push(dir)
  return dir
}

function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

interface JobsStub {
  attachController: () => () => void
  start: (spec: { kind: string; label: string; owner?: Agent; outputLimitBytes?: number; run(): unknown }) => string
  lastHooks?: { done: Promise<unknown>; readOutput(): string }
}

function jobsStub(): JobsStub {
  const stub: JobsStub = {
    attachController: () => () => undefined,
    start: (spec) => {
      stub.lastHooks = spec.run() as { done: Promise<unknown>; readOutput(): string }
      return JobId('h3-video-1')
    },
  }
  return stub
}

function h3VideoStub(outputDir: string, failSubmit: { value: boolean }): H3Video & { requests: SegmentRequest[] } {
  const requests: SegmentRequest[] = []
  const stub = {
    outputDir,
    providers: [],
    capabilities: () => undefined,
    canServe: () => true,
    submit: async (choice: BackendChoice, request: SegmentRequest) => {
      requests.push(request)
      if (failSubmit.value) throw new Error('backend unreachable')
      return {
        target: { choice, provider: {} as never },
        ref: H3TaskRef(`ref-${request.inputs[0]?.type ?? 'x'}`),
      }
    },
    poll: async () => ({ state: 'succeeded' as const, localFile: join(outputDir, 'seg.mp4') }),
    cancel: async () => undefined,
    assemble: async (segments: Array<{ file: string }>, options: { outputFile: string }) => {
      mkdirSync(join(options.outputFile, '..'), { recursive: true })
      writeFileSync(options.outputFile, `concat:${segments.length}`)
      return options.outputFile
    },
    keyframe: async () => {
      const file = join(outputDir, 'gen-keyframe.png')
      writeFileSync(file, 'png')
      return file
    },
  } as unknown as H3Video & { requests: SegmentRequest[] }
  return Object.assign(stub, { requests })
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown, agent: Agent & { session: Session }) {
  return ctx.tools.execute({
    signal: SIGNAL,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  const outputDir = tempDir()
  const jobs = jobsStub()
  const failSubmit = { value: false }
  const h3Video = h3VideoStub(outputDir, failSubmit)
  ctx.provide('jobs', jobs as never)
  ctx.provide('h3Video', h3Video as never)
  await ctx.plugin(tool)
  return { ctx, outputDir, jobs, failSubmit, h3Video }
}

const PLAN_ARGS = {
  goal: 'a 12s brand film',
  mode: 'per_segment' as const,
  segments: [
    {
      id: 's1',
      prompt: 'opening wide shot of a mountain',
      camera: 'slow push-in',
      duration_seconds: 6,
      resolution: '768P',
      ratio: '16:9',
      backend: 'local',
    },
    {
      id: 's2',
      prompt: 'close-up of the summit',
      duration_seconds: 6,
      resolution: '768P',
      ratio: '16:9',
      backend: 'auto',
    },
  ],
}

describe('dsh-experimental-tool-video', () => {
  it('registers the six video tools', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(['video_assemble', 'video_asset_images', 'video_assets', 'video_keyframes', 'video_plan', 'video_render'])
  })

  it('video_plan creates and persists a plan, then revisions it', async () => {
    const { ctx, outputDir } = await setup()
    const agent = agentWithSession('planner')
    const created = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error('expected plan success')
    const plan = created.value as { id: string; revision: number; segments: unknown[]; planFile: string }
    expect(plan.id).toBe('vp-1')
    expect(plan.revision).toBe(1)
    expect(plan.segments).toHaveLength(2)
    expect(existsSync(plan.planFile)).toBe(true)
    expect(plan.planFile.startsWith(outputDir)).toBe(true)

    const revised = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, plan_id: plan.id }, agent)
    if (revised.isError) throw new Error('expected revise success')
    expect((revised.value as { revision: number }).revision).toBe(2)
  })

  it('video_plan rejects duplicate segment ids and empty prompts', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const dup = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [PLAN_ARGS.segments[0], { ...PLAN_ARGS.segments[1], id: 's1' }],
    }, agent)
    expect(dup.isError).toBe(true)
    const blank = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '   ' }],
    }, agent)
    expect(blank.isError).toBe(true)
  })

  it('video_render submits each selected segment and starts one polling job', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('renderer')
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, segment_ids: ['s1'] }, agent)
    expect(rendered.isError).toBe(false)
    if (rendered.isError) throw new Error('expected render success')
    const value = rendered.value as {
      planId: string
      submissions: Array<{ segmentId: string; state: string; jobId?: string; taskRef?: string }>
      notice: string
    }
    expect(value.planId).toBe(planId)
    expect(value.submissions).toHaveLength(1)
    expect(value.submissions[0]?.segmentId).toBe('s1')
    expect(value.submissions[0]?.state).toBe('submitted')
    expect(value.submissions[0]?.jobId).toBe('h3-video-1')
    expect(value.submissions[0]?.taskRef).toBe('ref-text')
    expect(value.notice).toContain('submitted 1')
  })

  it('video_render reports a failed submission without a job id', async () => {
    const { ctx, failSubmit } = await setup()
    failSubmit.value = true
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const rendered = await callTool(ctx, 'video_render', { plan_id: planId }, agent)
    if (rendered.isError) throw new Error('expected render value')
    const submissions = (rendered.value as { submissions: Array<{ state: string; error?: string }> }).submissions
    expect(submissions.every(submission => submission.state === 'failed')).toBe(true)
    expect(submissions[0]?.error).toContain('backend unreachable')
  })

  it('video_assemble fails listing segments that were not rendered', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const assembled = await callTool(ctx, 'video_assemble', { plan_id: planId }, agent)
    expect(assembled.isError).toBe(true)
    const message = (assembled.content.find(block => block.type === 'text')?.text ?? '') + JSON.stringify(assembled)
    expect(message).toContain('missing rendered segments')
  })

  it('video_assemble concatenates rendered segments into the final file', async () => {
    const { ctx, outputDir } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    // Create the canonical segment files the assemble tool expects.
    const segmentsDir = join(outputDir, 'segments')
    mkdirSync(segmentsDir, { recursive: true })
    for (const segment of PLAN_ARGS.segments) {
      writeFileSync(join(segmentsDir, `${planId}-${segment.id}.mp4`), 'bytes')
    }
    const assembled = await callTool(ctx, 'video_assemble', { plan_id: planId }, agent)
    expect(assembled.isError).toBe(false)
    if (assembled.isError) throw new Error('expected assemble success')
    const value = assembled.value as { outputFile: string; segments: string[]; durationSeconds: number }
    expect(value.segments).toHaveLength(2)
    expect(value.durationSeconds).toBe(12)
    expect(existsSync(value.outputFile)).toBe(true)
  })

  it('persists segment references and sends them as image inputs on render', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      goal: 'i2v with a keyframe',
      segments: [{
        ...PLAN_ARGS.segments[0],
        backend: 'remote',
        references: [{
          type: 'image',
          source: 'C:/Users/demo/first-frame.png',
          role: 'first_frame',
        }],
      }],
    }, agent)
    expect(planned.isError).toBe(false)
    if (planned.isError) throw new Error('expected plan success')
    const planValue = planned.value as { segments: Array<{ references?: Array<{ type: string; source: string; role: string }> }> }
    expect(planValue.segments[0]?.references).toEqual([
      { type: 'image', source: 'C:/Users/demo/first-frame.png', role: 'first_frame' },
    ])
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId }, agent)
    expect(rendered.isError).toBe(false)
    const submitted = h3Video.requests
    expect(submitted).toHaveLength(1)
    const inputs = submitted[0]?.inputs ?? []
    expect(inputs.some(input => input.type === 'image' && input.role === 'first_frame'
      && input.url === 'C:/Users/demo/first-frame.png')).toBe(true)
    expect(inputs.some(input => input.type === 'text')).toBe(true)
  })

  it('rejects a reference whose role does not match its type', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [{
        ...PLAN_ARGS.segments[0],
        references: [{ type: 'image', source: 'C:/x.png', role: 'reference_audio' }],
      }],
    }, agent)
    expect(planned.isError).toBe(true)
  })

  it('multi_shot renders the whole storyboard as ONE coherent task', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, mode: 'multi_shot' }, agent)
    expect(planned.isError).toBe(false)
    if (planned.isError) throw new Error('expected plan success')
    expect((planned.value as { mode: string }).mode).toBe('multi_shot')
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId }, agent)
    expect(rendered.isError).toBe(false)
    if (rendered.isError) throw new Error('expected render success')
    const submissions = (rendered.value as { submissions: Array<{ segmentId: string; state: string; jobId?: string }> }).submissions
    expect(submissions).toHaveLength(1)
    expect(submissions[0]?.segmentId).toBe('all')
    expect(submissions[0]?.state).toBe('submitted')
    expect(h3Video.requests).toHaveLength(1)
    // The single request carries the folded multi-shot timeline.
    const prompt = h3Video.requests[0]?.inputs.find(input => input.type === 'text')
    expect(prompt?.type === 'text' && prompt.text).toContain('[0s-6s] Shot 1')
    expect(prompt?.type === 'text' && prompt.text).toContain('[6s-12s] Shot 2')
    expect(h3Video.requests[0]?.durationSeconds).toBe(12)
  })

  it('multi_shot assembly returns the single rendered clip without concat', async () => {
    const { ctx, outputDir } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, mode: 'multi_shot' }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const allFile = join(outputDir, 'segments', `${planId}-all.mp4`)
    mkdirSync(dirname(allFile), { recursive: true })
    writeFileSync(allFile, 'bytes')

    const assembled = await callTool(ctx, 'video_assemble', { plan_id: planId }, agent)
    expect(assembled.isError).toBe(false)
    if (assembled.isError) throw new Error('expected assemble success')
    const value = assembled.value as { outputFile: string; segments: string[]; durationSeconds: number }
    expect(value.outputFile).toBe(allFile)
    expect(value.segments).toEqual([allFile])
    expect(value.durationSeconds).toBe(12)
  })

  it('multi_shot rejects a plan over the 15s single-task ceiling', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      mode: 'multi_shot',
      segments: [{ ...PLAN_ARGS.segments[0], duration_seconds: 10 }, { ...PLAN_ARGS.segments[1], duration_seconds: 10 }],
    }, agent)
    expect(planned.isError).toBe(true)
  })

  it('video_keyframes generates a keyframe per segment into the keyframes directory', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const keyframed = await callTool(ctx, 'video_keyframes', { plan_id: planId }, agent)
    expect(keyframed.isError).toBe(false)
    if (keyframed.isError) throw new Error('expected keyframe success')
    const keyframes = (keyframed.value as { keyframes: Array<{ segmentId: string; state: string; keyframe?: string }> }).keyframes
    expect(keyframes).toHaveLength(2)
    expect(keyframes.every(keyframe => keyframe.state === 'generated')).toBe(true)
    for (const keyframe of keyframes) {
      expect(existsSync(keyframe.keyframe!)).toBe(true)
      expect(keyframe.keyframe).toContain(`${planId}-${keyframe.segmentId}.png`)
    }
  })

  it('video_render attaches an existing keyframe as the first frame (image-to-video)', async () => {
    const { ctx, outputDir, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    // Create only s1's keyframe; s2 has none.
    const keyframe = join(outputDir, 'keyframes', `${planId}-s1.png`)
    mkdirSync(dirname(keyframe), { recursive: true })
    writeFileSync(keyframe, 'png')

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, segment_ids: ['s1', 's2'] }, agent)
    expect(rendered.isError).toBe(false)
    const s1Request = h3Video.requests[0]
    const s2Request = h3Video.requests[1]
    expect(s1Request?.inputs.some(input => input.type === 'image' && input.role === 'first_frame')).toBe(true)
    expect(s2Request?.inputs.some(input => input.type === 'image')).toBe(false)
  })

  it('video_assets records user-provided materials and render anchors shots on them', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const assets = await callTool(ctx, 'video_assets', {
      plan_id: planId,
      style: '赛博朋克夜城',
      assets: [
        { id: 'char-1', name: '小明', kind: 'character', reference: 'C:/Users/demo/xiaoming.png' },
        { id: 'scene-1', name: '咖啡馆', kind: 'scene', reference: 'C:/Users/demo/cafe.png' },
      ],
    }, agent)
    expect(assets.isError).toBe(false)
    if (assets.isError) throw new Error('expected assets success')
    const planValue = assets.value as { style?: string; assets?: Array<{ name: string; reference?: string }> }
    expect(planValue.style).toBe('赛博朋克夜城')
    expect(planValue.assets).toHaveLength(2)

    // No keyframes exist → render anchors on the asset reference images.
    const rendered = await callTool(ctx, 'video_render', { plan_id: planId }, agent)
    expect(rendered.isError).toBe(false)
    const request = h3Video.requests[0]
    const refs = request?.inputs.filter((input): input is Extract<SegmentInput, { type: 'image' }> =>
      input.type === 'image' && input.role === 'reference_image') ?? []
    expect(refs).toHaveLength(2)
    expect(refs.some(ref => ref.url === 'C:/Users/demo/xiaoming.png')).toBe(true)
    expect(refs.some(ref => ref.url === 'C:/Users/demo/cafe.png')).toBe(true)
  })

  it('rejects a video_assets reference that is neither a path nor a URL', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const assets = await callTool(ctx, 'video_assets', {
      plan_id: planId,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', reference: 'relative/path.png' }],
    }, agent)
    expect(assets.isError).toBe(true)
  })

  it('video_asset_images generates reference images for assets without one and records them', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', description: '二十出头的年轻人，短发，深蓝工装' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const generated = await callTool(ctx, 'video_asset_images', { plan_id: planId }, agent)
    expect(generated.isError).toBe(false)
    if (generated.isError) throw new Error('expected asset image success')
    const results = (generated.value as { assets: Array<{ assetId: string; state: string; image?: string }> }).assets
    expect(results).toHaveLength(1)
    expect(results[0]?.state).toBe('generated')
    const image = results[0]?.image
    expect(image).toBeDefined()
    expect(existsSync(image!)).toBe(true)
    expect(image).toContain(`${planId}-char-1.png`)

    // The plan now carries the generated reference for rendering to anchor on.
    const reread = await callTool(ctx, 'video_assets', { plan_id: planId, assets: [] }, agent)
    expect(reread.isError).toBe(false)
    const planAssets = (reread.value as { assets?: Array<{ id: string; reference?: string }> }).assets ?? []
    expect(planAssets.find(asset => asset.id === 'char-1')?.reference).toBe(image)
    // And a render with no keyframes anchors on the generated asset reference.
    await callTool(ctx, 'video_render', { plan_id: planId }, agent)
  })
})
