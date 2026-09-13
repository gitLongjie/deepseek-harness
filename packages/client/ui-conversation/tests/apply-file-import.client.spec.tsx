// @vitest-environment jsdom
// The composer bar's addFiles inject over the real apply assembly: workspace
// imports stage `@` mention chips through the same reference pipeline as the
// `@` menu, and every failure shape resolves to its localized composer
// message (import failure, unmentionable path, frozen machine).
import { describe, expect, it, vi } from 'vitest'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  SlotTestRuntime, stubSettingsScope, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply, inject, type ComposerBarInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId

function sessionFakeFor(): SessionBehaviorOverrides {
  return {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
}

interface BenchOptions {
  /** Scripted `fileReferences.import` face; absent = no remote mount. */
  importFace?: (sessionId: SessionId, request: { name: string; data: string }) => Promise<unknown>
}

async function bench(options: BenchOptions = {}) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.ctx.provide('uiWorkspace', { connectWorkspace: async () => ROOT } as never)
  if (options.importFace !== undefined) {
    // The gateway wires the namespace twice: as a property of the `remote`
    // service and as a standalone `remote.<namespace>` service on the root.
    runtime.ctx.provide('remote', {
      fileReferences: { import: options.importFace },
    } as never)
    runtime.ctx.provide('remote.fileReferences', { import: options.importFace } as never)
  }
  const sessionFake = sessionFakeFor()
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session: sessionFake,
  }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
  }, (_props: { renderSlot?: unknown }) => null)

  const feature = await runtime.mount({ inject: [...inject], apply })
  runtime.renderRoot()
  const entry = runtime.slots.entries('conversation.composer.bar')[0]!
  const injected = (entry.inject as unknown as (id: SessionId | undefined) => ComposerBarInjected)(ROOT)
  const input = runtime.ctx.conversation.input.for(runtime.sessions.scope(ROOT)!)
  return {
    runtime, feature, injected, sessionFake, input,
    draft: (): string => input.state.getSnapshot().draft,
  }
}

const pdf = (name: string): File => new File([Uint8Array.of(1, 2)], name, { type: 'application/pdf' })

describe('composer addFiles', () => {
  it('imports documents into the workspace and stages their mention chips in the draft', async () => {
    const importFace = vi.fn((_id: SessionId, request: { name: string; data: string }) =>
      Promise.resolve({ ok: true, value: { path: `uploads/${request.name}` } }))
    const b = await bench({ importFace })
    const outcome = await b.injected.addFiles!([pdf('a.txt'), pdf('b c.txt')])
    expect(outcome).toBeNull()
    // A chip per file, whitespace paths quoted, separated by single spaces.
    expect(b.draft()).toBe('@uploads/a.txt @"uploads/b c.txt" ')
    expect(importFace).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('resolves the localized import failure when the Host refuses a file', async () => {
    const importFace = vi.fn((_id: SessionId, _request: { name: string; data: string }) =>
      Promise.resolve({ ok: false, error: { code: 'internal', message: 'too big', details: {} } }))
    const b = await bench({ importFace })
    const outcome = await b.injected.addFiles!([pdf('f.pdf')])
    expect(outcome).toBe('f.pdf 导入失败：too big')
    expect(b.draft()).toBe('')
    await b.runtime.dispose()
  })

  it('resolves the insert failure when the stored path cannot become a mention', async () => {
    const importFace = vi.fn((_id: SessionId, _request: { name: string; data: string }) =>
      Promise.resolve({ ok: true, value: { path: 'uploads/ba\nd.txt' } }))
    const b = await bench({ importFace })
    const outcome = await b.injected.addFiles!([pdf('weird.txt')])
    expect(outcome).toBe('weird.txt 已导入，但无法插入输入框')
    expect(b.draft()).toBe('')
    await b.runtime.dispose()
  })

  it('keeps the localized import failure when the remotes mount is absent', async () => {
    const b = await bench()
    const outcome = await b.injected.addFiles!([pdf('f.pdf')])
    expect(outcome).toBe('f.pdf 导入失败：file import is not mounted in this deployment')
    expect(b.draft()).toBe('')
    await b.runtime.dispose()
  })
})
