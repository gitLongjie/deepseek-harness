/**
 * AutoDL container-instance Pro API: the account-token HTTP client and the {@link GpuVendor}
 * adapter the instance pool drives. The client speaks AutoDL's documented envelope
 * (`{ code, msg, data, request_id }`) and resolves the token per request, so a rotated credential
 * takes effect without rebuilding the pool. Test setups inject a fetch stub; production uses the
 * global `fetch`.
 * @module @deepseek-ai/dsh-h3-video/autodl
 */

import type { FetchLike } from './http.ts'
import type { GpuRunState, GpuVendor, GpuVendorInstance } from './gpu.ts'

/** API origin used when the configuration names none. */
const DEFAULT_BASE_URL = 'https://api.autodl.com'

/** One AutoDL instance as the list endpoint reports it. */
export interface AutoDLInstance {
  /** Vendor instance id, e.g. `pro-76576c61fdf1`. */
  readonly id: string
  /** Account-visible instance name, the pool's reuse key. */
  readonly name?: string
  /** Vendor status string (`running`, `shutdown`, …). */
  readonly status: string
}

/** Instance detail returned by the snapshot endpoint. */
export type AutoDLSnapshot = Readonly<Record<string, unknown>>

/** Creation body of `POST /api/v1/dev/instance/pro/create`. */
export interface AutoDLCreateSpec {
  /** Compute specification id, e.g. `v-32g-p`. */
  readonly gpuSpecUuid: string
  /** Boot image uuid. */
  readonly imageUuid: string
  /** Minimum CUDA code the scheduled host must satisfy (118 = 11.8). */
  readonly cudaVersion: number
  /** GPU count, 1–4. */
  readonly gpuAmount: number
  /** System-disk expansion in GB, 0–500. */
  readonly systemDiskGb: number
  /** Preferred data centers, in order; the vendor picks when omitted. */
  readonly dataCenterList?: readonly string[]
  /** Command run after boot; starts the ComfyUI server. */
  readonly startCommand?: string
}

/** Construction options for {@link AutoDLClient}. */
export interface AutoDLClientOptions {
  /** Account token, or a resolver reading it from the credential store per request. */
  readonly token: string | (() => Promise<string>)
  /** API origin; defaults to `https://api.autodl.com`. */
  readonly baseUrl?: string
  /** Per-request wall-clock bound in milliseconds. */
  readonly timeoutMs: number
  /** Injectable fetch for tests. */
  readonly fetchImpl?: FetchLike
}

/** A non-`Success` AutoDL envelope, carrying the vendor's code and request id. */
export class AutoDLError extends Error {
  /**
   * @param endpoint - API path that answered.
   * @param code - vendor response code (`RecordNotFoundError`, …).
   * @param detail - vendor message.
   * @param requestId - vendor request id for support escalation.
   */
  constructor(
    readonly endpoint: string,
    readonly code: string,
    readonly detail: string,
    readonly requestId?: string,
  ) {
    super(`AutoDL ${endpoint} failed (${code}): ${detail}${requestId !== undefined ? ` [request ${requestId}]` : ''}`)
    this.name = 'AutoDLError'
  }
}

/**
 * Map one vendor status string onto the pool's run states. Unknown values stay `pending`, so a
 * transitional status never reads as running or stopped.
 * @param status - vendor status string.
 * @returns the normalized run state.
 */
export function normalizeGpuRunState(status: string): GpuRunState {
  if (status === 'running') return 'running'
  if (status === 'shutdown' || status === 'stopped' || status === 'off' || status === 'poweroff') return 'stopped'
  return 'pending'
}

/**
 * Build the public HTTP origin for one mapped service port from an instance snapshot.
 * @param snapshot - snapshot detail returned by the vendor.
 * @param port - service port, e.g. the ComfyUI `6006` mapping.
 * @returns the origin, or `undefined` while the mapping does not exist.
 */
export function serviceDomainUrl(snapshot: AutoDLSnapshot, port: number): string | undefined {
  const value = snapshot[`service_${port}_domain`]
  if (typeof value !== 'string' || value.length === 0) return undefined
  // AutoDL publishes a scheme-less host with its TLS port (`…:8443`); a value that already names
  // its scheme is a deployment's own mapping and is used as authored.
  if (/^https?:\/\//u.test(value)) return value.replace(/\/+$/u, '')
  return `https://${value.replace(/\/+$/u, '')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The AutoDL Pro API client: one authenticated JSON call per documented endpoint, with the
 * envelope unwrapped or raised.
 */
export class AutoDLClient {
  private readonly options: AutoDLClientOptions
  private readonly baseUrl: string
  private readonly doFetch: FetchLike

  /**
   * @param options - token source, origin, request bound, and an optional fetch stub.
   */
  constructor(options: AutoDLClientOptions) {
    this.options = options
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  /**
   * List the account's instances, newest first as the vendor orders them.
   * @returns the instances reported by the list endpoint.
   */
  async listInstances(): Promise<readonly AutoDLInstance[]> {
    const data = await this.call('POST', '/api/v1/dev/instance/pro/list', { page_index: 1, page_size: 50 })
    if (!isRecord(data) || !Array.isArray(data.list)) {
      throw new Error('AutoDL /api/v1/dev/instance/pro/list returned no instance list')
    }
    return data.list.filter(isRecord).flatMap((entry) => {
      if (typeof entry.uuid !== 'string') return []
      return [{
        id: entry.uuid,
        ...(typeof entry.name === 'string' && entry.name.length > 0 ? { name: entry.name } : {}),
        status: typeof entry.status === 'string' ? entry.status : '',
      }]
    })
  }

  /**
   * Create one pay-as-you-go instance.
   * @param spec - compute, image, and boot command.
   * @param instanceName - name the pool uses to reuse the instance later.
   * @returns the new instance id.
   */
  async createInstance(spec: AutoDLCreateSpec, instanceName: string): Promise<string> {
    const data = await this.call('POST', '/api/v1/dev/instance/pro/create', {
      gpu_spec_uuid: spec.gpuSpecUuid,
      image_uuid: spec.imageUuid,
      cuda_v_from: spec.cudaVersion,
      req_gpu_amount: spec.gpuAmount,
      expand_system_disk_by_gb: spec.systemDiskGb,
      instance_name: instanceName,
      ...(spec.dataCenterList !== undefined && spec.dataCenterList.length > 0
        ? { data_center_list: [...spec.dataCenterList] }
        : {}),
      ...(spec.startCommand !== undefined ? { start_command: spec.startCommand } : {}),
    })
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('AutoDL /api/v1/dev/instance/pro/create returned no instance id')
    }
    return data
  }

  /**
   * Read one instance's status string.
   * @param instanceId - vendor instance id.
   * @returns the vendor status, e.g. `running`.
   */
  async instanceStatus(instanceId: string): Promise<string> {
    const data = await this.call('GET', '/api/v1/dev/instance/pro/status', { instance_uuid: instanceId })
    return typeof data === 'string' ? data : ''
  }

  /**
   * Read one instance's detail, including its mapped service domains.
   * @param instanceId - vendor instance id.
   * @returns the snapshot record.
   */
  async instanceSnapshot(instanceId: string): Promise<AutoDLSnapshot> {
    const data = await this.call('GET', '/api/v1/dev/instance/pro/snapshot', { instance_uuid: instanceId })
    if (!isRecord(data)) throw new Error('AutoDL /api/v1/dev/instance/pro/snapshot returned no detail')
    return data
  }

  /**
   * Power a stopped instance on with GPU access, applying the boot command.
   * @param instanceId - vendor instance id.
   * @param startCommand - command run after boot; overrides the creation-time command.
   */
  async powerOn(instanceId: string, startCommand?: string): Promise<void> {
    await this.call('POST', '/api/v1/dev/instance/pro/power_on', {
      instance_uuid: instanceId,
      payload: 'gpu',
      ...(startCommand !== undefined ? { start_command: startCommand } : {}),
    })
  }

  /**
   * Power an instance off, ending GPU billing and keeping its disk.
   * @param instanceId - vendor instance id.
   */
  async powerOff(instanceId: string): Promise<void> {
    await this.call('POST', '/api/v1/dev/instance/pro/power_off', { instance_uuid: instanceId })
  }

  /**
   * Delete an instance and its disk. The vendor requires it to be powered off first.
   * @param instanceId - vendor instance id.
   */
  async release(instanceId: string): Promise<void> {
    await this.call('POST', '/api/v1/dev/instance/pro/release', { instance_uuid: instanceId })
  }

  /**
   * Issue one authenticated call and unwrap the vendor envelope.
   * @param method - HTTP verb; AutoDL reads `GET` bodies as query parameters.
   * @param path - API path.
   * @param body - request fields.
   * @returns the envelope's `data`.
   * @throws AutoDLError - when the vendor answers with a non-`Success` code.
   */
  private async call(method: 'GET' | 'POST', path: string, body: Record<string, unknown>): Promise<unknown> {
    const token = typeof this.options.token === 'string' ? this.options.token : await this.options.token()
    const url = new URL(path, this.baseUrl)
    if (method === 'GET') {
      for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    timer.unref()
    let response: Response
    try {
      response = await this.doFetch(url.toString(), {
        method,
        headers: { authorization: token, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      })
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        throw new Error(`AutoDL ${path} timed out after ${Math.round(this.options.timeoutMs / 1000)}s`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new Error(`AutoDL ${path} returned HTTP ${response.status} with a non-JSON body: ${text.slice(0, 200)}`)
    }
    if (!isRecord(payload) || typeof payload.code !== 'string') {
      throw new Error(`AutoDL ${path} returned an unexpected response: ${text.slice(0, 200)}`)
    }
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : undefined
    const message = typeof payload.msg === 'string' ? payload.msg : ''
    if (!response.ok) {
      throw new Error(`AutoDL ${path} failed with HTTP ${response.status}: ${message.length > 0 ? message : text.slice(0, 200)}`)
    }
    if (payload.code !== 'Success') {
      throw new AutoDLError(path, payload.code, message, requestId)
    }
    return payload.data
  }
}

/**
 * Create the AutoDL client from validated configuration.
 * @param options - token source, origin, and request bound.
 * @returns the ready client.
 */
export function createAutoDLClient(options: AutoDLClientOptions): AutoDLClient {
  return new AutoDLClient(options)
}

/** Construction options for {@link createAutoDLVendor}. */
export interface AutoDLVendorOptions {
  /** Client issuing the documented calls. */
  readonly client: AutoDLClient
  /** Creation specification applied when no instance can be reused. */
  readonly spec: AutoDLCreateSpec
  /** Name given to a created instance and matched when reusing one. */
  readonly instanceName: string
  /** Service port whose mapped domain carries ComfyUI. */
  readonly servicePort: number
}

/**
 * Bind the AutoDL client to one creation specification and expose it as the pool's vendor.
 * @param options - client, creation specification, reuse name, and service port.
 * @returns the vendor adapter the GPU pool drives.
 */
export function createAutoDLVendor(options: AutoDLVendorOptions): GpuVendor {
  const { client, spec, instanceName, servicePort } = options
  return {
    name: 'autodl',
    async list(): Promise<readonly GpuVendorInstance[]> {
      return (await client.listInstances()).map(instance => ({
        id: instance.id,
        ...(instance.name !== undefined ? { name: instance.name } : {}),
        state: normalizeGpuRunState(instance.status),
      }))
    },
    async create(): Promise<string> {
      return await client.createInstance(spec, instanceName)
    },
    async status(id: string): Promise<GpuRunState> {
      return normalizeGpuRunState(await client.instanceStatus(id))
    },
    async powerOn(id: string): Promise<void> {
      await client.powerOn(id, spec.startCommand)
    },
    async powerOff(id: string): Promise<void> {
      await client.powerOff(id)
    },
    async release(id: string): Promise<void> {
      await client.release(id)
    },
    async serviceUrl(id: string): Promise<string | undefined> {
      return serviceDomainUrl(await client.instanceSnapshot(id), servicePort)
    },
  }
}
