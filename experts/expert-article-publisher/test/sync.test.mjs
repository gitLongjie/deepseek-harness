/** Behavior tests for the expert mount plugin: node's built-in runner. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, syncExperts } from '../plugin.mjs'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'expert-article-'))
}

function writeTree(root) {
  mkdirSync(join(root, 'article-publisher', 'skills', 'geo-article-publish'), { recursive: true })
  writeFileSync(join(root, 'article-publisher', 'preset.yml'), 'name: 民大工作台文章专家\n')
  writeFileSync(join(root, 'article-publisher', 'agent.cordis.yml'), '- id: persona\n')
  writeFileSync(join(root, 'article-publisher', 'skills', 'geo-article-publish', 'SKILL.md'), '# publish\n')
}

test('syncs a nested expert tree into the target root', () => {
  const source = scratch()
  const target = scratch()
  writeTree(source)

  syncExperts(source, target)

  assert.equal(
    readFileSync(join(target, 'article-publisher', 'preset.yml'), 'utf8'),
    'name: 民大工作台文章专家\n',
  )
  assert.equal(
    readFileSync(join(target, 'article-publisher', 'skills', 'geo-article-publish', 'SKILL.md'), 'utf8'),
    '# publish\n',
  )
  rmSync(source, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

test('is idempotent: an unchanged rerun never rewrites file mtimes', () => {
  const source = scratch()
  const target = scratch()
  writeTree(source)

  syncExperts(source, target)
  const installed = join(target, 'article-publisher', 'preset.yml')
  const before = statSync(installed).mtimeMs
  syncExperts(source, target)
  const after = statSync(installed).mtimeMs

  assert.equal(before, after)
  rmSync(source, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

test('overwrites a target file whose content drifted', () => {
  const source = scratch()
  const target = scratch()
  writeTree(source)
  syncExperts(source, target)

  writeFileSync(join(source, 'article-publisher', 'preset.yml'), 'name: 民大工作台文章专家 v2\n')
  syncExperts(source, target)

  assert.equal(
    readFileSync(join(target, 'article-publisher', 'preset.yml'), 'utf8'),
    'name: 民大工作台文章专家 v2\n',
  )
  rmSync(source, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

test('never deletes a target file the source no longer carries', () => {
  const source = scratch()
  const target = scratch()
  writeTree(source)
  syncExperts(source, target)
  const userFile = join(target, 'article-publisher', 'my-notes.md')
  writeFileSync(userFile, 'user edits stay\n')

  rmSync(join(source, 'article-publisher', 'preset.yml'))
  syncExperts(source, target)

  assert.equal(readFileSync(userFile, 'utf8'), 'user edits stay\n')
  assert.ok(readdirSync(join(target, 'article-publisher')).includes('agent.cordis.yml'))
  rmSync(source, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

test('apply fails loud when the patch config carries no directories', () => {
  assert.throws(() => apply(undefined, {}), /`expertDir` and `targetDir`/)
  assert.throws(() => apply(undefined, { expertDir: '/tmp/x' }), /`expertDir` and `targetDir`/)
})