/**
 * Vendor-neutral cloud-GPU lifecycle for the local H3 backend: one instance pool that boots a
 * vendor instance on demand, publishes the ComfyUI endpoint it serves, and powers it off or
 * releases it after the idle window. Vendors implement {@link GpuVendor}; this module names no
 * cloud. Cloud GPU time is billed while an instance runs, so every terminal state either stops
 * the instance or leaves it under the configured idle policy.
 * @module @deepseek-ai/dsh-h3-video/gpu
 */

/** Runtime state of one vendor instance as the pool needs it. */
export type GpuRunState = 'running' | 'stopped' | 'pending'

/** One instance as a vendor lists it; `name` is the pool's reuse key. */
export interface GpuVendorInstance {
  /** Vendor-side instance id. */
  readonly id: string
  /** Account-unique instance name, when the vendor keeps one. */
  readonly name?: string
  /** Whether the instance is serving, powered off, or still transitioning. */
  readonly state: GpuRunState
}

/**
 * The vendor operations one GPU pool drives. An adapter binds the creation specification, so the
 * pool never sees vendor-specific fields.
 */
export interface GpuVendor {
  /** Vendor identity reported in status diagnostics. */
  readonly name: string
  /** List the account's instances so the pool can reuse one by name. */
  list(): Promise<readonly GpuVendorInstance[]>
  /** Create one instance from the adapter's creation specification. */
  create(): Promise<string>
  /** Read one instance's current run state. */
  status(id: string): Promise<GpuRunState>
  /** Start a stopped instance; its boot command starts the ComfyUI server. */
  powerOn(id: string): Promise<void>
  /** Stop the instance's GPU billing while keeping its disk. */
  powerOff(id: string): Promise<void>
  /** Delete the instance and its disk; the pool powers it off first. */
  release(id: string): Promise<void>
  /** Resolve the public HTTP endpoint for one instance port, or `undefined` until it exists. */
  serviceUrl(id: string, port: number): Promise<string | undefined>
}

/** Lifecycle state of the pool's instance, as reported to consumers. */
export type GpuInstanceState =
  | 'absent'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'releasing'
  | 'failed'

/** Model-safe view of the cloud GPU backing the local backend. */
export interface GpuStatus {
  /** Whether a cloud GPU row is configured at all. */
  readonly configured: boolean
  /** Vendor identity, absent when nothing is configured. */
  readonly vendor?: string
  /** Instance id once the pool has created or adopted one. */
  readonly instanceId?: string
  /** Lifecycle state owned by the pool. */
  readonly state: GpuInstanceState
  /** ComfyUI endpoint while the instance is running. */
  readonly serviceUrl?: string
  /** Idle window in milliseconds; `0` disables idle handling. */
  readonly idleTimeoutMs?: number
  /** What idle handling does once the window elapses. */
  readonly idleAction?: 'power_off' | 'release'
  /** Last failure message, cleared by the next successful ensure. */
  readonly error?: string
}

/** Idle handling applied when no generation is live for the configured window. */
export type GpuIdleAction = 'power_off' | 'release'

/** Construction options for {@link GpuInstancePool}. */
export interface GpuPoolOptions {
  /** Vendor adapter issuing the lifecycle calls. */
  readonly vendor: GpuVendor
  /** Reuse key: an existing instance with this name is powered on instead of created. */
  readonly instanceName: string
  /** Service port the vendor maps to the ComfyUI HTTP API. */
  readonly servicePort: number
  /** Milliseconds between lifecycle polls. */
  readonly pollIntervalMs: number
  /** Wall-clock bound on boot plus readiness, in milliseconds. */
  readonly bootTimeoutMs: number
  /** Idle milliseconds before {@link GpuPoolOptions.idleAction} runs; `0` disables it. */
  readonly idleTimeoutMs: number
  /** What idle handling does: power the instance off, or release it. */
  readonly idleAction: GpuIdleAction
  /** Release the instance when the pool is disposed, instead of leaving it to the idle policy. */
  readonly releaseOnDispose: boolean
  /**
   * Readiness probe against the instance's service URL; resolves `true` once ComfyUI answers.
   * @param url - the instance's public HTTP origin.
   * @returns whether the service is ready to accept work.
   */
  readonly probe: (url: string) => Promise<boolean>
  /** Injectable clock for tests. */
  readonly now?: () => number
}

/** Options accepted by {@link GpuInstancePool.dispose}. */
export interface GpuDisposeOptions {
  /** Override {@link GpuPoolOptions.releaseOnDispose} for this disposal. */
  readonly release?: boolean
}

function abortError(): Error {
  return Object.assign(new Error('h3-video: the GPU instance pool was disposed'), { name: 'AbortError' })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Wait for a delay, rejecting as soon as the pool is disposed.
 * @param ms - milliseconds to wait.
 * @param signal - pool lifetime signal.
 * @returns a promise settled after the delay.
 */
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The local backend's cloud GPU: boots one vendor instance on demand, reuses it across segments,
 * and applies the idle policy when generation stops. One pool owns at most one instance; every
 * public operation is safe to call from a routed submission or the model-facing GPU tool.
 */
export class GpuInstancePool {
  private readonly options: GpuPoolOptions
  private readonly now: () => number
  private readonly lifetime = new AbortController()
  private instanceId: string | undefined
  private serviceUrl: string | undefined
  private state: GpuInstanceState = 'absent'
  private lastError: string | undefined
  private booting: Promise<string> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private liveTasks = 0
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * @param options - vendor adapter, reuse key, timings, and the readiness probe.
   */
  constructor(options: GpuPoolOptions) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  /**
   * Current lifecycle view without contacting the vendor.
   * @returns the pool's tracked state, endpoint, and idle policy.
   */
  current(): GpuStatus {
    return {
      configured: true,
      vendor: this.options.vendor.name,
      ...(this.instanceId !== undefined ? { instanceId: this.instanceId } : {}),
      state: this.state,
      ...(this.serviceUrl !== undefined ? { serviceUrl: this.serviceUrl } : {}),
      idleTimeoutMs: this.options.idleTimeoutMs,
      idleAction: this.options.idleAction,
      ...(this.lastError !== undefined ? { error: this.lastError } : {}),
    }
  }

  /**
   * Boot or reuse the instance and wait until ComfyUI answers. Concurrent callers share one boot.
   * @returns the running increment's public HTTP origin.
   */
  async ensure(): Promise<string> {
    if (this.disposed) throw new Error('h3-video: the GPU instance pool was disposed')
    this.cancelIdle()
    if (this.state === 'running' && this.serviceUrl !== undefined) return this.serviceUrl
    this.booting ??= this.boot().finally(() => {
      this.booting = undefined
    })
    return await this.booting
  }

  /**
   * Re-read the vendor's state for the tracked instance.
   * @returns the refreshed lifecycle view.
   */
  async refresh(): Promise<GpuStatus> {
    if (this.instanceId === undefined || this.booting !== undefined) return this.current()
    try {
      const state = await this.options.vendor.status(this.instanceId)
      if (state === 'running') {
        this.state = 'running'
      } else if (state === 'stopped') {
        this.state = 'stopped'
        this.serviceUrl = undefined
      } else if (this.state !== 'starting') {
        this.state = 'starting'
      }
      this.lastError = undefined
    } catch (error: unknown) {
      this.state = 'failed'
      this.lastError = messageOf(error)
    }
    return this.current()
  }

  /** Record that one generation is live; the idle timer cannot fire while any is. */
  taskStarted(): void {
    this.liveTasks += 1
    this.cancelIdle()
  }

  /** Record that one generation settled; the idle timer restarts when none is live. */
  taskFinished(): void {
    this.liveTasks = Math.max(0, this.liveTasks - 1)
    if (this.liveTasks === 0) this.scheduleIdle()
  }

  /**
   * Power the instance off, keeping its disk for the next boot.
   * @returns the lifecycle view after the stop.
   * @throws Error - when a generation is still live on the instance.
   */
  async stop(): Promise<GpuStatus> {
    return await this.powerOff(false)
  }

  /**
   * Power the instance off, then delete it. The disk and any data on it are lost.
   * @returns the lifecycle view after the release.
   * @throws Error - when a generation is still live on the instance.
   */
  async release(): Promise<GpuStatus> {
    return await this.delete(false)
  }

  /** Power the instance off; disposal forces it past the live-generation guard. */
  private async powerOff(force: boolean): Promise<GpuStatus> {
    this.cancelIdle()
    const id = this.instanceId
    if (id === undefined) return this.current()
    this.assertIdle(force)
    this.state = 'stopping'
    try {
      await this.options.vendor.powerOff(id)
      this.state = 'stopped'
      this.serviceUrl = undefined
      this.lastError = undefined
    } catch (error: unknown) {
      this.state = 'failed'
      this.lastError = messageOf(error)
      throw error
    }
    return this.current()
  }

  /** Delete the instance; disposal forces it past the live-generation guard. */
  private async delete(force: boolean): Promise<GpuStatus> {
    this.cancelIdle()
    const id = this.instanceId
    if (id === undefined) return this.current()
    this.assertIdle(force)
    this.state = 'releasing'
    try {
      try {
        await this.options.vendor.powerOff(id)
      } catch (error: unknown) {
        // A release is the authoritative cleanup; a vendor that refuses to stop an already
        // stopped instance must not block it.
        void error
      }
      await this.options.vendor.release(id)
      this.instanceId = undefined
      this.serviceUrl = undefined
      this.state = 'absent'
      this.lastError = undefined
    } catch (error: unknown) {
      this.state = 'failed'
      this.lastError = messageOf(error)
      throw error
    }
    return this.current()
  }

  /**
   * Refuse to tear down a machine a generation is still using.
   * @param force - bypass the guard (disposal owns the instance's lifetime).
   */
  private assertIdle(force: boolean): void {
    if (force || this.liveTasks === 0) return
    throw new Error(
      `h3-video: GPU instance ${String(this.instanceId)} is serving ${this.liveTasks} live generation(s); cancel or wait for them before stopping or releasing it`,
    )
  }

  /**
   * Stop the pool's timers and, unless suppressed, release the instance. A disposed pool cannot
   * boot again.
   * @param options - whether this disposal releases the instance.
   */
  async dispose(options: GpuDisposeOptions = {}): Promise<void> {
    if (this.disposal !== undefined) {
      await this.disposal
      return
    }
    this.disposed = true
    this.cancelIdle()
    this.lifetime.abort()
    const inFlight = this.booting
    this.disposal = (async (): Promise<void> => {
      if (inFlight !== undefined) {
        try {
          await inFlight
        } catch (error: unknown) {
          // Disposal aborts a boot in progress; the settle path below still owns the instance.
          void error
        }
      }
      if (!(options.release ?? this.options.releaseOnDispose)) return
      try {
        await this.delete(true)
      } catch (error: unknown) {
        this.lastError = messageOf(error)
      }
    })()
    await this.disposal
  }

  /** Adopt the reused instance or create one, then wait for ComfyUI behind its service URL. */
  private async boot(): Promise<string> {
    this.state = 'starting'
    this.lastError = undefined
    const deadline = this.now() + this.options.bootTimeoutMs
    try {
      const instance = await this.acquire()
      this.instanceId = instance.id
      if (instance.state !== 'running') await this.options.vendor.powerOn(instance.id)
      await this.waitUntilRunning(instance.id, deadline)
      const url = await this.waitUntilReady(instance.id, deadline)
      if (this.disposed) throw abortError()
      this.serviceUrl = url
      this.state = 'running'
      return url
    } catch (error: unknown) {
      if (this.disposed) throw error
      this.state = 'failed'
      this.lastError = messageOf(error)
      // A boot that failed after creating or powering on an instance still bills for it.
      this.scheduleIdle()
      throw error
    }
  }

  /** Reuse an account instance carrying the pool's name, or create a new one. */
  private async acquire(): Promise<GpuVendorInstance> {
    const instances = await this.options.vendor.list()
    const named = instances.filter(instance => instance.name === this.options.instanceName)
    const running = named.find(instance => instance.state === 'running')
    if (running !== undefined) return running
    if (named.length > 0) return named[0] as GpuVendorInstance
    return { id: await this.options.vendor.create(), name: this.options.instanceName, state: 'pending' }
  }

  /** Poll the vendor until the instance reports running. */
  private async waitUntilRunning(id: string, deadline: number): Promise<void> {
    for (;;) {
      if (await this.options.vendor.status(id) === 'running') return
      const remaining = deadline - this.now()
      if (remaining <= 0) {
        throw new Error(`h3-video: GPU instance ${id} did not reach running within ${Math.round(this.options.bootTimeoutMs / 1000)}s`)
      }
      await sleep(Math.min(this.options.pollIntervalMs, remaining), this.lifetime.signal)
    }
  }

  /** Poll the instance's service mapping until ComfyUI answers its stats endpoint. */
  private async waitUntilReady(id: string, deadline: number): Promise<string> {
    for (;;) {
      const url = await this.options.vendor.serviceUrl(id, this.options.servicePort).catch(() => undefined)
      if (url !== undefined) {
        const ready = await this.options.probe(url).catch(() => false)
        if (ready) return url
      }
      const remaining = deadline - this.now()
      if (remaining <= 0) {
        throw new Error(
          `h3-video: ComfyUI on GPU instance ${id} did not answer within ${Math.round(this.options.bootTimeoutMs / 1000)}s (check the boot start command and the service port)`,
        )
      }
      await sleep(Math.min(this.options.pollIntervalMs, remaining), this.lifetime.signal)
    }
  }

  private scheduleIdle(): void {
    if (this.disposed || this.options.idleTimeoutMs <= 0 || this.liveTasks > 0) return
    if (this.instanceId === undefined) return
    this.cancelIdle()
    const timer = setTimeout(() => {
      this.idleTimer = undefined
      void this.runIdleAction()
    }, this.options.idleTimeoutMs)
    timer.unref()
    this.idleTimer = timer
  }

  private cancelIdle(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  private async runIdleAction(): Promise<void> {
    if (this.disposed || this.liveTasks > 0) return
    try {
      if (this.options.idleAction === 'release') await this.release()
      else await this.stop()
    } catch (error: unknown) {
      this.lastError = messageOf(error)
    }
  }
}
