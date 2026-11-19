import { describe, expect, it } from 'vitest'
import { isWebHostProxyPath } from '../src/main/web-host-proxy.ts'

describe('isWebHostProxyPath', () => {
  it('proxies open-in-app and skin routes to the Host web server', () => {
    expect(isWebHostProxyPath('/open-in-app/apps')).toBe(true)
    expect(isWebHostProxyPath('/_skin/active.css')).toBe(true)
    expect(isWebHostProxyPath('/_skin/api/themes')).toBe(true)
    expect(isWebHostProxyPath('/_skin/bg/theme.webp')).toBe(true)
    expect(isWebHostProxyPath('/_skin/preview/theme.webp')).toBe(true)
  })

  it('leaves frontend files and the IPC API on their own routes', () => {
    expect(isWebHostProxyPath('/index.html')).toBe(false)
    expect(isWebHostProxyPath('/assets/app.js')).toBe(false)
    expect(isWebHostProxyPath('/api/session/list')).toBe(false)
    expect(isWebHostProxyPath('/plugins/dsh-skin/client.js')).toBe(false)
    expect(isWebHostProxyPath('/_skins/active.css')).toBe(false)
  })
})
