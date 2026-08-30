/** Behavior checks for the local packaged-update rehearsal script. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  localUpdateBuildEnvironment,
  materializeLocalPublisherNames,
  parseByteRange,
  parseLocalUpdateArgs,
  readUpdateFeed,
  resolveFeedRequest,
} from '../scripts/test-local-update.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local desktop update rehearsal', () => {
  it('requires an increasing pair of semantic versions', () => {
    expect(parseLocalUpdateArgs(['--base-version', '1.2.3', '--update-version', '1.2.4'])).toEqual({
      baseVersion: '1.2.3',
      port: 43119,
      updateVersion: '1.2.4',
    })
    expect(parseLocalUpdateArgs([
      '--base-version', '1.2.3-beta.1',
      '--update-version', '1.2.3-beta.2',
      '--port', '44000',
    ])).toEqual({ baseVersion: '1.2.3-beta.1', port: 44000, updateVersion: '1.2.3-beta.2' })
    expect(() => parseLocalUpdateArgs(['--base-version', '1.2', '--update-version', '1.2.3']))
      .toThrow(/semantic version/)
    expect(() => parseLocalUpdateArgs(['--base-version', '1.2.4', '--update-version', '1.2.3']))
      .toThrow(/newer/)
    expect(() => parseLocalUpdateArgs([
      '--base-version', '1.2.3', '--update-version', '1.2.4', '--port', '70000',
    ])).toThrow(/port/)
  })

  it('creates an explicit loopback-only build environment', () => {
    expect(localUpdateBuildEnvironment('1.2.3', 'http://127.0.0.1:43119', 'C:/feed')).toMatchObject({
      DSH_DESKTOP_BUILD_VERSION: '1.2.3',
      DSH_DESKTOP_LOCAL_UPDATE_OUTPUT: 'C:/feed',
      DSH_DESKTOP_LOCAL_UPDATE_TEST: '1',
      DSH_DESKTOP_UPDATE_URL: 'http://127.0.0.1:43119',
    })
    expect(() => localUpdateBuildEnvironment('1.2.3', 'http://192.168.1.4:43119', 'C:/feed'))
      .toThrow(/loopback/)
  })

  it('parses the single byte ranges used by differential downloads', () => {
    expect(parseByteRange(undefined, 100)).toBeUndefined()
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ end: 19, start: 10 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ end: 99, start: 90 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ end: 99, start: 90 })
    expect(parseByteRange('bytes=100-101', 100)).toBeNull()
    expect(parseByteRange('bytes=0-1,4-5', 100)).toBeNull()
  })

  it('accepts a complete feed for the requested version', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-local-update-feed-'))
    roots.push(root)
    writeFileSync(join(root, 'Worker-1.2.4.exe'), 'installer')
    writeFileSync(join(root, 'Worker-1.2.4.exe.blockmap'), 'blockmap')
    writeFileSync(join(root, 'latest.yml'), [
      'version: 1.2.4',
      'files:',
      '  - url: Worker-1.2.4.exe',
      '    sha512: abc',
      'path: Worker-1.2.4.exe',
      'sha512: abc',
      '',
    ].join('\n'))

    expect(readUpdateFeed(root, '1.2.4')).toEqual({
      artifact: join(root, 'Worker-1.2.4.exe'),
      version: '1.2.4',
    })
    expect(() => readUpdateFeed(root, '1.2.5')).toThrow(/expected version 1\.2\.5/)
  })

  it('selects prerelease channel metadata by its recorded version', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-local-update-channel-'))
    roots.push(root)
    writeFileSync(join(root, 'Worker-1.2.4-beta.2.exe'), 'installer')
    writeFileSync(join(root, 'Worker-1.2.4-beta.2.exe.blockmap'), 'blockmap')
    writeFileSync(join(root, 'latest.yml'), 'version: 1.2.3\npath: stale.exe\n')
    writeFileSync(join(root, 'beta.yml'), [
      'version: 1.2.4-beta.2',
      'path: Worker-1.2.4-beta.2.exe',
      '',
    ].join('\n'))

    expect(readUpdateFeed(root, '1.2.4-beta.2')).toEqual({
      artifact: join(root, 'Worker-1.2.4-beta.2.exe'),
      version: '1.2.4-beta.2',
    })
  })

  it('rejects incomplete or escaping feed paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-local-update-invalid-'))
    roots.push(root)
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'latest.yml'), 'version: 1.2.4\npath: ../outside.exe\n')

    expect(() => readUpdateFeed(root, '1.2.4')).toThrow(/inside the feed directory/)
    expect(resolveFeedRequest(root, '/latest.yml')).toBe(join(root, 'latest.yml'))
    expect(resolveFeedRequest(root, '/../outside.exe')).toBeUndefined()
    expect(resolveFeedRequest(root, '/nested/')).toBeUndefined()
  })

  it('materializes the safe publisher name used by channel metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-local-update-publish-'))
    roots.push(root)
    writeFileSync(join(root, '深度Worker-1.2.4.exe'), 'installer')
    writeFileSync(join(root, '深度Worker-1.2.4.exe.blockmap'), 'blockmap')
    writeFileSync(join(root, 'latest.yml'), [
      'version: 1.2.4',
      'files:',
      '  - url: safe/desktop-setup-1.2.4.exe',
      '    sha512: abc',
      '    size: 9',
      'path: safe/desktop-setup-1.2.4.exe',
      'sha512: abc',
      '',
    ].join('\n'))

    materializeLocalPublisherNames(root, '1.2.4')

    expect(readUpdateFeed(root, '1.2.4')).toEqual({
      artifact: join(root, 'safe', 'desktop-setup-1.2.4.exe'),
      version: '1.2.4',
    })
  })
})
