import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as KbInvariant from '../src/invariant.ts'

describe('knowledge-base invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(KbInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-kb', () => {})
    }).toThrow(/already registered/)
  })
})
