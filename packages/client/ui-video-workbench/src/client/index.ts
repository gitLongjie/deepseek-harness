/**
 * Video workbench plugin, browser half. Two registrations over the layout's
 * global-panel mechanism: the sidebar rail row (id `video-workbench`) and the
 * matching keyed `main` entry rendering the project catalog. Data arrives from
 * the host plugin's read-only routes over the h3-video output directory; the
 * listing types are imported type-only from the host and erased from the browser artifact.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the layout Context merge (ctx.layout) and the main slot.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar slot declaration this entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the sessions service merge (ctx.sessions) and the session face.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconPlayOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, NS, zh, type VideoWorkbenchKey } from './locales.ts'
import {
  WORKBENCH_ASSET_DELETE_PATH,
  WORKBENCH_PROJECT_DELETE_PATH,
  WORKBENCH_PROJECTS_PATH,
  workbenchFileUrl,
} from './endpoints.ts'
import { VideoWorkbenchPage, type RegenerationAsset, type VideoWorkbenchInjected, type VideoWorkbenchSummary } from './VideoWorkbenchPage.tsx'

export type { VideoWorkbenchKey } from './locales.ts'
export type {
  VideoWorkbenchInjected,
  VideoWorkbenchPageProps,
  VideoWorkbenchProject,
  VideoWorkbenchSegmentRow,
  VideoWorkbenchSummary,
} from './VideoWorkbenchPage.tsx'
export { workbenchFileUrl, WORKBENCH_PROJECTS_PATH } from './endpoints.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Video workbench page copy. */
    videoWorkbench: VideoWorkbenchKey
  }
}

/** Dictionary namespace owned by this plugin. */
export { NS } from './locales.ts'

/** The sidebar row id and the matching keyed main-panel key. */
export const PANEL_ID = 'video-workbench'

/**
 * The composer surface this panel writes into. Spelled structurally rather than imported: the
 * workbench reaches ui-conversation's service through the session scope, and a feature plugin
 * takes only the members it calls.
 */
interface ComposerDraftFace {
  input: {
    for(ctx: Context): {
      setDraft(text: string): void
      addAttachments(ids: readonly string[]): boolean
    }
  }
  createDrafts(sessionId: SessionId, files: readonly File[]): ReadonlyArray<{ id: string }>
}

/**
 * POST one JSON body to a workbench route and surface the host's refusal message.
 * @param path - route path.
 * @param body - JSON payload.
 * @returns completion; a non-ok answer rejects with the host's message.
 */
async function postJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return
  const detail = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string }
  throw new Error(detail.error ?? `HTTP ${response.status}`)
}

/**
 * Read the anchor images through the workbench's own file route and turn them into browser files,
 * so the composer can show them as attachments instead of a path the user cannot see.
 * @param assets - anchors carried into the draft.
 * @param outputDir - the projected root the file route resolves paths against.
 * @returns the images that could be read, in asset order.
 */
async function anchorFiles(assets: readonly RegenerationAsset[], outputDir: string): Promise<File[]> {
  const paths = assets
    .flatMap(asset => [asset.reference, asset.sheet])
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
  const files: File[] = []
  for (const path of paths) {
    try {
      const response = await fetch(workbenchFileUrl(path, outputDir))
      if (!response.ok) continue
      const blob = await response.blob()
      const name = path.split(/[\\/]/u).pop() ?? 'anchor'
      files.push(new File([blob], name, { type: blob.type.length > 0 ? blob.type : 'image/jpeg' }))
    } catch {
      // A missing or unreadable anchor keeps the draft; the mention text still names the path.
      continue
    }
  }
  return files
}

/** Panel row order: beside the scheduled-work row, before future rows. */
const PANEL_ORDER = 70

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-sidebar and ui-layout applies, whose activation order relative to this
 * one is NOT constrained: apply therefore depends on each declaration
 * through `slots.inject()` instead of assuming order. `layout` closes the panel when a shot is
 * handed back to the chat, which is the only navigation this page performs.
 */
export const inject = ['slots', 'locale', 'layout', 'sessions'] as const

/**
 * Register the sidebar panel row and the workbench page once their slot
 * declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-video-workbench: dictionaries')

  // The panel row's label re-reads on every sidebar projection, so the
  // localized name follows the active locale without re-registration.
  const navLabel = (): string => {
    const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
    return dictionary.title
  }

  const injected: VideoWorkbenchInjected = {
    loadSummary: async () => {
      const response = await fetch(WORKBENCH_PROJECTS_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`video workbench listing failed with HTTP ${response.status}`)
      return await response.json() as VideoWorkbenchSummary
    },
    deleteProject: async (planId: string): Promise<void> => {
      await postJson(WORKBENCH_PROJECT_DELETE_PATH, { id: planId })
    },
    deleteAsset: async (planId: string, assetId: string): Promise<void> => {
      await postJson(WORKBENCH_ASSET_DELETE_PATH, { planId, assetId })
    },
    requestAssetRegeneration: (
      planId: string,
      assetId: string,
      name: string,
      kind: string,
    ): Promise<void> => {
      const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
      const kindLabel = kind === 'scene'
        ? dictionary['assetKind.scene']
        : kind === 'prop' ? dictionary['assetKind.prop'] : dictionary['assetKind.character']
      const draft = dictionary.assetRegenerateRequest
        .replaceAll('{plan}', planId)
        .replace('{assetId}', assetId)
        .replace('{name}', name)
        .replace('{kind}', kindLabel)
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return Promise.reject(new Error('no Session is open to receive the request'))
      const scoped = ctx.sessions.scope(current)
      if (scoped === undefined) return Promise.reject(new Error(`Session ${current} is not addressable`))
      const conversation = scoped.get('conversation') as ComposerDraftFace | undefined
      if (conversation === undefined) return Promise.reject(new Error('the open Session has no composer'))
      ctx.layout.selectPanel(null)
      conversation.input.for(scoped).setDraft(draft)
      return Promise.resolve()
    },
    requestRegeneration: async (
      planId: string,
      segmentId: string,
      prompt: string,
      assets: readonly RegenerationAsset[],
      outputDir: string,
    ): Promise<void> => {
      const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
      const kind = (value: string): string => value === 'scene'
        ? dictionary['assetKind.scene']
        : value === 'prop' ? dictionary['assetKind.prop'] : dictionary['assetKind.character']
      const anchors = assets.map((asset) => {
        // Each asset carries its own images on its own line: a shared block at the top loses which
        // picture belongs to which name, which is the only thing keeping the cast consistent.
        const references = [asset.reference, asset.sheet]
          .filter((path): path is string => typeof path === 'string' && path.length > 0)
          .map(path => dictionary.segmentRegenerateReference.replace('{path}', path))
          .join(' ')
        return dictionary.segmentRegenerateAsset
          .replace('{name}', asset.name)
          .replace('{kind}', kind(asset.kind))
          .replace('{description}', asset.description ?? '')
          .replace('{references}', references)
      })
      const draft = (segmentId === 'all' ? dictionary.storyboardRegenerateRequest : dictionary.segmentRegenerateRequest)
        .replace('{plan}', planId)
        .replace('{segment}', segmentId)
        .replace('{prompt}', prompt)
        .replace('{assets}', anchors.join('\n'))
      // The workbench is a root-scope panel with no Session binding of its own, so it reaches the
      // open Session through the sessions service: `scope()` hands out an Agent-scoped context, and
      // the conversation service's input facade for that scope owns the composer draft.
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) throw new Error('no Session is open to receive the request')
      const scoped = ctx.sessions.scope(current)
      if (scoped === undefined) throw new Error(`Session ${current} is not addressable`)
      const conversation = scoped.get('conversation') as ComposerDraftFace | undefined
      if (conversation === undefined) throw new Error('the open Session has no composer')
      // Attach the anchors as real images so the chat shows them instead of pasting paths; the
      // mention text stays for the paths the render actually takes.
      const files = await anchorFiles(assets, outputDir)
      if (ctx.sessions.list.getSnapshot().current !== current) throw new Error('the open Session changed during image loading')
      const drafts = files.length === 0 ? [] : conversation.createDrafts(current, files)
      // Seed the composer instead of sending: the user edits the prompt there and decides to send.
      conversation.input.for(scoped).setDraft(draft)
      if (drafts.length > 0) conversation.input.for(scoped).addAttachments(drafts.map(entry => entry.id))
      ctx.layout.selectPanel(null)
    },
  }

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    {
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: PANEL_ORDER,
      label: navLabel,
      locale: NS,
    },
    // Icon-only cell: the sidebar shell owns the row button and its label.
    ({ size }: { size: number; active: boolean }) => createElement(IconPlayOutline16, { size }),
  ))

  ctx.slots.inject('main', () => ctx.slots.register(
    {
      name: 'main',
      key: PANEL_ID,
      inject: () => injected,
      locale: NS,
    },
    VideoWorkbenchPage,
  ))
}
