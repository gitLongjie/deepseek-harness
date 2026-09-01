/** Unit tests for the offline index.html composition. */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { renderDesktopIndex } from '../src/main/ipc/index-html.ts'

/** A minimal host context carrying webServer + clientModules stubs. */
function makeCtx(rows: IndexInjection[], bundlePath?: string): Context {
  return {
    get(service: string): unknown {
      if (service === 'webServer') {
        return { collectIndexInjections: () => rows }
      }
      if (service === 'clientModules') {
        return {
          clientPath: () => bundlePath,
          // The registry serves bundle bytes keyed by the exact resource URL;
          // the fake answers any single-plugin URL with the fake bundle file.
          bundleResponse: () => bundlePath === undefined
            ? undefined
            : { body: readFileSync(bundlePath), contentType: 'text/javascript; charset=utf-8' },
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
  it('inlines script-src rows and prepends the transport IIFE', () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'window.__ModuleLoader__.load({ id: "pkg", factory() {} })')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const rows: IndexInjection[] = [
      { kind: 'script-src', placement: 'head', src: '/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=abc' },
      { kind: 'global', name: '__DSH_BOOT__', value: { rev: 'abc', entries: [] } },
    ]
    const html = renderDesktopIndex(makeCtx(rows, bundleFile), dir, iifeFile)
    expect(html).toContain('window.__DSH_TRANSPORT__')
    expect(html).toContain('__ModuleLoader__.load')
    expect(html).toContain('__DSH_BOOT__')
    expect(html).not.toContain('/plugins/')
  })

  it('escapes </script sequences inside inlined bundle bytes', () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'const s = "</script>"')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const rows: IndexInjection[] = [
      { kind: 'script-src', placement: 'head', src: '/plugins/pkg/client.js?rev=abc' },
    ]
    const html = renderDesktopIndex(makeCtx(rows, bundleFile), dir, iifeFile)
    // The literal `</script>` must not appear verbatim, so the HTML parser
    // cannot close the inline script element early.
    expect(html).not.toContain('"</script>"')
    expect(html).toContain('"<\\/script>"')
  })

  it('restores the client module bootstrap when the injection table is incomplete', () => {
    const dir = makeWebDist()
    const bundleFile = join(dir, 'client.js')
    writeFileSync(bundleFile, 'window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-modules", factory() {} })')
    const iifeFile = join(dir, 'render-transport.js')
    writeFileSync(iifeFile, 'window.__DSH_TRANSPORT__ = {}')
    const html = renderDesktopIndex(makeCtx([]), dir, iifeFile, bundleFile)
    expect(html).toContain('id: "@deepseek-ai/dsh-client-modules"')
  })

  it('throws when the transport IIFE is missing', () => {
    const dir = makeWebDist()
    expect(() => renderDesktopIndex(makeCtx([]), dir, join(dir, 'missing.js'))).toThrow()
  })
})
