/** Browser operations for authored works; failures retain stable status codes. */
import type { StudioCatalog, StudioContent, StudioDocument, StudioId } from '@deepseek-ai/dsh-video-workbench'

/** Plain callbacks injected by the owning panel. */
export interface StudioActions {
  /** Seed the active conversation with a saved work and creative skill; never send it. */
  requestSkill?: (skill: string, id: StudioId, revision: number) => Promise<void>
  /** Render a saved revision using local FFmpeg. */
  exportWork?: (id: StudioId, revision: number) => Promise<{ path: string; revision: number; duration: number }>
  /** Read the work catalog. */
  listWorks: () => Promise<StudioCatalog>
  /** Open a complete saved revision. */
  readWork: (id: StudioId) => Promise<StudioDocument>
  /** Create a new work. */
  createWork: (content: StudioContent) => Promise<StudioDocument>
  /** Commit only if the current revision still matches. */
  saveWork: (id: StudioId, revision: number, content: StudioContent) => Promise<StudioDocument>
}

/** HTTP failure used to distinguish conflicts from unavailable storage. */
export class StudioRequestError extends Error {
  constructor(readonly status: number) { super(`Studio HTTP ${status}`) }
}

const PATH = '/api/video-workbench/studio'

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new StudioRequestError(response.status)
  return await response.json() as T
}

/** Create the callbacks once per plugin instance.
 * @returns operations over authenticated same-origin routes.
 */
export function createStudioActions(): StudioActions {
  return {
    exportWork: (id, revision) => request(`${PATH}/export`, { id, revision }),
    listWorks: () => request<StudioCatalog>(PATH),
    readWork: id => request<StudioDocument>(`${PATH}?id=${encodeURIComponent(id)}`),
    createWork: content => request<StudioDocument>(PATH, { content }),
    saveWork: (id, revision, content) => request<StudioDocument>(PATH, { id, revision, content }),
  }
}
