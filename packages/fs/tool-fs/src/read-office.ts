/**
 * Text extraction for Office Open XML packages so `read` can return slide,
 * paragraph, and cell text instead of rejecting the zip as binary.
 * @module @deepseek-ai/dsh-tool-fs/read-office
 */

import { extname } from 'node:path'
import { strFromU8, unzipSync, type Unzipped } from 'fflate'
import { FsError } from '@deepseek-ai/dsh-fs'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Office Open XML kind `read` can turn into text. */
export type OfficeReadKind = 'pptx' | 'docx' | 'xlsx'

/**
 * Inclusive byte cap for one Office package read. Same source cap as Office-to-PDF.
 */
export const OFFICE_READ_MAX_BYTES = 50 * 1024 * 1024

const KIND_BY_EXTENSION: Readonly<Record<string, OfficeReadKind>> = {
  '.pptx': 'pptx',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
}

/** Package parts that carry readable text. Media and theme parts stay compressed. */
const OFFICE_PART = new RegExp(`^(?:${[
  'ppt/presentation\\.xml',
  'ppt/_rels/presentation\\.xml\\.rels',
  'ppt/slides/slide\\d+\\.xml',
  'ppt/slides/_rels/slide\\d+\\.xml\\.rels',
  'ppt/notesSlides/notesSlide\\d+\\.xml',
  'word/document\\.xml',
  'xl/sharedStrings\\.xml',
  'xl/workbook\\.xml',
  'xl/_rels/workbook\\.xml\\.rels',
  'xl/worksheets/sheet\\d+\\.xml',
].join('|')})$`, 'u')

/**
 * Classify a resolved path as an Office Open XML package `read` can extract.
 * @param path - display path, including its extension.
 * @returns the package kind, or `undefined` when `read` should decode the file as UTF-8 text.
 */
export function officeReadKind(path: string): OfficeReadKind | undefined {
  return KIND_BY_EXTENSION[extname(path).toLowerCase()]
}

/**
 * Extract readable text from an Office Open XML package.
 * @param kind - package kind selected from the file extension.
 * @param bytes - complete package bytes.
 * @param displayPath - path named in read errors.
 * @returns slide, paragraph, or cell text. Slides and sheets keep a heading line.
 * @throws FsError `FS_NOT_TEXT` when the bytes are not a readable package of `kind`.
 */
export function extractOfficeText(kind: OfficeReadKind, bytes: Uint8Array, displayPath: string): string {
  const entries = unzipOffice(bytes, displayPath)
  switch (kind) {
    case 'pptx': return pptxText(entries, displayPath)
    case 'docx': return docxText(entries, displayPath)
    case 'xlsx': return xlsxText(entries, displayPath)
    /* v8 ignore next -- Closed Office package union; assertNever checks exhaustiveness at compile time. */
    default: return assertNever(kind)
  }
}

function unzipOffice(bytes: Uint8Array, displayPath: string): Unzipped {
  try {
    return unzipSync(bytes, { filter: file => OFFICE_PART.test(file.name) })
  } catch (error: unknown) {
    throw new FsError(`cannot read "${displayPath}": not a readable Office file`, 'FS_NOT_TEXT', { cause: error })
  }
}

function notReadable(displayPath: string): FsError {
  return new FsError(`cannot read "${displayPath}": not a readable Office file`, 'FS_NOT_TEXT')
}

function entryText(entries: Unzipped, path: string): string | undefined {
  const bytes = entries[path]
  return bytes === undefined ? undefined : strFromU8(bytes)
}

function group(match: RegExpMatchArray, index: number): string {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the caller indexes a capture that the pattern always includes
  return match[index]!
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function zipBaseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function zipParent(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0))
}

/** Resolve a relationship target against its part directory. Targets may be absolute or contain `.` and `..`. */
function resolveZipPath(baseDir: string, target: string): string {
  const decoded = decodeXml(target)
  const raw = decoded.startsWith('/') ? decoded : `${baseDir}/${decoded}`
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function relationships(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of xml.matchAll(/<Relationship\b([^>]*)>/gu)) {
    const attrs = group(match, 1)
    const id = /\bId="([^"]*)"/u.exec(attrs)?.[1]
    const target = /\bTarget="([^"]*)"/u.exec(attrs)?.[1]
    if (id && target) map.set(id, target)
  }
  return map
}

function relationshipTargetEnding(xml: string, suffix: string): string | undefined {
  for (const match of xml.matchAll(/<Relationship\b([^>]*)>/gu)) {
    const attrs = group(match, 1)
    const type = /\bType="([^"]*)"/u.exec(attrs)?.[1]
    const target = /\bTarget="([^"]*)"/u.exec(attrs)?.[1]
    if (type?.endsWith(suffix) && target) return target
  }
  return undefined
}

function markedParagraphs(xml: string, endTag: string, textTag: string, tabTag: string, breakTag: string): string[] {
  const pattern = new RegExp(`<${breakTag}\\s*/>|<${tabTag}\\s*/>|<${textTag}\\b[^>]*>([^<]*)</${textTag}>`, 'gu')
  const lines: string[] = []
  for (const part of xml.split(endTag)) {
    let text = ''
    for (const match of part.matchAll(pattern)) {
      const token = match[0]
      if (token.startsWith(`<${breakTag}`)) text += '\n'
      else if (token.startsWith(`<${tabTag}`)) text += '\t'
      else text += decodeXml(group(match, 1))
    }
    if (text.length === 0) continue
    lines.push(...text.split('\n'))
  }
  return lines
}

function numberedParts(entries: Unzipped, pattern: RegExp): { path: string; number: number }[] {
  const found: { path: string; number: number }[] = []
  for (const path of Object.keys(entries)) {
    const digits = pattern.exec(path)?.[1]
    if (digits === undefined) continue
    found.push({ path, number: Number(digits) })
  }
  return found.sort((left, right) => left.number - right.number)
}

function slidePaths(entries: Unzipped): string[] {
  const presentation = entryText(entries, 'ppt/presentation.xml')
  const rels = entryText(entries, 'ppt/_rels/presentation.xml.rels')
  if (presentation !== undefined && rels !== undefined) {
    const map = relationships(rels)
    const paths: string[] = []
    for (const match of presentation.matchAll(/<p:sldId\b([^>]*)>/gu)) {
      const id = /\br:id="([^"]*)"/u.exec(group(match, 1))?.[1]
      const target = id === undefined || id.length === 0 ? undefined : map.get(id)
      if (target !== undefined) paths.push(resolveZipPath('ppt', target))
    }
    if (paths.length > 0) return paths
  }
  return numberedParts(entries, /^ppt\/slides\/slide(\d+)\.xml$/u).map(part => part.path)
}

function notesLines(entries: Unzipped, slidePath: string): string[] {
  const rels = entryText(entries, `${zipParent(slidePath)}/_rels/${zipBaseName(slidePath)}.rels`)
  if (rels === undefined) return []
  const target = relationshipTargetEnding(rels, '/notesSlide')
  if (target === undefined) return []
  const notes = entryText(entries, resolveZipPath(zipParent(slidePath), target))
  if (notes === undefined) return []
  return markedParagraphs(notes, '</a:p>', 'a:t', 'a:tab', 'a:br')
}

function pptxText(entries: Unzipped, displayPath: string): string {
  const slides = slidePaths(entries)
  if (slides.length === 0) throw notReadable(displayPath)
  return slides.map((path, index) => {
    const xml = entryText(entries, path)
    if (xml === undefined) throw notReadable(displayPath)
    const lines = [
      `Slide ${index + 1}`,
      ...markedParagraphs(xml, '</a:p>', 'a:t', 'a:tab', 'a:br'),
    ]
    const notes = notesLines(entries, path)
    if (notes.length > 0) lines.push('', 'Notes:', ...notes)
    return lines.join('\n')
  }).join('\n\n')
}

function docxText(entries: Unzipped, displayPath: string): string {
  const xml = entryText(entries, 'word/document.xml')
  if (xml === undefined) throw notReadable(displayPath)
  return markedParagraphs(xml, '</w:p>', 'w:t', 'w:tab', 'w:br').join('\n')
}

function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map(item =>
    [...group(item, 1).matchAll(/<t\b[^>]*>([^<]*)<\/t>/gu)].map(text => decodeXml(group(text, 1))).join(''))
}

function columnIndex(letters: string): number {
  let index = 0
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64
  return index
}

function cellText(
  type: string | undefined,
  value: string | undefined,
  inline: string | undefined,
  shared: readonly string[],
): string {
  if (type === 'inlineStr') return decodeXml(inline ?? '')
  if (type === 's') {
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 ? shared[index] ?? '' : ''
  }
  if (type === 'b') {
    if (value === '1') return 'TRUE'
    if (value === '0') return 'FALSE'
    return ''
  }
  if (value === undefined) return ''
  return decodeXml(value)
}

function worksheetLines(xml: string, shared: readonly string[]): string[] {
  const rows = new Map<number, { col: number; text: string }[]>()
  let fallback = 0
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
    const attrs = group(match, 1)
    const body = match[2] === undefined ? '' : match[2]
    const ref = /\br="([A-Z]+)(\d+)"/u.exec(attrs)
    const type = /\bt="([^"]*)"/u.exec(attrs)?.[1]
    const inline = /<t\b[^>]*>([^<]*)<\/t>/u.exec(body)?.[1]
    const value = /<v\b[^>]*>([^<]*)<\/v>/u.exec(body)?.[1]
    const text = cellText(type, value, inline, shared)
    if (text.length === 0) continue
    fallback += 1
    const row = ref ? Number(ref[2]) : fallback
    const col = ref ? columnIndex(group(ref, 1)) : fallback
    const cells = rows.get(row)
    if (cells === undefined) rows.set(row, [{ col, text }])
    else cells.push({ col, text })
  }
  return [...rows.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, cells]) => cells.sort((left, right) => left.col - right.col).map(cell => cell.text).join('\t'))
}

function sheetEntries(entries: Unzipped): { name: string; path: string }[] {
  const workbook = entryText(entries, 'xl/workbook.xml')
  const rels = entryText(entries, 'xl/_rels/workbook.xml.rels')
  if (workbook !== undefined && rels !== undefined) {
    const map = relationships(rels)
    const sheets: { name: string; path: string }[] = []
    for (const match of workbook.matchAll(/<sheet\b([^>]*)>/gu)) {
      const attrs = group(match, 1)
      const name = /\bname="([^"]*)"/u.exec(attrs)?.[1]
      const id = /\br:id="([^"]*)"/u.exec(attrs)?.[1]
      const target = id === undefined || id.length === 0 ? undefined : map.get(id)
      if (name === undefined || name.length === 0 || target === undefined) continue
      sheets.push({ name: decodeXml(name), path: resolveZipPath('xl', target) })
    }
    if (sheets.length > 0) return sheets
  }
  return numberedParts(entries, /^xl\/worksheets\/sheet(\d+)\.xml$/u)
    .map((part, index) => ({ name: `Sheet ${index + 1}`, path: part.path }))
}

function xlsxText(entries: Unzipped, displayPath: string): string {
  const sheets = sheetEntries(entries)
  if (sheets.length === 0) throw notReadable(displayPath)
  const shared = sharedStrings(entryText(entries, 'xl/sharedStrings.xml'))
  return sheets.map((sheet) => {
    const xml = entryText(entries, sheet.path)
    if (xml === undefined) throw notReadable(displayPath)
    return [`Sheet: ${sheet.name}`, ...worksheetLines(xml, shared)].join('\n')
  }).join('\n\n')
}
