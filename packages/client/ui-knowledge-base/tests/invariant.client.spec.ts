import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as nodeApply } from '../src/index.ts'
import * as KnowledgeInvariant from '../src/invariant.ts'

describe('ui-knowledge-base invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(KnowledgeInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-client-ui-knowledge-base', () => {})
    }).toThrow(/already registered/)
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
