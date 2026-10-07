/**
 * First-launch deployment of the bundled ComfyUI distribution. The installer
 * carries an optional ComfyUI program tree beside the app (resources/comfyui-dist,
 * produced by deploy-app.mjs from apps/desktop/resources/comfyui-dist — program
 * files only, never the ~40 GB of H3 model weights) plus the H3 workflow
 * template inside app.asar (config/comfyui/h3-t2v-api-template.json). The
 * installed resources directory may be read-only (per-machine Program Files
 * install) while ComfyUI writes into its input/ tree, so both land in the
 * user-writable local-app-data directory the h3-video-director preset's
 * `~`-expanded paths point at. Idempotent: a deployment marker keeps later
 * launches from overwriting whatever the user has put in the deployed tree.
 * @module @deepseek-ai/dsh-desktop/desktop/comfyui-bootstrap
 */

import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Marker naming a complete program-tree deployment; bump to redeploy over one. */
const DEPLOY_MARKER = '.comfyui-dist-v1'

/** The bundled workflow template's in-asar location relative to the app root. */
const TEMPLATE_RELATIVE = join('config', 'comfyui', 'h3-t2v-api-template.json')

/** Where the template lands inside the deployed tree (ComfyUI models/). */
const TEMPLATE_TARGET = join('models', 'h3-t2v-api-template.json')

/**
 * Resolve the user-writable ComfyUI deployment directory.
 * @param localAppData - the LOCALAPPDATA directory; `undefined` off Windows.
 * @returns `<localAppData>/MindaWork/comfyui`, or `undefined` when the
 * platform names no local-app-data directory and deployment cannot run.
 */
export function comfyuiLocalDir(localAppData: string | undefined): string | undefined {
  return localAppData === undefined ? undefined : join(localAppData, 'MindaWork', 'comfyui')
}

/** Options for {@link deployBundledComfyUI}. */
export interface DeployBundledComfyUIOptions {
  /** The app directory (`app.getAppPath()`): the workflow template lives inside it. */
  appRoot: string
  /** The Electron resources directory (`process.resourcesPath`); hosts `comfyui-dist`. */
  resourcesDir: string
  /** The deployment target from {@link comfyuiLocalDir}; absent disables deployment. */
  localDir: string | undefined
  /** Progress logger; defaults to staying silent. */
  log?: (message: string) => void
}

/**
 * Deploy the bundled ComfyUI program tree and workflow template into the
 * user-writable local directory. The template copy is unconditional (it is a
 * small in-asar file the deployed tree must always carry); the program tree
 * copies once, marker-guarded. Never throws: a deployment failure logs and
 * leaves the remote MiniMax backend the preset also configures.
 * @param options - paths and logger.
 */
export async function deployBundledComfyUI(options: DeployBundledComfyUIOptions): Promise<void> {
  const { appRoot, resourcesDir, localDir, log } = options
  if (localDir === undefined) return
  const distDir = join(resourcesDir, 'comfyui-dist')
  try {
    await mkdir(join(localDir, 'models'), { recursive: true })
    const templateSource = join(appRoot, TEMPLATE_RELATIVE)
    const templateTarget = join(localDir, TEMPLATE_TARGET)
    if (existsSync(templateSource) && !existsSync(templateTarget)) {
      await copyFile(templateSource, templateTarget)
      log?.(`desktop: comfyui template deployed at ${templateTarget}`)
    }
    if (!existsSync(distDir)) return
    if (existsSync(join(localDir, DEPLOY_MARKER))) return
    log?.('desktop: deploying bundled ComfyUI (first launch, this can take a while)')
    await cp(distDir, localDir, { recursive: true, verbatimSymlinks: true })
    await writeFile(join(localDir, DEPLOY_MARKER), `${new Date().toISOString()}\n`)
    log?.('desktop: bundled ComfyUI deployed')
  } catch (error) {
    log?.(`desktop: comfyui deployment skipped (${error instanceof Error ? error.message : String(error)})`)
  }
}
