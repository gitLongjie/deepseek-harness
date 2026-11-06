/**
 * Download the pinned dashi-ppt skill into a Desktop runtime's bundled-skills directory.
 * The archive is AGPL-3.0; its LICENSE is copied next to SKILL.md.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

/** Commit of https://github.com/chuspeeism/dashi-ppt-skill included in Desktop. */
export const DASHI_PPT_COMMIT = 'd2b75389ca056a3a8fb5b997b79a098acce0c189'

/**
 * Install `dashi-ppt` under `runtime/bundled-skills` when this commit is not already present.
 * @param {string} runtimeDir - Desktop `runtime` directory that also holds `primary-runtime`.
 * @param {string} cacheDir - Directory for the downloaded archive.
 * @returns {Promise<string>} Absolute skill directory.
 */
export async function prepareDashiPptSkill(runtimeDir, cacheDir) {
  const destination = join(runtimeDir, 'bundled-skills', 'dashi-ppt')
  const marker = join(destination, '.source-commit')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === DASHI_PPT_COMMIT && existsSync(join(destination, 'SKILL.md'))) {
    return destination
  }
  mkdirSync(cacheDir, { recursive: true })
  const archive = join(cacheDir, `dashi-ppt-skill-${DASHI_PPT_COMMIT}.tar.gz`)
  if (!existsSync(archive)) {
    const response = await fetch(`https://codeload.github.com/chuspeeism/dashi-ppt-skill/tar.gz/${DASHI_PPT_COMMIT}`)
    if (!response.ok || response.body === null) throw new Error(`dashi-ppt: download failed with ${String(response.status)}`)
    await pipeline(response.body, createWriteStream(archive))
  }
  const staging = await mkdtemp(join(tmpdir(), 'dashi-ppt-'))
  try {
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'inherit' })
    if (extracted.status !== 0) throw new Error('dashi-ppt: tar extraction failed')
    const root = join(staging, `dashi-ppt-skill-${DASHI_PPT_COMMIT}`)
    const source = join(root, 'skills', 'dashi-ppt')
    if (!existsSync(join(source, 'SKILL.md'))) throw new Error(`dashi-ppt: SKILL.md missing in ${source}`)
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true, dereference: true })
    await cp(join(root, 'LICENSE'), join(destination, 'LICENSE'))
    writeFileSync(marker, `${DASHI_PPT_COMMIT}\n`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return destination
}
