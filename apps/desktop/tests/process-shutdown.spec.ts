/** Unit tests for the desktop shutdown controller with injected exit wiring. */
import { describe, expect, it, vi } from 'vitest'
import { createProcessShutdown } from '../src/main/process-shutdown.ts'

describe('createProcessShutdown', () => {
  it('prepares disposal without exiting and lets a later shutdown complete', async () => {
    const events: string[] = []
    const shutdown = createProcessShutdown(
      async () => { events.push('disposed') },
      (code) => { events.push(`force:${code}`) },
      (code) => { events.push(`complete:${code}`) },
    )

    await shutdown.prepare()
    expect(events).toEqual(['disposed'])
    await shutdown.shutdown(0)
    expect(events).toEqual(['disposed', 'complete:0'])
  })

  it('finishes preparation at the grace limit without exiting', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const shutdown = createProcessShutdown(
      () => new Promise<void>(() => {}),
      (code) => { events.push(`force:${code}`) },
      (code) => { events.push(`complete:${code}`) },
      25,
    )

    const prepared = shutdown.prepare()
    await vi.advanceTimersByTimeAsync(25)
    await prepared
    expect(events).toEqual([])
    vi.useRealTimers()
  })

  it('disposes then records the natural completion code', async () => {
    let disposed = false
    const events: string[] = []
    const shutdown = createProcessShutdown(
      async () => { disposed = true },
      (code) => { events.push(`force:${code}`) },
      (code) => { events.push(`complete:${code}`) },
    )
    await shutdown.shutdown(0)
    expect(disposed).toBe(true)
    expect(events).toEqual(['complete:0'])
  })

  it('forces exit when the disposer rejects', async () => {
    const events: string[] = []
    const shutdown = createProcessShutdown(
      async () => { throw new Error('teardown failed') },
      (code) => { events.push(`force:${code}`) },
      (code) => { events.push(`complete:${code}`) },
    )
    await shutdown.shutdown(1)
    expect(events).toEqual(['force:1'])
  })

  it('escalates a repeated interrupt to a force exit', async () => {
    const events: string[] = []
    let releaseDispose!: () => void
    const shutdown = createProcessShutdown(
      () => new Promise<void>((resolve) => { releaseDispose = resolve }),
      (code) => { events.push(`force:${code}`) },
      (code) => { events.push(`complete:${code}`) },
      100,
    )
    shutdown.interrupt(130)
    // The second interrupt while a graceful dispose is pending forces the exit.
    shutdown.interrupt(130)
    expect(events).toEqual(['force:130'])
    // Let the pending dispose microtask run so the resolver is bound, then release it.
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    releaseDispose()
  })
})
