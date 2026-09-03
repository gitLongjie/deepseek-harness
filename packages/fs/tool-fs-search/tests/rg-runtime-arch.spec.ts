import { afterEach, describe, expect, it, vi } from 'vitest'

const originalArchOverride = process.env.npm_config_arch

afterEach(() => {
  if (originalArchOverride === undefined) delete process.env.npm_config_arch
  else process.env.npm_config_arch = originalArchOverride
  vi.resetModules()
})

describe('runtime ripgrep resolution', () => {
  it('uses the running Node architecture instead of npm_config_arch', async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') return

    process.env.npm_config_arch = 'arm64'
    vi.resetModules()
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toMatch(/ripgrep-win32-x64[\\/]bin[\\/]rg\.exe$/u)
  })
})
