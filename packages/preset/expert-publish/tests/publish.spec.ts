import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as ExpertPublish from '../src/index.ts'
import { fitExpertDraft, listPublishedExperts, loadPublishedExperts, publishExpert, readPublishedExpert, resolveExpertRoot, type ExpertPublisher } from '../src/publish.ts'
import { expertIdForName, fallbackShare, parseExpertShare, PUBLISH_TOOL } from '../src/share.ts'
import { agentOn, declare, harness } from '../../agent-preset-registry/tests/harness.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'expert-publish-'))
  directories.push(path)
  return path
}

const SHARE = '我用 WorkBuddy 创建了一个专家「示例专家」——做一件具体的事。'
  + '点击 https://www.workbuddy.cn/work/launch/?sharecode=abc&expertname=%E7%A4%BA%E4%BE%8B&buddy_type=workbuddy'

function draft(over: Partial<Parameters<typeof publishExpert>[1]> = {}) {
  return {
    id: 'geo-prelaunch',
    name: '示例专家',
    description: '做一件具体的事',
    persona: '你是示例专家。',
    ...over,
  }
}

function memoryPublisher(root: string, taken: ReadonlySet<string> = new Set()): ExpertPublisher & { ids(): string[] } {
  const owned = new Map<string, () => Promise<void>>()
  const ids: string[] = []
  return {
    root,
    owned,
    ids: () => [...ids],
    async register(definition) {
      if (taken.has(definition.id) || ids.includes(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
      ids.push(definition.id)
      return async () => {
        const index = ids.indexOf(definition.id)
        if (index >= 0) ids.splice(index, 1)
      }
    },
    async hasId(id) {
      return taken.has(id) || ids.includes(id)
    },
  }
}

describe('share text', () => {
  it('reads the bracket name and the clause after the dash', () => {
    expect(parseExpertShare(SHARE)).toEqual({ name: '示例专家', description: '做一件具体的事' })
    expect(expertIdForName('示例专家')).toMatch(/^expert-[0-9a-f]{12}$/)
  })

  it('reads a launch URL when the message has no bracket name', () => {
    expect(parseExpertShare('看看 https://www.workbuddy.cn/work/launch/?expertname=GEO+%E4%B8%93%E5%AE%B6&buddy_type=workbuddy'))
      .toEqual({ name: 'GEO 专家', description: 'GEO 专家' })
  })

  it('ignores ordinary text, a nameless URL, a blank name, an oversized name, and a bad escape', () => {
    expect(parseExpertShare('今天没有专家分享')).toBeUndefined()
    expect(parseExpertShare('https://www.workbuddy.cn/work/launch/?sharecode=abc')).toBeUndefined()
    expect(parseExpertShare('https://www.workbuddy.cn/work/launch/?expertname=+++')).toBeUndefined()
    expect(parseExpertShare(`https://www.workbuddy.cn/work/launch/?expertname=${'a'.repeat(81)}`)).toBeUndefined()
    expect(parseExpertShare('https://www.workbuddy.cn/work/launch/?expertname=%E0%A4')).toBeUndefined()
  })

  it('caps a long clause and treats an empty clause as the name', () => {
    const clause = '长'.repeat(600)
    expect(parseExpertShare(`创建了一个专家「甲」——${clause}。点击 https://www.workbuddy.cn/work/launch/?x=1`)?.description)
      .toHaveLength(500)
    expect(parseExpertShare('创建了一个专家「甲」——。')).toEqual({ name: '甲', description: '甲' })
    expect(parseExpertShare('创建了一个专家「甲」——没有句号')).toEqual({ name: '甲', description: '没有句号' })
    expect(parseExpertShare('创建了一个专家「甲」 https://www.workbuddy.cn/work/launch/?x=1'))
      .toEqual({ name: '甲', description: '甲' })
  })

  it('finds no share when the turn never started or the log has holes', () => {
    expect(fallbackShare(new Array<SessionEvent>(2), 1)).toBeUndefined()
  })
})

describe('publishExpert', () => {
  it('refuses a draft that breaks a limit', async () => {
    const root = await directory()
    const publisher = memoryPublisher(root)
    const cases: [Parameters<typeof publishExpert>[1], string][] = [
      [draft({ id: 'Bad' }), 'lowercase slug'],
      [draft({ name: ' ' }), 'name must be'],
      [draft({ name: '名'.repeat(81) }), 'name must be'],
      [draft({ description: ' ' }), 'description must be'],
      [draft({ description: '描'.repeat(501) }), 'description must be'],
      [draft({ persona: ' ' }), 'persona must be'],
      [draft({ persona: '人'.repeat(32001) }), 'persona must be'],
      [draft({ category: 'Marketing' }), 'category must be'],
      [draft({ subtitle: '副'.repeat(41) }), 'subtitle is too long'],
      [draft({ icon: '123456789' }), 'icon is too long'],
      [draft({ skillMarkdown: '技'.repeat(64001) }), 'skillMarkdown is too long'],
      [draft({ tags: Array.from({ length: 9 }, () => 'a') }), 'tags accepts'],
      [draft({ tags: [''] }), 'tags accepts'],
      [draft({ quickPrompts: Array.from({ length: 7 }, () => 'a') }), 'quickPrompts accepts'],
      [draft({ quickPrompts: [''] }), 'quickPrompts accepts'],
    ]
    for (const [input, fragment] of cases) {
      const outcome = await publishExpert(publisher, input)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.reason).toContain(fragment)
    }
    expect(publisher.ids()).toEqual([])
  })

  it('trims a draft to the store limits', () => {
    const fitted = fitExpertDraft({
      id: 'geo',
      name: 'n'.repeat(100),
      description: 'd'.repeat(600),
      persona: 'p',
      category: 'NOT VALID',
      subtitle: 's'.repeat(50),
      icon: 'icon-too-long',
      tags: ['', 't'.repeat(30), 'ok'],
      quickPrompts: ['', 'q'.repeat(250)],
      skillMarkdown: 'k',
    })
    expect(fitted.category).toBe('general')
    expect(fitted.name).toHaveLength(80)
    expect(fitted.description).toHaveLength(500)
    expect(fitted.subtitle).toHaveLength(40)
    expect(fitted.icon).toHaveLength(8)
    expect(fitted.tags).toEqual(['t'.repeat(24), 'ok'])
    expect(fitted.quickPrompts).toEqual(['q'.repeat(200)])
    expect(fitExpertDraft({
      id: 'geo', name: '名称', description: '描述', persona: '人设', category: 'marketing',
    })).toMatchObject({ category: 'marketing', name: '名称' })
  })

  it('writes the expert, replaces the same id, and refuses an id the deployment owns', async () => {
    const root = await directory()
    const publisher = memoryPublisher(root, new Set(['shipped']))
    const first = await publishExpert(publisher, draft({ skillMarkdown: '---\nname: custom\n---\nbody' }))
    expect(first).toMatchObject({ ok: true, replaced: false, id: 'geo-prelaunch' })
    const skill = await readFile(join(root, 'geo-prelaunch', 'skills', 'published-expert', 'SKILL.md'), 'utf8')
    expect(skill.endsWith('\n')).toBe(true)
    expect(skill.startsWith('---\nname: custom\n')).toBe(true)
    const second = await publishExpert(publisher, draft({
      persona: '更新后的人设。',
      tags: ['GEO'],
      quickPrompts: ['开始'],
      category: 'content',
      subtitle: '自建',
      icon: '📌',
    }))
    expect(second).toMatchObject({ ok: true, replaced: true })
    expect(publisher.ids()).toEqual(['geo-prelaunch'])
    const stored = JSON.parse(await readFile(join(root, 'geo-prelaunch', 'expert.json'), 'utf8')) as { persona: string }
    expect(stored.persona).toBe('更新后的人设。')
    expect(await publishExpert(publisher, draft({ id: 'shipped' }))).toMatchObject({ ok: false, reason: expect.stringContaining('already on the roster') as string })
  })

  it('reloads saved experts and skips a corrupt file, a duplicate id, and an id already registered', async () => {
    const root = await directory()
    const first = memoryPublisher(root)
    await publishExpert(first, draft({ tags: ['GEO'], quickPrompts: ['开始'] }))
    await publishExpert(first, draft({ id: 'other-expert', name: '另一个' }))
    const saved = JSON.parse(await readFile(join(root, 'geo-prelaunch', 'expert.json'), 'utf8')) as { id: string }
    await mkdir(join(root, 'copy'), { recursive: true })
    await writeFile(join(root, 'copy', 'expert.json'), `${JSON.stringify({ ...saved })}\n`)
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken', 'expert.json'), '{')
    await mkdir(join(root, 'empty-json'), { recursive: true })
    await writeFile(join(root, 'empty-json', 'expert.json'), '{}\n')
    await mkdir(join(root, 'bad-tags'), { recursive: true })
    await writeFile(join(root, 'bad-tags', 'expert.json'), `${JSON.stringify({ ...saved, id: 'bad-tags', tags: 'no' })}\n`)
    await mkdir(join(root, 'bad-item'), { recursive: true })
    await writeFile(join(root, 'bad-item', 'expert.json'), `${JSON.stringify({ ...saved, id: 'bad-item', tags: [1] })}\n`)
    await mkdir(join(root, 'no-json'), { recursive: true })
    await mkdir(join(root, 'null-json'), { recursive: true })
    await writeFile(join(root, 'null-json', 'expert.json'), 'null\n')
    await mkdir(join(root, 'number-json'), { recursive: true })
    await writeFile(join(root, 'number-json', 'expert.json'), '1\n')
    const restored = memoryPublisher(root, new Set(['other-expert']))
    await loadPublishedExperts(restored)
    expect(restored.ids()).toEqual(['geo-prelaunch'])
  })

  it('treats a missing directory as nothing to load and rejects a root that is not a directory', async () => {
    const root = await directory()
    await loadPublishedExperts(memoryPublisher(join(root, 'missing')))
    const file = join(root, 'not-a-directory')
    await writeFile(file, 'x')
    await expect(loadPublishedExperts(memoryPublisher(file))).rejects.toThrow()
    await expect(listPublishedExperts(join(root, 'missing'))).resolves.toEqual([])
    await expect(listPublishedExperts(file)).rejects.toThrow()
  })

  it('skips a bad id and a file that is not an expert', async () => {
    const root = await directory()
    await expect(readPublishedExpert(root, 'Bad')).resolves.toBeUndefined()
    await publishExpert(memoryPublisher(root), draft())
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken', 'expert.json'), '{')
    const listed = await listPublishedExperts(root)
    expect(listed.map(expert => expert.id)).toEqual(['geo-prelaunch'])
    await mkdir(join(root, 'bad-file', 'expert.json'), { recursive: true })
    await expect(loadPublishedExperts(memoryPublisher(root))).rejects.toThrow()
  })

  it('rejects a blank root and keeps an explicit directory', () => {
    expect(resolveExpertRoot(undefined, '/default')).toBe('/default')
    expect(resolveExpertRoot('  /experts  ', '/default')).toBe('/experts')
    expect(() => resolveExpertRoot('   ', '/default')).toThrow('non-empty')
  })
})

describe('running roster', () => {
  async function boot(root: string): Promise<Context> {
    const ctx = await harness()
    contexts.push(ctx)
    const internal = ctx.loader.internal
    if (internal === undefined) throw new Error('Loader module importer is unavailable')
    vi.spyOn(internal, 'import').mockImplementation(async () => ({ apply() {} }))
    await ctx.plugin(ExpertPublish, { root })
    await declare(ctx, { id: 'standard', name: 'Standard', plugins: [] })
    return ctx
  }

  async function call(ctx: Context, args: Record<string, unknown>) {
    return executeModelToolFixture(ctx, {
      callId: ToolCallId('publish-1'),
      name: 'publish_expert',
      arguments: args,
      signal: new AbortController().signal,
    })
  }

  it('registers a card the expert page can list, and replaces it on the same id', async () => {
    const ctx = await boot(await directory())
    const created = await call(ctx, draft())
    expect(created.isError).toBe(false)
    expect(created.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Published expert') as string })
    const replaced = await call(ctx, draft({
      persona: '换一条人设。',
      category: 'content',
      subtitle: '自建',
      tags: ['GEO'],
      quickPrompts: ['开始'],
      icon: '📌',
      skillMarkdown: '细则',
    }))
    expect(replaced.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Replaced expert') as string })
    const { presets } = await ctx.agentPresets.remoteExportList()
    expect(presets.filter(row => row.id === 'geo-prelaunch')).toHaveLength(1)
    expect(presets.find(row => row.id === 'geo-prelaunch')?.broken).toBeUndefined()
    const refused = await call(ctx, draft({ id: 'Bad' }))
    expect(refused.isError).toBe(false)
    expect(refused.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('lowercase slug') as string })
    const tool = ctx.tools.get(PUBLISH_TOOL)
    if (tool === undefined) throw new Error('publish_expert is not registered')
    expect(tool.output.render({}, { ok: false, id: 'x', name: 'n', replaced: false })).toEqual([
      { type: 'text', text: 'The expert was not published.' },
    ])
  })

  it('refuses an id the deployment already registered', async () => {
    const ctx = await harness()
    contexts.push(ctx)
    await declare(ctx, { id: 'kept', name: 'Kept', plugins: [] })
    const internal = ctx.loader.internal
    if (internal === undefined) throw new Error('Loader module importer is unavailable')
    vi.spyOn(internal, 'import').mockImplementation(async () => ({ apply() {} }))
    await ctx.plugin(ExpertPublish, { root: await directory() })
    const outcome = await call(ctx, draft({ id: 'kept', name: 'Kept' }))
    expect(outcome.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('already on the roster') as string })
  })

  it('tells the model to publish on the first step of a share, and not otherwise', async () => {
    const ctx = await boot(await directory())
    const agent = await agentOn(ctx, 'share')
    const signal = new AbortController().signal
    const message = createUserMessage({
      content: [{ type: 'reasoning', text: 'skip' }, { type: 'text', text: SHARE }],
      source: { kind: 'user' },
    })
    const selection = { provider: 'mock', model: 'mock' }
    const entered = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 1, signal, modelSelection: selection },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
    )
    if (entered.kind !== 'enter') throw new Error('expected the step to enter')
    expect(entered.messages.at(-1)?.source.kind).toBe('expert-publish')
    const later = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 1, step: 2, signal, modelSelection: selection },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
    )
    if (later.kind !== 'enter') throw new Error('expected the later step to enter')
    expect(later.messages.some(item => item.source.kind === 'expert-publish')).toBe(false)
    const ordinary = createUserMessage({ content: [{ type: 'text', text: '普通消息' }], source: { kind: 'user' } })
    const plain = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [ordinary], turn: 2, step: 1, signal, modelSelection: selection },
      () => Promise.resolve({ kind: 'enter' as const, messages: [ordinary] }),
    )
    if (plain.kind !== 'enter') throw new Error('expected the ordinary step to enter')
    expect(plain.messages).toHaveLength(1)
    const rejected = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 3, step: 1, signal, modelSelection: selection },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(rejected.kind).toBe('reject')
    const present = entered.messages.at(-1)
    if (present === undefined) throw new Error('missing notice')
    const again = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [message], turn: 4, step: 1, signal, modelSelection: selection },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message, present] }),
    )
    if (again.kind !== 'enter') throw new Error('expected the repeated step to enter')
    expect(again.messages.filter(item => item.source.kind === 'expert-publish')).toHaveLength(1)
  })

  it('publishes the share when the turn ends without the tool, and leaves an existing card alone', async () => {
    const root = await directory()
    const ctx = await boot(root)
    const agent = await agentOn(ctx, 'fallback')
    const id = expertIdForName('示例专家')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'reasoning', text: 'skip' }, { type: 'text', text: SHARE }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'already noted' }],
      source: { kind: 'expert-publish', form: 'notice', summary: 'Add expert' },
    }), { surfaceOp: 'append' })
    agent.session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('other'), name: 'read', arguments: '{}',
    })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(async () => {
      const { presets } = await ctx.agentPresets.remoteExportList()
      expect(presets.some(row => row.id === id)).toBe(true)
    })
    const persona = JSON.parse(await readFile(join(root, id, 'expert.json'), 'utf8')) as { persona: string }
    expect(persona.persona).toContain('示例专家')

    agent.session.append('turn/start', { turn: 2 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: SHARE }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('tool/call', {
      turn: 2, step: 1, callId: ToolCallId('pub'), name: 'publish_expert', arguments: '{}',
    })
    agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const afterSkip = JSON.parse(await readFile(join(root, id, 'expert.json'), 'utf8')) as { persona: string }
    expect(afterSkip.persona).toBe(persona.persona)

    agent.session.append('turn/end', { turn: 9, reason: { kind: 'completed' } })
    agent.session.append('turn/start', { turn: 3 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: SHARE }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    agent.session.append('turn/start', { turn: 4 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '普通消息' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    const kept = JSON.parse(await readFile(join(root, id, 'expert.json'), 'utf8')) as { persona: string }
    expect(kept.persona).toBe(persona.persona)
  })

  it('logs a disk failure instead of failing the turn', async () => {
    const root = await directory()
    const ctx = await boot(root)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const agent = await agentOn(ctx, 'disk')
    const id = expertIdForName('示例专家')
    await writeFile(join(root, id), 'not a directory')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: SHARE }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled()
    })
    const plainRoot = await directory()
    const plain = await boot(plainRoot)
    const plainWarn = vi.spyOn(plain.logger, 'warn').mockImplementation(() => {})
    const plainAgent = await agentOn(plain, 'plain-failure')
    vi.spyOn(plain.agentPresets, 'register').mockRejectedValueOnce('not-an-error')
    plainAgent.session.append('turn/start', { turn: 1 })
    plainAgent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: SHARE }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    plainAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(plainWarn).toHaveBeenCalledWith(expect.stringContaining('not-an-error'))
    })
  })

  it('loads experts saved by an earlier process', async () => {
    const root = await directory()
    const first = await boot(root)
    await call(first, draft({ id: 'reloaded-expert', name: '重载专家' }))
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const second = await boot(root)
    const { presets } = await second.agentPresets.remoteExportList()
    expect(presets.some(row => row.id === 'reloaded-expert')).toBe(true)
  })
})
