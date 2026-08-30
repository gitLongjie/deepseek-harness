import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

interface OemIdentity {
  readonly productName: string
  readonly brandIcon: string
}

async function readOemIdentity(): Promise<OemIdentity> {
  return JSON.parse(await readFile(join(REPOSITORY_ROOT, 'oem.config.json'), 'utf8')) as OemIdentity
}

function iconMediaType(path: string): string | undefined {
  const pathname = path.startsWith('/') ? path : new URL(path).pathname
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.ico')) return 'image/x-icon'
  return undefined
}

it('ships install metadata with the built web application', async () => {
  const config = await readOemIdentity()
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')
  const iconHref = config.brandIcon.startsWith('/') ? `.${config.brandIcon}` : config.brandIcon
  expect(index).toContain(`<link rel="icon" href="${iconHref}" />`)

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: config.productName,
    short_name: config.productName,
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: config.brandIcon,
      sizes: 'any',
      ...(iconMediaType(config.brandIcon) === undefined ? {} : { type: iconMediaType(config.brandIcon) }),
      purpose: 'any',
    }],
  })
})

it('ships or securely references the configured brand icon', async () => {
  const config = await readOemIdentity()
  if (config.brandIcon.startsWith('/')) {
    expect(config.brandIcon).toMatch(/^\/[A-Za-z0-9._/-]+$/)
    const icon = await readFile(join(DIST_ROOT, config.brandIcon.slice(1)))
    expect(icon.length).toBeGreaterThan(0)
  } else {
    expect(new URL(config.brandIcon).protocol).toBe('https:')
  }
})
