import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MarketInvariant from '../src/invariant.ts'

describe('market invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MarketInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-market', () => {})
    }).toThrow(/already registered/)
  })
})
