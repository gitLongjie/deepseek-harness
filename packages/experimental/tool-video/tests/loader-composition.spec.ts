/**
 * REAL-composition test: boots a cordis.yml through the real Loader with the h3-video service, a
 * real jobs-local registry, and a local mock ComfyUI HTTP server, then drives the model-facing
 * tools end to end. Only external HTTP (the mock server) and the poll interval are stubbed; the
 * Loader, services, tools, jobs, and session are the shipping code.
 */

import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import H3VideoService from '@deepseek-ai/dsh-experimental-h3-video'
import * as ToolVideo from '@deepseek-ai/dsh-experimental-tool-video'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined
let port = 0

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await new Promise<void>((resolve) => {
    server?.close(() => { resolve() })
  })
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A minimal ComfyUI API server that enqueues and immediately completes one prompt. */
function mockComfyServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
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

async function listen(): Promise<number> {
  server = mockComfyServer()
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
  const address = server?.address()
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

async function boot(): Promise<Context> {
  port = await listen()
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
    "- name: '@deepseek-ai/dsh-experimental-h3-video'",
    '  config:',
    `    outputDir: '${join(root, 'out').replaceAll('\\', '/')}'`,
    '    comfy:',
    `      url: 'http://127.0.0.1:${port}'`,
    `      workflowPath: '${workflowPath.replaceAll('\\', '/')}'`,
    '      pollIntervalMs: 500',
    '      taskTimeoutMs: 60000',
    '      resolutions: ["768P"]',
    '      minDurationSeconds: 1',
    '      maxDurationSeconds: 10',
    "- name: '@deepseek-ai/dsh-experimental-tool-video'",
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
    ['@deepseek-ai/dsh-experimental-h3-video', H3VideoService],
    ['@deepseek-ai/dsh-experimental-tool-video', ToolVideo],
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
  it('plans, renders, and completes one segment job against the local backend', async () => {
    const ctx = await boot()
    const owner = await agent(ctx)
    const call = (name: string, args: unknown) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(name),
      name,
      arguments: args,
      agent: owner,
    })

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
  }, 30_000)
})
