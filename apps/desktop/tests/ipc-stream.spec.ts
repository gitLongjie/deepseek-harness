/** The claim handshake: frames flow only after the renderer claims its id. */
import { describe, expect, it } from 'vitest'
import { createIpcStreamOpen } from '../src/render/transport.ts'

function fakeIpc({ deferOpen = false }: { deferOpen?: boolean } = {}) {
  const listeners = new Map<string, Array<(data: unknown) => void>>()
  let nextId = 0
  const programs = new Map<string, (push: (item: unknown) => void, end: () => void) => void>()
  const replies: Array<() => void> = []
  const emit = (channel: string, data: unknown): void => {
    for (const listener of listeners.get(channel) ?? []) listener(data)
  }
  return {
    invoke: (channel: string, payload?: unknown) => {
      if (channel !== 'dsh:stream:open') throw new Error(`unexpected invoke ${channel}`)
      void payload
      const streamId = `s${String(++nextId)}`
      if (!deferOpen) return Promise.resolve({ streamId })
      return new Promise<{ streamId: string }>((resolve) => {
        replies.push(() => { resolve({ streamId }) })
      })
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
        (item) => { emit('dsh:stream:frame', { streamId, item }) },
        () => { emit('dsh:stream:end', { streamId }) },
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
    /** Answer the oldest open request, as the host's reply would. */
    reply(): void {
      const answer = replies.shift()
      if (answer === undefined) throw new Error('no open request is awaiting a reply')
      answer()
    },
    /** Broadcast one frame as a stream that is already pumping on this bridge. */
    frame(streamId: string, item: unknown): void {
      emit('dsh:stream:frame', { streamId, item })
    },
    /** Broadcast one stream's end as that stream's pump would. */
    end(streamId: string): void {
      emit('dsh:stream:end', { streamId })
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

  it('drops a foreign entry that lands while this open is still in flight', async () => {
    const ipc = fakeIpc({ deferOpen: true })
    const stream = createIpcStreamOpen(ipc)('/api/session/follow', {}, new AbortController().signal)
    ipc.program('s1', (push) => { push({ type: 'snapshot', cursor: 4 }) })
    const iterator = stream[Symbol.asyncIterator]()
    // An already-running stream broadcasts a durable entry during this open;
    // adopted here, it would precede this stream's own opening cursor.
    ipc.frame('s-existing', { type: 'event', seq: 9 })
    ipc.reply()
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'snapshot', cursor: 4 } })
  })

  it('drops a foreign end that lands while this open is still in flight', async () => {
    const ipc = fakeIpc({ deferOpen: true })
    const stream = createIpcStreamOpen(ipc)('/api/session/follow', {}, new AbortController().signal)
    ipc.program('s1', (push) => { push({ type: 'snapshot', cursor: 1 }) })
    const iterator = stream[Symbol.asyncIterator]()
    ipc.end('s-existing')
    ipc.reply()
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'snapshot', cursor: 1 } })
  })
})
