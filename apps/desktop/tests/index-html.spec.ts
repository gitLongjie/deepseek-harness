/** Unit tests for the offline index.html composition. */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { renderDesktopIndex } from '../src/main/ipc/index-html.ts'

/** A minimal host context carrying webServer + clientModules stubs. */
function makeCtx(rows: IndexInjection[], bundlePath?: string, bundled: string[] = []): Context {
  return {
    get(service: string): unknown {
      if (service === 'webServer') {
        return { collectIndexInjections: () => rows }
      }
      if (service === 'clientModules') {
        return {
          // The registry parses the request URL and serves the advertised
          // revisioned bundle; the fake answers any /plugins URL with the file
          // and records the URL so the absolute-authority requirement stays checked.
          fetchBundle: (request: Request): Response => {
            bundled.push(request.url)
            return bundlePath === undefined
              ? new Response(null, { status: 404 })
              : new Response(readFileSync(bundlePath), {
                  status: 200,
                  headers: { 'content-type': 'text/javascript; charset=utf-8' },
                })
          },
        }
      }
      return undefined
    },
  } as unknown as Context
}

function makeWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-web-'))
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>x</title></head><body></body></html>',
  )
  return dir
}

describe('renderDesktopIndex', () => {
  it('inlines script-src rows and prepends the transport IIFE', async () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'window.__ModuleLoader__.load({ id: "pkg", factory() {} })')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const rows: IndexInjection[] = [
      { kind: 'script-src', placement: 'head', src: '/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=abc' },
      { kind: 'global', name: '__DSH_BOOT__', value: { rev: 'abc', entries: [] } },
    ]
    const bundled: string[] = []
    const html = await renderDesktopIndex(makeCtx(rows, bundleFile, bundled), dir, iifeFile)
    expect(html).toContain('window.__DSH_TRANSPORT__')
    expect(html).toContain('__ModuleLoader__.load')
    expect(html).toContain('__DSH_BOOT__')
    expect(html).not.toContain('/plugins/')
    // The registry parses the request URL, and the file:// document has no base
    // to resolve the table's root-relative src against.
    expect(bundled).toEqual(['http://127.0.0.1/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=abc'])
  })

  it('escapes </script sequences inside inlined bundle bytes', async () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'const s = "</script>"')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const rows: IndexInjection[] = [
      { kind: 'script-src', placement: 'head', src: '/plugins/pkg/client.js?rev=abc' },
    ]
    const html = await renderDesktopIndex(makeCtx(rows, bundleFile), dir, iifeFile)
    // The literal `</script>` must not appear verbatim, so the HTML parser
    // cannot close the inline script element early.
    expect(html).not.toContain('"</script>"')
    expect(html).toContain('"<\\/script>"')
  })

  it('drops the sourceMappingURL of every inlined script', async () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'window.__ModuleLoader__.load({ id: "pkg", factory() {} })\n//# sourceMappingURL=client.js.map')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}\n//# sourceMappingURL=render-transport.js.map')
    const html = await renderDesktopIndex(makeCtx([], dir, iifeFile), dir, iifeFile, bundleFile)
    // A relative map URL inside an inlined script resolves against the document,
    // where the map is not served: the renderer logs a 500 for it.
    expect(html).not.toContain('sourceMappingURL')
    expect(html).toContain('window.__DSH_TRANSPORT__')
    expect(html).toContain('__ModuleLoader__.load')
  })

  it('restores the client module bootstrap when the injection table is incomplete', async () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-modules", factory() {} })')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const html = await renderDesktopIndex(makeCtx([]), dir, iifeFile, bundleFile)
    expect(html).toContain('id: "@deepseek-ai/dsh-client-modules"')
  })

  it('rejects when the transport IIFE is missing', async () => {
    const dir = makeWebDist()
    await expect(renderDesktopIndex(makeCtx([]), dir, join(dir, 'missing.js'))).rejects.toThrow()
  })
})
