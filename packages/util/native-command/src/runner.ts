/**
 * Shared no-shell `execFile` runner for host-native OS integrations.
 * @module @deepseek-ai/dsh-native-command/runner
 */

import { execFile } from 'node:child_process'

/** Windows process-visibility policy for one spawned command. */
export interface NativeCommandOptions {
  /**
   * Suppress the transient console a console-subsystem child raises. Defaults
   * to true. A GUI-subsystem child that raises its own window needs false:
   * the flag hides the first window the child creates, so Explorer started
   * with it hands the folder over without ever showing it.
   */
  readonly windowsHide?: boolean
}

/**
 * Testable command boundary; native implementations never invoke a shell. The
 * caller states the visibility policy for the command it is spawning, and the
 * runner applies it, so an injected runner keeps that decision with the
 * command rather than replacing it.
 */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  options?: NativeCommandOptions,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and Windows console
 * hiding.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort terminates the child.
 * @param options - Windows process-visibility policy.
 * @returns captured stdout/stderr on exit 0.
 */
export function runNativeCommand(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  options: NativeCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide: options.windowsHide ?? true },
      (error, stdout, stderr) => {
        if (error !== null) {
          const failure = Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stdout,
            stderr,
          })
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}
