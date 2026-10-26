/**
 * REAL-composition test: boots a cordis.yml through the real Loader with the h3-video service, a
 * real jobs-local registry, and a local mock ComfyUI HTTP server, then drives the model-facing
 * tools end to end. Only external HTTP (the mock servers) and the poll interval are stubbed; the
 * Loader, services, tools, jobs, and session are the shipping code.
 */

import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import JobsLocal from '@deepseek-ai/dsh-jobs-local'
import H3VideoService from '@deepseek-ai/dsh-h3-video'
import * as ToolVideo from '@deepseek-ai/dsh-tool-video'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import * as Workbench from '@deepseek-ai/dsh-video-workbench'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined
let autodlServer: Server | undefined
let port = 0

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await Promise.all([server, autodlServer].map(closeServer))
  server = undefined
  autodlServer = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function closeServer(target: Server | undefined): Promise<void> {
  if (target === undefined) return
  await new Promise<void>((resolve) => {
    target.close(() => { resolve() })
  })
}

/** A minimal ComfyUI API server that enqueues and immediately completes one prompt. */
function mockComfyServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/system_stats') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ system: { os: 'linux' } }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/prompt') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: 'p-real' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/history/p-real') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        'p-real': { outputs: { '9': { images: [{ filename: 'clip.png', subfolder: '', type: 'output' }] } } },
      }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      return
    }
    res.writeHead(404)
    res.end()
  })
}

/** AutoDL account state one mock server serves, so the test can assert what the pool did. */
interface AutoDLState {
  instances: Array<{ uuid: string; name: string; status: string }>
  calls: string[]
  created: number
}

/** A minimal AutoDL Pro API server: create, list, status, snapshot, power, and release. */
function mockAutoDLServer(state: AutoDLState, comfyPort: number): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      state.calls.push(url.pathname)
      const send = (data: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 'Success', data, msg: '', request_id: 'req-test' }))
      }
      const payload = body.length > 0 ? JSON.parse(body) as Record<string, unknown> : {}
      const find = (): { uuid: string; name: string; status: string } | undefined => {
        const id = url.searchParams.get('instance_uuid') ?? payload.instance_uuid
        return state.instances.find(instance => instance.uuid === id)
      }
      switch (url.pathname) {
        case '/api/v1/dev/instance/pro/list':
          send({ list: state.instances.map(instance => ({ ...instance })) })
          return
        case '/api/v1/dev/instance/pro/create': {
          const id = `pro-${++state.created}`
          const name = typeof payload.instance_name === 'string' ? payload.instance_name : ''
          state.instances.push({ uuid: id, name, status: 'creating' })
          send(id)
          return
        }
        case '/api/v1/dev/instance/pro/power_on': {
          const instance = find()
          if (instance !== undefined) instance.status = 'running'
          send(null)
          return
        }
        case '/api/v1/dev/instance/pro/status': {
          send(find()?.status ?? 'shutdown')
          return
        }
        case '/api/v1/dev/instance/pro/snapshot': {
          send({ instance_uuid: find()?.uuid ?? '', service_6006_domain: `http://127.0.0.1:${comfyPort}` })
          return
        }
        case '/api/v1/dev/instance/pro/power_off': {
          const instance = find()
          if (instance !== undefined) instance.status = 'shutdown'
          send(null)
          return
        }
        case '/api/v1/dev/instance/pro/release': {
          const instance = find()
          if (instance !== undefined) state.instances.splice(state.instances.indexOf(instance), 1)
          send(null)
          return
        }
        default:
          res.writeHead(404)
          res.end()
      }
    })
  })
}

async function listen(target: Server): Promise<number> {
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  const address = target.address()
  if (typeof address === 'object' && address !== null) return address.port
  throw new Error('mock server did not bind a port')
}

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('video-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: unsupportedInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

/**
 * A tool invoker bound to one owning Agent, the way the executor discovers tools.
 * @param ctx - booted composition context.
 * @param owner - the calling Agent.
 * @returns an invoker taking a tool name and its arguments.
 */
function toolCall(ctx: Context, owner: Agent) {
  return (name: string, args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(name),
    name,
    arguments: args,
    agent: owner,
  })
}

async function boot(): Promise<Context> {
  server = mockComfyServer()
  port = await listen(server)
  return await bootComposition([`      url: 'http://127.0.0.1:${port}'`])
}

/** Boot the same composition with a cloud GPU row pointed at a mock AutoDL account. */
async function bootWithGpu(): Promise<{ ctx: Context; autoDL: AutoDLState }> {
  server = mockComfyServer()
  port = await listen(server)
  const autoDL: AutoDLState = { instances: [], calls: [], created: 0 }
  autodlServer = mockAutoDLServer(autoDL, port)
  const autodlPort = await listen(autodlServer)
  const ctx = await bootComposition([
    '      gpu:',
    "        gpuSpecUuid: 'v-32g-p'",
    "        imageUuid: 'image-comfyui'",
    "        apiToken: 'test-token'",
    `        baseUrl: 'http://127.0.0.1:${autodlPort}'`,
    "        instanceName: 'dsh-test'",
    "        startCommand: 'bash /root/start-comfyui.sh'",
    '        servicePort: 6006',
    '        pollIntervalMs: 1000',
    '        bootTimeoutMs: 60000',
    '        idleTimeoutMs: 0',
  ])
  return { ctx, autoDL }
}

/**
 * Write the composition with the given ComfyUI backend lines and boot it through the real Loader.
 * @param comfyLines - `comfy:` body lines, either a static `url` or the `gpu` row.
 * @returns the booted context.
 */
async function bootComposition(comfyLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-video-loader-'))
  const workflowPath = join(root, 'workflow.json')
  await writeFile(workflowPath, JSON.stringify({
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'h3-real', images: [] } },
  }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-jobs-local'",
    "- name: '@deepseek-ai/dsh-h3-video'",
    '  config:',
    `    outputDir: '${join(root, 'out').replaceAll('\\', '/')}'`,
    '    comfy:',
    ...comfyLines,
    `      workflowPath: '${workflowPath.replaceAll('\\', '/')}'`,
    '      pollIntervalMs: 500',
    '      taskTimeoutMs: 60000',
    '      resolutions: ["768P"]',
    '      minDurationSeconds: 1',
    '      maxDurationSeconds: 10',
    "- name: '@deepseek-ai/dsh-tool-video'",
    "- name: 'test-connection'",
    "- name: '@deepseek-ai/dsh-video-workbench'",
    '  config:',
    `    outputDir: '${join(root, 'out').replaceAll('\\', '/')}'`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-jobs-local', JobsLocal],
    ['@deepseek-ai/dsh-h3-video', H3VideoService],
    ['@deepseek-ai/dsh-tool-video', ToolVideo],
    ['test-connection', (ctx: Context) => { new HostConnectionService(ctx, [], {} as never) }],
    ['@deepseek-ai/dsh-video-workbench', Workbench],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

const PLAN_ARGS = {
  goal: 'a short brand film',
  segments: [
    {
      id: 's1',
      prompt: 'wide shot of a mountain at dawn',
      duration_seconds: 4,
      resolution: '768P',
      ratio: '16:9',
      backend: 'local',
    },
  ],
}

describe('tool-video real Loader composition through cordis.yml', () => {
  it.skipIf(spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0)(
    'assembles a default crossfade and serves the completed video through the workbench', async () => {
      const ctx = await boot()
      const owner = await agent(ctx)
      const call = toolCall(ctx, owner)
      const run = promisify(execFile)
      const planned = await call('video_plan', {
        ...PLAN_ARGS, mode: 'per_segment', segments: ['s1', 's2'].map(id => ({
          ...PLAN_ARGS.segments[0], id, duration_seconds: 1,
        })),
      })
      if (planned.isError) throw new Error('expected plan success')
      const planId = (planned.value as { id: string }).id
      const directory = join(ctx.h3Video.outputDir, 'segments')
      await mkdir(directory, { recursive: true })
      for (const [id, color] of [['s1', 'red'], ['s2', 'blue']]) {
        await run('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24:d=1`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, `${planId}-${id}.mp4`),
        ])
      }
      const assembled = await call('video_assemble', { plan_id: planId })
      expect(assembled.isError).toBe(false)
      if (assembled.isError) throw new Error('expected assembly success')
      const result = assembled.value as { outputFile: string; durationSeconds: number }
      expect(result.durationSeconds).toBeCloseTo(1.6)
      const { stdout } = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', result.outputFile,
      ])
      const media = JSON.parse(stdout) as { format: { duration: string } }
      expect(Number(media.format.duration)).toBeCloseTo(result.durationSeconds, 1)
      const handler = ctx.connection.createSharedFetchHandler('/api')
      const listing = await handler.fetch(new Request('http://127.0.0.1/api/video-workbench/projects'))
      const summary = await listing.json() as Workbench.WorkbenchSummary
      expect(summary.projects[0]?.final).toBe(result.outputFile)
      const response = await handler.fetch(new Request(
        `http://127.0.0.1/api/video-workbench/file?path=final%2F${planId}.mp4`,
      ))
      expect(response.status).toBe(200)
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    },
  )

  it('plans, renders, and completes one segment job against the local backend', async () => {
    const ctx = await boot()
    const owner = await agent(ctx)
    const call = toolCall(ctx, owner)

    const planned = await call('video_plan', PLAN_ARGS)
    expect(planned.isError).toBe(false)
    const planId = (planned.value as { id: string }).id
    expect(planId).toBe('vp-1')

    const rendered = await call('video_render', { plan_id: planId })
    expect(rendered.isError).toBe(false)
    const submissions = (rendered.value as { submissions: Array<{ jobId?: string; state: string }> }).submissions
    expect(submissions).toHaveLength(1)
    const jobId = submissions[0]?.jobId
    expect(jobId).toBeDefined()
    const id = JobId(jobId!)

    const snapshot = await ctx.jobs.wait(id, 8_000, owner)
    expect(snapshot.status).toBe('completed')
    const read = ctx.jobs.read(id, owner)
    // multi_shot is the default: one segment renders as one coherent clip under the `all` id.
    expect(read.text).toContain('[succeeded] all')
    expect(read.text).toContain('vp-1-all.mp4')
    const listing = await ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request('http://127.0.0.1/api/video-workbench/projects'),
    )
    expect(listing.status).toBe(200)
    const summary = await listing.json() as Workbench.WorkbenchSummary
    expect(summary.projects[0]?.segments[0]).toMatchObject({
      id: 'all', rendered: true,
      shots: [{ id: 's1', prompt: PLAN_ARGS.segments[0]!.prompt, durationSeconds: 4, resolution: '768P', ratio: '16:9', backend: 'local' }],
    })
    const file = summary.projects[0]?.segments[0]?.file
    expect(file).toBeDefined()
    expect(summary.projects[0]?.final).toBe(file)
    expect(summary.projects[0]?.finalBytes).toBeGreaterThan(0)
    const relative = file!.slice(summary.outputDir.length + 1).replaceAll('\\', '/')
    const media = await ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://127.0.0.1/api/video-workbench/file?path=${encodeURIComponent(relative)}`),
    )
    expect(media.status).toBe(200)
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(0)
  }, 30_000)

  it('provisions the AutoDL instance for a local render and releases it on request', async () => {
    const { ctx, autoDL } = await bootWithGpu()
    const owner = await agent(ctx)
    const call = toolCall(ctx, owner)

    const planned = await call('video_plan', PLAN_ARGS)
    if (planned.isError) throw new Error('expected plan success')
    const planId = (planned.value as { id: string }).id

    const up = await call('video_gpu', { action: 'up' })
    if (up.isError) throw new Error('expected gpu up success')
    expect(up.value).toMatchObject({ state: 'running', instanceId: 'pro-1' })
    expect(autoDL.calls).toContain('/api/v1/dev/instance/pro/create')
    expect(autoDL.calls).toContain('/api/v1/dev/instance/pro/power_on')

    const rendered = await call('video_render', { plan_id: planId })
    if (rendered.isError) throw new Error('expected render success')
    const jobId = (rendered.value as { submissions: Array<{ jobId?: string }> }).submissions[0]?.jobId
    expect(jobId).toBeDefined()
    expect((await ctx.jobs.wait(JobId(String(jobId)), 8_000, owner)).status).toBe('completed')
    // The running instance is reused for the render: no second create.
    expect(autoDL.created).toBe(1)

    const released = await call('video_gpu', { action: 'release' })
    if (released.isError) throw new Error('expected gpu release success')
    expect((released.value as { state: string }).state).toBe('absent')
    expect(autoDL.calls).toContain('/api/v1/dev/instance/pro/release')
    expect(autoDL.instances).toHaveLength(0)
  }, 30_000)
})
