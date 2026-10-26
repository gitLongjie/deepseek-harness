/**
 * Video-workbench host tests: project discovery over a synthetic output tree, file resolution
 * refusals (escape, extension, missing, oversized), and the two Fetch routes' method and response
 * behavior through a stub Connection service.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import * as plugin from '../src/index.ts'
import { parseRange, resolveWorkbenchFile } from '../src/file-serve.ts'
import { scanProjects } from '../src/projects.ts'
import { deleteAsset, deleteProject } from '../src/trash.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function outputTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'video-workbench-'))
  tempDirs.push(dir)
  const output = join(dir, 'video')
  mkdirSync(output)
  return output
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

describe('deletions', () => {
  it('retains images and clips referenced directly by another storyboard', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    writePlan(dir, { ...PLAN, id: 'vp-2', segments: [{ ...PLAN.segments[0], references: [
      { type: 'image', role: 'first_frame', source: join(dir, 'keyframes', 'vp-1-s1.png') },
      { type: 'video', role: 'reference_video', source: join(dir, 'segments', 'vp-1-s1.mp4') },
    ] }] })
    touch(dir, 'keyframes/vp-1-s1.png')
    touch(dir, 'segments/vp-1-s1.mp4')
    const result = await deleteProject(dir, 'vp-1')
    expect(result.files).toEqual([join('plans', 'vp-1.json')])
    expect(existsSync(join(dir, 'keyframes', 'vp-1-s1.png'))).toBe(true)
    expect(existsSync(join(dir, 'segments', 'vp-1-s1.mp4'))).toBe(true)
  })

  it('keeps a detached image used as an authored reference in the same plan', async () => {
    const dir = outputTree()
    const image = join(dir, 'assets', 'vp-1-cup.png')
    writePlan(dir, { ...PLAN, assets: [{ id: 'cup', name: 'cup', kind: 'prop', reference: image }],
      segments: [{ ...PLAN.segments[0], references: [{ type: 'image', role: 'first_frame', source: image }] }],
    })
    touch(dir, 'assets/vp-1-cup.png')
    const result = await deleteAsset(dir, 'vp-1', 'cup')
    expect(result.files).toEqual([])
    expect(existsSync(image)).toBe(true)
  })

  it('restores images when the updated plan cannot be written', async () => {
    const dir = outputTree()
    const asset = { id: 'a', name: 'cup', kind: 'prop', reference: 'assets/cup.png' }
    writePlan(dir, { ...PLAN, assets: [asset] })
    touch(dir, 'assets/cup.png')
    const original = readFileSync(join(dir, 'plans', 'vp-1.json'), 'utf8')
    mkdirSync(join(dir, 'plans', 'vp-1.json.tmp'))
    await expect(deleteAsset(dir, 'vp-1', 'a')).rejects.toThrow()
    expect(readFileSync(join(dir, 'assets', 'cup.png'), 'utf8')).toBe('x')
    expect(readFileSync(join(dir, 'plans', 'vp-1.json'), 'utf8')).toBe(original)
  })

  it('refuses to remove images when another plan has unreadable references', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    touch(dir, 'plans/vp-2.json', 'null')
    await expect(deleteProject(dir, 'vp-1')).rejects.toThrow(/invalid video document/u)
    expect(existsSync(join(dir, 'plans', 'vp-1.json'))).toBe(true)
  })
  it('keeps images used by the library or another plan when deleting an episode', async () => {
    const dir = outputTree()
    const portrait = join(dir, 'assets', 'vp-1-char-1.png')
    const asset = { id: 'char-1', name: '小明', kind: 'character', reference: portrait }
    writePlan(dir, { ...PLAN, assets: [asset] })
    writePlan(dir, { ...PLAN, id: 'vp-2', assets: [asset] })
    touch(dir, 'assets/vp-1-char-1.png')
    touch(dir, 'assets/library.json', JSON.stringify({ version: 1, assets: [asset] }))
    await deleteProject(dir, 'vp-1')
    expect(existsSync(portrait)).toBe(true)
    const summary = await scanProjects(dir)
    expect(summary.projects[0]?.assets[0]?.reference).toBeDefined()
    await deleteAsset(dir, 'vp-2', 'char-1')
    expect(existsSync(portrait)).toBe(true)
  })

  it('trashes directory-relative images when detaching an unshared asset', async () => {
    const dir = outputTree()
    writePlan(dir, { ...PLAN, assets: [{ id: 'a', name: 'cup', kind: 'prop', reference: 'assets/cup.png' }] })
    touch(dir, 'assets/cup.png')
    const result = await deleteAsset(dir, 'vp-1', 'a')
    expect(result.files).toContain(join('assets', 'cup.png'))
    expect(existsSync(join(dir, 'assets', 'cup.png'))).toBe(false)
  })

  it('leaves a failed deletion observable instead of reporting success', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    touch(dir, 'segments/vp-1-s1.mp4')
    // A file occupies the trash root, so mkdir must fail before any creative file moves.
    touch(dir, 'video-trash', 'occupied')
    // Use an output child whose sibling trash directory belongs to this fixture.
    const child = join(dir, 'video')
    writePlan(child, PLAN)
    await expect(deleteProject(child, 'vp-1')).rejects.toThrow()
    expect(existsSync(join(child, 'plans', 'vp-1.json'))).toBe(true)
  })
  it('moves a project and every artifact it owns into the trash', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    touch(dir, 'segments/vp-1-s1.mp4')
    touch(dir, 'keyframes/vp-1-s1.png')
    touch(dir, 'final/vp-1.mp4', 'cut')
    const result = await deleteProject(dir, 'vp-1')
    expect(result.files).toEqual(expect.arrayContaining([
      join('plans', 'vp-1.json'),
      join('segments', 'vp-1-s1.mp4'),
      join('keyframes', 'vp-1-s1.png'),
      join('final', 'vp-1.mp4'),
    ]))
    // Nothing is unlinked: each moved file sits in the trash at its original relative position.
    for (const file of result.files) expect(existsSync(join(result.trashDir, file))).toBe(true)
    expect(existsSync(join(dir, 'plans', 'vp-1.json'))).toBe(false)
    expect((await scanProjects(dir)).projects).toEqual([])
  })

  it('refuses an id that is not a project id', async () => {
    const dir = outputTree()
    await expect(deleteProject(dir, '../escape')).rejects.toThrow(/not a project id/u)
  })

  it('removes one asset from the plan and trashes the images it named', async () => {
    const dir = outputTree()
    const portrait = join(dir, 'assets', 'vp-1-char-1.png')
    writePlan(dir, {
      ...PLAN,
      assets: [
        { id: 'char-1', name: '小明', kind: 'character', reference: portrait },
        { id: 'scene-1', name: '山顶', kind: 'scene', reference: join(dir, 'assets', 'vp-1-scene-1.png') },
      ],
    })
    touch(dir, 'assets/vp-1-char-1.png')
    const result = await deleteAsset(dir, 'vp-1', 'char-1')
    expect(result.files).toEqual([join('assets', 'vp-1-char-1.png')])
    expect(existsSync(portrait)).toBe(false)
    const plan = JSON.parse(readFileSync(join(dir, 'plans', 'vp-1.json'), 'utf8')) as { assets?: Array<{ id: string }> }
    expect(plan.assets?.map(asset => asset.id)).toEqual(['scene-1'])
  })

  it('refuses an asset id the plan does not carry', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    await expect(deleteAsset(dir, 'vp-1', 'nope')).rejects.toThrow(/has no asset/u)
  })
})

describe('scanProjects', () => {
  it('isolates malformed plan documents and malformed segment entries', async () => {
    const dir = outputTree()
    writePlan(dir, PLAN)
    touch(dir, 'plans/null.json', 'null')
    touch(dir, 'plans/vp-2.json', JSON.stringify({ ...PLAN, id: 'vp-2', segments: [null] }))
    const summary = await scanProjects(dir)
    expect(summary.projects.map(project => project.id)).toEqual(['vp-1'])
    expect(summary.errors).toHaveLength(2)
  })

  it('uses the pipeline default mode for plans with no recorded mode', async () => {
    const dir = outputTree()
    const { mode: _mode, ...legacy } = PLAN
    writePlan(dir, legacy)
    touch(dir, 'segments/vp-1-all.mp4')
    const project = (await scanProjects(dir)).projects[0]
    expect(project?.mode).toBe('multi_shot')
    expect(project?.segments[0]?.id).toBe('all')
    expect(project?.segments[0]?.rendered).toBe(true)
  })

  it('retains the authored storyboard and generation settings of a combined render', async () => {
    const dir = outputTree()
    writePlan(dir, { ...PLAN, mode: 'multi_shot' })
    const project = (await scanProjects(dir)).projects[0]
    expect(project?.segments[0]).toMatchObject({ id: 'all', shots: PLAN.segments })
  })

  it('uses the combined render as the completed video instead of an old assembly', async () => {
    const dir = outputTree()
    writePlan(dir, { ...PLAN, mode: 'multi_shot' })
    touch(dir, 'final/vp-1.mp4', 'old assembly')
    expect((await scanProjects(dir)).projects[0]?.final).toBeUndefined()
    touch(dir, 'segments/vp-1-all.mp4', 'complete storyboard')
    const project = (await scanProjects(dir)).projects[0]
    expect(project?.final).toBe(join(dir, 'segments', 'vp-1-all.mp4'))
    expect(project?.finalBytes).toBe('complete storyboard'.length)
  })

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
      {
        id: 's1',
        prompt: 'opening',
        shots: [PLAN.segments[0]],
        rendered: true,
        keyframe: join(dir, 'keyframes', 'vp-1-s1.png'),
        file: join(dir, 'segments', 'vp-1-s1.mp4'),
      },
      { id: 's2', prompt: 'close', rendered: false, shots: [PLAN.segments[1]] },
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
      {
        id: 'all',
        prompt: 'a 12s brand film\nopening\nclose',
        shots: PLAN.segments,
        rendered: true,
        keyframe: join(dir, 'keyframes', 'vp-1-s1.jpg'),
        file: join(dir, 'segments', 'vp-1-all.mp4'),
      },
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

  it('projects recorded assets with served images, prompt blocks, and library state', async () => {
    const dir = outputTree()
    const real = realpathSync(dir)
    writePlan(dir, {
      ...PLAN,
      assets: [
        {
          id: 'char-1',
          name: '小明',
          kind: 'character',
          prompt: '小明，短发工装',
          description: '短发',
          reference: 'assets/vp-1-char-1.png',
          sheet: 'assets/vp-1-char-1-sheet.png',
        },
        {
          id: 'scene-1',
          name: '山顶',
          kind: 'scene',
          prompt: '',
          description: '雪山垭口',
          reference: join(dir, 'assets', 'vp-1-scene-1.jpg'),
        },
        { id: 'prop-1', name: '茶砖', kind: 'prop', description: '   ' },
        { id: 'bad-1', name: 'vehicle', kind: 'vehicle' },
        'not-an-object',
        { name: 'no-id', kind: 'prop' },
        { id: 'no-name', kind: 'prop' },
        { id: 'weird', name: 'weird', kind: 'prop', prompt: 42, description: 7 },
      ],
    })
    touch(dir, 'assets/vp-1-char-1.png')
    touch(dir, 'assets/vp-1-char-1-sheet.png')
    touch(dir, 'assets/vp-1-scene-1.jpg')
    writeFileSync(
      join(dir, 'assets', 'library.json'),
      JSON.stringify({
        version: 1,
        assets: [{ name: '小明' }, { name: '茶砖' }, { name: '' }, { nope: true }, null],
      }),
    )
    const summary = await scanProjects(dir)
    expect(summary.projects[0]?.assets).toEqual([
      {
        id: 'char-1',
        name: '小明',
        kind: 'character',
        prompt: '小明，短发工装',
        description: '短发',
        reference: join(real, 'assets', 'vp-1-char-1.png'),
        sheet: join(real, 'assets', 'vp-1-char-1-sheet.png'),
        saved: true,
      },
      {
        id: 'scene-1',
        name: '山顶',
        kind: 'scene',
        description: '雪山垭口',
        reference: join(real, 'assets', 'vp-1-scene-1.jpg'),
        saved: false,
      },
      { id: 'prop-1', name: '茶砖', kind: 'prop', saved: true },
      { id: 'weird', name: 'weird', kind: 'prop', saved: false },
    ])
  })

  it('drops asset images the file route could not serve', async () => {
    const dir = outputTree()
    const outside = outputTree()
    writeFileSync(join(outside, 'outside.png'), 'x')
    touch(dir, 'assets/script.exe')
    writePlan(dir, {
      ...PLAN,
      assets: [
        { id: 'a', name: 'a', kind: 'character', reference: join(outside, 'outside.png'), sheet: 'assets/missing.png' },
        { id: 'b', name: 'b', kind: 'character', reference: '.', sheet: 42 },
        { id: 'c', name: 'c', kind: 'character', reference: '', sheet: 'assets/script.exe' },
      ],
    })
    const rows = (await scanProjects(dir)).projects[0]?.assets ?? []
    expect(rows).toHaveLength(3)
    expect(rows.every(row => row.reference === undefined && row.sheet === undefined)).toBe(true)
  })

  it('treats a missing or corrupt project library as unsaved', async () => {
    const dir = outputTree()
    writePlan(dir, { ...PLAN, assets: [{ id: 'char-1', name: '小明', kind: 'character' }] })
    const savedOf = async (): Promise<boolean | undefined> =>
      (await scanProjects(dir)).projects[0]?.assets[0]?.saved
    expect(await savedOf()).toBe(false)

    touch(dir, 'assets/library.json', '{not json')
    expect(await savedOf()).toBe(false)

    writeFileSync(join(dir, 'assets', 'library.json'), JSON.stringify({ assets: {} }))
    expect(await savedOf()).toBe(false)
  })
})

describe('parseRange', () => {
  it('parses closed, open-ended, and suffix ranges inside the file', () => {
    expect(parseRange(null, 10)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-3', 10)).toEqual({ kind: 'satisfiable', start: 0, end: 3 })
    expect(parseRange('bytes=4-', 10)).toEqual({ kind: 'satisfiable', start: 4, end: 9 })
    expect(parseRange('bytes=-3', 10)).toEqual({ kind: 'satisfiable', start: 7, end: 9 })
    expect(parseRange('bytes=5-100', 10)).toEqual({ kind: 'satisfiable', start: 5, end: 9 })
  })

  it('ignores malformed and multi-range headers and refuses a past-end range', () => {
    expect(parseRange('bytes=abc', 10)).toEqual({ kind: 'ignore' })
    expect(parseRange('bytes=0-1,3-4', 10)).toEqual({ kind: 'ignore' })
    expect(parseRange('bytes=-', 10)).toEqual({ kind: 'ignore' })
    expect(parseRange('bytes=4-2', 10)).toEqual({ kind: 'ignore' })
    expect(parseRange('bytes=-0', 10)).toEqual({ kind: 'ignore' })
    expect(parseRange('bytes=10-', 10)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
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
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(`http://127.0.0.1${path}`)
    return await routes.get(url.pathname)!.fetch(new Request(url, { method, headers }))
  }

  it('registers the read routes and the two deletion routes on the Connection registry', async () => {
    const routes = await boot(outputTree())
    expect([...routes.keys()].sort()).toEqual([
      '/api/video-workbench/asset/delete',
      '/api/video-workbench/file',
      '/api/video-workbench/project/delete',
      '/api/video-workbench/projects',
    ])
    for (const [path, route] of routes) {
      expect(route.requestBody).toBe('buffered')
      expect(route.methods).toEqual(path.endsWith('/delete') ? ['POST'] : ['GET', 'HEAD'])
    }
  })

  it.each(['null', '[]', '{broken', '{}'])('returns a JSON refusal for deletion body %s', async (body) => {
    const routes = await boot(outputTree())
    for (const path of ['/api/video-workbench/project/delete', '/api/video-workbench/asset/delete']) {
      const response = await routes.get(path)!.fetch(new Request(`http://127.0.0.1${path}`, {
        method: 'POST', body, headers: { 'content-type': 'application/json' },
      }))
      expect(response.status).toBe(400)
      expect(await response.json()).toHaveProperty('error')
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

  it('serves byte ranges for media and refuses a past-end range', async () => {
    const dir = outputTree()
    touch(dir, 'final/vp-1.mp4', 'abcdef')
    const routes = await boot(dir)
    const partial = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'GET', { range: 'bytes=1-3' })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 1-3/6')
    expect(partial.headers.get('content-length')).toBe('3')
    expect(partial.headers.get('accept-ranges')).toBe('bytes')
    expect(await partial.text()).toBe('bcd')

    const head = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'HEAD', { range: 'bytes=0-1' })
    expect(head.status).toBe(206)
    expect(await head.text()).toBe('')

    expect(await (await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'GET', { range: 'bytes=4-' })).text())
      .toBe('ef')
    expect(await (await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'GET', { range: 'bytes=-2' })).text())
      .toBe('ef')

    const unsatisfiable = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'GET', { range: 'bytes=99-' })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */6')

    // A malformed range falls back to the whole file.
    const malformed = await call(routes, '/api/video-workbench/file?path=final/vp-1.mp4', 'GET', { range: 'bytes=nope' })
    expect(malformed.status).toBe(200)
    expect(await malformed.text()).toBe('abcdef')
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
