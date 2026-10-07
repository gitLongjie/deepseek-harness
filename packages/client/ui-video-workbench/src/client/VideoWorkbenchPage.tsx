/**
 * The video workbench page: the project catalog on the left, the selected
 * project's shots, keyframes, and final assembly on the right. Data arrives
 * through the injected loader (the host plugin's read-only route); this
 * component holds only presentation and refresh state.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import { workbenchFileUrl } from './endpoints.ts'
import css from './VideoWorkbenchPage.module.css'

/** One rendered-shot row, mirrored from the host listing. */
export interface VideoWorkbenchSegmentRow {
  /** Plan segment id (`all` for a multi-shot render). */
  readonly id: string
  /** Whether the canonical segment mp4 exists. */
  readonly rendered: boolean
  /** Absolute keyframe path when one exists. */
  readonly keyframe?: string
}

/** One video project, mirrored from the host listing. */
export interface VideoWorkbenchProject {
  /** Plan id, e.g. `vp-3`. */
  readonly id: string
  /** Plan revision number. */
  readonly revision: number
  /** One-line goal the plan serves. */
  readonly goal: string
  /** Render mode (`multi_shot` or `per_segment`). */
  readonly mode: string
  /** Plan creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Shot rows with their on-disk state. */
  readonly segments: readonly VideoWorkbenchSegmentRow[]
  /** Absolute final-assembly mp4 path when one exists. */
  readonly final?: string
  /** Bytes of the final assembly, when present. */
  readonly finalBytes?: number
}

/** The whole listing the page renders, mirrored from the host route. */
export interface VideoWorkbenchSummary {
  /** Absolute projected directory. */
  readonly outputDir: string
  /** Projects, newest plan first. */
  readonly projects: readonly VideoWorkbenchProject[]
  /** One message per unreadable or corrupt plan file. */
  readonly errors: readonly string[]
}

/**
 * Services injected by the plugin entry: the loader over the host route. The
 * member is flattened into the page props by the slot runtime.
 */
export interface VideoWorkbenchInjected {
  /** Fetch the current listing from the host route. */
  loadSummary: () => Promise<VideoWorkbenchSummary>
}

/** Full page props: main-slot runtime share, the injected loader, and the locale seat. */
export type VideoWorkbenchPageProps =
  & PropsRuntime<'main'>
  & VideoWorkbenchInjected
  & PropsLocale<typeof NS>

/** How often the listing refreshes itself while the page is open. */
const REFRESH_INTERVAL_MS = 10_000

/** Whole megabytes for display. */
function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))}`
}

/** The localized mode label of one project. */
function modeLabel(mode: string): 'projectMode.multi_shot' | 'projectMode.per_segment' {
  return mode === 'per_segment' ? 'projectMode.per_segment' : 'projectMode.multi_shot'
}

/** The video workbench page. */
export function VideoWorkbenchPage({ loadSummary, t }: VideoWorkbenchPageProps) {
  const [summary, setSummary] = useState<VideoWorkbenchSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void loadSummary()
      .then((next) => { setSummary(next); setFailed(false) })
      .catch(() => { setFailed(true) })
  }, [loadSummary])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  const projects = summary?.projects ?? []
  const selected = projects.find(project => project.id === selectedId) ?? projects[0] ?? null

  return (
    <div className={css.page}>
      <header className={css.header}>
        <h1 className={css.title}>{t('title')}</h1>
        <Button size="sm" onClick={refresh}>{t('refresh')}</Button>
      </header>
      {failed && <p className={css.error}>{t('loadFailed')}</p>}
      {summary === null && !failed && <p className={css.hint}>{t('loading')}</p>}
      {summary !== null && projects.length === 0 && (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('empty')}</p>
          <p className={css.hint}>{t('emptyHint')}</p>
        </div>
      )}
      {summary !== null && projects.length > 0 && (
        <div className={css.columns}>
          <ul className={css.projectList} aria-label={t('title')}>
            {projects.map(project => (
              <li key={project.id}>
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
              <h3 className={css.sectionTitle}>{t('segments')}</h3>
              <ul className={css.segmentList}>
                {selected.segments.map(segment => (
                  <li key={segment.id} className={css.segmentRow}>
                    {segment.keyframe !== undefined && (
                      <img
                        className={css.keyframe}
                        src={workbenchFileUrl(segment.keyframe, summary.outputDir)}
                        alt={`${t('keyframe')} ${segment.id}`}
                      />
                    )}
                    <span className={css.segmentMeta}>
                      {segment.id}
                      {' — '}
                      {segment.rendered ? t('segmentRendered') : t('segmentPending')}
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className={css.sectionTitle}>{t('finalTitle')}</h3>
              {selected.final !== undefined
                ? (
                  <video
                    className={css.finalVideo}
                    src={workbenchFileUrl(selected.final, summary.outputDir)}
                    controls
                  />
                )
                : <p className={css.hint}>{t('finalMissing')}</p>}
              {selected.final !== undefined && selected.finalBytes !== undefined && (
                <p className={css.projectMeta}>{megabytes(selected.finalBytes)} {t('bytes.mb')}</p>
              )}
              {summary.errors.length > 0 && (
                <p className={css.hint}>{t('errors')}: {summary.errors.length}</p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
