import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MarketGatewayInvariant from '../src/invariant.ts'

describe('market-gateway invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MarketGatewayInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-market-gateway', () => {})
    }).toThrow(/already registered/)
  })
})
