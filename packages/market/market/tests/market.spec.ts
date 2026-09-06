import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Market, { default as DefaultMarket } from '../src/index.ts'
import type { MarketInstallOutcome, MarketSource, MarketUninstallOutcome } from '../src/types.ts'

/** Minimal concrete provider exercising the abstract Service Definition. */
class StubMarket extends Market {
  async listSources() { return [] }
  async selectedSource() { return null }
  async selectSource() {}
  async addSource(): Promise<MarketSource> { throw new Error('stub') }
  async removeSource() {}
  async browse() { return { entries: [], nextCursor: null, total: 0 } }
  async entryDetail() { return undefined }
  async installability() { return { installable: false, npmPackage: null, resolvedVersion: null, reasons: [] } }
  async install(): Promise<MarketInstallOutcome> { return { ok: false, message: 'stub', outputTail: null } }
  async installed() { return [] }
  async uninstall(): Promise<MarketUninstallOutcome> { return { ok: false, message: 'stub', outputTail: null } }
}

describe('market Service Definition', () => {
  it('registers concrete providers as the ctx.market service', async () => {
    const ctx = new Context()
    // Cordis exposes the service through a per-context filtered view, so the
    // registration is asserted through type, name, and delegation.
    new StubMarket(ctx)
    expect(ctx.market).toBeInstanceOf(StubMarket)
    expect(ctx.market.name).toBe('market')
    await expect(ctx.market.listSources()).resolves.toEqual([])
    expect(DefaultMarket).toBe(Market)
  })
})
