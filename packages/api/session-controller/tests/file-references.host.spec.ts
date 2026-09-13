import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  FileImportRequest, FileImportValue, FileReferenceCandidate,
} from '@deepseek-ai/dsh-file-reference/types'
import { describe, expect, it, vi } from 'vitest'
import { SessionFileReferences } from '../src/file-references.ts'

describe('SessionFileReferences', () => {
  it('delegates the resolved Agent, query, and cancellation signal unchanged', async () => {
    const ctx = new Context()
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn(() => Promise.resolve(candidates))
    ctx.provide('fileReferences', { list } as never)
    const adapter = new SessionFileReferences(ctx)
    const agent = { id: 'target' } as unknown as Agent
    const signal = new AbortController().signal

    await expect(adapter.list(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })

  it('delegates workspace imports with the request and cancellation signal unchanged', async () => {
    const ctx = new Context()
    const stored: FileImportValue = { path: 'uploads/report.pdf' }
    const importFile = vi.fn(() => Promise.resolve(stored))
    ctx.provide('fileReferences', { import: importFile } as never)
    const adapter = new SessionFileReferences(ctx)
    const agent = { id: 'target' } as unknown as Agent
    const signal = new AbortController().signal
    const request: FileImportRequest = { name: 'report.pdf', data: 'aGVsbG8=' }

    await expect(adapter.import(agent, request, signal)).resolves.toBe(stored)
    expect(importFile).toHaveBeenCalledWith(agent, request, signal)
  })
})
