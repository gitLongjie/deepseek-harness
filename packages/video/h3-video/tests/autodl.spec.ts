/**
 * The AutoDL Pro API client and its GPU vendor adapter: the documented endpoints, the
 * query-parameter form of the two GET calls, envelope errors, and the service-domain mapping the
 * instance pool turns into a ComfyUI origin.
 */

import { describe, expect, it } from 'vitest'
import {
  AutoDLClient,
  AutoDLError,
  createAutoDLVendor,
  normalizeGpuRunState,
  serviceDomainUrl,
} from '../src/autodl.ts'
import type { FetchLike } from '../src/http.ts'

interface Call {
  readonly url: URL
  readonly init: RequestInit | undefined
}

type MockFetch = FetchLike & { readonly calls: Call[] }

/** A fetch stub answering one canned envelope per call and recording the request. */
function mockFetch(answer: (call: Call) => { status?: number; body: unknown }): MockFetch {
  const calls: Call[] = []
  const fetchImpl: FetchLike = (input, init) => {
    const call = { url: new URL(input), init }
    calls.push(call)
    const { status = 200, body } = answer(call)
    return Promise.resolve(new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    ))
  }
  return Object.assign(fetchImpl, { calls })
}

function success(data: unknown): { body: unknown } {
  return { body: { code: 'Success', data, msg: '', request_id: 'req-1' } }
}

/** The JSON request body one recorded call sent. */
function jsonBody(call: Call | undefined): Record<string, unknown> {
  const body = call?.init?.body
  if (typeof body !== 'string') throw new Error('expected a JSON request body')
  return JSON.parse(body) as Record<string, unknown>
}

function client(fetchImpl: FetchLike, token: string | (() => Promise<string>) = 'test-token'): AutoDLClient {
  return new AutoDLClient({ token, timeoutMs: 5_000, fetchImpl })
}

const CREATE_SPEC = {
  gpuSpecUuid: 'v-32g-p',
  imageUuid: 'image-comfy',
  cudaVersion: 118,
  gpuAmount: 1,
  systemDiskGb: 0,
  dataCenterList: ['westDC3'],
  startCommand: 'bash /root/start-comfyui.sh',
}

describe('AutoDLClient', () => {
  it('creates an instance with the documented body and the account token', async () => {
    const fetcher = mockFetch(() => success('pro-76419909953e'))
    const id = await client(fetcher).createInstance(CREATE_SPEC, 'dsh-h3-video')
    expect(id).toBe('pro-76419909953e')
    const call = fetcher.calls[0]
    expect(call?.url.href).toBe('https://api.autodl.com/api/v1/dev/instance/pro/create')
    expect(call?.init?.method).toBe('POST')
    expect(new Headers(call?.init?.headers).get('authorization')).toBe('test-token')
    expect(jsonBody(call)).toEqual({
      gpu_spec_uuid: 'v-32g-p',
      image_uuid: 'image-comfy',
      cuda_v_from: 118,
      req_gpu_amount: 1,
      expand_system_disk_by_gb: 0,
      instance_name: 'dsh-h3-video',
      data_center_list: ['westDC3'],
      start_command: 'bash /root/start-comfyui.sh',
    })
  })

  it('reads status and snapshot through query parameters, never a GET body', async () => {
    const fetcher = mockFetch(call => call.url.pathname.endsWith('/status')
      ? success('running')
      : success({ service_6006_domain: 'u1-gpu.autodl.com:8443' }))
    const api = client(fetcher)
    expect(await api.instanceStatus('pro-1')).toBe('running')
    const snapshot = await api.instanceSnapshot('pro-1')
    expect(snapshot.service_6006_domain).toBe('u1-gpu.autodl.com:8443')
    for (const call of fetcher.calls) {
      expect(call.init?.body).toBeUndefined()
      expect(call.url.searchParams.get('instance_uuid')).toBe('pro-1')
    }
  })

  it('lists the account instances newest first', async () => {
    const fetcher = mockFetch(() => success({
      list: [
        { uuid: 'pro-2', name: 'dsh-h3-video', status: 'running' },
        { uuid: 'pro-1', status: 'shutdown' },
        { name: 'no-uuid', status: 'running' },
      ],
    }))
    const instances = await client(fetcher).listInstances()
    expect(instances).toEqual([
      { id: 'pro-2', name: 'dsh-h3-video', status: 'running' },
      { id: 'pro-1', status: 'shutdown' },
    ])
    expect(jsonBody(fetcher.calls[0])).toEqual({ page_index: 1, page_size: 50 })
  })

  it('resolves the token on every call so a rotated credential takes effect', async () => {
    let value = 'first'
    const fetcher = mockFetch(() => success(null))
    const api = new AutoDLClient({ token: async () => value, timeoutMs: 5_000, fetchImpl: fetcher })
    await api.powerOff('pro-1')
    value = 'second'
    await api.powerOff('pro-1')
    const headers = fetcher.calls.map(call => new Headers(call.init?.headers).get('authorization'))
    expect(headers).toEqual(['first', 'second'])
  })

  it('raises a vendor envelope failure with its code and request id', async () => {
    const fetcher = mockFetch(() => ({
      body: { code: 'RecordNotFoundError', data: null, msg: '未查询到相关实例', request_id: 'req-9' },
    }))
    const error = await client(fetcher).instanceStatus('pro-missing').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AutoDLError)
    expect((error as AutoDLError).code).toBe('RecordNotFoundError')
    expect((error as AutoDLError).requestId).toBe('req-9')
    expect((error as Error).message).toContain('未查询到相关实例')
  })

  it('reports a gateway failure and a non-JSON body as errors naming the endpoint', async () => {
    const gateway = mockFetch(() => ({ status: 502, body: 'Bad Gateway' }))
    await expect(client(gateway).listInstances()).rejects.toThrow(/HTTP 502 with a non-JSON body/u)
    const html = mockFetch(() => ({ body: '<html>maintenance</html>' }))
    await expect(client(html).listInstances()).rejects.toThrow(/non-JSON body/u)
  })

  it('powers on with GPU payload, shuts down, and releases', async () => {
    const fetcher = mockFetch(() => success(null))
    const api = client(fetcher)
    await api.powerOn('pro-1', 'bash /root/start-comfyui.sh')
    await api.powerOff('pro-1')
    await api.release('pro-1')
    expect(fetcher.calls.map(call => new URL(call.url).pathname)).toEqual([
      '/api/v1/dev/instance/pro/power_on',
      '/api/v1/dev/instance/pro/power_off',
      '/api/v1/dev/instance/pro/release',
    ])
    expect(jsonBody(fetcher.calls[0])).toEqual({
      instance_uuid: 'pro-1',
      payload: 'gpu',
      start_command: 'bash /root/start-comfyui.sh',
    })
  })

  it('bounds one call by the configured timeout', async () => {
    const never: FetchLike = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    })
    const api = new AutoDLClient({ token: 't', timeoutMs: 1_000, fetchImpl: never })
    await expect(api.instanceStatus('pro-1')).rejects.toThrow(/timed out after 1s/u)
  }, 5_000)
})

describe('AutoDL vendor mapping', () => {
  it('normalizes vendor statuses into run states', () => {
    expect(normalizeGpuRunState('running')).toBe('running')
    expect(normalizeGpuRunState('shutdown')).toBe('stopped')
    expect(normalizeGpuRunState('stopped')).toBe('stopped')
    expect(normalizeGpuRunState('starting')).toBe('pending')
    expect(normalizeGpuRunState('')).toBe('pending')
  })

  it('publishes the mapped service port as an https origin', () => {
    expect(serviceDomainUrl({ service_6006_domain: 'u1-gpu.autodl.com:8443' }, 6006))
      .toBe('https://u1-gpu.autodl.com:8443')
    expect(serviceDomainUrl({ service_6006_domain: 'https://u1-gpu.autodl.com:8443/' }, 6006))
      .toBe('https://u1-gpu.autodl.com:8443')
    // A deployment's own mapping may already name its scheme.
    expect(serviceDomainUrl({ service_6006_domain: 'http://127.0.0.1:8188' }, 6006))
      .toBe('http://127.0.0.1:8188')
    expect(serviceDomainUrl({ service_6006_domain: '' }, 6006)).toBeUndefined()
    expect(serviceDomainUrl({}, 6006)).toBeUndefined()
  })

  it('binds the creation specification to the vendor operations', async () => {
    const fetcher = mockFetch((call) => {
      if (call.url.pathname.endsWith('/create')) return success('pro-new')
      if (call.url.pathname.endsWith('/snapshot')) return success({ service_6006_domain: 'u1-gpu.autodl.com:8443' })
      return success(null)
    })
    const vendor = createAutoDLVendor({
      client: client(fetcher),
      spec: CREATE_SPEC,
      instanceName: 'dsh-h3-video',
      servicePort: 6006,
    })
    expect(vendor.name).toBe('autodl')
    expect(await vendor.create()).toBe('pro-new')
    await vendor.powerOn('pro-new')
    expect(jsonBody(fetcher.calls[1])).toMatchObject({
      instance_uuid: 'pro-new',
      payload: 'gpu',
      start_command: 'bash /root/start-comfyui.sh',
    })
    expect(await vendor.serviceUrl('pro-new', 6006)).toBe('https://u1-gpu.autodl.com:8443')
  })
})
