import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarketSourceId } from '@deepseek-ai/dsh-market'
import { afterEach, describe, expect, it } from 'vitest'
import { readSourcesFile, newSourceId, writeSourcesFile, DEFAULT_SOURCE_ID, DEFAULT_SOURCE_URL } from '../src/sources.ts'
import { DEFAULT_SOURCE_ATTRIBUTION } from '../src/schemas.ts'

const homes: string[] = []

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-market-home-'))
  homes.push(home)
  return home
}

describe('readSourcesFile', () => {
  it('seeds the built-in community source into a fresh home', async () => {
    const home = tempHome()
    const state = await readSourcesFile(home)
    expect(state.selected).toBe(DEFAULT_SOURCE_ID)
    expect(state.sources).toEqual([{
      id: DEFAULT_SOURCE_ID,
      name: DEFAULT_SOURCE_ATTRIBUTION.name,
      kind: 'store-v1',
      url: DEFAULT_SOURCE_URL,
      attribution: DEFAULT_SOURCE_ATTRIBUTION,
    }])
  })

  it('reads back a written registry through the round trip', async () => {
    const home = tempHome()
    // The test mints its own registry-safe identity; the owning rebrand lives here.
    const customId = 'custom' as MarketSourceId
    await writeSourcesFile(home, {
      schema: 1,
      selected: customId,
      sources: [{ id: customId, name: 'Custom', kind: 'catalog', url: 'https://custom.example.com/v1/plugins' }],
    })
    const state = await readSourcesFile(home)
    expect(state.selected).toBe(customId)
    expect(state.sources).toHaveLength(1)
  })

  it('fails loud on a corrupt registry document', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'market'), { recursive: true })
    writeFileSync(join(home, 'market', 'sources.json'), '{ not json', 'utf8')
    await expect(readSourcesFile(home)).rejects.toThrow(/is not valid JSON/)

    writeFileSync(join(home, 'market', 'sources.json'), JSON.stringify({ schema: 9, selected: null, sources: [] }), 'utf8')
    await expect(readSourcesFile(home)).rejects.toThrow(/is not a valid source registry/)
  })
})

describe('newSourceId', () => {
  it('mints registry-safe identities', () => {
    const id = newSourceId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(id).not.toBe(newSourceId())
  })
})
