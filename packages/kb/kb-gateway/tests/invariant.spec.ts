import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as GatewayInvariant from '../src/invariant.ts'

describe('kb-gateway invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(GatewayInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-kb-gateway', () => {})
    }).toThrow(/already registered/)
  })
})
