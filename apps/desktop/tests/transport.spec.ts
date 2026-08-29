/** Unary IPC dispatch through the Connection shared-channel handler. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
}))

import { ipcMain } from 'electron'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { dispatchTransportFetch, registerTransportIpc } from '../src/main/ipc/transport.ts'

/** The never-settled host: no Connection yet. */
const UNSETTLED = { gateway: undefined, connection: undefined }

describe('dispatchTransportFetch', () => {
  it('answers 503 before the host settles', async () => {
    const response = await dispatchTransportFetch(UNSETTLED, {
      requestId: 'r', path: '/api/settings.describe', method: 'POST',
    }, new AbortController().signal)
    expect(response.status).toBe(503)
  })

  it('routes interceptor-claimed endpoints through the Connection shared-channel handler', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: () => ({
        fetch: async (request: Request) => {
          seen = request
          return new Response('gateway', { status: 200 })
        },
      }),
      createChannelsFetchHandler: () => ({
        fetch: async () => new Response('unreachable', { status: 500 }),
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/api/dynamicCordisRunner/inventory',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"rpcId":"r1"}',
      },
      new AbortController().signal,
    )
    expect(await response.text()).toBe('gateway')
    // The synthetic request carries the loopback Host the shared channel's
    // trust fence binds on, plus the JSON media type the envelope needs.
    expect(seen?.url).toBe('http://127.0.0.1/api/dynamicCordisRunner/inventory')
    expect(seen?.headers.get('host')).toBe('127.0.0.1')
    expect(seen?.headers.get('content-type')).toBe('application/json')
  })

  it('routes a generic RPC channel through the Connection channel dispatcher', async () => {
    let seen: Request | undefined
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      createChannelsFetchHandler: (fallback: unknown) => ({
        fetch: async (request: Request) => {
          seen = request
          void fallback
          return new Response('channel', { status: 200 })
        },
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection },
      {
        requestId: 'r',
        path: '/weixin/connection.status',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"type":"client-request","rpcId":"r1","method":"connection.status","payload":{}}',
      },
      new AbortController().signal,
    )
    expect(await response.text()).toBe('channel')
    expect(seen?.url).toBe('http://127.0.0.1/weixin/connection.status')
  })

  it('answers 404 for endpoints no shared-channel owner claims', async () => {
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => fallback,
      createChannelsFetchHandler: () => ({
        fetch: async () => new Response('not found', { status: 404 }),
      }),
    } as unknown as HostConnectionHandle
    const response = await dispatchTransportFetch(
      { gateway: {} as never, connection: connection as HostConnectionHandle },
      {
        requestId: 'r',
        path: '/api/no.such.method',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"rpcId":"r1"}',
      },
      new AbortController().signal,
    )
    expect(response.status).toBe(404)
  })
})

describe('registerTransportIpc stream handshake', () => {
  it('answers the open request with { streamId } and pumps only after the claim', async () => {
    const opened: Array<{ endpoint: string; payload: unknown; signal: AbortSignal }> = []
    const gateway = {
      wireStream: {
        open: (endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> => {
          opened.push({ endpoint, payload, signal })
          return Promise.resolve((async function* () { yield { type: 'ready' } })())
        },
      },
    } as never
    let send: ((channel: string, payload: unknown) => void) | undefined
    const remove = registerTransportIpc(() => ({ gateway, connection: undefined }))
    try {
      const handle = (ipcMain.handle as unknown as {
        mock: { calls: Array<[string, (event: unknown, req: unknown) => unknown]> }
      }).mock.calls
      const on = (ipcMain.on as unknown as {
        mock: { calls: Array<[string, (event: unknown, payload: unknown) => void]> }
      }).mock.calls
      const openHandler = handle.find(([channel]) => channel === 'dsh:stream:open')?.[1]
      const claimHandler = on.find(([channel]) => channel === 'dsh:stream:claim')?.[1]
      expect(openHandler).toBeTypeOf('function')
      expect(claimHandler).toBeTypeOf('function')
      const sender = { isDestroyed: () => false, send: (channel: string, payload: unknown): void => { send?.(channel, payload) } }
      send = vi.fn()
      const response = openHandler!({ sender }, { endpoint: '$events', payload: { args: {} } }) as { streamId?: string }
      // The claim contract: an object field, not a bare string.
      expect(typeof response).toBe('object')
      expect(typeof response.streamId).toBe('string')
      expect(opened).toHaveLength(0)
      claimHandler!({}, response.streamId)
      await vi.waitFor(() => { expect(opened).toHaveLength(1) })
      expect(opened[0]!.endpoint).toBe('$events')
    } finally {
      await remove()
    }
  })
})
