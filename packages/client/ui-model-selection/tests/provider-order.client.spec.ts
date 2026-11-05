/** The shared provider display order for both model pickers. */
import { describe, expect, it } from 'vitest'
import { orderModelProviders } from '../src/client/provider-order.ts'

describe('orderModelProviders', () => {
  it('leads with the gateway, then account and official, keeping other relative order', () => {
    const groups = ['openai', 'deepseek-official', 'deepagens', 'deepseek-account', 'anthropic']
      .map(id => ({ id, models: [] }))
    expect(orderModelProviders(groups).map(group => group.id))
      .toEqual(['deepagens', 'deepseek-account', 'deepseek-official', 'openai', 'anthropic'])
  })

  it('returns a copy and leaves the input order untouched', () => {
    const groups = ['deepseek-official', 'deepagens'].map(id => ({ id, models: [] }))
    orderModelProviders(groups)
    expect(groups.map(group => group.id)).toEqual(['deepseek-official', 'deepagens'])
  })
})
