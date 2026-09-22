/**
 * Office-document text extraction: the per-platform converter resolve, the
 * strict UTF-8 decode of the converter's output, the conversion cache keyed by
 * the file's version, and the `read` endpoint's routing and wire failures.
 *
 * Every converter runs through a stub, so the tests hold on hosts without any
 * real converter installed; the default internals get their own unit coverage
 * for the PATH scan and the byte-capturing runner.
 */
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, extname, join } from 'node:path'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commandExtensionsOf, convertDocumentText, defaultDocumentTextInternals, documentTextSuffixOf,
  pathEntriesOf, resolveDocumentConverter, utf8DocumentText,
  type DocumentTextConfig, type DocumentTextInternals,
} from '../src/document-text.ts'
import { WorkspaceFiles, type Config } from '../src/index.ts'
import { failureOf, openWorkspace, signal } from './harness.ts'

const CONVERTED = 'first line\nsecond line\nthird line'

function documentTextConfig(overrides: Partial<DocumentTextConfig> = {}): DocumentTextConfig {
  return {
    enabled: true,
    textutilPath: 'textutil',
    sofficePath: 'soffice',
    pandocPath: 'pandoc',
    catdocPath: 'catdoc',
    ...overrides,
  }
}

function config(overrides: Partial<DocumentTextConfig> = {}): Config {
  return {
    maxBytes: 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxLines: 5000,
    maxEntries: 2000,
    documentText: documentTextConfig(overrides),
  }
}

interface Call {
  readonly command: string
  readonly args: readonly string[]
}

/** Stub internals resolving `command` on every platform and answering with `output`.
 *
 * soffice-style runs write the outfile LibreOffice would write — `<stem>.txt`
 * into the argv's `--outdir` — and answer without stdout, like the real child. */
function stubInternals(output: Buffer | string, platform = 'linux', available = true): {
  internals: DocumentTextInternals
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    internals: {
      platform: () => platform,
      commandAvailable: () => available,
      run: async (command, args, runSignal) => {
        if (runSignal.aborted) throw new Error('aborted before spawn')
        calls.push({ command, args })
        const outdir = args.indexOf('--outdir') === -1 ? undefined : args[args.indexOf('--outdir') + 1]!
        if (outdir === undefined) return Buffer.from(output)
        const input = args[args.length - 1]!
        const stem = basename(input, extname(input))
        await writeFile(join(outdir, `${stem}.txt`), output)
        return Buffer.from('')
      },
    },
  }
}

describe('documentTextSuffixOf', () => {
  it('names the covered suffix case-insensitively and refuses uncovered ones', () => {
    expect(documentTextSuffixOf(join('w', 'report.docx'))).toBe('docx')
    expect(documentTextSuffixOf(join('w', 'REPORT.DOC'))).toBe('doc')
    expect(documentTextSuffixOf(join('w', 'handbook.Odt'))).toBe('odt')
    expect(documentTextSuffixOf(join('w', 'notes.txt'))).toBeUndefined()
    expect(documentTextSuffixOf(join('w', 'archive.docx.zip'))).toBeUndefined()
    expect(documentTextSuffixOf(join('w', 'no-extension'))).toBeUndefined()
  })
})

describe('resolveDocumentConverter', () => {
  it('names textutil for every covered suffix on macOS', () => {
    const { internals } = stubInternals('', 'darwin')
    for (const suffix of ['doc', 'docx', 'odt']) {
      expect(resolveDocumentConverter(join('w', `f.${suffix}`), documentTextConfig(), internals))
        .toEqual({ style: 'textutil', command: 'textutil' })
    }
  })

  it('prefers soffice off macOS and falls through its per-suffix backups', () => {
    const available: DocumentTextInternals = {
      ...stubInternals('').internals,
      platform: () => 'linux',
      commandAvailable: command => command === 'soffice' || command === 'catdoc',
    }
    expect(resolveDocumentConverter(join('w', 'f.docx'), documentTextConfig(), available))
      .toEqual({ style: 'soffice', command: 'soffice' })
    expect(resolveDocumentConverter(join('w', 'f.doc'), documentTextConfig(), available))
      .toEqual({ style: 'soffice', command: 'soffice' })

    const withoutOffice: DocumentTextInternals = {
      ...stubInternals('').internals,
      platform: () => 'linux',
      commandAvailable: command => command === 'catdoc' || command === 'pandoc',
    }
    expect(resolveDocumentConverter(join('w', 'f.doc'), documentTextConfig(), withoutOffice))
      .toEqual({ style: 'catdoc', command: 'catdoc' })
    expect(resolveDocumentConverter(join('w', 'f.docx'), documentTextConfig(), withoutOffice))
      .toEqual({ style: 'pandoc', command: 'pandoc' })
  })

  it('returns undefined when no candidate resolves or the suffix is uncovered', () => {
    const { internals } = stubInternals('', 'linux', false)
    expect(resolveDocumentConverter(join('w', 'f.docx'), documentTextConfig(), internals)).toBeUndefined()
    expect(resolveDocumentConverter(join('w', 'f.pptx'), documentTextConfig(), {
      ...internals,
      commandAvailable: () => true,
    })).toBeUndefined()
  })

  it('names each configured command, not the style default', () => {
    const { internals } = stubInternals('', 'darwin')
    expect(resolveDocumentConverter(join('w', 'f.docx'), documentTextConfig({ textutilPath: '/opt/textutil' }), internals))
      .toEqual({ style: 'textutil', command: '/opt/textutil' })
  })
})

describe('convertDocumentText', () => {
  it('spawns textutil with an explicit UTF-8 encoding and stdout capture', async () => {
    const { internals, calls } = stubInternals(CONVERTED, 'darwin')
    const text = await convertDocumentText(
      { style: 'textutil', command: 'textutil' }, join('w', 'report.docx'), internals, signal(), 'report.docx',
    )
    expect(text).toBe(CONVERTED)
    expect(calls).toEqual([{
      command: 'textutil',
      args: ['-convert', 'txt', '-encoding', 'UTF-8', '-stdout', join('w', 'report.docx')],
    }])
  })

  it('spawns pandoc and catdoc with UTF-8 output pinned in argv', async () => {
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    await convertDocumentText({ style: 'pandoc', command: 'pandoc' }, join('w', 'f.odt'), internals, signal(), 'f.odt')
    await convertDocumentText({ style: 'catdoc', command: 'catdoc' }, join('w', 'f.doc'), internals, signal(), 'f.doc')
    expect(calls.map(call => call.args)).toEqual([
      ['--to=plain', '--wrap=none', join('w', 'f.odt')],
      ['-d', 'utf-8', join('w', 'f.doc')],
    ])
  })

  it('converts through soffice by reading the outfile it writes into a private outdir', async () => {
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    const text = await convertDocumentText(
      { style: 'soffice', command: 'soffice' }, join('w', 'sofficed.doc'), internals, signal(), 'sofficed.doc',
    )
    expect(text).toBe(CONVERTED)
    const argv = calls[0]!.args
    expect(argv).toContain('--headless')
    expect(argv).toContain('txt:Text')
    const profile = argv.find(value => value.startsWith('-env:UserInstallation='))!
    expect(profile.startsWith('-env:UserInstallation=file:///')).toBe(true)
  }, 20000)

  it('fails when soffice writes no outfile', async () => {
    const internals: DocumentTextInternals = {
      ...stubInternals('').internals,
      run: async () => Buffer.from(''),
    }
    const failure = await failureOf(convertDocumentText(
      { style: 'soffice', command: 'soffice' }, join('w', 'quiet.docx'), internals, signal(), 'quiet.docx',
    ))
    expect(failure.code).toBe('workspace-file/conversion-failed')
  }, 20000)

  it('fails with the converter named when the child fails', async () => {
    const internals: DocumentTextInternals = {
      ...stubInternals('').internals,
      run: async () => { throw new Error('exit 2') },
    }
    const failure = await failureOf(convertDocumentText(
      { style: 'catdoc', command: 'catdoc' }, join('w', 'f.doc'), internals, signal(), 'f.doc',
    ))
    expect(failure.code).toBe('workspace-file/conversion-failed')
    expect(failure.details).toEqual({ path: 'f.doc', converter: 'catdoc' })
  })

  it('stringifies a non-Error child failure into the message', async () => {
    const internals: DocumentTextInternals = {
      ...stubInternals('').internals,
      run: async () => { throw 'spawn blew up' },
    }
    const failure = await failureOf(convertDocumentText(
      { style: 'pandoc', command: 'pandoc' }, join('w', 'f.odt'), internals, signal(), 'f.odt',
    ))
    expect(failure.code).toBe('workspace-file/conversion-failed')
  })

  it('rethrows the abort instead of wrapping it', async () => {
    const controller = new AbortController()
    const abort = new Error('aborted mid-conversion')
    const internals: DocumentTextInternals = {
      ...stubInternals('').internals,
      run: async () => {
        controller.abort()
        throw abort
      },
    }
    await expect(convertDocumentText(
      { style: 'pandoc', command: 'pandoc' }, join('w', 'f.odt'), internals, controller.signal, 'f.odt',
    )).rejects.toBe(abort)
  })
})

describe('utf8DocumentText', () => {
  it('decodes UTF-8 and skips one leading byte-order mark', () => {
    expect(utf8DocumentText(Buffer.from(CONVERTED, 'utf8'), 'f.docx', 'textutil')).toBe(CONVERTED)
    expect(utf8DocumentText(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(CONVERTED, 'utf8')]), 'f.docx', 'textutil'))
      .toBe(CONVERTED)
    // Only the leading mark skips; a second one is content.
    expect(utf8DocumentText(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF]), Buffer.from(CONVERTED, 'utf8')]), 'f.docx', 'textutil'))
      .toBe(`${String.fromCharCode(0xFEFF)}${CONVERTED}`)
  })

  it('refuses UTF-16 output instead of feeding the preview re-encoded noise', () => {
    // The bytes `textutil -convert txt` writes without `-encoding UTF-8`: a
    // UTF-16 byte-order mark leading UTF-16LE text.
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(`${CONVERTED}\n`, 'utf16le')])
    try {
      utf8DocumentText(utf16, 'f.docx', 'textutil')
      expect.unreachable('UTF-16 bytes must not decode')
    } catch (error: unknown) {
      expect(remoteErrorOf(error)?.code).toBe('workspace-file/conversion-failed')
    }
  })
})

describe('defaultDocumentTextInternals', () => {
  it('observes the host platform and missing commands, absolute and on PATH', () => {
    expect(defaultDocumentTextInternals.platform()).toBe(process.platform)
    expect(defaultDocumentTextInternals.commandAvailable('dsh-missing-converter-xyz')).toBe(false)
    expect(defaultDocumentTextInternals.commandAvailable(join(tmpdir(), 'dsh-missing-converter-xyz'))).toBe(false)
    // An absolute command naming a directory exists but is no executable file.
    expect(defaultDocumentTextInternals.commandAvailable(tmpdir())).toBe(false)
    expect(defaultDocumentTextInternals.commandAvailable(basename(process.execPath))).toBe(true)
  })

  it('captures child stdout as bytes without a shell', async () => {
    const out = await defaultDocumentTextInternals.run(process.execPath, ['-e', 'process.stdout.write("ok")'], signal())
    expect(out.toString('utf8')).toBe('ok')
  })

  it('rejects with the child failure when the command exits nonzero', async () => {
    await expect(defaultDocumentTextInternals.run(process.execPath, ['-e', 'process.exit(3)'], signal()))
      .rejects.toMatchObject({ code: 3 })
  })
})

describe('command lookup facts', () => {
  it('splits PATH on the platform delimiter and drops empty entries', () => {
    expect(pathEntriesOf(['a', '', 'b'].join(delimiter))).toEqual(['a', 'b'])
    expect(pathEntriesOf(undefined)).toEqual([])
  })

  it('answers PATHEXT tokens on Windows and the bare name elsewhere', () => {
    expect(commandExtensionsOf('linux', '.EXE;.BAT')).toEqual([''])
    expect(commandExtensionsOf('darwin', undefined)).toEqual([''])
    expect(commandExtensionsOf('win32', '.COM;.EXE;;.BAT')).toEqual(['', '.COM', '.EXE', '.BAT'])
    expect(commandExtensionsOf('win32', undefined)).toEqual(['', '.EXE'])
  })
})

describe('read over a convertible document', () => {
  let dispose: (() => Promise<void>) | undefined
  afterEach(async () => {
    await dispose?.()
    dispose = undefined
  })

  async function documentWorkspace() {
    const harness = await openWorkspace('dsh-doc-text-')
    dispose = async () => { await harness.dispose() }
    const report = join(harness.workspace, 'report.docx')
    await writeFile(report, Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]))
    return { harness, report }
  }

  it('pages the extracted text and reports the document as the stat source', async () => {
    const { harness, report } = await documentWorkspace()
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    const files = new WorkspaceFiles(harness.ctx, config(), internals)
    const page = await files.read(harness.scope, 'report.docx', { offset: 2, limit: 1 }, signal())
    expect(page.text).toBe('second line')
    expect(page.lines).toBe(1)
    expect(page.eof).toBe(false)
    expect(page.absolutePath).toBe(report)
    expect(calls[0]?.args).toContain(report)
  })

  it('keeps one conversion per file version across lazy pages', async () => {
    const { harness } = await documentWorkspace()
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    const files = new WorkspaceFiles(harness.ctx, config(), internals)
    await files.read(harness.scope, 'report.docx', {}, signal())
    await files.read(harness.scope, 'report.docx', { offset: 3 }, signal())
    expect(calls).toHaveLength(1)

    // A moved version converts again: the cache never outlives the bytes it named.
    await new Promise(resolve => setTimeout(resolve, 20))
    await writeFile(join(harness.workspace, 'report.docx'), Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x01]))
    await files.read(harness.scope, 'report.docx', {}, signal())
    expect(calls).toHaveLength(2)
  })

  it('reports no-converter when nothing resolves', async () => {
    const { harness } = await documentWorkspace()
    const { internals } = stubInternals(CONVERTED, 'linux', false)
    const files = new WorkspaceFiles(harness.ctx, config(), internals)
    expect(await failureOf(files.read(harness.scope, 'report.docx', {}, signal())))
      .toMatchObject({ code: 'workspace-file/no-converter' })
  })

  it('reports conversion-failed when the converter fails', async () => {
    const { harness } = await documentWorkspace()
    const broken: DocumentTextInternals = {
      ...stubInternals('').internals,
      run: async () => { throw new Error('exit 2') },
    }
    expect(await failureOf(new WorkspaceFiles(harness.ctx, config(), broken).read(harness.scope, 'report.docx', {}, signal())))
      .toMatchObject({ code: 'workspace-file/conversion-failed' })
  })

  it('reports conversion-failed when the converter emits non-UTF-8', async () => {
    const { harness } = await documentWorkspace()
    // UTF-16LE with its byte-order mark, what textutil writes without `-encoding UTF-8`.
    const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(CONVERTED, 'utf16le')])
    const misEncoded = new WorkspaceFiles(harness.ctx, config(), stubInternals(utf16, 'linux').internals)
    expect(await failureOf(misEncoded.read(harness.scope, 'report.docx', {}, signal())))
      .toMatchObject({ code: 'workspace-file/conversion-failed' })
  })

  it('caps converted text at the full-file cap', async () => {
    const { harness } = await documentWorkspace()
    const smallCaps: Config = { ...config(), maxFileBytes: 512 * 1024 }
    const files = new WorkspaceFiles(harness.ctx, smallCaps, stubInternals('x'.repeat(600 * 1024), 'linux').internals)
    expect(await failureOf(files.read(harness.scope, 'report.docx', {}, signal())))
      .toMatchObject({ code: 'workspace-file/too-large' })
  })

  it('reads a convertible suffix as ordinary bytes when extraction is disabled', async () => {
    const { harness } = await documentWorkspace()
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    const files = new WorkspaceFiles(harness.ctx, config({ enabled: false }), internals)
    expect(await failureOf(files.read(harness.scope, 'report.docx', {}, signal())))
      .toMatchObject({ code: 'workspace-file/not-text' })
    expect(calls).toHaveLength(0)
  })

  it('leaves uncovered suffixes on the ordinary text path', async () => {
    const { harness } = await documentWorkspace()
    await writeFile(join(harness.workspace, 'notes.txt'), 'plain text\n')
    const { internals, calls } = stubInternals(CONVERTED, 'linux')
    const files = new WorkspaceFiles(harness.ctx, config(), internals)
    const page = await files.read(harness.scope, 'notes.txt', {}, signal())
    expect(page.text).toBe('plain text')
    expect(page.eof).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('document text extraction config schema', () => {
  it('fills every field from defaults when the section is empty', () => {
    expect(WorkspaceFiles.Config({} as Config).documentText).toEqual({
      enabled: true,
      textutilPath: 'textutil',
      sofficePath: 'soffice',
      pandocPath: 'pandoc',
      catdocPath: 'catdoc',
    })
  })
})
