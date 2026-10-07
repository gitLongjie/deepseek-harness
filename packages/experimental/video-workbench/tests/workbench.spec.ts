/**
 * Video-workbench host tests: project discovery over a synthetic output tree, file resolution
 * refusals (escape, extension, missing, oversized), and the two routes' method and response
 * behavior through a stub web-server service.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import plugin from '../src/index.ts'
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

/** Minimal web-server stub recording route registrations. */
function webServerStub(): { routes: Map<string, (req: FakeReq, res: FakeRes) => Promise<void>> } {
  const routes = new Map<string, (req: FakeReq, res: FakeRes) => Promise<void>>()
  return {
    routes,
  }
}

interface FakeReq {
  method: string
  url: string
}

interface FakeRes {
  status: number
  headers: Record<string, unknown>
  body: string
  writeHead(status: number, headers?: Record<string, unknown>): FakeRes
  write(chunk: string | Buffer): boolean
  end(body?: string): void
  on(event: string, listener: (...args: unknown[]) => void): FakeRes
  once(event: string, listener: (...args: unknown[]) => void): FakeRes
  emit(event: string, ...args: unknown[]): boolean
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
      return res
    },
    write(chunk) {
      res.body += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      return true
    },
    end(body) {
      if (body !== undefined) res.body += body
    },
    on(_event, listener) {
      void listener
      return res
    },
    once(_event, listener) {
      void listener
      return res
    },
    emit(_event, ..._args) {
      return true
    },
  }
  return res
}

describe('routes', () => {
  async function boot(outputDir: string): Promise<Map<string, (req: FakeReq, res: FakeRes) => Promise<void>>> {
    const stub = webServerStub()
    const ctx = new Context()
    ctx.provide('webServer', {
      register: (route: { kind: string; path: string; handler: (req: FakeReq, res: FakeRes) => Promise<void> }) => {
        stub.routes.set(route.path, route.handler)
        return () => stub.routes.delete(route.path)
      },
    } as never)
    await ctx.plugin(plugin, { outputDir })
    return stub.routes
  }

  it('lists projects as JSON', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    const routes = await boot(dir)
    const handler = routes.get('/api/video-workbench/projects')
    expect(handler).toBeDefined()
    const res = fakeRes()
    await handler!({ method: 'GET', url: '/api/video-workbench/projects' }, res)
    expect(res.status).toBe(200)
    const summary = JSON.parse(res.body) as { projects: Array<{ id: string }> }
    expect(summary.projects[0]?.id).toBe('vp-1')
  })

  it('refuses non-GET methods on both routes', async () => {
    const dir = outputTree()
    const routes = await boot(dir)
    const res = fakeRes()
    await routes.get('/api/video-workbench/projects')!({ method: 'POST', url: '' }, res)
    expect(res.status).toBe(405)
    await routes.get('/api/video-workbench/file')!({ method: 'DELETE', url: '' }, res)
    expect(res.status).toBe(405)
  })

  it('serves a file from the projected directory and refuses an escape', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4', 'abc')
    const routes = await boot(dir)
    const handler = routes.get('/api/video-workbench/file')!
    const ok = fakeRes()
    await handler({ method: 'GET', url: '/api/video-workbench/file?path=final/vp-1.mp4' }, ok)
    // The streamed body settles asynchronously; let the read stream drain before the cleanup.
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('video/mp4')
    expect(ok.body).toBe('abc')
    const denied = fakeRes()
    await handler({ method: 'GET', url: '/api/video-workbench/file?path=../secrets.txt' }, denied)
    expect(denied.status).toBe(403)
  })
})
