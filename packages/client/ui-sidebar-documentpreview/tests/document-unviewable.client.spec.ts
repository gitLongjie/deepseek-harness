// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { unviewableBinaryPath } from '../src/client/document/unviewable.ts'

describe('unviewableBinaryPath', () => {
  it('matches one sample from every listed category', () => {
    for (const path of [
      'clip.mp4', 'song.mp3', 'bundle.zip', 'sheet.xls', 'deck.pptx', 'tool.exe',
      'face.woff2', 'image.dmg', 'design.psd',
    ]) expect(unviewableBinaryPath(path), path).toBe(true)
  })

  it('matches regardless of case, directories, and path separators', () => {
    expect(unviewableBinaryPath('MOVIE.MP4')).toBe(true)
    expect(unviewableBinaryPath('work/deep/archive.tar.gz')).toBe(true)
    expect(unviewableBinaryPath('work\\deep\\slides.pptx')).toBe(true)
  })

  it('leaves renderer-claimed, extractable, text, and unknown suffixes to their existing paths', () => {
    for (const path of [
      'main.ts', 'README.md', 'photo.png', 'page.html', 'paper.pdf', 'logo.svg',
      'server.log', 'config.env', 'notes.unknown', 'Makefile', 'mp4', 'private.key',
      'report.doc', 'report.docx', 'handbook.odt', 'work\\deep\\notes.docx',
    ]) expect(unviewableBinaryPath(path), path).toBe(false)
  })
})
