import { describe, expect, it } from 'vitest'
import { createIpcStreamOpen } from '../src/render/transport.ts'

function fakeIpc() {
  const listeners = new Map()
  const pending = []
  return {
    listeners,
    sent: [],
    invoke: (channel, payload) => {
      const streamId = `s${pending.length + 1}`
      pending.push({ channel, payload, streamId })
      return Promise.resolve({ streamId })
    },
    send: () => { /* renderer → main */ },
    on: (channel, listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
      return () => { listeners.set(channel, listeners.get(channel).filter(l => l !== listener)) }
    },
    main: {
      frame(streamId, item) {
        for (const l of listeners.get('dsh:stream:frame') ?? []) l({ streamId, item })
      },
      end(streamId) {
        for (const l of listeners.get('dsh:stream:end') ?? []) l({ streamId })
      },
    },
  }
}

describe('ipc stream open interleaving', () => {
  it('routes concurrent streams to their own iterators', async () => {
    const ipc = fakeIpc()
    const open = createIpcStreamOpen(ipc)
    const a = open('/api/a', {}, new AbortController().signal)
    const b = open('/api/b', {}, new AbortController().signal)
    // main pushes b's ready BEFORE b's invoke reply resolves, and a's data interleaved
    ipc.main.frame('s2', { type: 'ready', clientId: 'b' })
    ipc.main.frame('s1', { type: 'baseline', value: 1 })
    const ia = a[Symbol.asyncIterator]()
    const ib = b[Symbol.asyncIterator]()
    expect(await ib.next()).toEqual({ done: false, value: { type: 'ready', clientId: 'b' } })
    expect(await ia.next()).toEqual({ done: false, value: { type: 'baseline', value: 1 } })
    ipc.main.frame('s1', { type: 'delta', v: 2 })
    expect(await ia.next()).toEqual({ done: false, value: { type: 'delta', v: 2 } })
    ipc.main.end('s1')
    expect(await ia.next()).toEqual({ done: true })
  })
})
