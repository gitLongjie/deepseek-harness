/**
 * Routing and validation tests: explicit local/remote choices, auto fallback, and request rules.
 */

import { describe, expect, it } from 'vitest'
import { resolve, RoutingError } from '../src/routing.ts'
import { validateSegmentRequest, SegmentRequestError } from '../src/validation.ts'
import type { H3VideoProvider, ProviderCapabilities, SegmentRequest } from '../src/types.ts'

const LOCAL_CAPS: ProviderCapabilities = {
  name: 'comfyui-local',
  resolutions: ['768P'],
  minDurationSeconds: 4,
  maxDurationSeconds: 10,
  multimodalInputs: false,
  maxConcurrency: 1,
}

const REMOTE_CAPS: ProviderCapabilities = {
  name: 'minimax-api',
  resolutions: ['768P', '2K'],
  minDurationSeconds: 4,
  maxDurationSeconds: 15,
  multimodalInputs: true,
  maxConcurrency: 3,
}

function provider(capabilities: ProviderCapabilities): H3VideoProvider {
  return {
    capabilities,
    submit: async () => {
      throw new Error('not used')
    },
    poll: async () => {
      throw new Error('not used')
    },
    cancel: async () => undefined,
  }
}

function textRequest(overrides: Partial<SegmentRequest> = {}): SegmentRequest {
  return {
    inputs: [{ type: 'text', text: 'a robot walking' }],
    resolution: '768P',
    durationSeconds: 5,
    ratio: '16:9',
    ...overrides,
  }
}

const PROVIDERS = [
  { choice: 'local' as const, provider: provider(LOCAL_CAPS) },
  { choice: 'remote' as const, provider: provider(REMOTE_CAPS) },
]

describe('resolve', () => {
  it('routes an explicit local choice to the comfy backend', () => {
    const target = resolve('local', PROVIDERS, textRequest())
    expect(target.choice).toBe('local')
    expect(target.provider.capabilities.name).toBe('comfyui-local')
  })

  it('routes an explicit remote choice to the api backend', () => {
    const target = resolve('remote', PROVIDERS, textRequest())
    expect(target.choice).toBe('remote')
    expect(target.provider.capabilities.name).toBe('minimax-api')
  })

  it('auto prefers local and falls back to remote when local rejects the request', () => {
    const target = resolve('auto', PROVIDERS, textRequest({ resolution: '2K' }))
    expect(target.choice).toBe('remote')
  })

  it('throws a routing error when the only backend cannot serve the request', () => {
    const onlyLocal = PROVIDERS.filter(entry => entry.choice === 'local')
    expect(() => resolve('auto', onlyLocal, textRequest({ durationSeconds: 20 }))).toThrow(RoutingError)
    expect(() => resolve('remote', onlyLocal, textRequest())).toThrow(/not configured/)
  })

  it('routes image-frame requests only to a multimodal backend', () => {
    const withImage = textRequest({
      inputs: [
        { type: 'text', text: 'zoom in' },
        { type: 'image', url: 'https://x.test/f.png', role: 'first_frame' },
      ],
      ratio: 'adaptive',
    })
    const target = resolve('auto', PROVIDERS, withImage)
    expect(target.choice).toBe('remote')
    expect(() => resolve('local', PROVIDERS, withImage)).toThrow(/text prompts only/)
  })
})

describe('validateSegmentRequest', () => {
  it('accepts a valid text request', () => {
    expect(() => { validateSegmentRequest(textRequest(), REMOTE_CAPS) }).not.toThrow()
  })

  it('rejects requests with no or multiple text prompts', () => {
    expect(() => { validateSegmentRequest(textRequest({ inputs: [] }), REMOTE_CAPS) })
      .toThrow(SegmentRequestError)
    expect(() => {
      validateSegmentRequest(
        textRequest({ inputs: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
        REMOTE_CAPS,
      )
    }).toThrow(SegmentRequestError)
  })

  it('rejects blank and oversized prompts', () => {
    expect(() => {
      validateSegmentRequest(textRequest({ inputs: [{ type: 'text', text: '   ' }] }), REMOTE_CAPS)
    }).toThrow(/non-empty/)
    expect(() => {
      validateSegmentRequest(textRequest({ inputs: [{ type: 'text', text: 'x'.repeat(7001) }] }), REMOTE_CAPS)
    }).toThrow(/7000/)
  })

  it('rejects durations outside the backend range', () => {
    expect(() => { validateSegmentRequest(textRequest({ durationSeconds: 3 }), REMOTE_CAPS) })
      .toThrow(SegmentRequestError)
    expect(() => { validateSegmentRequest(textRequest({ durationSeconds: 16 }), REMOTE_CAPS) })
      .toThrow(SegmentRequestError)
  })

  it('rejects text-only requests with adaptive ratio', () => {
    expect(() => { validateSegmentRequest(textRequest({ ratio: 'adaptive' }), REMOTE_CAPS) })
      .toThrow(/explicit ratio/)
  })
})
