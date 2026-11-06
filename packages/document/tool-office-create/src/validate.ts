/** Argument checks the tool schema cannot express alone. */

import {
  MAX_BULLET_ITEMS,
  MAX_BULLETS_PER_SLIDE,
  MAX_COLS,
  MAX_DOCX_BLOCKS,
  MAX_ROWS,
  MAX_SHEETS,
  MAX_SLIDES,
  MAX_TEXT_CHARS,
} from './limits.ts'

/** Supported create formats. */
export type OfficeCreateKind = 'pptx' | 'docx' | 'xlsx'

/** One PowerPoint slide in a create_pptx call. */
export interface PptxSlideInput {
  readonly title: string
  readonly bullets?: readonly string[]
  readonly notes?: string
}

/** One Word block in a create_docx call. */
export interface DocxBlockInput {
  readonly type: 'heading' | 'paragraph' | 'bullet_list'
  readonly text?: string
  readonly level?: number
  readonly items?: readonly string[]
}

/** One worksheet in a create_xlsx call. */
export interface XlsxSheetInput {
  readonly name: string
  readonly rows?: readonly (readonly (string | number | boolean | null)[])[]
}

function requireNonEmptyPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) throw new Error('path must be a non-empty string')
  return trimmed
}

function requireExtension(path: string, extension: `.${OfficeCreateKind}`): void {
  if (!path.toLowerCase().endsWith(extension)) {
    throw new Error(`path must end with ${extension}`)
  }
}

function requireText(label: string, value: string): string {
  if (value.length > MAX_TEXT_CHARS) throw new Error(`${label} exceeds ${String(MAX_TEXT_CHARS)} characters`)
  return value
}

/**
 * Validate create_pptx arguments after schema parsing.
 * @param args - Tool arguments.
 * @returns Normalized path, overwrite flag, and slides payload for the generator.
 */
export function validatePptxArgs(args: {
  path: string
  overwrite?: boolean
  slides: readonly PptxSlideInput[]
}): { path: string; overwrite: boolean; slides: PptxSlideInput[] } {
  const path = requireNonEmptyPath(args.path)
  requireExtension(path, '.pptx')
  if (args.slides.length === 0) throw new Error('create_pptx requires at least one slide')
  if (args.slides.length > MAX_SLIDES) throw new Error(`create_pptx accepts at most ${String(MAX_SLIDES)} slides`)
  const slides = args.slides.map((slide, index) => {
    const title = requireText(`slides[${String(index)}].title`, slide.title)
    if (title.trim().length === 0) throw new Error(`slides[${String(index)}].title must be non-empty`)
    const bullets = slide.bullets ?? []
    if (bullets.length > MAX_BULLETS_PER_SLIDE) {
      throw new Error(`slides[${String(index)}] accepts at most ${String(MAX_BULLETS_PER_SLIDE)} bullets`)
    }
    for (const [bulletIndex, bullet] of bullets.entries()) {
      requireText(`slides[${String(index)}].bullets[${String(bulletIndex)}]`, bullet)
    }
    const notes = slide.notes === undefined ? undefined : requireText(`slides[${String(index)}].notes`, slide.notes)
    return { title, bullets: [...bullets], ...(notes === undefined ? {} : { notes }) }
  })
  return { path, overwrite: args.overwrite === true, slides }
}

/**
 * Validate create_docx arguments after schema parsing.
 * @param args - Tool arguments.
 * @returns Normalized path, overwrite flag, and blocks payload for the generator.
 */
export function validateDocxArgs(args: {
  path: string
  overwrite?: boolean
  blocks: readonly DocxBlockInput[]
}): { path: string; overwrite: boolean; blocks: DocxBlockInput[] } {
  const path = requireNonEmptyPath(args.path)
  requireExtension(path, '.docx')
  if (args.blocks.length === 0) throw new Error('create_docx requires at least one block')
  if (args.blocks.length > MAX_DOCX_BLOCKS) throw new Error(`create_docx accepts at most ${String(MAX_DOCX_BLOCKS)} blocks`)
  const blocks = args.blocks.map((block, index) => {
    if (block.type === 'bullet_list') {
      const items = block.items ?? []
      if (items.length === 0) throw new Error(`blocks[${String(index)}].items must be non-empty for bullet_list`)
      if (items.length > MAX_BULLET_ITEMS) {
        throw new Error(`blocks[${String(index)}] accepts at most ${String(MAX_BULLET_ITEMS)} items`)
      }
      for (const [itemIndex, item] of items.entries()) {
        requireText(`blocks[${String(index)}].items[${String(itemIndex)}]`, item)
      }
      return { type: 'bullet_list' as const, items: [...items] }
    }
    const text = requireText(`blocks[${String(index)}].text`, block.text ?? '')
    if (block.type === 'heading') {
      const level = block.level ?? 1
      if (!Number.isSafeInteger(level) || level < 1 || level > 9) {
        throw new Error(`blocks[${String(index)}].level must be an integer from 1 to 9`)
      }
      return { type: 'heading' as const, text, level }
    }
    return { type: 'paragraph' as const, text }
  })
  return { path, overwrite: args.overwrite === true, blocks }
}

/**
 * Validate create_xlsx arguments after schema parsing.
 * @param args - Tool arguments.
 * @returns Normalized path, overwrite flag, and sheets payload for the generator.
 */
export function validateXlsxArgs(args: {
  path: string
  overwrite?: boolean
  sheets: readonly XlsxSheetInput[]
}): { path: string; overwrite: boolean; sheets: XlsxSheetInput[] } {
  const path = requireNonEmptyPath(args.path)
  requireExtension(path, '.xlsx')
  if (args.sheets.length === 0) throw new Error('create_xlsx requires at least one sheet')
  if (args.sheets.length > MAX_SHEETS) throw new Error(`create_xlsx accepts at most ${String(MAX_SHEETS)} sheets`)
  const sheets = args.sheets.map((sheet, index) => {
    const name = sheet.name.trim()
    if (name.length === 0) throw new Error(`sheets[${String(index)}].name must be non-empty`)
    if (name.length > 31) throw new Error(`sheets[${String(index)}].name exceeds 31 characters`)
    const rows = sheet.rows ?? []
    if (rows.length > MAX_ROWS) throw new Error(`sheets[${String(index)}] accepts at most ${String(MAX_ROWS)} rows`)
    for (const [rowIndex, row] of rows.entries()) {
      if (row.length > MAX_COLS) {
        throw new Error(`sheets[${String(index)}].rows[${String(rowIndex)}] accepts at most ${String(MAX_COLS)} columns`)
      }
      for (const [columnIndex, value] of row.entries()) {
        if (typeof value === 'string') {
          requireText(`sheets[${String(index)}].rows[${String(rowIndex)}][${String(columnIndex)}]`, value)
        }
      }
    }
    return { name, rows: rows.map(row => [...row]) }
  })
  return { path, overwrite: args.overwrite === true, sheets }
}
