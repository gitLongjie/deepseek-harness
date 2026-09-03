/** Unit tests for the packaged desktop's single-source resource manifest. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ASAR_UNPACK_GLOBS, findMissingPackagedResources, REQUIRED_UNPACKED_PACKAGES } from '../src/main/desktop/packaged-resources.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Create a complete desktop layout (every boot-critical resource) under `dirName`. */
function layout(dirName: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-resources-'))
  roots.push(root)
  const appRoot = join(root, dirName)
  mkdirSync(join(appRoot, 'web'), { recursive: true })
  writeFileSync(join(appRoot, 'web', 'index.html'), '<html></html>\n')
  mkdirSync(join(appRoot, 'config', 'agent-presets', 'code'), { recursive: true })
  writeFileSync(join(appRoot, 'cordis.patch.yml'), '[]\n')
  mkdirSync(join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-workflow-worker-thread', 'lib'), { recursive: true })
  writeFileSync(join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-workflow-worker-thread', 'lib', 'worker.cjs'), '')
  const unpacked = join(`${appRoot}.unpacked`, 'node_modules')
  mkdirSync(join(unpacked, '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib'), { recursive: true })
  writeFileSync(join(unpacked, '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js'), '')
  mkdirSync(join(unpacked, 'koffi'), { recursive: true })
  writeFileSync(join(unpacked, 'koffi', 'package.json'), '{}')
  return appRoot
}

describe('ASAR_UNPACK_GLOBS', () => {
  it('unpacks native binaries and every required package', () => {
    expect(ASAR_UNPACK_GLOBS[0]).toBe('**/*.node')
    for (const name of REQUIRED_UNPACKED_PACKAGES) {
      expect(ASAR_UNPACK_GLOBS).toContain(`**/node_modules/${name}/**`)
    }
  })
})

describe('findMissingPackagedResources', () => {
  it('accepts a complete packaged layout on Windows', () => {
    expect(findMissingPackagedResources(layout('app.asar'), { platform: 'win32' })).toEqual([])
  })

  it('skips the Windows twin assertions off Windows', () => {
    expect(findMissingPackagedResources(layout('app.asar'), { platform: 'linux' })).toEqual([])
  })

  it('skips the twin assertions in the open checkout layout', () => {
    expect(findMissingPackagedResources(layout('checkout'), { platform: 'win32' })).toEqual([])
  })

  it('reports each removed resource with its stable label', () => {
    // The unpacked twins live beside app.asar, so their removal paths resolve
    // against the layout's parent, not appRoot.
    const cases: ReadonlyArray<readonly [boolean, string, string]> = [
      [false, 'web/index.html', 'web-dist'],
      [false, 'cordis.patch.yml', 'desktop-patch'],
      [false, 'node_modules/@deepseek-ai/dsh-workflow-worker-thread/lib/worker.cjs', 'workflow-worker'],
      [true, 'app.asar.unpacked/node_modules/koffi/package.json', 'koffi-binding'],
      [true, 'app.asar.unpacked/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js', 'windows-acl-runner'],
    ]
    for (const [underParent, removed, label] of cases) {
      const appRoot = layout('app.asar')
      const base = underParent ? dirname(appRoot) : appRoot
      rmSync(join(base, ...removed.split('/')), { recursive: true, force: true })
      const missing = findMissingPackagedResources(appRoot, { platform: 'win32' })
      expect(missing.map(entry => entry.label), removed).toContain(label)
    }
  })

  it('reports an empty preset root as missing', () => {
    const appRoot = layout('app.asar')
    rmSync(join(appRoot, 'config', 'agent-presets'), { recursive: true, force: true })
    mkdirSync(join(appRoot, 'config', 'agent-presets'), { recursive: true })
    expect(findMissingPackagedResources(appRoot, { platform: 'win32' }).map(entry => entry.label))
      .toContain('agent-presets')
  })
})
