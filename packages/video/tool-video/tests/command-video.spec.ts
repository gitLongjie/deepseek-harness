/**
 * `/video` command tests: registers the real command, and verifies the handler rejects empty input
 * and queues one user turn that drives the plan → render → assemble pipeline for a description.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionStore, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { H3Video } from '@deepseek-ai/dsh-h3-video'
import { H3TaskRef } from '@deepseek-ai/dsh-h3-video'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'

import * as tool from '../src/index.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'command-video-'))
  tempDirs.push(dir)
  return dir
}

type CapturingAgent = Agent & { followedUp: Array<{ text: string }> }

function stubAgent(ctx: Context, id: string): { agent: CapturingAgent; session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = createInboxStub()
  let status: Agent['status'] = 'idle'
  const followedUp: Array<{ text: string }> = []
  const collect = (message: UserMessage): void => {
    for (const block of message.content) {
      if (block.type === 'text') followedUp.push({ text: block.text })
    }
  }
  const agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    followedUp,
    get status() { return status },
    send: () => {},
    followup: (message: UserMessage) => { collect(message) },
    steer: () => {},
    inject: (message: UserMessage) => { collect(message) },
    cancel() { status = 'idle' },
    runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  } as unknown as CapturingAgent
  return { agent, session }
}

function h3VideoStub(outputDir: string): H3Video {
  return {
    outputDir,
    providers: [],
    capabilities: () => undefined,
    canServe: () => true,
    submit: async (choice: string, request: { inputs: Array<{ type: string }> }) => ({
      target: { choice, provider: {} as never },
      ref: H3TaskRef(`ref-${request.inputs[0]?.type ?? 'x'}`),
    }),
    poll: async () => ({ state: 'succeeded' as const, localFile: join(outputDir, 'seg.mp4') }),
    cancel: async () => undefined,
    assemble: async () => join(outputDir, 'final.mp4'),
    diskFreeMegabytes: async () => 1024,
  } as unknown as H3Video
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.provide('jobs', { attachController: () => () => undefined, start: () => 'h3-video-1' } as never)
  ctx.provide('h3Video', h3VideoStub(tempDir()) as never)
  await ctx.plugin(tool)
  const { agent, session } = stubAgent(ctx, `command-video-${Math.random().toString(36).slice(2)}`)
  await ctx.agents.register(agent)
  return { ctx, agent, session }
}

describe('/video command', () => {
  it('registers a `video` command', async () => {
    const { ctx, agent } = await harness()
    const names = ctx.commands.list(agent).map(descriptor => descriptor.name)
    expect(names).toContain('video')
  })

  it('rejects an empty description with usage', async () => {
    const { ctx, agent } = await harness()
    const execution = await ctx.commands.execute(agent, '/video', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('error')
    if (execution?.result.kind === 'error') {
      expect(execution.result.text).toContain('/video <需求描述>')
    }
    expect(agent.followedUp).toHaveLength(0)
  })

  it('queues one user turn carrying the description for a valid request', async () => {
    const { ctx, agent } = await harness()
    const execution = await ctx.commands.execute(agent, '/video 拍一段 8 秒的品牌片', [], new AbortController().signal)
    expect(execution?.result.kind).toBe('success')
    if (execution?.result.kind === 'success') {
      expect(execution.result.text).toContain('已收到视频请求')
    }
    expect(agent.followedUp).toHaveLength(1)
    expect(agent.followedUp[0]?.text).toContain('拍一段 8 秒的品牌片')
    expect(agent.followedUp[0]?.text).toContain('video_plan')
    expect(agent.followedUp[0]?.text).toContain('video_assemble')
  })
})
