/** Spawn the bundled Python Office generator with a JSON payload. */

import { spawn } from 'node:child_process'
import { access, constants, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { OfficeCreateKind } from './validate.ts'

const SCRIPT = fileURLToPath(new URL('../assets/generate_office.py', import.meta.url))

/** Runtime paths required to generate an Office file. */
export interface OfficeRuntime {
  readonly python: string
  readonly pythonPackages: string
}

/**
 * Run the fixed generator script.
 * @param runtime - Bundled Python interpreter and site-packages directory.
 * @param kind - Office format discriminant.
 * @param outputPath - Absolute host path for the output file.
 * @param payload - JSON-serializable generator input.
 * @param signal - Cancels the child process.
 */
export async function runOfficeGenerator(
  runtime: OfficeRuntime,
  kind: OfficeCreateKind,
  outputPath: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  await access(runtime.python, constants.X_OK).catch(async () => {
    await access(runtime.python, constants.F_OK)
  })
  await access(SCRIPT, constants.R_OK)
  let incomplete = true
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(runtime.python, [SCRIPT, kind, outputPath], {
        env: {
          ...process.env,
          PYTHONPATH: runtime.pythonPackages,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          // stdin carries UTF-8 JSON and stderr is decoded as UTF-8, independent of the Windows ANSI code page.
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const onAbort = (): void => {
        child.kill()
      }
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
      child.stdout?.on('data', (chunk: Buffer) => { stdout.push(chunk) })
      child.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk) })
      child.on('error', (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(signal.reason instanceof Error ? signal.reason : new Error('Office create cancelled'))
          return
        }
        if (code === 0) {
          resolve()
          return
        }
        const detail = Buffer.concat(stderr).toString('utf8').trim()
          || Buffer.concat(stdout).toString('utf8').trim()
          || `exit ${String(code ?? 'null')}`
        reject(new Error(`Office generator failed: ${detail}`))
      })
      child.stdin?.end(JSON.stringify(payload), 'utf8')
    })
    const info = await stat(outputPath)
    if (!info.isFile() || info.size < 4) throw new Error('Office generator produced no usable file')
    incomplete = false
  } finally {
    if (incomplete) {
      await rm(outputPath, { force: true }).catch((error: unknown) => {
        // Best-effort cleanup of a partial OOXML write after generator failure.
        void error
      })
    }
  }
}
