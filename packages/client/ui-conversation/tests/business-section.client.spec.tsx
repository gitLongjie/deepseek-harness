// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { BusinessSection } from '../src/client/settings/BusinessSection.tsx'
import type { BusinessSectionProps } from '../src/client/settings/BusinessSection.tsx'
import { en } from '../src/client/locales.ts'

const PLUGIN_ID = 'xmanrui-dsh-business-entry'

type IpcStub = {
  invoke: ReturnType<typeof vi.fn>
}

function stubIpc(enabled: boolean): IpcStub {
  const invoke = vi.fn((channel: string, ..._args: unknown[]) => {
    if (channel === 'dsh:plugin:isEnabled') return Promise.resolve(enabled)
    return Promise.resolve()
  })
  ;(window as { __DSH_IPC__?: unknown }).__DSH_IPC__ = { invoke }
  return invoke
}

function mount() {
  const props: BusinessSectionProps = { t: makeTranslate(en) }
  render(<BusinessSection {...props} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete (window as { __DSH_IPC__?: unknown }).__DSH_IPC__
})

describe('BusinessSection', () => {
  it('is hidden off the desktop shell (no IPC bridge)', () => {
    mount()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('reflects the persisted enabled state from the home patch', async () => {
    stubIpc(true)
    mount()
    const sw = await screen.findByRole('switch', { name: 'Show business entries' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('persists a disable toggle and fires the plugin hot-toggle event', async () => {
    const invoke = stubIpc(true)
    mount()
    const events: CustomEvent[] = []
    const listener = (event: Event): void => { events.push(event as CustomEvent) }
    window.addEventListener('dsh-business-entry:toggle', listener)

    fireEvent.click(await screen.findByRole('switch', { name: 'Show business entries' }))
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('dsh:plugin:setEnabled', PLUGIN_ID, false)
    expect(events).toHaveLength(1)
    expect(events[0]?.detail).toEqual({ enabled: false })
    expect(screen.getByRole('switch', { name: 'Show business entries' }).getAttribute('aria-checked')).toBe('false')
    window.removeEventListener('dsh-business-entry:toggle', listener)
  })

  it('persists a re-enable toggle for a disabled plugin', async () => {
    const invoke = stubIpc(false)
    mount()
    const sw = await screen.findByRole('switch', { name: 'Show business entries' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('dsh:plugin:setEnabled', PLUGIN_ID, true)
    expect(screen.getByRole('switch', { name: 'Show business entries' }).getAttribute('aria-checked')).toBe('true')
  })
})
