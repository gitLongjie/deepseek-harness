// @vitest-environment jsdom
/** Overlay top margin falls back to the desktop title bar inset when the frame publishes no clearance. */
import { afterEach, describe, expect, it } from 'vitest'
import { overlayTopMargin } from '../src/overlay-top-margin.ts'

const root = document.documentElement

afterEach(() => {
  root.style.removeProperty('--dsh-frame-top-clearance')
  root.style.removeProperty('--dsh-shell-top-inset')
  root.removeAttribute('data-fullscreen')
})

describe('overlayTopMargin', () => {
  it('keeps the caller minimum when neither inset is published', () => {
    expect(overlayTopMargin(12)).toBe(12)
  })

  it('clears the desktop title bar inset when the frame publishes no clearance', () => {
    root.style.setProperty('--dsh-shell-top-inset', '36px')
    expect(overlayTopMargin(12)).toBe(56)
    expect(overlayTopMargin(12, { top: 8, bottom: 20 }, 4)).toBe(24)
  })

  it('prefers frame clearance over the title bar inset', () => {
    root.style.setProperty('--dsh-frame-top-clearance', '48px')
    root.style.setProperty('--dsh-shell-top-inset', '36px')
    expect(overlayTopMargin(12)).toBe(68)
  })

  it('drops the strip in fullscreen and keeps the 20px margin', () => {
    root.style.setProperty('--dsh-shell-top-inset', '36px')
    root.setAttribute('data-fullscreen', '')
    expect(overlayTopMargin(12)).toBe(20)
  })
})
