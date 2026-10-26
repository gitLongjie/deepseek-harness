/**
 * Video-workbench transport test: the routes must be reachable through the shared `/api` Fetch
 * handler, the one dispatch surface both carriers use — the browser's `/api` HTTP route and the
 * desktop shell's in-process transport. A route registered only on the web server answers the
 * browser and never the desktop, which is how the workbench page failed to load its listing.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.ts'

/** The desktop's own fallback: `/api` paths no registered route or channel claims. */
const UNCLAIMED = {
  requestBodyMode: () => 'buffered' as const,
  fetch: () => Promise.resolve(new Response('not found', { status: 404 })),
}

describe('Connection transport', () => {
  it('answers both routes through the shared /api handler every carrier dispatches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-workbench-transport-'))
    try {
      mkdirSync(join(dir, 'plans'), { recursive: true })
      writeFileSync(join(dir, 'plans', 'vp-1.json'), JSON.stringify({
        id: 'vp-1', revision: 1, goal: 'a film', mode: 'per_segment', createdAt: 1, segments: [{ id: 's1' }],
      }))
      mkdirSync(join(dir, 'final'), { recursive: true })
      writeFileSync(join(dir, 'final', 'vp-1.mp4'), 'bytes')

      const ctx = new Context()
      // The Connection service's request fence is never consulted on this dispatch path, so the
      // registration test needs no browser-auth instance.
      const connection = new HostConnectionService(ctx, [], {} as never)
      await ctx.plugin(plugin, { outputDir: dir })
      const shared = connection.createSharedFetchHandler(
        '/api',
        connection.createChannelsFetchHandler(UNCLAIMED),
      )

      const listing = await shared.fetch(new Request('http://127.0.0.1/api/video-workbench/projects'))
      expect(listing.status).toBe(200)
      expect(await listing.json()).toMatchObject({ outputDir: dir, projects: [{ id: 'vp-1' }] })

      const file = await shared.fetch(new Request(
        'http://127.0.0.1/api/video-workbench/file?path=final%2Fvp-1.mp4',
      ))
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toBe('video/mp4')
      expect(await file.text()).toBe('bytes')

      const refused = await shared.fetch(new Request(
        'http://127.0.0.1/api/video-workbench/file?path=..%2Fsecrets.txt',
      ))
      expect(refused.status).toBe(403)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
