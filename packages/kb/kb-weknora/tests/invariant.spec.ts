import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WeknoraInvariant from '../src/invariant.ts'

describe('kb-weknora invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(WeknoraInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-kb-weknora', () => {})
    }).toThrow(/already registered/)
  })
})
