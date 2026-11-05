/** Type declarations for the electron-builder factory re-exported by electron-builder.config.mjs. */

export interface ElectronBuilderFileCopy {
  from: string
  to: string
  filter: string[]
}

export interface ElectronBuilderPackagedResource {
  from: string
  to: string
}

export interface ElectronBuilderConfig {
  directories: { output: string }
  extraMetadata: { name?: string; version?: string; main?: string }
  files: Array<string | ElectronBuilderFileCopy>
  productName?: string
  publish?: unknown
  artifactName: string
  beforeBuild(): Promise<boolean>
  extraResources: ElectronBuilderPackagedResource[]
  nsis: {
    uninstallDisplayName: string
    installerLanguages: string[]
  }
  artifactBuildCompleted(event: { file: string }): void
  afterPack(context: unknown): void | Promise<void>
  win: {
    forceCodeSigning?: boolean
    signtoolOptions: { sign?: (configuration: unknown) => void | Promise<void> }
  }
}

export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: string,
  hostArch?: string,
  preparedRuntime?: string,
  preparedRuntimeVersion?: string,
): ElectronBuilderConfig

declare const config: ElectronBuilderConfig
export default config
