/**
 * The fetch seam shared by the HTTP-backed providers and the GPU vendor client: tests inject a
 * stub, production resolves the global `fetch`.
 * @module @deepseek-ai/dsh-h3-video/http
 */

/** HTTP fetch function injectable for tests; defaults to global fetch. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
