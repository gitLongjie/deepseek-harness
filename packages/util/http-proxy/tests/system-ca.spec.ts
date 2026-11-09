import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { generate } from 'selfsigned'
import { fetch as undiciFetch } from 'undici'
import { installProxyFromEnvironment, trustSystemCertificateAuthorities } from '../src/install.ts'

const originalAuthorities = getCACertificates('default')
const originalFlag = process.env.NODE_USE_SYSTEM_CA
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
  setDefaultCACertificates(originalAuthorities)
  if (originalFlag === undefined) Reflect.deleteProperty(process.env, 'NODE_USE_SYSTEM_CA')
  else process.env.NODE_USE_SYSTEM_CA = originalFlag
})

/** SHA-256 fingerprints of PEM certificates, one per distinct certificate. */
function fingerprints(pems: readonly string[]): Set<string> {
  return new Set(pems.map(pem => new X509Certificate(pem).fingerprint256))
}

/** Node's TLS alert for a certificate that is not in the default trust list. */
function certificateCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !(error.cause instanceof Error) || !('code' in error.cause)) return undefined
  return typeof error.cause.code === 'string' ? error.cause.code : undefined
}

/** A self-signed certificate whose subject alternative name is the loopback address the test dials. */
function loopbackCertificate(): { cert: string; key: string } {
  const generated = generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    days: 1,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ],
  })
  return { cert: generated.cert, key: generated.private }
}

/** Serve one fixed body on a fresh loopback port. */
function serve(cert: string, key: string): Promise<string> {
  const server = createServer({ cert, key }, (_request, response) => { response.end('ok') })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('system-ca fixture did not bind a TCP port')
      resolve(`https://127.0.0.1:${String(address.port)}/`)
    })
  })
}

/** Stop one fixture server. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => { server.close(() => { resolve() }) })
}

describe('trustSystemCertificateAuthorities', () => {
  it('leaves the default trust and the child flag unchanged when the store is empty', () => {
    const before = getCACertificates('default')
    trustSystemCertificateAuthorities([])
    expect(getCACertificates('default')).toEqual(before)
    expect(process.env.NODE_USE_SYSTEM_CA).toBe(originalFlag)
  })

  it('trusts a certificate that is only in the supplied store and still rejects a different one', async () => {
    const trusted = loopbackCertificate()
    const untrusted = loopbackCertificate()
    const trustedUrl = await serve(trusted.cert, trusted.key)
    const untrustedUrl = await serve(untrusted.cert, untrusted.key)
    const bundled = fingerprints(getCACertificates('bundled'))
    const rejected = await undiciFetch(trustedUrl).then(() => undefined, (error: unknown) => error)
    expect(certificateCode(rejected)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    trustSystemCertificateAuthorities([trusted.cert])
    const trustedFingerprints = fingerprints(getCACertificates('default'))
    for (const fingerprint of bundled) expect(trustedFingerprints.has(fingerprint)).toBe(true)
    expect(trustedFingerprints.has(new X509Certificate(trusted.cert).fingerprint256)).toBe(true)
    expect(process.env.NODE_USE_SYSTEM_CA).toBe('1')
    await expect(undiciFetch(trustedUrl).then(response => response.text())).resolves.toBe('ok')
    await expect(fetch(trustedUrl).then(response => response.text())).resolves.toBe('ok')
    const failure = await undiciFetch(untrustedUrl).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(certificateCode(failure)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
  })

  it('installs the operating-system store before a direct policy and keeps it after disposal', async () => {
    const system = fingerprints(getCACertificates('system'))
    const before = fingerprints(getCACertificates('default'))
    const dispose = await installProxyFromEnvironment({ get: () => undefined }, () => undefined)
    try {
      const after = fingerprints(getCACertificates('default'))
      for (const fingerprint of before) expect(after.has(fingerprint)).toBe(true)
      if (system.size === 0) {
        expect(process.env.NODE_USE_SYSTEM_CA).toBe(originalFlag)
      } else {
        for (const fingerprint of system) expect(after.has(fingerprint)).toBe(true)
        expect(process.env.NODE_USE_SYSTEM_CA).toBe('1')
        const childEnv: Record<string, string> = {}
        for (const [key, value] of Object.entries(process.env)) if (value !== undefined) childEnv[key] = value
        const child = spawnSync(process.execPath, ['-e', [
          "const tls = require('node:tls')",
          "const { X509Certificate } = require('node:crypto')",
          'const system = new Set(tls.getCACertificates(\'system\').map(pem => new X509Certificate(pem).fingerprint256))',
          'const trusted = new Set(tls.getCACertificates(\'default\').map(pem => new X509Certificate(pem).fingerprint256))',
          'for (const fingerprint of system) if (!trusted.has(fingerprint)) process.exit(2)',
        ].join('\n')], { env: childEnv, encoding: 'utf8' })
        expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
      }
    } finally {
      await dispose()
    }
    if (system.size > 0) expect(process.env.NODE_USE_SYSTEM_CA).toBe('1')
  })
})
