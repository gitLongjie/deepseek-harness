/**
 * macOS renderer backend selection for the desktop shell.
 * The main entry applies the returned switches before Electron's ready event,
 * which is when Chromium starts the GPU process.
 * @module @deepseek-ai/dsh-desktop/main/desktop/darwin-renderer
 */

/**
 * Chromium GPU switches required before the app ready event.
 *
 * On Apple M1 and M2, Skia Graphite presents no compositor frame. The main
 * window waits for `ready-to-show` before `show()`, so the process stays up
 * with the menu bar visible and the desktop wallpaper in place of the window.
 * `disable-skia-graphite` selects Ganesh. GPU compositing stays enabled.
 * Later Apple silicon keeps Graphite.
 *
 * @param platform - the main process `process.platform`.
 * @param cpuModel - `os.cpus()[0].model`. An empty string applies no switch.
 * @returns switch names for `app.commandLine.appendSwitch`. None take a value.
 */
export function darwinRendererSwitches(platform: NodeJS.Platform, cpuModel: string): readonly string[] {
  if (platform !== 'darwin') return []
  if (!/^Apple M[12](?:\s|$)/.test(cpuModel.trim())) return []
  return ['disable-skia-graphite']
}
