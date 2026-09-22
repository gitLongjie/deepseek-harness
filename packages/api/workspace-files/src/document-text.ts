/**
 * Office-document text extraction for file previews.
 *
 * A document suffix the feature covers is converted to plain text by the
 * platform converter the deployment names in its Config; the converter is
 * resolved explicitly per platform before anything runs, and the output is
 * decoded as strict UTF-8 afterwards, because no converter's encoding default
 * is trusted — macOS `textutil -convert txt` writes UTF-16 unless
 * `-encoding UTF-8` is stated, so the encoding travels in the argv.
 * @module @deepseek-ai/dsh-api-workspace-files/document-text
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, extname, isAbsolute, join } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Document suffixes text extraction covers, without the dot, lowercase. */
export const DOCUMENT_TEXT_SUFFIXES: readonly string[] = ['doc', 'docx', 'odt']

/**
 * Extraction configuration; every converter command is a PATH name or an
 * absolute path, nameable per deployment because installs differ per host.
 */
export interface DocumentTextConfig {
  /** Extract text for covered document suffixes instead of failing them as not-text. */
  readonly enabled: boolean
  /** The macOS converter (handles `doc`, `docx`, and `odt`). */
  readonly textutilPath: string
  /** The LibreOffice converter, the first choice off macOS. */
  readonly sofficePath: string
  /** The pandoc converter (`docx` and `odt` only). */
  readonly pandocPath: string
  /** The catdoc converter (legacy `doc` only). */
  readonly catdocPath: string
}

/** The converter one read uses, resolved before anything spawns. */
export interface DocumentConverter {
  /** Converter style; owns the argv and how the output is captured. */
  readonly style: 'textutil' | 'soffice' | 'pandoc' | 'catdoc'
  /** The configured command to spawn. */
  readonly command: string
}

/** Host observations and process execution, stated apart so tests substitute them. */
export interface DocumentTextInternals {
  /** The host platform name, `os.platform()`'s value. */
  platform(): string
  /** Whether the command resolves on PATH, or names an existing file when absolute. */
  commandAvailable(command: string): boolean
  /** Run one command, no shell, capturing stdout bytes; rejects with the child's failure. */
  run(command: string, args: readonly string[], signal: AbortSignal): Promise<Buffer>
}

/** The lowercase suffix of an absolute path when text extraction covers it. */
export function documentTextSuffixOf(absolutePath: string): string | undefined {
  const suffix = extname(absolutePath).replace(/^\./, '').toLowerCase()
  return DOCUMENT_TEXT_SUFFIXES.includes(suffix) ? suffix : undefined
}

/** Candidate converter styles for one suffix, in resolve order, per platform family. */
function candidateStyles(suffix: string, platform: string): readonly DocumentConverter['style'][] {
  if (platform === 'darwin') return ['textutil']
  if (suffix === 'doc') return ['soffice', 'catdoc']
  return ['soffice', 'pandoc']
}

const COMMAND_OF_STYLE: Record<DocumentConverter['style'], 'textutilPath' | 'sofficePath' | 'pandocPath' | 'catdocPath'> = {
  textutil: 'textutilPath',
  soffice: 'sofficePath',
  pandoc: 'pandocPath',
  catdoc: 'catdocPath',
}

/**
 * Resolve the converter for one document before anything runs, in the
 * suffix's per-platform preference order and only among commands this
 * deployment names that resolve on the host.
 * @param absolutePath - the document's absolute path; its suffix picks the candidates.
 * @param config - extraction configuration naming each converter's command.
 * @param internals - platform and availability observations.
 * @returns the first available converter, or `undefined` when none resolves.
 */
export function resolveDocumentConverter(
  absolutePath: string,
  config: DocumentTextConfig,
  internals: DocumentTextInternals,
): DocumentConverter | undefined {
  const suffix = documentTextSuffixOf(absolutePath)
  if (suffix === undefined) return undefined
  for (const style of candidateStyles(suffix, internals.platform())) {
    const command = config[COMMAND_OF_STYLE[style]]
    if (internals.commandAvailable(command)) return { style, command }
  }
  return undefined
}

/**
 * Convert one document to plain text and decode it as strict UTF-8.
 * @param converter - the resolved converter.
 * @param absolutePath - the document's absolute path.
 * @param internals - process execution.
 * @param signal - caller cancellation; abort terminates the child.
 * @param path - the workspace path the wire failure names.
 * @returns the extracted text, byte-order mark stripped.
 * @throws RemoteError `workspace-file/conversion-failed` when the converter
 *   fails or its output is not valid UTF-8.
 */
export async function convertDocumentText(
  converter: DocumentConverter,
  absolutePath: string,
  internals: DocumentTextInternals,
  signal: AbortSignal,
  path: string,
): Promise<string> {
  let bytes: Buffer
  try {
    bytes = await converterBytes(converter, absolutePath, internals, signal)
  } catch (error: unknown) {
    if (signal.aborted) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new RemoteError(
      'workspace-file/conversion-failed',
      `converting "${path}" with ${converter.style} failed: ${detail}`,
      { path, converter: converter.style },
      { cause: error },
    )
  }
  return utf8DocumentText(bytes, path, converter.style)
}

/** Spawn the resolved converter and capture the converted bytes, per style. */
async function converterBytes(
  converter: DocumentConverter,
  absolutePath: string,
  internals: DocumentTextInternals,
  signal: AbortSignal,
): Promise<Buffer> {
  switch (converter.style) {
    case 'textutil':
      // `-encoding UTF-8` is the point of this module: without it textutil
      // writes UTF-16 and every later read decodes noise.
      return internals.run(converter.command, ['-convert', 'txt', '-encoding', 'UTF-8', '-stdout', absolutePath], signal)
    case 'pandoc':
      return internals.run(converter.command, ['--to=plain', '--wrap=none', absolutePath], signal)
    case 'catdoc':
      return internals.run(converter.command, ['-d', 'utf-8', absolutePath], signal)
    case 'soffice':
      return sofficeBytes(converter, absolutePath, internals, signal)
  }
}

/**
 * Convert through LibreOffice, which writes the output file beside a temp
 * outdir instead of stdout. A private user profile keeps the headless run
 * clear of any desktop LibreOffice instance holding the default one.
 */
async function sofficeBytes(
  converter: DocumentConverter,
  absolutePath: string,
  internals: DocumentTextInternals,
  signal: AbortSignal,
): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), 'dsh-doc-text-'))
  try {
    const outdir = join(work, 'out')
    await mkdir(outdir)
    const profile = pathToFileURL(join(work, 'profile')).toString()
    await internals.run(
      converter.command,
      [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'txt:Text', '--outdir', outdir, absolutePath],
      signal,
    )
    signal.throwIfAborted()
    const stem = basename(absolutePath, extname(absolutePath))
    return await readFile(join(outdir, `${stem}.txt`))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Decode converted bytes as strict UTF-8, one leading byte-order mark stripped.
 * A converter that ignored its encoding argument fails here instead of feeding
 * the preview re-encoded noise.
 * @param bytes - the converter's output.
 * @param path - the workspace path the wire failure names.
 * @param style - the converter style the failure names.
 * @returns the decoded text.
 * @throws RemoteError `workspace-file/conversion-failed` on invalid UTF-8.
 */
export function utf8DocumentText(bytes: Buffer, path: string, style: DocumentConverter['style']): string {
  try {
    // The decoder skips one leading byte-order mark and, fatal, refuses bytes
    // that are not UTF-8 — textutil's UTF-16 default output fails here.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new RemoteError(
      'workspace-file/conversion-failed',
      `converting "${path}" with ${style} produced bytes that are not valid UTF-8`,
      { path, converter: style },
      { cause: error },
    )
  }
}

/** Whether one absolute command names an existing regular file. */
function absoluteCommandExists(command: string): boolean {
  try {
    return statSync(command).isFile()
  } catch {
    return false
  }
}

/** Split a raw PATH value into its non-empty entries. */
export function pathEntriesOf(rawPath: string | undefined): readonly string[] {
  return (rawPath ?? '').split(delimiter).filter(entry => entry !== '')
}

/**
 * Candidate command suffixes of a PATH lookup: the bare name everywhere, plus
 * the PATHEXT tokens on Windows (`.EXE` when unset).
 */
export function commandExtensionsOf(platform: string, rawPathExt: string | undefined): readonly string[] {
  if (platform !== 'win32') return ['']
  return ['', ...(rawPathExt ?? '.EXE').split(';').filter(entry => entry !== '')]
}

/** Whether one PATH-named command resolves on this host, honouring Windows PATHEXT. */
function pathCommandExists(command: string): boolean {
  const extensions = commandExtensionsOf(process.platform, process.env.PATHEXT)
  for (const entry of pathEntriesOf(process.env.PATH)) {
    for (const extension of extensions) {
      if (existsSync(join(entry, command + extension))) return true
    }
  }
  return false
}

/** Production internals: the host platform, a PATH scan, and a no-shell byte-capturing runner. */
export const defaultDocumentTextInternals: DocumentTextInternals = {
  platform: () => process.platform,
  commandAvailable: command => isAbsolute(command) ? absoluteCommandExists(command) : pathCommandExists(command),
  run: (command, args, signal) => new Promise((resolve, reject) => {
    execFile(command, [...args], { encoding: 'buffer', signal, windowsHide: true, maxBuffer: 2 ** 30 }, (error, stdout) => {
      if (error !== null) reject(Object.assign(new Error(error.message, { cause: error }), { code: error.code }))
      else resolve(stdout)
    })
  }),
}
