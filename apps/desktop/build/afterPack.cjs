/**
 * Ad-hoc seals the macOS app bundle when electron-builder performs no real
 * signing (no CSC_LINK / CSC_NAME). `mac.identity: null` leaves the bundle
 * with only Electron's per-file linker signatures and no `_CodeSignature`:
 * the signature then claims sealed resources the bundle does not have, and
 * macOS Gatekeeper reports that broken seal as "damaged" with no bypass.
 * A valid ad-hoc signature seals the bundle, which downgrades the block to
 * the recoverable "unidentified developer" flow (System Settings >
 * Privacy & Security > Open Anyway). Runs before the dmg/zip targets, so
 * both are built from the sealed bundle.
 */
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const run = promisify(execFile)

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  await run('codesign', ['--force', '--deep', '--sign', '-', appPath])
  await run('codesign', ['--verify', '--deep', '--strict', appPath])
}
