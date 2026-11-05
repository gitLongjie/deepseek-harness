/** The model and GUI share one owner and one revision conflict policy. */
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { StudioStore } from '../src/studio-store.ts'
import * as tools from '../src/tools.ts'

it('saves visible works and refuses stale model edits without overwriting GUI edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-tools-'))
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const store = new StudioStore(root, 65536)
    ctx.provide('videoWorkbenchStudio', store)
    const mounted = ctx.plugin(tools)
    await mounted
    const content = { title: 'Agent draft', source: '', blocks: [] }
    const created = await executeToolFixture(ctx, { signal: new AbortController().signal,
      callId: ToolCallId('create'), name: 'video_studio_save', arguments: { content_json: JSON.stringify(content) } })
    expect(created.isError).toBe(false)
    const work = (await store.list()).works[0]!
    const read = await executeToolFixture(ctx, { signal: new AbortController().signal,
      callId: ToolCallId('read'), name: 'video_studio_read', arguments: { id: work.id } })
    expect(read.isError).toBe(false)
    expect(read.content).toEqual([{ type: 'text', text: JSON.stringify(await store.read(work.id)) }])
    await store.save(work.id, 1, { ...content, title: 'GUI revision' })
    const stale = await executeToolFixture(ctx, { signal: new AbortController().signal,
      callId: ToolCallId('stale'), name: 'video_studio_save',
      arguments: { id: work.id, revision: 1, content_json: JSON.stringify(content) } })
    expect(stale.isError).toBe(true)
    expect((await store.read(work.id)).title).toBe('GUI revision')
    await mounted.dispose()
    const removed = await executeToolFixture(ctx, { signal: new AbortController().signal,
      callId: ToolCallId('removed'), name: 'video_studio_read', arguments: {} })
    expect(removed.isError).toBe(true)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
