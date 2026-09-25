/**
 * Display metadata is presentation, never capability: every way of getting it
 * wrong degrades to "this preset has no display text" rather than to a
 * preset that cannot be discovered or mounted. It also cannot carry identity
 * — `id` is the directory and `trust` is the root, so neither is readable
 * from the file a user can write.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AVATAR_CAP, METADATA_FILE, readPresetMetadata, renderPresetMetadata } from '../src/metadata.ts'

/** Every temp preset directory created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A preset directory holding exactly the given metadata text. */
async function presetDir(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-preset-meta-'))
  tempDirs.push(dir)
  await mkdir(dir, { recursive: true })
  if (content !== undefined) await writeFile(join(dir, METADATA_FILE), content)
  return dir
}

describe('reading display metadata', () => {
  it('reads a name and a description', async () => {
    const dir = await presetDir('name: 标准模式\ndescription: 完整的编码 agent。\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', description: '完整的编码 agent。' })
  })

  it('treats an absent file as no metadata', async () => {
    // The common case: every preset authored by duplicating another starts
    // without one, and a picker simply falls back to the id.
    expect(await readPresetMetadata(await presetDir())).toEqual({})
  })

  it('treats malformed YAML as no metadata', async () => {
    const dir = await presetDir('name: [unclosed\n')

    // Display text is not worth failing discovery over — the composition
    // beside it still mounts.
    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it.each([
    ['a list', '- name: x\n'],
    ['a scalar', 'just a string\n'],
    ['an empty document', ''],
  ])('treats %s as no metadata', async (_label, content) => {
    expect(await readPresetMetadata(await presetDir(content))).toEqual({})
  })

  it('ignores fields that are not text', async () => {
    const dir = await presetDir('name: 42\ndescription:\n  nested: true\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('ignores blank text rather than showing an empty name', async () => {
    const dir = await presetDir('name: "   "\ndescription: ""\n')

    expect(await readPresetMetadata(dir)).toEqual({})
  })

  it('trims surrounding whitespace', async () => {
    const dir = await presetDir('name: "  极简模式  "\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '极简模式' })
  })

  it('reads a declared order', async () => {
    const dir = await presetDir('name: 标准模式\norder: 1\n')

    expect(await readPresetMetadata(dir)).toEqual({ name: '标准模式', order: 1 })
  })

  it('ignores an order that is not a finite number', async () => {
    expect(await readPresetMetadata(await presetDir('order: first\n'))).toEqual({})
    expect(await readPresetMetadata(await presetDir('order: .inf\n'))).toEqual({})
  })

  it('cannot carry identity or trust', async () => {
    const dir = await presetDir('name: mine\nid: standard\ntrust: system\n')

    // A locally authored preset writing `trust: system` must not become a
    // shipped one; identity comes from the directory and the root it sits in.
    expect(await readPresetMetadata(dir)).toEqual({ name: 'mine' })
  })

  it('reads the expert-card fields', async () => {
    const dir = await presetDir(
      'category: marketing\ntags: [GEO, "AI 搜索"]\nquickPrompts:\n  - 先诊断可见度\n  - 再出报价\nicon: 🔍\n',
    )

    expect(await readPresetMetadata(dir)).toEqual({
      category: 'marketing',
      tags: ['GEO', 'AI 搜索'],
      quickPrompts: ['先诊断可见度', '再出报价'],
      icon: '🔍',
    })
  })

  it('degrades wrongly-typed expert-card fields rather than failing the read', async () => {
    const dir = await presetDir('category: 7\ntags: GEO\nquickPrompts: [3, "  ", ok]\nicon: []\n')

    // A non-array tags stays unread, non-text entries drop out, and one
    // surviving prompt is still worth showing — display text never fails.
    expect(await readPresetMetadata(dir)).toEqual({ quickPrompts: ['ok'] })
  })

  it('caps the expert-card arrays at their display sizes', async () => {
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const dir = await presetDir(`tags: [${nine.map(tag => JSON.stringify(tag)).join(', ')}]\n`)

    expect((await readPresetMetadata(dir))?.tags).toHaveLength(8)
  })

  it('reads the card image, attribution line, and curator badge', async () => {
    const dir = await presetDir(
      'subtitle: 可见度实验室\nbadge: 特邀专家\navatar: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E"\n',
    )

    expect(await readPresetMetadata(dir)).toEqual({
      subtitle: '可见度实验室',
      badge: '特邀专家',
      avatar: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    })
  })

  it('drops an over-long card image rather than truncating it', async () => {
    // Half a data URI renders as a broken image, so the excess degrades to no
    // image — and the cap is what keeps one preset from bloating every roster
    // read.
    const dir = await presetDir(`avatar: "${'x'.repeat(AVATAR_CAP + 1)}"\n`)

    expect(await readPresetMetadata(dir)).toEqual({})
  })
})

describe('rendering display metadata', () => {
  it('round-trips through a read', async () => {
    const rendered = renderPresetMetadata({ name: '创造模式', description: '可以改自己的组装。' })
    const dir = await presetDir(rendered)

    expect(await readPresetMetadata(dir)).toEqual({ name: '创造模式', description: '可以改自己的组装。' })
  })

  it('round-trips the expert-card fields through a read', async () => {
    const metadata = {
      category: 'marketing',
      tags: ['GEO', 'AI 搜索'],
      quickPrompts: ['先诊断可见度', '再出报价'],
      icon: '🔍',
    }
    const dir = await presetDir(renderPresetMetadata(metadata))

    expect(await readPresetMetadata(dir)).toEqual(metadata)
  })

  it('round-trips the card image, attribution line, and badge', async () => {
    const metadata = {
      subtitle: '可见度实验室',
      badge: '特邀专家',
      avatar: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    }
    const dir = await presetDir(renderPresetMetadata(metadata))

    expect(await readPresetMetadata(dir)).toEqual(metadata)
  })

  it('stores a declared order', () => {
    expect(renderPresetMetadata({ name: '标准模式', order: 1 })).toBe('name: 标准模式\norder: 1\n')
  })

  it('omits an absent field rather than writing it blank', () => {
    expect(renderPresetMetadata({ name: '极简模式' })).toBe('name: 极简模式\n')
    // Description without a name is legal too: the picker falls back to the id.
    expect(renderPresetMetadata({ description: '只做检索。' })).toBe('description: 只做检索。\n')
  })

  it('renders nothing when there is nothing to store', () => {
    // Clearing both fields removes the file; an empty document would read as
    // an intentional blank name.
    expect(renderPresetMetadata({})).toBeUndefined()
    expect(renderPresetMetadata({ name: '  ', description: '' })).toBeUndefined()
  })
})
