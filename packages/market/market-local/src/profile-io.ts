/**
 * Profile plugin mutations and reads: the pnpm execution boundary, the
 * `dsh.profile.bundles` reconcile through the shared app-boot helper, and the
 * installed-plugin view derived from the profile manifest.
 * @module @deepseek-ai/dsh-market-local/profile-io
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  reconcileProfileBundles,
  resolveBundleDir,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import type { MarketBundleId, MarketInstallOutcome, MarketInstalledPlugin, MarketOperationFailure, MarketUninstallOutcome } from '@deepseek-ai/dsh-market'

/** Profile mutation and read options, resolved from the owning plugin's Config. */
export interface ProfileMutationOptions {
  /** Absolute path of the managed profile directory. */
  readonly profileDir: string
  /** Absolute path of the running dsh installation's package.json. */
  readonly installAnchor: string
  /** Maximum pnpm runtime before the child is killed. */
  readonly pnpmTimeoutMs: number
  /** Maximum captured process-output tail retained for failure diagnostics. */
  readonly maxOutputTailBytes: number
}

/**
 * Create the profile directory on first use, exactly as `dsh plugin` does, so
 * a market install into a fresh custom profile behaves like the CLI.
 * @param profileName - the profile's name (template lookup and diagnostics).
 * @param profileDir - the profile directory.
 */
export function ensureProfileDir(profileName: string, profileDir: string): void {
  if (existsSync(join(profileDir, 'package.json'))) return
  const template = PROFILE_TEMPLATES[profileName]
  initProfile(profileDir, template?.bundles ?? DEFAULT_PROFILE_BUNDLES, template?.patchReload)
}

/**
 * Whether a string is a valid npm package name, the grammar bundle ids must
 * satisfy before any profile lookup.
 * @param value - the candidate id.
 */
export function isNpmPackageName(value: string): boolean {
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(value)
}

/** Rebrand a validated npm package name into a bundle id at the owning boundary. */
export function bundleId(packageName: string): MarketBundleId {
  return packageName as MarketBundleId
}

function installedVersion(
  binName: string,
  packageName: string,
  profileDir: string,
  installAnchor: string,
): string | null {
  let dir: string
  try {
    dir = resolveBundleDir(binName, packageName, installAnchor, profileDir)
  } catch {
    return null // the manifest lists the dependency but it does not resolve — report no version
  }
  try {
    const manifest = readProfileManifest(binName, dir) as ProfileManifest & { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : null
  } catch {
    return null // an unreadable dependency manifest reports no version rather than failing the view
  }
}

/**
 * Read the installed-plugin view: every direct dependency of the profile plus
 * installation-owned template layers read-only. Every install route appears —
 * this market, another market, or the CLI — because the manifest is the only
 * truth read. Dependencies come first: a dependency-managed package that is
 * also a bundle layer (every market install) carries its manifest spec and is
 * removable; template layers carry no spec and are not removable through the
 * market.
 * @param binName - the diagnostic prefix on thrown errors.
 * @param profileDir - the managed profile directory.
 * @param installAnchor - the installation anchor for package resolution.
 * @returns the installed rows, dependencies first, then template layers in listed order.
 */
export function readInstalledPlugins(
  binName: string,
  profileDir: string,
  installAnchor: string,
): MarketInstalledPlugin[] {
  const manifest = readProfileManifest(binName, profileDir)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const rows: MarketInstalledPlugin[] = []
  const seen = new Set<string>()
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    seen.add(name)
    rows.push({
      bundleId: bundleId(name),
      packageName: name,
      version: installedVersion(binName, name, profileDir, installAnchor),
      spec,
      isBundleLayer: bundles.includes(name),
      removable: true,
    })
  }
  for (const name of bundles) {
    if (seen.has(name)) continue
    seen.add(name)
    rows.push({
      bundleId: bundleId(name),
      packageName: name,
      version: installedVersion(binName, name, profileDir, installAnchor),
      spec: null,
      isBundleLayer: true,
      removable: false,
    })
  }
  return rows
}

/** Keep only the last N bytes of merged process output. */
class RollingTail {
  private readonly parts: Buffer[] = []

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.parts.push(chunk)
    // Trim whole chunks from the front while oversized; at least one chunk is
    // always kept, and text() cuts the final remainder to the bound.
    while (Buffer.concat(this.parts).byteLength > this.maxBytes && this.parts.length > 1) {
      this.parts.shift()
    }
  }

  text(): string {
    return Buffer.concat(this.parts).subarray(-this.maxBytes).toString('utf8')
  }
}

interface PnpmResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly tail: string
}

function runPnpm(args: readonly string[], options: ProfileMutationOptions): Promise<PnpmResult> {
  return new Promise((resolve) => {
    // Windows resolves pnpm through its .cmd shim, which spawn() refuses
    // without a shell since the CVE-2024-27980 hardening. The bounded args
    // contain no shell metacharacters: package names are grammar-checked and
    // versions are registry-validated exact stable releases.
    const child = spawn('pnpm', [...args], {
      cwd: options.profileDir,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tail = new RollingTail(options.maxOutputTailBytes)
    child.stdout?.on('data', (chunk: Buffer) => tail.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => tail.push(chunk))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.pnpmTimeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, timedOut, tail: tail.text() === '' ? error.message : `${tail.text()}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, timedOut, tail: tail.text() })
    })
  })
}

function failure(message: string, tail: string): MarketOperationFailure {
  return { ok: false, message, outputTail: tail === '' ? null : tail }
}

/**
 * Install one exact package version into the profile and reconcile the bundle
 * layer list. Installability must already be validated: this function runs the
 * package manager with the exact version it is given.
 * @param binName - the diagnostic prefix on thrown errors and reconcile warnings.
 * @param packageName - the npm package to add.
 * @param version - the exact stable version to add.
 * @param options - the profile mutation options.
 */
export async function pnpmInstall(
  binName: string,
  packageName: string,
  version: string,
  options: ProfileMutationOptions,
): Promise<MarketInstallOutcome> {
  const before = readProfileManifest(binName, options.profileDir)
  const result = await runPnpm(['add', `${packageName}@${version}`], options)
  // A timed-out child may still report an exit code on its way down; the
  // timeout owns the verdict regardless of that code.
  if (result.timedOut || result.exitCode !== 0) {
    return failure(
      result.timedOut
        ? `pnpm add ${packageName}@${version} timed out after ${options.pnpmTimeoutMs}ms`
        : `pnpm add ${packageName}@${version} failed with exit code ${result.exitCode ?? 'spawn error'}`,
      result.tail,
    )
  }
  // The npm pre-validation guarantees the installed manifest declares
  // dsh.bundle, so the reconcile's bundle-less-dependency warning cannot fire
  // for a market install; the sink discards what still arrives.
  reconcileProfileBundles(binName, before, options.profileDir, options.installAnchor, () => {})
  return { ok: true, packageName, version, restartRequired: true }
}

/**
 * Remove one dependency-managed package from the profile and reconcile the
 * bundle layer list. Installation-owned template layers refuse here.
 * @param binName - the diagnostic prefix on thrown errors and reconcile warnings.
 * @param packageName - the npm package to remove.
 * @param options - the profile mutation options.
 */
export async function pnpmUninstall(
  binName: string,
  packageName: string,
  options: ProfileMutationOptions,
): Promise<MarketUninstallOutcome> {
  const manifest = readProfileManifest(binName, options.profileDir)
  const dependencies = manifest.dependencies ?? {}
  if (!(packageName in dependencies)) {
    return failure(
      `${packageName} is not a dependency-managed plugin of this profile; installation-owned layers are removed through a profile reset`,
      '',
    )
  }
  const before = manifest
  const result = await runPnpm(['remove', packageName], options)
  // Symmetric with pnpmInstall: the timeout owns the verdict over a late exit code.
  if (result.timedOut || result.exitCode !== 0) {
    return failure(
      result.timedOut
        ? `pnpm remove ${packageName} timed out after ${options.pnpmTimeoutMs}ms`
        : `pnpm remove ${packageName} failed with exit code ${result.exitCode ?? 'spawn error'}`,
      result.tail,
    )
  }
  reconcileProfileBundles(binName, before, options.profileDir, options.installAnchor, () => {})
  return { ok: true, packageName, restartRequired: true }
}
