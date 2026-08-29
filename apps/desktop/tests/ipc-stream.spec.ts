/** The claim handshake: frames flow only after the renderer claims its id. */
import { describe, expect, it } from 'vitest'
import { createIpcStreamOpen } from '../src/render/transport.ts'

function fakeIpc() {
  const listeners = new Map<string, Array<(data: unknown) => void>>()
  let nextId = 0
  const programs = new Map<string, (push: (item: unknown) => void, end: () => void) => void>()
  return {
    invoke: (channel: string, payload?: unknown) => {
      if (channel !== 'dsh:stream:open') throw new Error(`unexpected invoke ${channel}`)
      void payload
      return Promise.resolve({ streamId: `s${String(++nextId)}` })
    },
    send: (channel: string, payload?: unknown) => {
      if (channel !== 'dsh:stream:claim') return
      const start = programs.get(payload as string)
      if (start === undefined) throw new Error(`claim for unknown stream ${String(payload)}`)
      const streamId = payload as string
      // The push reaches the renderer over real IPC in a later task: the
      // broadcast waits a microtask so the claiming `.then` can no longer be
      // the only closure whose streamId is still unset.
      queueMicrotask(() => start(
        (item) => { for (const l of listeners.get('dsh:stream:frame') ?? []) l({ streamId, item }) },
        () => { for (const l of listeners.get('dsh:stream:end') ?? []) l({ streamId }) },
      ))
    },
    on: (channel: string, listener: (data: unknown) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
      return () => { listeners.set(channel, (listeners.get(channel) ?? []).filter(l => l !== listener)) }
    },
    /** Queue one stream's pump: it fires only when the renderer claims the id. */
    program(streamId: string, start: (push: (item: unknown) => void, end: () => void) => void): void {
      programs.set(streamId, start)
    },
  }
}

describe('ipc stream claim handshake', () => {
  it('starts each host pump on claim and routes frames to their own iterator', async () => {
    const ipc = fakeIpc()
    const open = createIpcStreamOpen(ipc)
    const a = open('/api/a', {}, new AbortController().signal)
    const b = open('/api/b', {}, new AbortController().signal)
    ipc.program('s1', (push) => { push({ type: 'baseline', value: 1 }) })
    ipc.program('s2', (push) => { push({ type: 'ready', clientId: 'b' }) })
    const ia = a[Symbol.asyncIterator]()
    const ib = b[Symbol.asyncIterator]()
    expect((await ia.next()).value).toEqual({ type: 'baseline', value: 1 })
    expect((await ib.next()).value).toEqual({ type: 'ready', clientId: 'b' })
  })

  it('delivers an end frame as iterator completion', async () => {
    const ipc = fakeIpc()
    const stream = createIpcStreamOpen(ipc)('/api/x', {}, new AbortController().signal)
    ipc.program('s1', (_push, end) => { end() })
    expect(await stream[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
  })
})
