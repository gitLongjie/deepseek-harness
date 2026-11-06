import { describe, expect, it } from 'vitest'
import { MAX_SLIDES } from '../src/limits.ts'
import { validateDocxArgs, validatePptxArgs, validateXlsxArgs } from '../src/validate.ts'

describe('office create validation', () => {
  it('accepts a minimal pptx payload and rejects wrong extensions', () => {
    expect(validatePptxArgs({
      path: 'deck.pptx',
      slides: [{ title: 'Hello', bullets: ['One'] }],
    })).toEqual({
      path: 'deck.pptx',
      overwrite: false,
      slides: [{ title: 'Hello', bullets: ['One'] }],
    })
    expect(() => validatePptxArgs({ path: 'deck.docx', slides: [{ title: 'Hello' }] })).toThrow(/\.pptx/)
    expect(() => validatePptxArgs({
      path: 'deck.pptx',
      slides: Array.from({ length: MAX_SLIDES + 1 }, (_, index) => ({ title: `S${String(index)}` })),
    })).toThrow(/at most/)
  })

  it('accepts docx blocks and xlsx sheets with overwrite', () => {
    expect(validateDocxArgs({
      path: 'note.docx',
      overwrite: true,
      blocks: [
        { type: 'heading', text: 'Title', level: 1 },
        { type: 'paragraph', text: 'Body' },
        { type: 'bullet_list', items: ['A', 'B'] },
      ],
    }).overwrite).toBe(true)
    expect(validateXlsxArgs({
      path: 'data.xlsx',
      sheets: [{ name: 'Sheet1', rows: [['a', 1, true, null]] }],
    }).sheets[0]?.name).toBe('Sheet1')
    expect(() => validateXlsxArgs({
      path: 'data.xlsx',
      sheets: [{ name: '', rows: [] }],
    })).toThrow(/name must be non-empty/)
  })
})
