/**
 * Video-workbench host tests: project discovery over a synthetic output tree, file resolution
 * refusals (escape, extension, missing, oversized), and the two Fetch routes' method and response
 * behavior through a stub Connection service.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import * as plugin from '../src/index.ts'
import { resolveWorkbenchFile } from '../src/file-serve.ts'
import { scanProjects } from '../src/projects.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function outputTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'video-workbench-'))
  tempDirs.push(dir)
  return dir
}

function writePlan(dir: string, plan: Record<string, unknown>): void {
  mkdirSync(join(dir, 'plans'), { recursive: true })
  writeFileSync(join(dir, 'plans', `${plan.id as string}.json`), `${JSON.stringify(plan)}\n`)
}

function touch(dir: string, relative: string, bytes = 'x'): void {
  const file = join(dir, ...relative.split('/'))
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, bytes)
}

const PLAN = {
  id: 'vp-1',
  revision: 2,
  goal: 'a 12s brand film',
  mode: 'per_segment',
  createdAt: 1_700_000_000_000,
  segments: [
    { id: 's1', prompt: 'opening', durationSeconds: 6, resolution: '768P', ratio: '16:9', backend: 'local' },
    { id: 's2', prompt: 'close', durationSeconds: 6, resolution: '768P', ratio: '16:9', backend: 'auto' },
  ],
}

describe('scanProjects', () => {
  it('projects segments, keyframes, and the final assembly with their on-disk state', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    touch(dir, 'segments/vp-1-s1.mp4')
    touch(dir, 'keyframes/vp-1-s1.png')
    touch(dir, 'final/vp-1.mp4', 'final-bytes')
    const summary = await scanProjects(dir)
    expect(summary.outputDir).toBe(dir)
    expect(summary.errors).toEqual([])
    expect(summary.projects).toHaveLength(1)
    const project = summary.projects[0]
    expect(project?.id).toBe('vp-1')
    expect(project?.revision).toBe(2)
    expect(project?.final).toBe(join(dir, 'final', 'vp-1.mp4'))
    expect(project?.finalBytes).toBe('final-bytes'.length)
    expect(project?.segments).toEqual([
      { id: 's1', rendered: true, keyframe: join(dir, 'keyframes', 'vp-1-s1.png') },
      { id: 's2', rendered: false },
    ])
  })

  it('collapses a multi_shot plan onto the synthetic all segment', async () => {
    const dir = outputTree()
    writePlan(dir, { ...PLAN, mode: 'multi_shot' })
    touch(dir, 'segments/vp-1-all.mp4')
    touch(dir, 'keyframes/vp-1-s1.jpg')
    const summary = await scanProjects(dir)
    const project = summary.projects[0]
    expect(project?.mode).toBe('multi_shot')
    expect(project?.segments).toEqual([
      { id: 'all', rendered: true, keyframe: join(dir, 'keyframes', 'vp-1-s1.jpg') },
    ])
  })

  it('reports corrupt plans as error rows without failing the listing', async () => {
    const dir = outputTree()
    mkdirSync(join(dir, 'plans'), { recursive: true })
    writeFileSync(join(dir, 'plans', 'broken.json'), '{not json')
    writeFileSync(join(dir, 'plans', 'mismatch.json'), JSON.stringify({ id: 'other', segments: [] }))
    const summary = await scanProjects(dir)
    expect(summary.projects).toEqual([])
    expect(summary.errors).toHaveLength(2)
    expect(summary.errors[0]).toContain('broken.json')
    expect(summary.errors[1]).toContain('mismatch.json')
  })

  it('returns an empty listing when no plans directory exists', async () => {
    const dir = outputTree()
    const summary = await scanProjects(dir)
    expect(summary.projects).toEqual([])
    expect(summary.errors).toEqual([])
  })
})

describe('resolveWorkbenchFile', () => {
  it('serves a whitelisted file inside the directory', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4')
    const resolved = await resolveWorkbenchFile(dir, 'final/vp-1.mp4')
    expect(resolved).toMatchObject({ contentType: 'video/mp4', bytes: 1 })
  })

  it('refuses traversal, absolute paths, and drive letters as escapes', async () => {
    const dir = outputTree()
    await expect(resolveWorkbenchFile(dir, '../outside.mp4')).resolves.toMatchObject({ reason: 'escape' })
    await expect(resolveWorkbenchFile(dir, '/etc/hosts')).resolves.toMatchObject({ reason: 'escape' })
    await expect(resolveWorkbenchFile(dir, 'C:/windows/win.ini')).resolves.toMatchObject({ reason: 'escape' })
  })

  it('refuses an unserved extension and a missing file', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4')
    await expect(resolveWorkbenchFile(dir, 'final/vp-1.exe')).resolves.toMatchObject({ reason: 'extension' })
    await expect(resolveWorkbenchFile(dir, 'final/vp-2.mp4')).resolves.toMatchObject({ reason: 'not-found' })
  })

  // Windows without symlink privilege throws EPERM on symlinkSync; CI's matrix covers it there.
  it.skipIf(process.platform === 'win32')('refuses a symlink leading outside the directory', async () => {
    const dir = outputTree()
    const outside = mkdtempSync(join(tmpdir(), 'video-workbench-out-'))
    tempDirs.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    mkdirSync(join(dir, 'final'), { recursive: true })
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'final', 'secret.txt'))
    await expect(resolveWorkbenchFile(dir, 'final/secret.txt')).resolves.toMatchObject({ reason: 'escape' })
  })
})

/** One registered exact Fetch route as the stub records it. */
interface RegisteredRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

describe('routes', () => {
  async function boot(outputDir?: string): Promise<Map<string, RegisteredRoute>> {
    const routes = new Map<string, RegisteredRoute>()
    const ctx = new Context()
    ctx.provide('connection', {
      fetch: {
        register: (route: RegisteredRoute) => {
          routes.set(route.path, route)
          return async () => { routes.delete(route.path) }
        },
      },
    } as never)
    await ctx.plugin(plugin, outputDir === undefined ? {} : { outputDir })
    return routes
  }

  /** One call against a registered route. */
  async function call(
    routes: Map<string, RegisteredRoute>,
    path: string,
    method = 'GET',
  ): Promise<Response> {
    const url = new URL(`http://127.0.0.1${path}`)
    return await routes.get(url.pathname)!.fetch(new Request(url, { method }))
  }

  it('registers both routes as GET/HEAD Fetch routes on the Connection registry', async () => {
    const routes = await boot(outputTree())
    expect([...routes.keys()].sort()).toEqual([
      '/api/video-workbench/file',
      '/api/video-workbench/projects',
    ])
    for (const route of routes.values()) {
      expect(route.methods).toEqual(['GET', 'HEAD'])
      expect(route.requestBody).toBe('buffered')
    }
  })

  it('defaults the projected directory to the DSH cache video path', async () => {
    const home = outputTree()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const projected = dshCachePath('video')
      expect(projected).toBe(join(home, 'cache', 'video'))
      writePlan(projected, PLAN)
      const routes = await boot()
      const summary = await (await call(routes, '/api/video-workbench/projects')).json() as {
        outputDir: string
        projects: Array<{ id: string }>
      }
      expect(summary.outputDir).toBe(projected)
      expect(summary.projects[0]?.id).toBe('vp-1')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('lists projects as JSON and answers HEAD without a body', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    const routes = await boot(dir)
    const response = await call(routes, '/api/video-workbench/projects')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    const summary = await response.json() as { projects: Array<{ id: string }> }
    expect(summary.projects[0]?.id).toBe('vp-1')
    const head = await call(routes, '/api/video-workbench/projects', 'HEAD')
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('streams a served file and answers HEAD with its headers alone', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4', 'abc')
    const routes = await boot(dir)
    const ok = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('video/mp4')
    expect(ok.headers.get('content-length')).toBe('3')
    expect(await ok.text()).toBe('abc')
    const head = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('3')
    expect(await head.text()).toBe('')
  })

  it('refuses an escaping path, an unserved extension, and a missing file', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.exe', 'x')
    const routes = await boot(dir)
    const noPath = await call(routes, '/api/video-workbench/file')
    expect(noPath.status).toBe(403)
    const escaped = await call(routes, '/api/video-workbench/file?path=../secrets.txt')
    expect(escaped.status).toBe(403)
    expect(await escaped.text()).toContain('escapes the video workbench directory')
    const unserved = await call(routes, '/api/video-workbench/file?path=final/vp-1.exe')
    expect(unserved.status).toBe(403)
    expect(await unserved.text()).toContain('unsupported file type .exe')
    const headRefusal = await call(routes, '/api/video-workbench/file?path=final/vp-9.mp4', 'HEAD')
    expect(headRefusal.status).toBe(404)
    expect(await headRefusal.text()).toBe('')
  })

  it('refuses a file above the byte ceiling with 413', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4')
    // Sparse extension: the ceiling is read from the file's size, so the body is never written.
    truncateSync(join(dir, 'final', 'vp-1.mp4'), 256 * 1024 * 1024 + 1)
    const routes = await boot(dir)
    const oversized = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4')
    expect(oversized.status).toBe(413)
    expect(await oversized.text()).toContain('256 MB limit')
  })
})
