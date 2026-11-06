/** Download commit of the dashi-ppt skill archive bundled into Desktop runtimes. */
export declare const DASHI_PPT_COMMIT: string

/**
 * Install `dashi-ppt` under the runtime's bundled-skills directory when this
 * commit is not already present.
 * @param runtimeDir - Desktop `runtime` directory that also holds `primary-runtime`.
 * @param cacheDir - Directory for the downloaded archive.
 * @returns Absolute skill directory.
 */
export declare function prepareDashiPptSkill(runtimeDir: string, cacheDir: string): Promise<string>
