/** Authenticated workbench routes over the studio document owner. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { StudioError, StudioStore, studioContent, studioId } from './studio-store.ts'

/** Register authoring routes; Connection owns authentication and origin checks.
 * @param ctx - plugin lifetime and connection registry.
 * @param store - shared work document owner.
 * @param maxBytes - maximum complete JSON request size.
 */
export function registerStudioRoutes(ctx: Context, store: StudioStore, maxBytes: number): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/video-workbench/studio/export', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const text = await request.text()
        if (Buffer.byteLength(text) > maxBytes) return Response.json({ code: 'invalid' }, { status: 413 })
        const body: unknown = JSON.parse(text)
        if (typeof body !== 'object' || body === null || !('id' in body) || !('revision' in body)
          || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 1
          || Object.keys(body).some(key => !['id', 'revision'].includes(key))) {
          throw new StudioError('invalid', 'Expected work id and revision')
        }
        return Response.json(await store.export(studioId(body.id), body.revision, request.signal))
      } catch (error) {
        if (error instanceof SyntaxError) return Response.json({ code: 'invalid' }, { status: 400 })
        if (error instanceof StudioError) return Response.json({ code: error.code }, {
          status: { invalid: 400, missing: 404, conflict: 409, corrupt: 422, storage: 500 }[error.code],
        })
        ctx.logger.warn('Studio export failed: %s', error)
        return Response.json({ code: 'export_failed' }, { status: 422 })
      }
    },
  }), 'video-workbench: studio export')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/video-workbench/studio', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const id = new URL(request.url).searchParams.get('id')
          return Response.json(id === null ? await store.list() : await store.read(studioId(id)))
        }
        const text = await request.text()
        if (Buffer.byteLength(text) > maxBytes) return Response.json({ code: 'invalid' }, { status: 413 })
        const body: unknown = JSON.parse(text)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new StudioError('invalid', 'Expected request object')
        if (!('content' in body)) throw new StudioError('invalid', 'Content is required')
        const content = studioContent(body.content)
        if (!('id' in body)) {
          if (Object.keys(body).some(key => key !== 'content')) throw new StudioError('invalid', 'Unknown create field')
          return Response.json(await store.create(content), { status: 201 })
        }
        if (Object.keys(body).some(key => !['id', 'revision', 'content'].includes(key)) || !('revision' in body) || typeof body.revision !== 'number') throw new StudioError('invalid', 'Invalid save request')
        return Response.json(await store.save(studioId(body.id), body.revision, content))
      } catch (error) {
        if (error instanceof SyntaxError) return Response.json({ code: 'invalid' }, { status: 400 })
        if (error instanceof StudioError) {
          const status = { invalid: 400, missing: 404, conflict: 409, corrupt: 422, storage: 500 }[error.code]
          return Response.json({ code: error.code }, { status })
        }
        ctx.logger.warn('Studio request failed: %s', error)
        return Response.json({ code: 'storage' }, { status: 500 })
      }
    },
  }), 'video-workbench: studio documents')
}
