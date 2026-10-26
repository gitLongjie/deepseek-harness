/**
 * The video workbench page: the project catalog on the left, the selected
 * project's shots, keyframes, and final assembly on the right. Data arrives
 * through the injected loader (the host plugin's read-only route); this
 * component holds only presentation and refresh state.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import { workbenchFileUrl } from './endpoints.ts'
import css from './VideoWorkbenchPage.module.css'

/** Host listing types are erased from the browser artifact. */
export type {
  WorkbenchAssetRow as VideoWorkbenchAssetRow,
  WorkbenchProject as VideoWorkbenchProject,
  WorkbenchSegmentRow as VideoWorkbenchSegmentRow,
  WorkbenchSummary as VideoWorkbenchSummary,
} from '@deepseek-ai/dsh-video-workbench'
import type {
  WorkbenchAssetRow as VideoWorkbenchAssetRow,
  WorkbenchSummary as VideoWorkbenchSummary,
} from '@deepseek-ai/dsh-video-workbench'

/**
 * Services injected by the plugin entry: the loader over the host route. The
 * member is flattened into the page props by the slot runtime.
 */
export interface VideoWorkbenchInjected {
  /** Fetch the current listing from the host route. */
  loadSummary: () => Promise<VideoWorkbenchSummary>
  /**
   * Hand one shot back to the chat: leave the workbench, return to the conversation surface, and
   * seed the composer with the shot prompt plus the anchors it renders against. The workbench has no
   * Session binding of its own; this call is the whole hand-off.
   * @param planId - project the shot belongs to.
   * @param segmentId - shot being revised.
   * @param prompt - the shot's current prompt, which the user edits in the composer.
   * @param assets - cast/set/prop anchors the shot names, so the revision keeps the same references.
   * @returns completion; a rejection means the chat could not be reached.
   */
  requestRegeneration: (
    planId: string,
    segmentId: string,
    prompt: string,
    assets: readonly RegenerationAsset[],
    outputDir: string,
  ) => Promise<void>
  /**
   * Delete one project: its plan, keyframes, segments, final cut, and per-plan asset images move
   * into the host's trash directory.
   * @param planId - project id to delete.
   * @returns completion; a rejection carries the host's refusal message.
   */
  deleteProject: (planId: string) => Promise<void>
  /**
   * Delete one recorded asset from a plan and trash the images it named.
   * @param planId - owning project id.
   * @param assetId - asset id to delete.
   * @returns completion; a rejection carries the host's refusal message.
   */
  deleteAsset: (planId: string, assetId: string) => Promise<void>
  /**
   * Hand one recorded asset back to the chat for a fresh image: the composer is seeded with the
   * call that regenerates it, so the user sends it once they are happy with the wording.
   * @param planId - owning project id.
   * @param assetId - asset id to regenerate.
   * @param name - the asset's name, for the message.
   * @param kind - `character`, `scene`, or `prop`.
   * @returns completion; a rejection means the chat could not be reached.
   */
  requestAssetRegeneration: (planId: string, assetId: string, name: string, kind: string) => Promise<void>
}

/** One anchor carried into the regeneration draft. */
export interface RegenerationAsset {
  /** Name the storyboard references. */
  readonly name: string
  /** `character`, `scene`, or `prop`. */
  readonly kind: string
  /** Canonical description or prompt block, when the plan carries one. */
  readonly description?: string
  /** Absolute reference image, when one exists. */
  readonly reference?: string
  /** Absolute character master sheet, when one exists. */
  readonly sheet?: string
}

/** Full page props: main-slot runtime share, the injected loader, and the locale seat. */
export type VideoWorkbenchPageProps =
  & PropsRuntime<'main'>
  & VideoWorkbenchInjected
  & PropsLocale<typeof NS>

/** How often the listing refreshes itself while the page is open. */
const REFRESH_INTERVAL_MS = 10_000

/**
 * The cast, sets, and props shelves, in the order a reader expects: who is in the film, where it
 * happens, what they handle. A plan records all three in one `assets` list, so the shelves are a
 * partition of it rather than a second source; an empty shelf renders no heading at all.
 */
const ASSET_SHELVES = [
  { kind: 'character', key: 'castTitle' },
  { kind: 'scene', key: 'scenesTitle' },
  { kind: 'prop', key: 'propsTitle' },
] as const

/** Whole megabytes for display. */
function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))}`
}

/** The localized mode label of one project. */
function modeLabel(mode: string): 'projectMode.multi_shot' | 'projectMode.per_segment' {
  return mode === 'per_segment' ? 'projectMode.per_segment' : 'projectMode.multi_shot'
}

/** The localized kind label of one asset. */
function kindLabel(kind: string): 'assetKind.character' | 'assetKind.scene' | 'assetKind.prop' {
  if (kind === 'scene') return 'assetKind.scene'
  if (kind === 'prop') return 'assetKind.prop'
  return 'assetKind.character'
}

/**
 * The anchors one shot renders against: the recorded assets whose names its prompt mentions, or
 * every recorded asset when it names none — the same rule the render uses to pick references.
 * @param assets - the project's recorded assets.
 * @param prompt - the shot prompt.
 * @returns the anchors to carry into the regeneration draft.
 */
function shotAnchors(assets: readonly VideoWorkbenchAssetRow[], prompt: string): RegenerationAsset[] {
  const named = assets.filter(asset => prompt.includes(asset.name))
  return (named.length > 0 ? named : assets).map(asset => ({
    name: asset.name,
    kind: asset.kind,
    ...asset.prompt !== undefined ? { description: asset.prompt } : {},
    ...asset.description !== undefined && asset.prompt === undefined ? { description: asset.description } : {},
    ...asset.reference !== undefined ? { reference: asset.reference } : {},
    ...asset.sheet !== undefined ? { sheet: asset.sheet } : {},
  }))
}

/** The video workbench page. */
export function VideoWorkbenchPage({
  loadSummary, requestRegeneration, requestAssetRegeneration, deleteProject, deleteAsset, t,
}: VideoWorkbenchPageProps) {
  const [summary, setSummary] = useState<VideoWorkbenchSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ kind: 'image' | 'video'; src: string; label: string } | null>(null)
  const [handoff, setHandoff] = useState<'sent' | 'failed' | null>(null)
  /** The row awaiting its second click: deleting is destructive, so one click only arms it. */
  const [armed, setArmed] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const listingRequest = useRef(0)

  const refresh = useCallback(() => {
    const request = ++listingRequest.current
    void loadSummary()
      .then((next) => {
        if (request !== listingRequest.current) return
        setSummary(next)
        setFailed(false)
      })
      .catch(() => { if (request === listingRequest.current) setFailed(true) })
  }, [loadSummary])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer); listingRequest.current += 1 }
  }, [refresh])

  useEffect(() => {
    if (preview === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [preview])

  const projects = summary?.projects ?? []
  const selected = projects.find(project => project.id === selectedId) ?? projects[0] ?? null

  const openPreview = (src: string, label: string, kind: 'image' | 'video' = 'image'): void => {
    setPreview({ kind, src, label })
  }

  /**
   * Arm or perform one deletion. The first click on a row's delete button only arms it, so a
   * mis-click cannot remove an episode; the second click runs the host operation.
   * @param key - stable row identity (`project:<id>` or `asset:<plan>:<id>`).
   * @param run - the deletion to perform once armed.
   */
  const removeWithConfirm = (key: string, run: () => Promise<void>): void => {
    if (armed !== key) {
      setArmed(key)
      setRemoveError(null)
      return
    }
    setArmed(null)
    void run()
      .then(() => { refresh() })
      .catch((error: unknown) => {
        setRemoveError(t('removeFailed').replace('{reason}', error instanceof Error ? error.message : String(error)))
      })
  }

  const removeLabel = (key: string): string => (armed === key ? t('removeConfirm') : t('remove'))

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t('title')}</h1>
        <Button size="sm" onClick={refresh}>{t('refresh')}</Button>
      </header>
      {failed && <p className={css.error}>{t('loadFailed')}</p>}
      {summary !== null && summary.errors.length > 0 && (
        <p className={css.error}>{t('errors')}: {summary.errors.length}</p>
      )}
      {summary === null && !failed && <p className={css.hint}>{t('loading')}</p>}
      {summary !== null && projects.length === 0 && (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('empty')}</p>
          <p className={css.hint}>{t('emptyHint')}</p>
        </div>
      )}
      {removeError !== null && <p className={css.error}>{removeError}</p>}
      {summary !== null && projects.length > 0 && (
        <div className={css.columns}>
          <ul className={css.projectList} aria-label={t('title')}>
            {projects.map(project => (
              <li key={project.id} className={css.projectItem}>
                <button
                  type="button"
                  className={project.id === selected?.id ? `${css.projectRow} ${css.projectActive}` : css.projectRow}
                  onClick={() => { setSelectedId(project.id) }}
                >
                  <span className={css.projectId}>{project.id}</span>
                  <span className={css.projectGoal}>{project.goal}</span>
                  <span className={css.projectMeta}>
                    {t(modeLabel(project.mode))}
                    {' · '}
                    {t('revision')} {project.revision}
                  </span>
                </button>
                <button
                  type="button"
                  className={css.removeButton}
                  aria-label={`${removeLabel(`project:${project.id}`)} ${project.id}`}
                  onClick={() => {
                    const key = `project:${project.id}`
                    removeWithConfirm(key, () => deleteProject(project.id))
                  }}
                >
                  {removeLabel(`project:${project.id}`)}
                </button>
              </li>
            ))}
          </ul>
          {selected !== null && (
            <section className={css.detail} aria-label={selected.id}>
              <h2 className={css.detailGoal}>{selected.goal}</h2>
              <p className={css.projectMeta}>
                {selected.id}
                {' · '}
                {t(modeLabel(selected.mode))}
                {' · '}
                {t('revision')} {selected.revision}
              </p>
              {selected.assets.length === 0
                ? <p className={css.hint}>{t('assetsEmpty')}</p>
                : ASSET_SHELVES.map((shelf) => {
                  const rows = selected.assets.filter(asset => asset.kind === shelf.kind)
                  if (rows.length === 0) return null
                  return (
                    <Fragment key={shelf.kind}>
                      <h3 className={css.sectionTitle}>{t(shelf.key)}</h3>
                      <ul className={css.assetList}>
                        {rows.map(asset => (
                          <li key={asset.id} className={css.assetRow}>
                            <div className={css.assetImages}>
                              {asset.reference !== undefined && (
                                <button
                                  type="button"
                                  className={css.assetThumb}
                                  aria-label={`${t('assetPreview')} ${t(kindLabel(asset.kind))} ${asset.name}`}
                                  onClick={() => {
                                    openPreview(
                                      workbenchFileUrl(asset.reference as string, summary.outputDir),
                                      `${t(kindLabel(asset.kind))} ${asset.name}`,
                                    )
                                  }}
                                >
                                  <img
                                    className={css.assetImage}
                                    src={workbenchFileUrl(asset.reference, summary.outputDir)}
                                    alt={`${t(kindLabel(asset.kind))} ${asset.name}`}
                                  />
                                </button>
                              )}
                              {asset.sheet !== undefined && (
                                <button
                                  type="button"
                                  className={css.assetThumb}
                                  aria-label={`${t('assetPreview')} ${t('assetSheet')} ${asset.name}`}
                                  onClick={() => {
                                    openPreview(
                                      workbenchFileUrl(asset.sheet as string, summary.outputDir),
                                      `${t('assetSheet')} ${asset.name}`,
                                    )
                                  }}
                                >
                                  <img
                                    className={css.assetImage}
                                    src={workbenchFileUrl(asset.sheet, summary.outputDir)}
                                    alt={`${t('assetSheet')} ${asset.name}`}
                                  />
                                </button>
                              )}
                            </div>
                            <div className={css.assetMeta}>
                              <span className={css.assetName}>{asset.name}</span>
                              {asset.prompt !== undefined
                                ? <p className={css.assetPrompt}>{asset.prompt}</p>
                                : asset.description !== undefined
                                  ? <p className={css.assetPrompt}>{asset.description}</p>
                                  : null}
                              <span className={asset.saved ? css.assetSaved : css.assetUnsaved}>
                                {asset.saved ? t('assetSaved') : t('assetUnsaved')}
                              </span>
                              <button
                                type="button"
                                className={css.removeButton}
                                onClick={() => {
                                  setHandoff(null)
                                  void requestAssetRegeneration(selected.id, asset.id, asset.name, asset.kind)
                                    .then(() => { setHandoff('sent') })
                                    .catch(() => { setHandoff('failed') })
                                }}
                              >
                                {t('assetRegenerate')}
                              </button>
                              <button
                                type="button"
                                className={css.removeButton}
                                aria-label={`${removeLabel(`asset:${selected.id}:${asset.id}`)} ${asset.name}`}
                                onClick={() => {
                                  const key = `asset:${selected.id}:${asset.id}`
                                  removeWithConfirm(key, () => deleteAsset(selected.id, asset.id))
                                }}
                              >
                                {removeLabel(`asset:${selected.id}:${asset.id}`)}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Fragment>
                  )
                })}
              <h3 className={css.sectionTitle}>{t('segments')}</h3>
              <ul className={css.segmentList}>
                {selected.segments.map((segment) => {
                  const shotLabel = `${t('segments')} ${segment.id}`
                  const poster = segment.keyframe
                  const anchors = shotAnchors(selected.assets, segment.prompt)
                  return (
                    <li key={segment.id} className={css.segmentRow}>
                      {segment.file !== undefined
                        ? (
                          <video
                            className={css.segmentVideo}
                            src={workbenchFileUrl(segment.file, summary.outputDir)}
                            poster={poster === undefined ? undefined : workbenchFileUrl(poster, summary.outputDir)}
                            controls
                            preload="metadata"
                            aria-label={shotLabel}
                          />
                        )
                        : poster === undefined
                          ? <span className={css.keyframeEmpty} aria-hidden="true" />
                          : (
                            <button
                              type="button"
                              className={css.segmentThumb}
                              aria-label={`${t('assetPreview')} ${shotLabel}`}
                              onClick={() => {
                                openPreview(workbenchFileUrl(poster, summary.outputDir), shotLabel)
                              }}
                            >
                              <img
                                className={css.keyframe}
                                src={workbenchFileUrl(poster, summary.outputDir)}
                                alt={`${t('keyframe')} ${segment.id}`}
                              />
                            </button>
                          )}
                      <span className={css.segmentMeta}>
                        {segment.id}
                        {' — '}
                        {segment.rendered ? t('segmentRendered') : t('segmentPending')}
                      </span>
                      <ol className={css.shotDetails} aria-label={t('storyboard')}>
                        {segment.shots.map(shot => (
                          <li key={shot.id}>
                            <span className={css.segmentMeta}>
                              {shot.id}
                              {shot.durationSeconds === undefined ? '' : ` · ${t('shotDuration').replace('{seconds}', String(shot.durationSeconds))}`}
                              {[shot.resolution, shot.ratio].filter(Boolean).map(value => ` · ${value}`).join('')}
                            </span>
                            <p className={css.assetPrompt}>{shot.prompt}</p>
                            {shot.camera !== undefined && <p className={css.segmentMeta}>{shot.camera}</p>}
                          </li>
                        ))}
                      </ol>
                      {anchors.length > 0 && (
                        <span className={css.segmentMeta}>
                          {t('segmentAnchors')}: {anchors.map(asset => asset.name).join('、')}
                        </span>
                      )}
                      <button
                        type="button"
                        className={css.segmentRegenerate}
                        onClick={() => {
                          setHandoff(null)
                          void requestRegeneration(
                            selected.id,
                            segment.id,
                            segment.prompt,
                            shotAnchors(selected.assets, segment.prompt),
                            summary.outputDir,
                          )
                            .then(() => { setHandoff('sent') })
                            .catch(() => { setHandoff('failed') })
                        }}
                      >
                        {t(segment.id === 'all' ? 'storyboardRegenerate' : 'segmentRegenerate')}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {handoff !== null && (
                <p className={handoff === 'sent' ? css.hint : css.error}>
                  {handoff === 'sent' ? t('segmentRegenerateHint') : t('segmentRegenerateFailed')}
                </p>
              )}
              <h3 className={css.sectionTitle}>{t('finalTitle')}</h3>
              {selected.final !== undefined
                ? (
                  <video
                    className={css.finalVideo}
                    src={workbenchFileUrl(selected.final, summary.outputDir)}
                    controls
                    preload="metadata"
                  />
                )
                : <p className={css.hint}>{t('finalMissing')}</p>}
              {selected.final !== undefined && selected.finalBytes !== undefined && (
                <p className={css.projectMeta}>{megabytes(selected.finalBytes)} {t('bytes.mb')}</p>
              )}
            </section>
          )}
        </div>
      )}
      {preview !== null && (
        <div
          className={css.previewBackdrop}
          role="presentation"
          onClick={() => { setPreview(null) }}
        >
          <div
            className={css.previewPanel}
            role="dialog"
            aria-modal="true"
            aria-label={preview.label}
            onClick={(event) => { event.stopPropagation() }}
          >
            {preview.kind === 'video'
              ? <video className={css.previewVideo} src={preview.src} controls autoPlay aria-label={preview.label} />
              : <img className={css.previewImage} src={preview.src} alt={preview.label} />}
            <p className={css.previewMeta}>{preview.label}</p>
            <Button size="sm" onClick={() => { setPreview(null) }}>{t('assetPreviewClose')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
