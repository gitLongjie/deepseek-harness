/**
 * Office Open XML text extraction for `read`: slide order, notes, worksheet cells,
 * and the failures that replace the binary-file rejection.
 */
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { FsError } from '@deepseek-ai/dsh-fs'
import { extractOfficeText, officeReadKind } from '../src/read-office.ts'

function officePackage(entries: Record<string, string>, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = { ...extra }
  for (const [name, text] of Object.entries(entries)) files[name] = strToU8(text)
  return zipSync(files)
}

function readOffice(kind: 'pptx' | 'docx' | 'xlsx', entries: Record<string, string>, extra?: Record<string, Uint8Array>): string {
  return extractOfficeText(kind, officePackage(entries, extra), `sample.${kind}`)
}

describe('officeReadKind', () => {
  it('recognizes Office extensions and leaves other paths as text', () => {
    expect(officeReadKind('E:\\deepseek-harness\\geo-deck\\GEO服务方案.pptx')).toBe('pptx')
    expect(officeReadKind('/tmp/deck.PPTX')).toBe('pptx')
    expect(officeReadKind('notes.docx')).toBe('docx')
    expect(officeReadKind('book.xlsx')).toBe('xlsx')
    expect(officeReadKind('notes.txt')).toBeUndefined()
    expect(officeReadKind('README')).toBeUndefined()
  })
})

describe('extractOfficeText', () => {
  it('returns slides in presentation order, with notes, breaks, and decoded text', () => {
    const text = readOffice('pptx', {
      'ppt/presentation.xml': '<p:sldIdLst>'
        + '<p:sldId r:id="rId2"/>'
        + '<p:sldId/>'
        + '<p:sldId r:id=""/>'
        + '<p:sldId r:id="missing"/>'
        + '<p:sldId r:id="rId1"/>'
        + '<p:sldId r:id="rId3"/>'
        + '</p:sldIdLst>',
      'ppt/_rels/presentation.xml.rels': [
        '<Relationship Target="orphan"/>',
        '<Relationship Id="rId8"/>',
        '<Relationship Id="" Target="empty"/>',
        '<Relationship Id="rId2" Target="./slides//slide2.xml"/>',
        '<Relationship Id="rId1" Target="/ppt/slides/slide1.xml"/>',
        '<Relationship Id="rId3" Target="slides/slide3.xml"/>',
      ].join(''),
      'ppt/slides/slide1.xml': '<a:p><a:t>First file</a:t></a:p>',
      'ppt/slides/_rels/slide1.xml.rels': '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pic.jpeg"/>',
      'ppt/slides/slide2.xml': '<a:p><a:t>A &amp; B &lt;C&gt; &quot;Q&quot; &apos;z&apos;</a:t><a:br/><a:t>next</a:t><a:tab/><a:t>tabbed</a:t></a:p><a:p></a:p>',
      'ppt/slides/_rels/slide2.xml.rels': [
        '<Relationship Id="rId9" Target="bare"/>',
        '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pic.jpeg"/>',
        '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target=""/>',
        '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>',
      ].join(''),
      'ppt/notesSlides/notesSlide1.xml': '<a:p><a:t>封面备注</a:t></a:p>',
      'ppt/slides/slide3.xml': '<a:p><a:t>Third</a:t></a:p>',
      'ppt/slides/_rels/slide3.xml.rels': '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide9.xml"/>',
    }, {
      'ppt/media/pic.jpeg': Uint8Array.from([0, 1, 2, 3]),
    })

    expect(text).toBe([
      'Slide 1',
      'A & B <C> "Q" \'z\'',
      'next\ttabbed',
      '',
      'Notes:',
      '封面备注',
      '',
      'Slide 2',
      'First file',
      '',
      'Slide 3',
      'Third',
    ].join('\n'))
  })

  it('falls back to numeric slide order when the presentation does not name slides', () => {
    const slides = {
      'ppt/slides/slide10.xml': '<a:p><a:t>Ten</a:t></a:p>',
      'ppt/slides/slide2.xml': '<a:p><a:t>Two</a:t></a:p>',
    }
    expect(readOffice('pptx', slides)).toBe('Slide 1\nTwo\n\nSlide 2\nTen')
    expect(readOffice('pptx', { 'ppt/presentation.xml': '<p:presentation/>', ...slides }))
      .toBe('Slide 1\nTwo\n\nSlide 2\nTen')
  })

  it('uses slide filenames when every slide id is unresolved', () => {
    const text = readOffice('pptx', {
      'ppt/presentation.xml': '<p:sldId r:id="missing"/>',
      'ppt/_rels/presentation.xml.rels': '<Relationship Id="rId1" Target="slides/slide1.xml"/>',
      'ppt/slides/slide1.xml': '<a:p><a:t>Only</a:t></a:p>',
    })
    expect(text).toBe('Slide 1\nOnly')
  })

  it('rejects a package with no slides, a missing slide part, or bytes that are not a zip', () => {
    expect(() => readOffice('pptx', { 'ppt/presentation.xml': '<p:presentation/>' }))
      .toThrow(FsError)
    expect(() => readOffice('pptx', {
      'ppt/presentation.xml': '<p:sldId r:id="rId1"/>',
      'ppt/_rels/presentation.xml.rels': '<Relationship Id="rId1" Target="slides/slide9.xml"/>',
    })).toThrow(/not a readable Office file/)
    expect(() => extractOfficeText('pptx', Uint8Array.from([0, 1, 2, 3]), 'bad.pptx'))
      .toThrow('cannot read "bad.pptx": not a readable Office file')
  })

  it('reads paragraphs from a document and rejects a docx without a document part', () => {
    expect(readOffice('docx', {
      'word/document.xml': '<w:p><w:t>Hello &amp; co</w:t><w:br/><w:t>line</w:t><w:tab/><w:t>cell</w:t></w:p><w:p></w:p>',
    })).toBe('Hello & co\nline\tcell')
    expect(readOffice('docx', { 'word/document.xml': '<w:document/>' })).toBe('')
    expect(() => readOffice('docx', {})).toThrow(/not a readable Office file/)
  })

  it('reads named sheets, shared strings, and cell kinds in row-major order', () => {
    const text = readOffice('xlsx', {
      'xl/workbook.xml': [
        '<sheet/>',
        '<sheet name=""/>',
        '<sheet name="Skipped" r:id="missing"/>',
        '<sheet name="Q&amp;A" r:id="rId2"/>',
        '<sheet name="Empty" r:id="rId1"/>',
      ].join(''),
      'xl/_rels/workbook.xml.rels': [
        '<Relationship Target="orphan"/>',
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId2" Target="../xl/worksheets/sheet2.xml"/>',
      ].join(''),
      'xl/sharedStrings.xml': '<si><t>Hello</t></si><si><r><t>Rich </t></r><r><t>&amp;</t></r></si>',
      'xl/worksheets/sheet1.xml': '<sheetData><c r="A1"/></sheetData>',
      'xl/worksheets/sheet2.xml': [
        '<c t="inlineStr"><is></is></c>',
        '<c r="B2" t="s"><v>1</v></c>',
        '<c r="A2" t="s"><v>0</v></c>',
        '<c r="A1" t="inlineStr"><is><t>Title</t></is></c>',
        '<c t="inlineStr"><is><t>Orphan</t></is></c>',
        '<c r="C2" t="s"><v>9</v></c>',
        '<c r="D2" t="s"><v>nope</v></c>',
        '<c r="E2" t="s"><v>-1</v></c>',
        '<c r="A3" t="b"><v>1</v></c>',
        '<c r="B3" t="b"><v>0</v></c>',
        '<c r="C3" t="b"><v>2</v></c>',
        '<c r="D3"><v>3 &amp; 4</v></c>',
        '<c r="E3" t="str"/>',
        '<c r="AA3"><v>wide</v></c>',
      ].join(''),
    })
    expect(text).toBe([
      'Sheet: Q&A',
      'Title',
      'Hello\tRich &',
      'TRUE\tFALSE\t3 & 4\twide',
      'Orphan',
      '',
      'Sheet: Empty',
    ].join('\n'))
  })

  it('numbers unnamed sheets when the workbook does not resolve one', () => {
    expect(readOffice('xlsx', {
      'xl/workbook.xml': '<sheet/>',
      'xl/_rels/workbook.xml.rels': '<Relationship Id="rId1" Target="worksheets/sheet2.xml"/>',
      'xl/worksheets/sheet10.xml': '<c r="A1"><v>10</v></c>',
      'xl/worksheets/sheet2.xml': '<c r="A1"><v>2</v></c>',
    })).toBe('Sheet: Sheet 1\n2\n\nSheet: Sheet 2\n10')
    expect(readOffice('xlsx', {
      'xl/workbook.xml': '<workbook/>',
      'xl/worksheets/sheet1.xml': '<c r="A1"><v>1</v></c>',
    })).toBe('Sheet: Sheet 1\n1')
    expect(() => readOffice('xlsx', { 'xl/workbook.xml': '<sheet name="Gone" r:id="rId1"/>', 'xl/_rels/workbook.xml.rels': '<Relationship Id="rId1" Target="worksheets/sheet9.xml"/>' }))
      .toThrow(/not a readable Office file/)
    expect(() => readOffice('xlsx', {})).toThrow(/not a readable Office file/)
  })
})
