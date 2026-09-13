/** The abstract service preserves the provider's discovery and import contracts. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReferenceService } from '../src/index.ts'
import type { FileImportValue, FileReferenceCandidate } from '../src/types.ts'

describe('FileReferenceService', () => {
  it('registers a provider implementation without wrapping its discovery member', async () => {
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn((_agent: Agent, _query: string, _signal: AbortSignal) => Promise.resolve(candidates))
    const stored: FileImportValue = { path: 'uploads/src.txt' }
    const importFile = vi.fn((_agent: Agent, _request: unknown, _signal: AbortSignal) => Promise.resolve(stored))
    class StubProvider extends FileReferenceService {
      list = list
      import = importFile
    }
    const provider = new StubProvider(new Context())
    const agent = { id: 'target' } as unknown as Agent
    const signal = new AbortController().signal
    await expect(provider.list(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
    const request = { name: 'src.txt', data: 'aGVsbG8=' }
    await expect(provider.import(agent, request, signal)).resolves.toBe(stored)
    expect(importFile).toHaveBeenCalledWith(agent, request, signal)
  })
})
