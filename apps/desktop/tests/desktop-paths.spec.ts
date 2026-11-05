/** Desktop shell path resolution stays anchored at the package root in every layout. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  desktopPackageRoot,
  desktopWebDistDir,
  resolveDesktopPreloadPath,
  resolveDesktopRenderTransportPath,
} from '../src/main/desktop-paths.ts'

describe('desktop shell paths', () => {
  it('finds the package root from dist/main and bundled lib/main layouts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop' }))
    const distMain = join(root, 'dist/main/index.js')
    const libMain = join(root, 'lib/main.js')
    mkdirSync(join(root, 'dist/main'), { recursive: true })
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(distMain, 'export {}\n')
    writeFileSync(libMain, 'export {}\n')
    expect(desktopPackageRoot(pathToFileURL(distMain).href)).toBe(root)
    expect(desktopPackageRoot(pathToFileURL(libMain).href)).toBe(root)
    expect(desktopWebDistDir(pathToFileURL(libMain).href)).toBe(join(root, 'web'))
  })

  it('accepts the packaged manifest whose name is the OEM identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'DeepWorker' }))
    const distMain = join(root, 'dist/main/desktop-paths.js')
    mkdirSync(join(root, 'dist/main'), { recursive: true })
    writeFileSync(distMain, 'export {}\n')
    expect(desktopPackageRoot(pathToFileURL(distMain).href)).toBe(root)
  })

  it('prefers the packaged preload bundle when both dev and lib outputs exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop' }))
    const libMain = join(root, 'lib/main.js')
    mkdirSync(join(root, 'lib/preload'), { recursive: true })
    mkdirSync(join(root, 'dist/preload'), { recursive: true })
    writeFileSync(libMain, 'export {}\n')
    writeFileSync(join(root, 'lib/preload/index.cjs'), 'module.exports = {}\n')
    writeFileSync(join(root, 'dist/preload/index.js'), 'export {}\n')
    expect(resolveDesktopPreloadPath(pathToFileURL(libMain).href)).toBe(join(root, 'lib/preload/index.cjs'))
  })

  it('loads the render-transport IIFE from dist under the package root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-paths-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop' }))
    const libMain = join(root, 'lib/main.js')
    mkdirSync(join(root, 'dist'), { recursive: true })
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(libMain, 'export {}\n')
    writeFileSync(join(root, 'dist/render-transport.js'), 'window.__TRANSPORT__ = true\n')
    expect(resolveDesktopRenderTransportPath(pathToFileURL(libMain).href)).toBe(join(root, 'dist/render-transport.js'))
  })
})
