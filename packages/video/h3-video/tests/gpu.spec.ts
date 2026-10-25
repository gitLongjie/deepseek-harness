/**
 * The GPU instance pool: boot-on-demand, reuse by name, single-flight booting, readiness waiting,
 * live-task protection, and the idle policy that stops or releases the instance.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { GpuInstancePool } from '../src/gpu.ts'
import type { GpuPoolOptions, GpuRunState, GpuVendor, GpuVendorInstance } from '../src/gpu.ts'

const SERVICE_URL = 'https://gpu.example:8443'

/** A vendor whose instances live in memory, so the pool's calls are observable. */
class FakeVendor implements GpuVendor {
  readonly name = 'fake'
  readonly instances: Array<{ id: string; name?: string; state: GpuRunState }> = []
  readonly calls: string[] = []
  created = 0
  serviceUrlValue: string | undefined = SERVICE_URL
  probeAnswers: boolean[] = []
  probeDefault = true
  bootState: GpuRunState = 'running'

  async list(): Promise<readonly GpuVendorInstance[]> {
    this.calls.push('list')
    return this.instances.map(instance => ({ ...instance }))
  }

  async create(): Promise<string> {
    this.calls.push('create')
    const id = `i-${++this.created}`
    this.instances.push({ id, name: 'pool', state: 'pending' })
    return id
  }

  async status(id: string): Promise<GpuRunState> {
    this.calls.push(`status:${id}`)
    return this.instances.find(instance => instance.id === id)?.state ?? this.bootState
  }

  async powerOn(id: string): Promise<void> {
    this.calls.push(`power_on:${id}`)
    const instance = this.instances.find(candidate => candidate.id === id)
    if (instance !== undefined) instance.state = this.bootState
  }

  async powerOff(id: string): Promise<void> {
    this.calls.push(`power_off:${id}`)
    const instance = this.instances.find(candidate => candidate.id === id)
    if (instance !== undefined) instance.state = 'stopped'
  }

  async release(id: string): Promise<void> {
    this.calls.push(`release:${id}`)
    const index = this.instances.findIndex(instance => instance.id === id)
    if (index !== -1) this.instances.splice(index, 1)
  }

  async serviceUrl(): Promise<string | undefined> {
    this.calls.push('service')
    return this.serviceUrlValue
  }
}

const pools: GpuInstancePool[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.dispose({ release: false })
})

function poolFor(vendor: FakeVendor, overrides: Partial<GpuPoolOptions> = {}): GpuInstancePool {
  const pool = new GpuInstancePool({
    vendor,
    instanceName: 'pool',
    servicePort: 6006,
    pollIntervalMs: 5,
    bootTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    idleAction: 'power_off',
    releaseOnDispose: false,
    probe: async () => vendor.probeAnswers.shift() ?? vendor.probeDefault,
    ...overrides,
  })
  pools.push(pool)
  return pool
}

/** Wait until a predicate holds, failing the test after a generous bound. */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not met in time')
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
}

describe('GpuInstancePool', () => {
  it('creates an instance, waits for ComfyUI, and returns its origin', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    expect(await pool.ensure()).toBe(SERVICE_URL)
    expect(vendor.calls).toContain('create')
    expect(vendor.calls).toContain('power_on:i-1')
    expect(pool.current()).toMatchObject({
      configured: true,
      vendor: 'fake',
      instanceId: 'i-1',
      state: 'running',
      serviceUrl: SERVICE_URL,
    })
  })

  it('serves a running instance from cache without contacting the vendor again', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    await pool.ensure()
    const calls = vendor.calls.length
    expect(await pool.ensure()).toBe(SERVICE_URL)
    expect(vendor.calls).toHaveLength(calls)
  })

  it('shares one boot between concurrent callers', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    const urls = await Promise.all([pool.ensure(), pool.ensure(), pool.ensure()])
    expect(urls).toEqual([SERVICE_URL, SERVICE_URL, SERVICE_URL])
    expect(vendor.created).toBe(1)
  })

  it('reuses an existing running instance named for the pool instead of creating one', async () => {
    const vendor = new FakeVendor()
    vendor.instances.push({ id: 'pro-existing', name: 'pool', state: 'running' })
    const pool = poolFor(vendor)
    expect(await pool.ensure()).toBe(SERVICE_URL)
    expect(vendor.created).toBe(0)
    expect(vendor.calls).not.toContain('power_on:pro-existing')
    expect(pool.current().instanceId).toBe('pro-existing')
  })

  it('powers a stopped instance on rather than creating another', async () => {
    const vendor = new FakeVendor()
    vendor.instances.push({ id: 'pro-stopped', name: 'pool', state: 'stopped' })
    const pool = poolFor(vendor)
    await pool.ensure()
    expect(vendor.created).toBe(0)
    expect(vendor.calls).toContain('power_on:pro-stopped')
  })

  it('waits for the service mapping and the readiness probe', async () => {
    const vendor = new FakeVendor()
    vendor.serviceUrlValue = undefined
    vendor.probeAnswers = [false, false, true]
    const pool = poolFor(vendor)
    const asserting = (async (): Promise<void> => {
      await waitFor(() => vendor.calls.filter(call => call === 'service').length >= 2)
      vendor.serviceUrlValue = SERVICE_URL
    })()
    expect(await pool.ensure()).toBe(SERVICE_URL)
    await asserting
  })

  it('fails loud when the instance never becomes ready', async () => {
    const vendor = new FakeVendor()
    vendor.probeDefault = false
    const pool = poolFor(vendor, { bootTimeoutMs: 60, pollIntervalMs: 5 })
    await expect(pool.ensure()).rejects.toThrow(/did not answer within/u)
    expect(pool.current().state).toBe('failed')
    expect(pool.current().error).toMatch(/did not answer/u)
  })

  it('holds the idle policy off while a generation is live and applies it once none is', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor, { idleTimeoutMs: 30 })
    await pool.ensure()
    pool.taskStarted()
    await new Promise<void>((resolve) => { setTimeout(resolve, 80) })
    expect(vendor.calls).not.toContain('power_off:i-1')
    pool.taskFinished()
    await waitFor(() => vendor.calls.includes('power_off:i-1'))
    expect(pool.current().state).toBe('stopped')
  })

  it('releases the instance when the idle action is release', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor, { idleTimeoutMs: 20, idleAction: 'release' })
    await pool.ensure()
    pool.taskStarted()
    pool.taskFinished()
    await waitFor(() => vendor.calls.includes('release:i-1'))
    expect(pool.current()).toMatchObject({ state: 'absent' })
    expect(pool.current().instanceId).toBeUndefined()
  })

  it('stops and releases explicitly, and treats a second release as a no-op', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor, { idleTimeoutMs: 0 })
    await pool.ensure()
    expect((await pool.stop()).state).toBe('stopped')
    expect((await pool.release()).state).toBe('absent')
    const calls = vendor.calls.length
    expect((await pool.release()).state).toBe('absent')
    expect(vendor.calls).toHaveLength(calls)
  })

  it('refuses to stop or release an instance a generation is still using', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    await pool.ensure()
    pool.taskStarted()
    await expect(pool.stop()).rejects.toThrow(/live generation/u)
    await expect(pool.release()).rejects.toThrow(/live generation/u)
    expect(vendor.calls).not.toContain('power_off:i-1')
    pool.taskFinished()
    expect((await pool.release()).state).toBe('absent')
  })

  it('releases on disposal only when configured', async () => {
    const releasing = new FakeVendor()
    const releasedPool = poolFor(releasing, { releaseOnDispose: true })
    await releasedPool.ensure()
    await releasedPool.dispose()
    expect(releasing.calls).toContain('release:i-1')

    const keeping = new FakeVendor()
    const keptPool = poolFor(keeping, { releaseOnDispose: false })
    await keptPool.ensure()
    await keptPool.dispose()
    expect(keeping.calls).not.toContain('release:i-1')
  })

  it('cannot boot after disposal', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    await pool.dispose()
    await expect(pool.ensure()).rejects.toThrow(/disposed/u)
  })

  it('refreshes the tracked instance state from the vendor', async () => {
    const vendor = new FakeVendor()
    const pool = poolFor(vendor)
    await pool.ensure()
    const instance = vendor.instances.find(candidate => candidate.id === 'i-1')
    if (instance === undefined) throw new Error('missing fake instance')
    instance.state = 'stopped'
    const refreshed = await pool.refresh()
    expect(refreshed.state).toBe('stopped')
    expect(refreshed.serviceUrl).toBeUndefined()
  })
})
