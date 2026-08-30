/** Bounded, escalating shutdown for the desktop surface. */

/** Maximum grace allowed for the application tree to dispose before process exit. */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000

/** Exit controller shared by the tray quit path and the before-quit hook. */
export interface ProcessShutdown {
  /** Dispose at most once and wait up to the shutdown grace without exiting. */
  prepare(): Promise<void>
  /** Start or join graceful disposal before allowing completion with `code`. */
  shutdown(code: number): Promise<void>
  /** Start graceful disposal followed by exit, or force exit when shutdown is already running. */
  interrupt(code: number): void
}

/**
 * Create one exit controller around an application disposer. The Electron main
 * process injects `forceExit`/`complete` as `app.exit` so no `before-quit`
 * re-entry can loop; tests inject recorders.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param forceExit - Function that exits immediately, replaceable by tests.
 * @param complete - Function that records the natural completion, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated interrupt escalates.
 */
export function createProcessShutdown(
  dispose: () => Promise<void>,
  forceExit: (code: number) => void = (code) => { process.exit(code) },
  complete: (code: number) => void = (code) => { process.exitCode = code },
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ProcessShutdown {
  let pending: Promise<void> | undefined
  let disposal: Promise<boolean> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let completed = false
  let forceExited = false

  const clearExitTimeout = (): void => {
    /* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
    if (timeout !== undefined) clearTimeout(timeout)
  }

  const forceExitOnce = (code: number): void => {
    if (forceExited) return
    forceExited = true
    clearExitTimeout()
    forceExit(code)
  }

  const completeOnce = (code: number): void => {
    if (completed || forceExited) return
    completed = true
    clearExitTimeout()
    complete(code)
  }

  const disposeOnce = (): Promise<boolean> => {
    disposal ??= Promise.resolve().then(dispose).then(
      () => true,
      () => false,
    )
    return disposal
  }

  const prepare = (): Promise<void> => new Promise((resolve) => {
    const preparationTimeout = setTimeout(resolve, timeoutMs)
    void disposeOnce().then(() => {
      clearTimeout(preparationTimeout)
      resolve()
    })
  })

  const start = (code: number, forceAfterDispose: boolean): Promise<void> => {
    if (pending !== undefined) return pending
    timeout = setTimeout(() => { forceExitOnce(code) }, timeoutMs)
    pending = disposeOnce().then(
      (disposed) => {
        if (!disposed) {
          forceExitOnce(code)
          return
        }
        if (forceAfterDispose) forceExitOnce(code)
        else completeOnce(code)
      },
    )
    return pending
  }

  return {
    prepare,
    shutdown(code) {
      return start(code, false)
    },
    interrupt(code) {
      if (pending !== undefined) {
        forceExitOnce(code)
        return
      }
      void start(code, true)
    },
  }
}
