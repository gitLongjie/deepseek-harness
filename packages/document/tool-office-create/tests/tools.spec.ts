import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox, unsupportedModel, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import {
  workspaceDependencyPaths,
  type PrimaryRuntimeManifest,
} from '@deepseek-ai/dsh-tool-workspace-dependencies'
import * as officeCreate from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function runtimeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-office-create-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'resources')
  const root = join(directory, 'home', 'dsh-runtimes', 'dsh-primary-runtime')
  const manifest: PrimaryRuntimeManifest = {
    desktopVersion: '1.0.0',
    platform: process.platform,
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    python: '3.12.14',
    node: '24.21.0',
    pnpm: '11.7.0',
    pythonPackages: { 'python-pptx': '1.0.2' },
  }
  const paths = workspaceDependencyPaths(source, manifest)
  for (const path of [paths.python, paths.node, paths.pnpm]) {
    if (path === undefined) continue
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'interpreter')
  }
  await mkdir(paths.pythonPackages, { recursive: true })
  if (paths.nodePackages !== undefined) await mkdir(paths.nodePackages, { recursive: true })
  await writeFile(join(source, 'runtime.json'), JSON.stringify(manifest))
  return { source, root, directory }
}

async function agent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`office-create-${String(++callNumber)}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

async function setup() {
  const { source, root, directory } = await runtimeFixture()
  const cwd = join(directory, 'workspace')
  await mkdir(cwd, { recursive: true })
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(officeCreate, { source, root })
  const owner = await agent(ctx, cwd)
  owner.session.append('turn/start', { turn: 1 })
  return { ctx, owner, cwd }
}

describe('tool-office-create', () => {
  it('registers the three create tools and prompt guidance', async () => {
    const { ctx, owner } = await setup()
    expect(ctx.tools.get('create_pptx', owner)?.name).toBe('create_pptx')
    expect(ctx.tools.get('create_docx', owner)?.name).toBe('create_docx')
    expect(ctx.tools.get('create_xlsx', owner)?.name).toBe('create_xlsx')
    const assembly = await ctx.systemPrompt.assemble({ agent: owner, scope: owner })
    expect(assembly.sections.some(section => section.name === 'tool:office-create' && section.text.includes('create_pptx'))).toBe(true)
  })

  it('fails when the bundled interpreter cannot run the generator', async () => {
    const { ctx, owner } = await setup()
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId(`call-${String(++callNumber)}`),
      name: 'create_pptx',
      arguments: {
        path: 'deck.pptx',
        slides: [{ title: 'Hello', bullets: ['One'] }],
      },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(text).toMatch(/bundled Office runtime unavailable|Office generator failed|not a valid|spawn/iu)
  })
})
