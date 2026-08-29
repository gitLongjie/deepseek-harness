/** Unary IPC dispatch through the Connection shared-channel handler. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
}))

import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { dispatchTransportFetch } from '../src/main/ipc/transport.ts'

/** The never-settled host: no ApiProxy yet. */
const UNSETTLED = { api: undefined, connection: undefined }

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
      { api: {} as ApiProxy, connection },
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
      { api: {} as ApiProxy, connection },
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

  it('falls back to the ApiProxy unary dispatcher without the Connection service', async () => {
    const response = await dispatchTransportFetch(
      { api: {} as ApiProxy, connection: undefined },
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
