import { describe, expect, it } from 'vitest'

import { resolveTrayIconPath } from '../src/main/desktop/tray.ts'

describe('desktop tray icon resolution', () => {
  it('uses the PNG twins on macOS, where nativeImage cannot decode ICO', () => {
    expect(resolveTrayIconPath('darwin')).toMatch(/tray\.png$/)
  })

  it('keeps the ICO on Windows and Linux', () => {
    expect(resolveTrayIconPath('win32')).toMatch(/tray\.ico$/)
    expect(resolveTrayIconPath('linux')).toMatch(/tray\.ico$/)
  })
})
