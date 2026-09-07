import { describe, expect, it } from 'vitest'
import {
  resolveWindowChrome,
  TRAFFIC_LIGHT_DIAMETER_PX,
  TRAFFIC_LIGHT_POSITION,
} from '../src/main/desktop/window-chrome.ts'
import { TITLE_BAR_HEIGHT_PX } from '../src/render/title-bar.ts'

describe('desktop window chrome', () => {
  it('keeps the native traffic lights on macOS and hides the native frame elsewhere', () => {
    expect(resolveWindowChrome('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
    })
    expect(resolveWindowChrome('win32')).toEqual({ frame: false })
    expect(resolveWindowChrome('linux')).toEqual({ frame: false })
    expect(resolveWindowChrome('freebsd')).toEqual({ frame: false })
  })

  it('centers the pinned traffic lights in the renderer title bar height', () => {
    // window-chrome.ts restates the bar height from render/title-bar.ts; this
    // fails when one side moves TITLE_BAR_HEIGHT_PX without the other.
    expect(TRAFFIC_LIGHT_POSITION.y + TRAFFIC_LIGHT_DIAMETER_PX / 2).toBe(TITLE_BAR_HEIGHT_PX / 2)
  })
})
