/** The API-key route validates listing timing and does not select a listing. */
import { expect, it } from 'vitest'
import { Config, plainOptions, resolveAdapterOptions } from '../src/config.ts'

it('does not select a model listing', () => {
  expect(resolveAdapterOptions({})).not.toHaveProperty('listing')
  expect(resolveAdapterOptions(plainOptions(Config({})))).not.toHaveProperty('listing')
  expect(resolveAdapterOptions({ models: [{ id: 'custom' }] })).not.toHaveProperty('listing')
  expect(resolveAdapterOptions({ baseURL: 'https://api.deepseek.com/anthropic/v1', modelsTimeoutMs: 7, modelsMaxAgeMs: 0 }))
    .not.toHaveProperty('listing')
  expect(resolveAdapterOptions({ baseURL: 'https://gateway.example/anthropic' })).not.toHaveProperty('listing')
})

it.each([
  [{ modelsTimeoutMs: 0 }, /^llm-deepseek-api-key: modelsTimeoutMs must be a positive finite number/],
  [{ modelsMaxAgeMs: 1.5 }, /^llm-deepseek-api-key: modelsMaxAgeMs must be a non-negative safe integer/],
])('rejects %j', (options, message) => {
  expect(() => resolveAdapterOptions({ models: [{ id: 'custom' }], ...options })).toThrow(message)
})
