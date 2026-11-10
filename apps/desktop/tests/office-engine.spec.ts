import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installOfficeEngineResolution } from '../src/main/desktop/office-engine.ts'

const roots: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  const cache = createRequire(import.meta.url).cache
  for (const path of Object.keys(cache)) {
    if (roots.some(root => path.startsWith(root + sep))) Reflect.deleteProperty(cache, path)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writePackage(path: string, place: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ name: '@deepseek-ai/libreoffice-kit-darwin-arm64', place, path: realpathSync(dirname(path)) }))
}

function layout(kind: 'root' | 'dsh') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-office-asar-')))
  roots.push(root)
  const archive = join(root, 'app.asar')
  const manifest = kind === 'dsh'
    ? join('dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit-darwin-arm64', 'package.json')
    : join('node_modules', '@deepseek-ai', 'libreoffice-kit-darwin-arm64', 'package.json')
  writePackage(join(archive, manifest), 'archive')
  writePackage(join(`${archive}.unpacked`, manifest), 'unpacked')
  const probe = join(archive, kind === 'dsh' ? 'dsh' : '', 'probe.cjs')
  writeFileSync(probe, '')
  const require = createRequire(probe)
  const runtimeDir = kind === 'dsh' ? join(archive, 'dsh') : archive
  const hook = installOfficeEngineResolution(runtimeDir)
  if (hook !== undefined) hooks.push(hook)
  return { root, archive, manifest, require, hook }
}

it('maps an engine at the asar root onto app.asar.unpacked', () => {
  const f = layout('root')
  expect(f.hook).toBeDefined()
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ place: 'unpacked', path: realpathSync(dirname(join(`${f.archive}.unpacked`, f.manifest))) })
})

it('maps an engine under a runtime subdirectory onto the same unpacked relative path', () => {
  const f = layout('dsh')
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ place: 'unpacked', path: realpathSync(dirname(join(`${f.archive}.unpacked`, f.manifest))) })
})

it('resolves an engine file that exists only in the unpacked tree', () => {
  const f = layout('root')
  const marker = join(`${f.archive}.unpacked`, 'node_modules', '@deepseek-ai', 'libreoffice-kit-darwin-arm64', 'only-unpacked.json')
  writeFileSync(marker, JSON.stringify({ place: 'unpacked-only' }))
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/only-unpacked.json')).toEqual({ place: 'unpacked-only' })
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-office-prepared-'))
  roots.push(root)
  expect(installOfficeEngineResolution(join(root, 'dsh'))).toBeUndefined()
})

it('does not install a resolver when the packaged runtime directory is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-office-missing-'))
  roots.push(root)
  expect(installOfficeEngineResolution(join(root, 'app.asar', 'dsh'))).toBeUndefined()
})
