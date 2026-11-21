import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectShippedExperts, isPackagedPresetDirectory, isShippedExpertRow, personaBlock, readShippedExpert,
  type ShippedPresetRow,
} from '../src/shipped.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'shipped-expert-'))
  directories.push(path)
  return path
}

const ROW: ShippedPresetRow = {
  id: 'geo-optimizer',
  name: 'GEO 优化专家',
  description: '诊断可见度。',
  category: 'marketing',
  subtitle: '官方',
  icon: '🔍',
  tags: ['GEO'],
  quickPrompts: ['先诊断'],
}

const COMPOSITION = `---
- id: persona
  config:
    prefix: |-
      你是顾问。

      先诊断。
- id: next
`

describe('shipped experts', () => {
  it('reads persona and skills, and skips package copies and modes', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await mkdir(join(directory, 'skills', 'pricing'), { recursive: true })
    await writeFile(join(directory, 'skills', 'pricing', 'SKILL.md'), '---\nname: 报价\n---\n\n模型\n', 'utf8')
    await writeFile(join(directory, 'skills', 'note.txt'), 'not a skill', 'utf8')
    await mkdir(join(directory, 'skills', 'plain'), { recursive: true })
    await writeFile(join(directory, 'skills', 'plain', 'SKILL.md'), '# 纯标题\n正文\n', 'utf8')

    const expert = await readShippedExpert(directory, ROW)
    expect(expert).toMatchObject({
      id: 'geo-optimizer',
      persona: '你是顾问。\n\n先诊断。',
      category: 'marketing',
    })
    expect(expert?.skillNames).toEqual(expect.arrayContaining(['报价', '纯标题']))
    expect(expert?.skillNames).toHaveLength(2)
    expect(isPackagedPresetDirectory(join(directory, '.agent-presets', 'geo'))).toBe(true)
    expect(isPackagedPresetDirectory(directory)).toBe(false)
    expect(isShippedExpertRow({ id: 'a', quickPrompts: ['先诊断'] })).toBe(true)
    expect(isShippedExpertRow({ id: 'a' })).toBe(false)

    const packaged = join(directory, '.agent-presets', 'geo')
    await mkdir(packaged, { recursive: true })
    await writeFile(join(packaged, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await expect(readShippedExpert(packaged, ROW)).resolves.toBeUndefined()
    await expect(readShippedExpert(directory, { id: 'standard' })).resolves.toBeUndefined()
    await expect(readShippedExpert(directory, { ...ROW, id: 'Bad' })).resolves.toBeUndefined()
    const nameless = await readShippedExpert(directory, { id: 'geo-optimizer', category: 'marketing', description: '  ' })
    expect(nameless?.name).toBe('geo-optimizer')
    expect(nameless?.description).toBe('geo-optimizer')
  })

  it('ignores a directory with no persona and a persona block that is empty', async () => {
    const directory = await root()
    expect(personaBlock('prefix: |-\n')).toBeUndefined()
    expect(personaBlock('prefix: |-\n\n      文本\n')).toBe('文本')
    expect(personaBlock('no persona here')).toBeUndefined()
    await expect(readShippedExpert(directory, ROW)).resolves.toBeUndefined()
    await writeFile(join(directory, 'agent.cordis.yml'), 'prefix: |-\n', 'utf8')
    await expect(readShippedExpert(directory, ROW)).resolves.toBeUndefined()
  })

  it('propagates a composition that cannot be read', async () => {
    const directory = await root()
    await mkdir(join(directory, 'agent.cordis.yml'))
    await expect(readShippedExpert(directory, ROW)).rejects.toThrow()
  })

  it('propagates a skills directory that cannot be listed', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await writeFile(join(directory, 'skills'), 'not a directory', 'utf8')
    await expect(readShippedExpert(directory, ROW)).rejects.toThrow()
  })

  it('collects shipped experts from the roster and skips rows without a directory', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    const found = await collectShippedExperts({
      list: async () => [ROW, { id: 'standard' }],
      directoryOf: id => (id === ROW.id ? directory : undefined),
    })
    expect(found.map(expert => expert.id)).toEqual(['geo-optimizer'])
    await expect(collectShippedExperts(undefined)).resolves.toEqual([])
    const empty = await root()
    await expect(collectShippedExperts({
      list: async () => [{ id: 'standard' }],
      directoryOf: () => empty,
    })).resolves.toEqual([])
  })

  it('fills a card that only has an id', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), 'prefix: |-\n  人设\n', 'utf8')
    const expert = await readShippedExpert(directory, { id: 'geo-optimizer', category: 'marketing' })
    expect(expert).toMatchObject({
      name: 'geo-optimizer',
      description: 'geo-optimizer',
      subtitle: '',
      icon: '',
      tags: [],
      quickPrompts: [],
      skillMarkdown: '',
    })
    const named = await readShippedExpert(directory, { id: 'geo-optimizer', name: '名字', category: 'marketing' })
    expect(named?.description).toBe('名字')
  })

  it('names a skill after its directory when the file has no title', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await mkdir(join(directory, 'skills', 'untitled'), { recursive: true })
    await writeFile(join(directory, 'skills', 'untitled', 'SKILL.md'), '正文\n', 'utf8')
    await mkdir(join(directory, 'skills', 'blank-name'), { recursive: true })
    await writeFile(join(directory, 'skills', 'blank-name', 'SKILL.md'), '---\nname:   \n---\n# 回退标题\n', 'utf8')
    await mkdir(join(directory, 'skills', 'hash'), { recursive: true })
    await writeFile(join(directory, 'skills', 'hash', 'SKILL.md'), '#   \n', 'utf8')
    // An uncurated row publishes no `category` property at all — an explicit
    // `category: undefined` would fail exactOptionalPropertyTypes and a
    // spread of ROW would keep the marker.
    const { category: _droppedCategory, ...uncurated } = ROW
    const expert = await readShippedExpert(directory, { ...uncurated, tags: ['GEO'] })
    expect(expert?.skillNames).toEqual(expect.arrayContaining(['untitled', '回退标题', 'hash']))
  })

  it('propagates a skill file that cannot be read', async () => {
    const directory = await root()
    await writeFile(join(directory, 'agent.cordis.yml'), COMPOSITION, 'utf8')
    await mkdir(join(directory, 'skills', 'broken', 'SKILL.md'), { recursive: true })
    await expect(readShippedExpert(directory, ROW)).rejects.toThrow()
  })
})
