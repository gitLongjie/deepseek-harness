/**
 * Bounded HTTPS JSON fetch for catalog and npm registry reads.
 *
 * Security contract: HTTPS only on the standard port, no user info, no
 * IP-literal or private-looking hostnames, no credentials attached or
 * forwarded, manual redirect handling with every hop re-validated against the
 * same rules, a bounded redirect count, a bounded body size, and bounded wall
 * time. DNS resolution is not pinned: a public hostname that resolves to a
 * private address is outside this guard (see the package README's Known
 * Limitations).
 * @module @deepseek-ai/dsh-market-local/http
 */

/** One request rejected by the transport guard. */
export class MarketFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketFetchError'
  }
}

/** Maximum redirect hops one fetch may follow. */
const MAX_REDIRECTS = 3

/** Transport bounds for one fetch. */
export interface FetchJsonOptions {
  /** Wall-time bound for the whole request including body read. */
  readonly timeoutMs: number
  /** Maximum accepted response body size in bytes. */
  readonly maxBytes: number
}

/**
 * Validate one URL as a fetchable public HTTPS endpoint.
 * @param raw - the URL string.
 * @returns the parsed URL.
 * @throws MarketFetchError when the URL is not fetchable under the transport contract.
 */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new MarketFetchError(`not a valid URL: ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'https:') throw new MarketFetchError(`only https:// URLs are allowed: ${url.href}`)
  if (url.username !== '' || url.password !== '') throw new MarketFetchError(`URL must not carry user info: ${url.href}`)
  if (url.port !== '' && url.port !== '443') throw new MarketFetchError(`only the standard HTTPS port is allowed: ${url.href}`)
  if (!isPublicHostname(url.hostname)) throw new MarketFetchError(`not a public domain name: ${url.href}`)
  return url
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (isIpLiteral(host)) return false // any IP literal is rejected: catalogs are domain names
  return host.includes('.') // a single-label host cannot be public
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function fetchOnce(url: URL, options: FetchJsonOptions): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
    throw new MarketFetchError(`request to ${url.href} failed${cause}`)
  }
  return response
}

async function readBoundedText(response: Response, url: URL, maxBytes: number): Promise<string> {
  if (response.body === null) throw new MarketFetchError(`empty response body from ${url.href}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  const parts: string[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new MarketFetchError(`response from ${url.href} exceeds the ${maxBytes}-byte limit`)
    }
    parts.push(decoder.decode(value, { stream: true }))
  }
  parts.push(decoder.decode())
  return parts.join('')
}

/**
 * Fetch one JSON document under the full transport contract.
 * @param rawUrl - the absolute HTTPS URL to fetch.
 * @param options - the transport bounds.
 * @returns the parsed JSON payload.
 * @throws MarketFetchError on any transport-contract violation, timeout, oversized
 *   body, or invalid JSON.
 */
export async function fetchJsonBounded(rawUrl: string, options: FetchJsonOptions): Promise<unknown> {
  let url = assertPublicHttpsUrl(rawUrl)
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) throw new MarketFetchError(`more than ${MAX_REDIRECTS} redirects from ${rawUrl}`)
    const response = await fetchOnce(url, options)
    if (isRedirect(response.status)) {
      const location = response.headers.get('location')
      if (location === null) throw new MarketFetchError(`redirect from ${url.href} carries no location`)
      url = assertPublicHttpsUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) throw new MarketFetchError(`HTTP ${response.status} from ${url.href}`)
    const text = await readBoundedText(response, url, options.maxBytes)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new MarketFetchError(`response from ${url.href} is not valid JSON`)
    }
  }
}
