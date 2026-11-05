/** Durable authoring revisions and concurrent editor protection. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { StudioStore, studioId } from '../src/studio-store.ts'
import type { StudioContent } from '../src/studio-types.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-store-'))
  roots.push(root)
  return { root, store: new StudioStore(root, 4096) }
}
function content(title = 'First scene'): StudioContent {
  return { title, source: 'Original story', blocks: [{ id: studioId(randomUUID()), kind: 'scene', text: 'INT. ROOM — DAY' }] }
}

it('reopens saved works through a fresh store and preserves prior revisions', async () => {
  const { root, store } = await setup()
  const first = await store.create(content())
  const second = await store.save(first.id, first.revision, { ...first, title: 'Revised' } as StudioContent).catch(() => null)
  // Full persisted documents are deliberately not admitted as content.
  expect(second).toBeNull()
  await store.save(first.id, 1, { title: 'Revised', source: first.source, blocks: first.blocks })
  expect(await new StudioStore(root, 4096).read(first.id)).toMatchObject({ title: 'Revised', revision: 2 })
  expect(JSON.parse(await readFile(join(root, 'studio', first.id, '1.json'), 'utf8'))).toEqual(first)
  expect((await store.list()).works).toMatchObject([{ title: 'Revised', revision: 2 }])
})

it('allows only one of two independent writers to publish a revision', async () => {
  const { root, store } = await setup()
  const first = await store.create(content())
  const results = await Promise.allSettled([
    store.save(first.id, 1, content('Writer A')),
    new StudioStore(root, 4096).save(first.id, 1, content('Writer B')),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } })
  await expect(store.save(first.id, 1, content('Stale'))).rejects.toMatchObject({ code: 'conflict' })
  expect((await store.read(first.id)).revision).toBe(2)
})

it('refuses corrupt latest data without replacing it or hiding other works', async () => {
  const { root, store } = await setup()
  const first = await store.create(content())
  const healthy = await store.create(content('Healthy'))
  await writeFile(join(root, 'studio', first.id, '2.json'), '{broken')
  await expect(store.read(first.id)).rejects.toMatchObject({ code: 'corrupt' })
  await expect(store.save(first.id, 1, content())).rejects.toMatchObject({ code: 'corrupt' })
  expect(await store.list()).toMatchObject({ works: [{ id: healthy.id }], errors: [{ id: first.id, code: 'corrupt' }] })
})

it('rejects invalid ids, duplicate blocks and oversized edits without changing saved text', async () => {
  const { store } = await setup()
  expect(() => studioId('../outside')).toThrow()
  await expect(store.read(studioId(randomUUID()))).rejects.toMatchObject({ code: 'missing' })
  const draft = content()
  await expect(store.create({ ...draft, blocks: [...draft.blocks, ...draft.blocks] })).rejects.toMatchObject({ code: 'invalid' })
  const first = await store.create(draft)
  await expect(store.save(first.id, 1, { ...draft, source: 'x'.repeat(4096) })).rejects.toMatchObject({ code: 'invalid' })
  expect(await store.read(first.id)).toEqual(first)
})


it('round trips production collections and rejects malformed data instead of erasing it', async () => {
  const { store, root } = await setup()
  const node = studioId(randomUUID())
  const other = studioId(randomUUID())
  const draft: StudioContent = { ...content(),
    canvas: [{ id: studioId(randomUUID()), title: 'Shot', text: 'Opening', kind: 'scene', x: 20, y: 40, source: 'keyframes/opening.png' }],
    graph: { nodes: [{ id: node, kind: 'character', label: 'Mei' }, { id: other, kind: 'character', label: 'Lin' }],
      edges: [{ id: studioId(randomUUID()), from: node, to: other, label: 'Siblings' }] },
    director: [{ id: studioId(randomUUID()), name: 'Home', camera: 'Wide', objects: [{ id: node, label: 'Mei', x: 1, y: 2, z: 3 }] }],
    edit: { tracks: [{ id: studioId(randomUUID()), name: 'Video', kind: 'video',
      clips: [{ id: node, name: 'Opening', start: 0, duration: 5 }] }] },
  }
  const first = await store.create(draft)
  expect(await new StudioStore(root, 4096).read(first.id)).toEqual(first)
  await expect(store.create({ ...draft, canvas: null } as never)).rejects.toMatchObject({ code: 'invalid' })
  await expect(store.create({ ...draft, graph: { ...draft.graph, nodes: [] } } as never)).rejects.toMatchObject({ code: 'invalid' })
  await expect(store.create({ ...draft, director: [{ ...draft.director![0], objects: 'invalid' }] } as never))
    .rejects.toMatchObject({ code: 'invalid' })
  await expect(store.create({ ...draft, edit: { tracks: [{ ...draft.edit!.tracks[0], clips: [{ id: node, name: 'Bad', start: -1, duration: 5 }] }] } } as never))
    .rejects.toMatchObject({ code: 'invalid' })
  expect(await store.read(first.id)).toEqual(first)
})
