/**
 * Explicit local/remote routing over H3 video providers. `resolve` is the single place that picks
 * a backend for one segment request; no call path receives an implicit default.
 * @module @deepseek-ai/dsh-h3-video/routing
 */

import type { H3VideoProvider, SegmentRequest } from './types.ts'
import { validateSegmentRequest } from './validation.ts'

/** Caller-selected backend policy for one segment. */
export type BackendChoice = 'local' | 'remote' | 'auto'

/** A provider paired with the choice label that routes to it. */
export interface RoutedProvider {
  readonly choice: 'local' | 'remote'
  readonly provider: H3VideoProvider
}

/** One resolved generation target. */
export interface ResolvedTarget {
  readonly provider: H3VideoProvider
  readonly choice: 'local' | 'remote'
}

/** Thrown when no configured backend can serve a request under the requested policy. */
export class RoutingError extends Error {}

/**
 * Choose the provider for one request. `local` and `remote` demand their named backend and report
 * why it cannot serve the request; `auto` prefers local and falls back to remote when local is
 * absent or rejects the request on capability grounds (resolution tier or duration range). Request
 * validation runs against the chosen provider before submission.
 * @param choice - caller policy.
 * @param providers - configured backends by label.
 * @param request - the segment request to route.
 * @returns the selected provider after successful validation.
 * @throws RoutingError - when no backend serves the request under the policy.
 */
export function resolve(choice: BackendChoice, providers: readonly RoutedProvider[], request: SegmentRequest): ResolvedTarget {
  const wanted = choice === 'auto' ? ['local', 'remote'] as const : [choice] as const
  const reasons: string[] = []
  for (const label of wanted) {
    const entry = providers.find(provider => provider.choice === label)
    if (entry === undefined) {
      reasons.push(`${label}: not configured`)
      continue
    }
    try {
      validateSegmentRequest(request, entry.provider.capabilities)
      return { provider: entry.provider, choice: label }
    } catch (error: unknown) {
      reasons.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new RoutingError(`no H3 backend can serve this request (${reasons.join('; ')})`)
}
