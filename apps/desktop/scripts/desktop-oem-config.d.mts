/** Type declarations for the OEM packaging helpers implemented in desktop-oem-config.mjs. */

export interface DesktopOemConfig {
  productName: string
  brandIcon: string
  updateUrl?: string
  knowledgeBase?: unknown
  gatewayProviderName?: string
  helpDocsUrl?: string
}

export function readDesktopOemConfig(repoRoot: string, environment?: NodeJS.ProcessEnv): DesktopOemConfig

export function syncDesktopOemIcons(repoRoot: string, desktopRoot: string, environment?: NodeJS.ProcessEnv): void

export interface ElectronBuilderOemOptions {
  allowLoopbackHttp?: boolean
  localUpdateFeed?: boolean
  knowledgeBase?: unknown
  gatewayProviderName?: string
  helpDocsUrl?: string
  version?: string
  output?: string
  asarUnpack?: readonly string[]
}

export interface ElectronBuilderOemConfig {
  extends: string
  productName: string
  extraMetadata: {
    name: string
    productName: string
    version?: string
    dsh: Record<string, unknown>
  }
  asarUnpack?: string[]
}

export function createElectronBuilderOemConfig(
  productName: string,
  updateUrl?: string,
  options?: ElectronBuilderOemOptions,
): ElectronBuilderOemConfig
