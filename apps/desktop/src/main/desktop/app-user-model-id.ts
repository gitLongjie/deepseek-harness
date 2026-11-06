/**
 * The Windows AppUserModelId of the desktop shell. Windows draws a window's
 * taskbar button from the Start Menu shortcut that carries the same id, so the
 * installed build must own its id alone: a checkout launch registers shortcuts
 * that point at its branded development executable, and a shared id lets
 * those stale shortcuts replace the installed product's taskbar icon.
 * @module @deepseek-ai/dsh-desktop/desktop/app-user-model-id
 */

/** Installed id; equals electron-builder.yml `appId`, which the NSIS shortcuts carry. */
export const DESKTOP_APP_USER_MODEL_ID = 'com.deepagens.app'

/**
 * Resolve the AppUserModelId for this launch.
 * @param environment - Process environment; the dev launcher sets `DSH_DESKTOP_DEV=1`.
 * @returns The installed id, or a `.dev` id for checkout launches.
 */
export function resolveAppUserModelId(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return environment.DSH_DESKTOP_DEV === '1' ? `${DESKTOP_APP_USER_MODEL_ID}.dev` : DESKTOP_APP_USER_MODEL_ID
}
