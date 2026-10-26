/** Unit tests for the first-launch ComfyUI deployment. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { comfyuiLocalDir, deployBundledComfyUI } from '../src/main/desktop/comfyui-bootstrap.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Create a scratch tree with `app/config/comfyui`, `resources/comfyui-dist`, and `local` directories. */
function layout(withDist: boolean): { appRoot: string; resourcesDir: string; localDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-comfyui-bootstrap-'))
  roots.push(root)
  const appRoot = join(root, 'app')
  const resourcesDir = join(root, 'resources')
  const localDir = join(root, 'local')
  mkdirSync(join(appRoot, 'config', 'comfyui'), { recursive: true })
  writeFileSync(join(appRoot, 'config', 'comfyui', 'h3-t2v-api-template.json'), '{"1":{}}\n')
  if (withDist) {
    mkdirSync(join(resourcesDir, 'comfyui-dist', 'ComfyUI'), { recursive: true })
    writeFileSync(join(resourcesDir, 'comfyui-dist', 'ComfyUI', 'main.py'), 'print("hi")\n')
  } else {
    mkdirSync(resourcesDir, { recursive: true })
  }
  return { appRoot, resourcesDir, localDir }
}

describe('comfyuiLocalDir', () => {
  it('nests under the named local-app-data directory', () => {
    expect(comfyuiLocalDir(join('C:', 'Users', 'a', 'AppData', 'Local')))
      .toBe(join('C:', 'Users', 'a', 'AppData', 'Local', 'DeepagensWork', 'comfyui'))
  })

  it('is undefined without a local-app-data directory', () => {
    expect(comfyuiLocalDir(undefined)).toBeUndefined()
  })
})

describe('deployBundledComfyUI', () => {
  it('deploys the template and the program tree once, then never overwrites', async () => {
    const { appRoot, resourcesDir, localDir } = layout(true)
    await deployBundledComfyUI({ appRoot, resourcesDir, localDir })
    expect(existsSync(join(localDir, 'models', 'h3-t2v-api-template.json'))).toBe(true)
    expect(existsSync(join(localDir, 'ComfyUI', 'main.py'))).toBe(true)
    expect(existsSync(join(localDir, '.comfyui-dist-v1'))).toBe(true)
    // A user edit survives the second launch: the marker skips redeployment.
    writeFileSync(join(localDir, 'ComfyUI', 'main.py'), '# user edit\n')
    await deployBundledComfyUI({ appRoot, resourcesDir, localDir })
    expect(readFileSync(join(localDir, 'ComfyUI', 'main.py'), 'utf8')).toBe('# user edit\n')
  })

  it('deploys only the template when the installer carries no program tree', async () => {
    const { appRoot, resourcesDir, localDir } = layout(false)
    await deployBundledComfyUI({ appRoot, resourcesDir, localDir })
    expect(existsSync(join(localDir, 'models', 'h3-t2v-api-template.json'))).toBe(true)
    expect(existsSync(join(localDir, 'ComfyUI'))).toBe(false)
    expect(existsSync(join(localDir, '.comfyui-dist-v1'))).toBe(false)
  })

  it('does nothing without a deployment directory', async () => {
    const { appRoot, resourcesDir } = layout(true)
    await deployBundledComfyUI({ appRoot, resourcesDir, localDir: undefined })
  })
})
