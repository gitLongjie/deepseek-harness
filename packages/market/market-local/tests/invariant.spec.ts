import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MarketLocalInvariant from '../src/invariant.ts'

describe('market-local invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MarketLocalInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-market-local', () => {})
    }).toThrow(/already registered/)
  })
})
