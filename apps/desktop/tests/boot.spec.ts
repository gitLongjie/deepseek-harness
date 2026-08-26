/** Unit tests for the desktop boot helpers. */
import { describe, expect, it } from 'vitest'
import { resolveTelemetryPatch } from '../src/main/boot.ts'

describe('resolveTelemetryPatch', () => {
  it('returns undefined when the switch is unset or the row is absent', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
  })

  it('disables the telemetry row for any non-empty value', () => {
    expect(resolveTelemetryPatch('0', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('1', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('false', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
  })
})
