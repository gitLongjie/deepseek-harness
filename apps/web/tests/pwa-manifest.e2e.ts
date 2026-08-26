import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'DeepSeek Harness',
    short_name: 'DSH',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.ico',
      sizes: 'any',
      type: 'image/x-icon',
      purpose: 'any',
    }],
  })
})

it('ships the brand favicon as a real ICO next to the entry document', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.ico'))
  // ICONDIR: reserved word + type 1 (icon) + exactly one embedded image.
  expect(favicon.length).toBeGreaterThan(0)
  expect(favicon.readUInt16LE(0)).toBe(0)
  expect(favicon.readUInt16LE(2)).toBe(1)
  expect(favicon.readUInt16LE(4)).toBe(1)
})
