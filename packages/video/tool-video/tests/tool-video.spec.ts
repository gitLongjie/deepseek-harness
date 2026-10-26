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
import type { BackendChoice, KeyframeRequest, SegmentInput, SegmentRequest } from '@deepseek-ai/dsh-h3-video'
import { H3TaskRef, type H3Video } from '@deepseek-ai/dsh-h3-video'

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
  starts: number
}

function jobsStub(): JobsStub {
  const stub: JobsStub = {
    attachController: () => () => undefined,
    start: (spec) => {
      stub.starts += 1
      stub.lastHooks = spec.run() as { done: Promise<unknown>; readOutput(): string }
      return JobId('h3-video-1')
    },
    starts: 0,
  }
  return stub
}

function h3VideoStub(
  outputDir: string,
  failSubmit: { value: boolean },
): H3Video & {
  requests: SegmentRequest[]
  keyframeRequests: KeyframeRequest[]
  assembleOptions?: { transition?: { kind: string; seconds: number } }
  captured: { assembleOptions?: { transition?: { kind: string; seconds: number } } }
} {
  const requests: SegmentRequest[] = []
  const keyframeRequests: KeyframeRequest[] = []
  /** Assembly options the last `assemble` call received. */
  const captured: { assembleOptions?: { transition?: { kind: string; seconds: number } } } = {}
  const stub = {
    outputDir,
    providers: [],
    capabilities: () => undefined,
    canServe: () => true,
    assembleOptions: undefined as { transition?: { kind: string; seconds: number } } | undefined,
    submit: async (choice: BackendChoice, request: SegmentRequest) => {
      requests.push(request)
      if (failSubmit.value) throw new Error('backend unreachable')
      return {
        // `auto` never survives routing: the resolved target names the backend that serves it.
        target: { choice: choice === 'remote' ? 'remote' : 'local', provider: {} as never },
        ref: H3TaskRef(`ref-${request.inputs[0]?.type ?? 'x'}`),
      }
    },
    poll: async () => ({ state: 'succeeded' as const, localFile: join(outputDir, 'seg.mp4') }),
    cancel: async () => undefined,
    assemble: async (segments: Array<{ file: string }>, options: {
      outputFile: string
      transition?: { kind: string; seconds: number }
    }) => {
      captured.assembleOptions = options
      mkdirSync(join(options.outputFile, '..'), { recursive: true })
      writeFileSync(options.outputFile, `concat:${segments.length}`)
      return options.outputFile
    },
    keyframe: async (request: KeyframeRequest) => {
      keyframeRequests.push(request)
      const file = join(outputDir, 'gen-keyframe.png')
      writeFileSync(file, 'png')
      return file
    },
    gpuStatus: async () => ({
      configured: true,
      vendor: 'autodl',
      instanceId: 'pro-1',
      state: 'stopped' as const,
    }),
    gpuUp: async () => ({
      configured: true,
      vendor: 'autodl',
      instanceId: 'pro-1',
      state: 'running' as const,
      serviceUrl: 'https://gpu.example:8443',
      idleTimeoutMs: 600_000,
      idleAction: 'power_off' as const,
    }),
    gpuDown: async (mode: 'stop' | 'release') => mode === 'release'
      ? { configured: true, vendor: 'autodl', state: 'absent' as const }
      : { configured: true, vendor: 'autodl', instanceId: 'pro-1', state: 'stopped' as const },
  } as unknown as H3Video & { requests: SegmentRequest[]; keyframeRequests: KeyframeRequest[] }
  return Object.assign(stub, { requests, keyframeRequests, captured })
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

/** The settled content blocks of one tool call, for asserting what the model and UI receive. */
async function callToolContent(
  ctx: Context, name: string, args: unknown, agent: Agent & { session: Session },
): Promise<readonly { type: string; text?: string; attachment?: { attachmentId: string } }[]> {
  const result = await callTool(ctx, name, args, agent)
  if (result.isError) throw new Error(`${name} failed`)
  return (result as unknown as { content: readonly { type: string; text?: string; attachment?: { attachmentId: string } }[] }).content
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
  // A durable image store, so a material result can carry the image itself.
  ctx.provide('attachments', {
    saveImage: async ({ mediaType, name }: { mediaType: string; name?: string }) => ({
      attachmentId: `sha256:${name ?? 'material'}`,
      mediaType,
      bytes: 4,
      width: 8,
      height: 8,
      ...name === undefined ? {} : { name },
    }),
  } as never)
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

describe('dsh-tool-video', () => {
  it('registers the eight video tools', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(['video_assemble', 'video_asset_images', 'video_assets', 'video_gpu', 'video_keyframes', 'video_library', 'video_plan', 'video_render'])
  })

  it('video_gpu boots, reports, stops, and releases the cloud GPU', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const up = await callTool(ctx, 'video_gpu', { action: 'up' }, agent)
    if (up.isError) throw new Error('expected gpu up success')
    expect(up.value).toMatchObject({ state: 'running', serviceUrl: 'https://gpu.example:8443' })
    expect((up.value as { notice: string }).notice).toContain('https://gpu.example:8443')

    const status = await callTool(ctx, 'video_gpu', { action: 'status' }, agent)
    if (status.isError) throw new Error('expected gpu status success')
    expect((status.value as { notice: string }).notice).toContain('pro-1')

    const stopped = await callTool(ctx, 'video_gpu', { action: 'stop' }, agent)
    if (stopped.isError) throw new Error('expected gpu stop success')
    expect((stopped.value as { state: string }).state).toBe('stopped')

    const released = await callTool(ctx, 'video_gpu', { action: 'release' }, agent)
    if (released.isError) throw new Error('expected gpu release success')
    expect((released.value as { notice: string }).notice).toBe('cloud GPU instance released')
  })

  it('video_gpu rejects an unknown action', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const result = await callTool(ctx, 'video_gpu', { action: 'boot' }, agent)
    expect(result.isError).toBe(true)
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
    const { ctx, outputDir, h3Video } = await setup()
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'video_assemble')
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot('./expected/assembly-tool-schema.json')
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
    expect(value.durationSeconds).toBeCloseTo(11.6)
    expect(existsSync(value.outputFile)).toBe(true)
    expect(h3Video.captured.assembleOptions?.transition).toEqual({ kind: 'crossfade', seconds: 0.4 })

    const hardCut = await callTool(ctx, 'video_assemble', { plan_id: planId, transition: 'cut' }, agent)
    expect(hardCut.isError).toBe(false)
    if (hardCut.isError) throw new Error('expected cut success')
    expect((hardCut.value as { durationSeconds: number }).durationSeconds).toBe(12)
    expect(h3Video.captured.assembleOptions?.transition?.kind).toBe('cut')

    const capped = await callTool(ctx, 'video_assemble', {
      plan_id: planId, transition: 'crossfade', transition_seconds: 20,
    }, agent)
    expect(capped.isError).toBe(false)
    if (capped.isError) throw new Error('expected capped crossfade success')
    expect((capped.value as { durationSeconds: number }).durationSeconds).toBe(9)

    const invalid = await callTool(ctx, 'video_assemble', { plan_id: planId, transition_seconds: -1 }, agent)
    expect(invalid.isError).toBe(true)
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
      allow_remote: true,
    }, agent)
    expect(planned.isError).toBe(false)
    if (planned.isError) throw new Error('expected plan success')
    const planValue = planned.value as { segments: Array<{ references?: Array<{ type: string; source: string; role: string }> }> }
    expect(planValue.segments[0]?.references).toEqual([
      { type: 'image', source: 'C:/Users/demo/first-frame.png', role: 'first_frame' },
    ])
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, allow_remote: true }, agent)
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

  it('starts a shot from its keyframe instead of re-feeding the portraits as references', async () => {
    const { ctx, outputDir, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', reference: 'C:/Users/demo/xiaoming.png' }],
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '小明站在山顶' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const keyframe = join(outputDir, 'keyframes', `${planId}-s1.png`)
    mkdirSync(dirname(keyframe), { recursive: true })
    writeFileSync(keyframe, 'png')

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, segment_ids: ['s1'] }, agent)
    expect(rendered.isError).toBe(false)
    const request = h3Video.requests[0]
    // The keyframe already carries the cast (it was drawn from the portrait), so the clip starts
    // from it: frame conditioning cannot mix with references, and the still is the stronger anchor.
    const firstFrame = request?.inputs.find(input => input.type === 'image' && input.role === 'first_frame')
    expect(firstFrame?.type === 'image' && firstFrame.url).toBe(keyframe)
    expect(request?.inputs.filter(input => input.type === 'image' && input.role === 'reference_image')).toEqual([])
    // The character is still described in the prompt text, which is what the model reads.
    const prompt = request?.inputs.find(input => input.type === 'text')
    expect(prompt?.type === 'text' && prompt.text).toContain('小明 (character)')
    // A frame request takes its ratio from the still.
    expect(request?.ratio).toBe('adaptive')
  })

  it('degrades an authored first frame to reference_image when asset anchors exist', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'scene-1', name: '山顶', kind: 'scene', reference: 'C:/Users/demo/summit.png' }],
      segments: [{
        ...PLAN_ARGS.segments[0],
        references: [{ type: 'image', source: 'C:/Users/demo/first-frame.png', role: 'first_frame' }],
      }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, segment_ids: ['s1'] }, agent)
    expect(rendered.isError).toBe(false)
    const request = h3Video.requests[0]
    expect(request?.inputs.some(input => input.type === 'image' && input.role === 'first_frame')).toBe(false)
    const references = request?.inputs.filter((input): input is Extract<SegmentInput, { type: 'image' }> =>
      input.type === 'image' && input.role === 'reference_image') ?? []
    expect(references).toHaveLength(2)
    expect(references.some(ref => ref.url === 'C:/Users/demo/first-frame.png')).toBe(true)
    expect(references.some(ref => ref.url === 'C:/Users/demo/summit.png')).toBe(true)
    const prompt = request?.inputs.find(input => input.type === 'text')
    expect(prompt?.type === 'text' && prompt.text).toContain('<Picture 1> opening frame')
    expect(prompt?.type === 'text' && prompt.text).toContain('<Picture 2> 山顶 (scene)')
  })

  it('video_assets records user-provided materials and render anchors shots on them', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '小明走进咖啡馆' }],
    }, agent)
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

    // No keyframes exist — render anchors on the asset reference images.
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

  it('returns generated keyframes as image blocks so the materials are visible', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const content = await callToolContent(ctx, 'video_keyframes', { plan_id: planId }, agent)
    // One envelope plus one image per segment, then the notice.
    const images = content.filter(block => block.type === 'image')
    expect(images).toHaveLength(2)
    expect(images[0]?.attachment?.attachmentId).toContain(`${planId}-s1.png`)
    expect(content.filter(block => block.type === 'text')).toHaveLength(3)
  })

  it('returns generated asset images as image blocks', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '马锅头', kind: 'character', description: '藏族赶马人' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const content = await callToolContent(ctx, 'video_asset_images', { plan_id: planId }, agent)
    // A character contributes a portrait and its master sheet, each with an envelope.
    expect(content.filter(block => block.type === 'image')).toHaveLength(2)
    expect(content[0]?.text).toContain('character 马锅头')
  })

  it('injects the plan style and one shared seed into every segment request', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, style: '赛博朋克夜城' }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const plan = planned.value as { id: string; seed?: number }
    expect(typeof plan.seed).toBe('number')

    await callTool(ctx, 'video_render', { plan_id: plan.id }, agent)
    expect(h3Video.requests).toHaveLength(2)
    for (const request of h3Video.requests) {
      const prompt = request.inputs.find(input => input.type === 'text')
      expect(prompt?.type === 'text' && prompt.text).toContain('Visual style: 赛博朋克夜城')
      // One seed for the whole plan: separately rendered shots sample the same noise.
      expect(request.seed).toBe(plan.seed)
    }
  })

  it('conditions each shot on the anchors its prompt names, and on the sets when it names none', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [
        { id: 'char-1', name: '小明', kind: 'character', reference: 'C:/Users/demo/xiaoming.png' },
        { id: 'scene-1', name: '山顶', kind: 'scene', reference: 'C:/Users/demo/summit.png' },
      ],
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '小明站在山顶' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '山顶的空镜' },
      ],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    await callTool(ctx, 'video_render', { plan_id: planId }, agent)
    const referencesOf = (index: number): string[] =>
      (h3Video.requests[index]?.inputs ?? []).flatMap(input =>
        input.type === 'image' && input.role === 'reference_image' ? [input.url] : [])
    expect(referencesOf(0)).toEqual(['C:/Users/demo/xiaoming.png', 'C:/Users/demo/summit.png'])
    expect(referencesOf(1)).toEqual(['C:/Users/demo/summit.png'])
  })

  it('anchors an uncast shot on the sets alone', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '云海翻涌的空镜' }],
      assets: [
        { id: 'char-1', name: '小明', kind: 'character', reference: 'C:/Users/demo/xiaoming.png' },
        { id: 'scene-1', name: '山顶', kind: 'scene', reference: 'C:/Users/demo/summit.png' },
      ],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    await callTool(ctx, 'video_render', { plan_id: (planned.value as { id: string }).id }, agent)
    // Nobody is named, so the cast never enters the frame; the set still anchors the look.
    const references = (h3Video.requests[0]?.inputs ?? []).flatMap(input =>
      input.type === 'image' && input.role === 'reference_image' ? [input.url] : [])
    expect(references).toEqual(['C:/Users/demo/summit.png'])
  })

  it('conditions generated keyframes on the character the shot names, with the plan style and seed', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      style: '冷色调雨夜',
      assets: [
        { id: 'char-1', name: '小明', kind: 'character', description: '短发，深蓝工装', reference: 'C:/Users/demo/xiaoming.png' },
        { id: 'char-2', name: '阿花', kind: 'character', description: '红色风衣', reference: 'C:/Users/demo/ahua.png' },
      ],
      segments: [{ ...PLAN_ARGS.segments[0], id: 's1', prompt: '小明回头看向镜头' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const plan = planned.value as { id: string; seed?: number }

    const keyframed = await callTool(ctx, 'video_keyframes', { plan_id: plan.id }, agent)
    expect(keyframed.isError).toBe(false)
    const request = h3Video.keyframeRequests[0]
    // Auto mode: a shot that names a carried character is an edit of that portrait, so the still
    // keeps the face and still gets its own set.
    expect(request?.subjectReference).toBe('C:/Users/demo/xiaoming.png')
    expect(request?.prompt).toContain('保持参考图中人物的脸')
    expect(request?.prompt).toContain('小明 (character): 短发，深蓝工装')
    expect(request?.prompt).not.toContain('阿花')
    expect(request?.prompt).toContain('Visual style: 冷色调雨夜')
    expect(request?.seed).toBe(plan.seed)

    // "text" overrides the auto choice and draws the shot from words alone.
    h3Video.keyframeRequests.length = 0
    await callTool(ctx, 'video_keyframes', { plan_id: plan.id, identity: 'text' }, agent)
    expect(h3Video.keyframeRequests[0]?.subjectReference).toBeUndefined()
  })

  it('keeps the plan seed across revisions and honors an explicit one', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const explicit = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, seed: 777 }, agent)
    if (explicit.isError) throw new Error('expected plan success')
    const plan = explicit.value as { id: string; seed?: number }
    expect(plan.seed).toBe(777)

    const revised = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, plan_id: plan.id, style: '新风格' }, agent)
    if (revised.isError) throw new Error('expected revision success')
    expect((revised.value as { seed?: number }).seed).toBe(777)

    const derived = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (derived.isError) throw new Error('expected plan success')
    const derivedSeed = (derived.value as { seed?: number }).seed
    expect(typeof derivedSeed).toBe('number')
    expect(derivedSeed).toBeGreaterThanOrEqual(0)
    expect(derivedSeed).toBeLessThan(2 ** 32)
  })

  it('generates a front-facing character portrait and can replace it on request', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', description: '短发，深蓝工装' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const first = await callTool(ctx, 'video_asset_images', { plan_id: planId }, agent)
    if (first.isError) throw new Error('expected asset image success')
    // The portrait is a 1:1 bust; the sheet is a wide text-to-image turnaround, because an
    // image-to-image pass from the bust keeps that framing instead of drawing three full views.
    expect(h3Video.keyframeRequests[0]?.prompt).toContain('角色定妆照')
    expect(h3Video.keyframeRequests[0]?.prompt).toContain('短发，深蓝工装')
    expect(h3Video.keyframeRequests[0]?.ratio).toBe('1:1')
    expect(h3Video.keyframeRequests[1]?.prompt).toContain('三视图')
    expect(h3Video.keyframeRequests[1]?.prompt).toContain('全身')
    expect(h3Video.keyframeRequests[1]?.ratio).toBe('21:9')
    expect(h3Video.keyframeRequests[1]?.subjectReference).toBeUndefined()

    // A confirmed portrait and sheet are not regenerated by a plain re-run.
    const second = await callTool(ctx, 'video_asset_images', { plan_id: planId }, agent)
    if (second.isError) throw new Error('expected a successful run')
    expect((second.value as { assets: Array<{ state: string }> }).assets[0]?.state).toBe('skipped')
    expect(h3Video.keyframeRequests).toHaveLength(2)

    // A regenerate with another seed replaces both, and the plan points at the replacement.
    const regenerated = await callTool(ctx, 'video_asset_images', { plan_id: planId, regenerate: true, seed: 99 }, agent)
    if (regenerated.isError) throw new Error('expected a successful regenerate')
    expect(h3Video.keyframeRequests).toHaveLength(4)
    expect(h3Video.keyframeRequests[2]?.seed).toBe(99)
    expect(h3Video.keyframeRequests[3]?.seed).toBe(99)
    const replacement = (regenerated.value as { assets: Array<{ image?: string }> }).assets[0]?.image
    expect(replacement).toBeDefined()
    const reread = await callTool(ctx, 'video_assets', { plan_id: planId, assets: [] }, agent)
    if (reread.isError) throw new Error('expected a plan read')
    expect((reread.value as { assets?: Array<{ reference?: string }> }).assets?.[0]?.reference).toBe(replacement)
  })

  it('reproduces keyframes with the plan seed and explores with an explicit one', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    await callTool(ctx, 'video_keyframes', { plan_id: planId, segment_ids: ['s1'] }, agent)
    await callTool(ctx, 'video_keyframes', { plan_id: planId, segment_ids: ['s1'] }, agent)
    expect(h3Video.keyframeRequests[0]?.seed).toBe(h3Video.keyframeRequests[1]?.seed)

    await callTool(ctx, 'video_keyframes', { plan_id: planId, segment_ids: ['s1'], seed: 5 }, agent)
    expect(h3Video.keyframeRequests[2]?.seed).toBe(5)
  })

  it('reuses a saved character through the project library with its prompt block', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const prompt = '小明，25岁男性，鹅蛋脸，黑色短发，深蓝工装，黑色工装靴，体型偏瘦'
    const first = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', description: '短发工装', prompt }],
    }, agent)
    if (first.isError) throw new Error('expected plan success')
    const firstPlanId = (first.value as { id: string }).id

    // Recording the asset writes it to the project library.
    const recorded = await callTool(ctx, 'video_assets', {
      plan_id: firstPlanId,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', description: '短发工装', prompt, reference: 'C:/Users/demo/xiaoming.png' }],
    }, agent)
    expect(recorded.isError).toBe(false)

    const library = await callTool(ctx, 'video_library', {}, agent)
    if (library.isError) throw new Error('expected library listing')
    expect((library.value as { assets: Array<{ name: string; prompt?: string }> }).assets)
      .toContainEqual(expect.objectContaining({ name: '小明', prompt }))

    // A later plan attaches the saved asset by name instead of redefining it, and a shot that
    // names the character conditions on it.
    const second = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      library_assets: ['小明'],
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '小明站在山顶' }],
    }, agent)
    if (second.isError) throw new Error('expected plan success')
    const secondPlanId = (second.value as { id: string; assets?: Array<{ reference?: string; prompt?: string }> }).id
    expect((second.value as { assets?: Array<{ reference?: string; prompt?: string }> }).assets?.[0]).toMatchObject({
      reference: 'C:/Users/demo/xiaoming.png',
      prompt,
    })

    await callTool(ctx, 'video_render', { plan_id: secondPlanId, segment_ids: ['s1'] }, agent)
    const request = h3Video.requests.find(candidate => candidate.inputs.some(input =>
      input.type === 'image' && input.url === 'C:/Users/demo/xiaoming.png'))
    expect(request).toBeDefined()
    const text = request?.inputs.find(input => input.type === 'text')
    expect(text?.type === 'text' && text.text).toContain(`小明 (character): ${prompt}`)

    // An unknown library reference fails loud instead of silently rendering without the anchor.
    const missing = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, library_assets: ['不存在'] }, agent)
    expect(missing.isError).toBe(true)
  })

  it('continues the plan series across sessions, so a new project never reuses an id', async () => {
    const { ctx } = await setup()
    const first = await callTool(ctx, 'video_plan', PLAN_ARGS, agentWithSession('session-a'))
    const second = await callTool(ctx, 'video_plan', PLAN_ARGS, agentWithSession('session-b'))
    if (first.isError || second.isError) throw new Error('expected both plans to succeed')
    expect((first.value as { id: string }).id).toBe('vp-1')
    expect((second.value as { id: string }).id).toBe('vp-2')
  })

  it('skips an id a plan file in the directory already occupies', async () => {
    const { ctx, outputDir } = await setup()
    mkdirSync(join(outputDir, 'plans'), { recursive: true })
    writeFileSync(join(outputDir, 'plans', 'vp-7.json'), JSON.stringify({ id: 'vp-7', segments: [] }))
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agentWithSession('session-a'))
    if (planned.isError) throw new Error('expected plan success')
    expect((planned.value as { id: string }).id).toBe('vp-8')
  })

  it('keeps earlier assets when a later recording names only one', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const first = await callTool(ctx, 'video_assets', {
      plan_id: planId,
      assets: [{ id: 'char-1', name: '小明', kind: 'character', reference: 'C:/Users/demo/xiaoming.png' }],
    }, agent)
    if (first.isError) throw new Error('expected the first recording to succeed')

    const second = await callTool(ctx, 'video_assets', {
      plan_id: planId,
      assets: [{ id: 'scene-1', name: '咖啡馆', kind: 'scene', reference: 'C:/Users/demo/cafe.png' }],
    }, agent)
    if (second.isError) throw new Error('expected the second recording to succeed')
    const assets = (second.value as { assets?: Array<{ id: string }> }).assets ?? []
    expect(assets.map(asset => asset.id)).toEqual(['char-1', 'scene-1'])
  })

  it('refuses a storyboard whose neighbouring shots share no anchor and declare no cut', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'scene-1', name: '7楼办公区', kind: 'scene', reference: 'C:/Users/demo/office.png' }],
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '7楼办公区的空镜' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '林晓在电梯里看手机' },
      ],
    }, agent)
    expect(planned.isError).toBe(true)
  })

  it('accepts a carried anchor and an explicit scene cut between shots', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const shared = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [
        { id: 'char-1', name: '林晓', kind: 'character', reference: 'C:/Users/demo/lin.png' },
        { id: 'scene-1', name: '7楼办公区', kind: 'scene', reference: 'C:/Users/demo/office.png' },
      ],
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '林晓走进7楼办公区' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '林晓仍在7楼办公区，手扶工位' },
      ],
    }, agent)
    expect(shared.isError).toBe(false)

    const cut = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [
        { id: 'char-1', name: '林晓', kind: 'character', reference: 'C:/Users/demo/lin.png' },
        { id: 'scene-2', name: '电梯', kind: 'scene', reference: 'C:/Users/demo/lift.png' },
      ],
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '林晓在电梯里' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '切至：电梯。空镜，指示灯熄灭' },
      ],
    }, agent)
    expect(cut.isError).toBe(false)
  })

  it('renders a chain as one background job so each shot starts from the last frame', async () => {
    const { ctx, jobs } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, chain: true }, agent)
    if (rendered.isError) throw new Error('expected render success')
    const value = rendered.value as { submissions: Array<{ jobId?: string }>; notice: string }
    // One job owns the whole sequence; sequential rendering is what makes the chain possible.
    expect(new Set(value.submissions.map(entry => entry.jobId)).size).toBe(1)
    expect(jobs.starts).toBe(1)
    expect(value.notice).toContain('chained render')
  })

  it('dips through black between shots when the caller asks for it', async () => {
    const { ctx, h3Video } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const segmentsDir = join((h3Video as unknown as { outputDir: string }).outputDir, 'segments')
    mkdirSync(segmentsDir, { recursive: true })
    for (const segment of PLAN_ARGS.segments) {
      writeFileSync(join(segmentsDir, `${planId}-${segment.id}.mp4`), 'bytes')
    }

    const assembled = await callTool(ctx, 'video_assemble', {
      plan_id: planId,
      transition: 'dip',
      transition_seconds: 0.4,
    }, agent)
    expect(assembled.isError).toBe(false)
    const options = h3Video.captured.assembleOptions
    expect(options?.transition).toEqual({ kind: 'dip', seconds: 0.4 })
  })

  it('refuses a room change carried only by the same character', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const assets = [
      { id: 'char-1', name: '林晓', kind: 'character', reference: 'C:/Users/demo/lin.png' },
      { id: 'scene-1', name: '7楼办公区', kind: 'scene', reference: 'C:/Users/demo/office.png' },
      { id: 'scene-2', name: '楼下花坛', kind: 'scene', reference: 'C:/Users/demo/flowerbed.png' },
    ]
    const refused = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets,
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '林晓在7楼办公区收拾工位' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '林晓独自坐在楼下花坛边' },
      ],
    }, agent)
    expect(refused.isError).toBe(true)

    const accepted = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets,
      segments: [
        { ...PLAN_ARGS.segments[0], id: 's1', prompt: '林晓在7楼办公区收拾工位' },
        { ...PLAN_ARGS.segments[1], id: 's2', prompt: '切至：楼下花坛。林晓独自坐在花坛边' },
      ],
    }, agent)
    expect(accepted.isError).toBe(false)
  })

  it('refuses a still for a character the plan records without an image', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      assets: [{ id: 'char-1', name: '林晓', kind: 'character', description: '齐肩黑发' }],
      segments: [{ ...PLAN_ARGS.segments[0], prompt: '林晓走进办公室' }],
    }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const refused = await callTool(ctx, 'video_keyframes', { plan_id: planId }, agent)
    expect(refused.isError).toBe(true)

    // With the portrait recorded, the still is drawn from it instead of from text alone.
    await callTool(ctx, 'video_assets', {
      plan_id: planId,
      assets: [{ id: 'char-1', name: '林晓', kind: 'character', reference: 'C:/Users/demo/lin.png' }],
    }, agent)
    const allowed = await callTool(ctx, 'video_keyframes', { plan_id: planId }, agent)
    expect(allowed.isError).toBe(false)
  })

  it('refuses a plan that pins segments to the paid backend without consent', async () => {    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', {
      ...PLAN_ARGS,
      segments: [{ ...PLAN_ARGS.segments[0], backend: 'remote' }],
    }, agent)
    expect(planned.isError).toBe(true)
  })

  it('refuses a paid render before anything is submitted, then honours the consent flag', async () => {
    const { ctx, h3Video, jobs } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', { ...PLAN_ARGS, allow_remote: true }, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const refused = await callTool(ctx, 'video_render', { plan_id: planId, backend: 'remote' }, agent)
    expect(refused.isError).toBe(true)
    // Nothing reached the backend, so a refusal costs nothing.
    expect(h3Video.requests).toHaveLength(0)
    expect(jobs.lastHooks).toBeUndefined()

    const allowed = await callTool(ctx, 'video_render', { plan_id: planId, backend: 'remote', allow_remote: true }, agent)
    expect(allowed.isError).toBe(false)
    if (allowed.isError) throw new Error('expected render success')
    const submissions = (allowed.value as { submissions: Array<{ backend: string; resolved?: string }> }).submissions
    expect(submissions.map(entry => entry.backend)).toEqual(['remote', 'remote'])
    expect(submissions.map(entry => entry.resolved)).toEqual(['remote', 'remote'])
  })

  it('reports the backend routing actually reached', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession()
    const planned = await callTool(ctx, 'video_plan', PLAN_ARGS, agent)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id
    const rendered = await callTool(ctx, 'video_render', { plan_id: planId, backend: 'local' }, agent)
    if (rendered.isError) throw new Error('expected render success')
    const submissions = (rendered.value as { submissions: Array<{ resolved?: string }> }).submissions
    expect(submissions.every(entry => entry.resolved === 'local')).toBe(true)
  })
})
