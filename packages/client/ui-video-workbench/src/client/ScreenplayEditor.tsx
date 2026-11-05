/** Explicitly saved screenplay drafts; failed saves and conflicts retain the local text. */
import { useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { StudioContent, StudioDocument, StudioId, StudioSummary, ScriptKind } from '@deepseek-ai/dsh-video-workbench'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { StudioRequestError, type StudioActions } from './studio-api.ts'
import { StudioAuthoringPanel } from './StudioAuthoringPanel.tsx'
import { workbenchFileUrl } from './endpoints.ts'
import { NS } from './locales.ts'
import css from './VideoWorkbenchPage.module.css'

type Props = StudioActions & Pick<PropsLocale<typeof NS>, 't'> & { media?: readonly string[]; mode?: 'screenplay' | 'canvas' | 'graph' | 'director' | 'editor' | 'skills' }
type History = { past: StudioContent[]; present: StudioContent; future: StudioContent[] }
const KINDS: readonly ScriptKind[] = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition']

/** The screenplay authoring view; loading is user initiated and navigation preserves dirty drafts.
 * @param props - injected storage operations and locale.
 * @returns editor with source comparison, block operations and Fountain download.
 */
export function ScreenplayEditor({ listWorks, readWork, createWork, saveWork, exportWork, requestSkill, t, media = [], mode = 'screenplay' }: Props) {
  const [exported, setExported] = useState<{ path: string; revision: number } | null>(null)
  const [works, setWorks] = useState<StudioSummary[]>([])
  const [document, setDocument] = useState<StudioDocument | null>(null)
  const [history, setHistory] = useState<History>({ past: [], present: { title: '', source: '', blocks: [] }, future: [] })
  const [baseline, setBaseline] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | 'conflict' | 'damaged' | 'exportFailed' | null>(null)
  const [choice, setChoice] = useState('')
  const [discard, setDiscard] = useState(false)
  const draft = history.present
  const dirty = JSON.stringify(draft) !== (baseline || JSON.stringify({ title: '', source: '', blocks: [] }))
  const change = (next: StudioContent): void => {
    setHistory(old => ({ past: [...old.past.slice(-99), old.present], present: next, future: [] }))
    setNotice(null)
    setDiscard(false)
  }
  const adopt = (next: StudioDocument): void => {
    const { format: _format, version: _version, id: _id, revision: _revision, updatedAt: _updatedAt, ...content } = next
    setDocument(next)
    setExported(null)
    setHistory({ past: [], present: content, future: [] })
    setBaseline(JSON.stringify(content))
    setDiscard(false)
  }
  const failed = (error: unknown): void => { setNotice(error instanceof StudioRequestError && error.status === 409 ? 'conflict' : 'failed') }
  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const catalog = await listWorks()
      setWorks(catalog.works)
      setNotice(catalog.errors.length > 0 ? 'damaged' : null)
    } catch (error) { failed(error) } finally { setBusy(false) }
  }
  const open = async (): Promise<void> => {
    if (dirty && !discard) { setDiscard(true); return }
    setBusy(true)
    try {
      if (choice === '') {
        const content: StudioContent = { title: '', source: '', blocks: [] }
        setDocument(null); setExported(null); setHistory({ past: [], present: content, future: [] }); setBaseline(''); setDiscard(false)
      } else { adopt(await readWork(choice as StudioId)) }
      setNotice(null)
    } catch (error) { failed(error) } finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = document === null ? await createWork(draft) : await saveWork(document.id, document.revision, draft)
      adopt(next)
      setChoice(next.id)
      setWorks(old => [next, ...old.filter(work => work.id !== next.id)])
      setNotice('saved')
    } catch (error) { failed(error) } finally { setBusy(false) }
  }
  const renderMovie = async (): Promise<void> => {
    if (document === null || exportWork === undefined || dirty) return
    setBusy(true)
    setExported(null)
    try { setExported(await exportWork(document.id, document.revision)) }
    catch (error) { setNotice(error instanceof StudioRequestError && error.status === 409 ? 'conflict' : 'exportFailed') }
    finally { setBusy(false) }
  }
  const move = (index: number, delta: number): void => {
    const blocks = [...draft.blocks]
    const block = blocks[index]
    if (block === undefined || index + delta < 0 || index + delta >= blocks.length) return
    blocks.splice(index, 1); blocks.splice(index + delta, 0, block)
    change({ ...draft, blocks })
  }
  const downloadProject = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }))
    const anchor = globalThis.document.createElement('a')
    anchor.href = url
    anchor.download = 'production-work.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const download = (): void => {
    const body = draft.blocks.map((block) => {
      switch (block.kind) {
        case 'scene': return `.${block.text}`
        case 'character': return `@${block.text}`
        case 'parenthetical': return `(${block.text})`
        case 'transition': return `> ${block.text}`
        case 'action': case 'dialogue': return block.text
      }
    }).map((text, index) => {
      const kind = draft.blocks[index]?.kind
      const previous = draft.blocks[index - 1]?.kind
      const continuation = (kind === 'dialogue' || kind === 'parenthetical') && (previous === 'character' || previous === 'parenthetical' || previous === 'dialogue')
      return `${index === 0 ? '' : continuation ? '\n' : '\n\n'}${text}`
    }).join('')
    const url = URL.createObjectURL(new Blob([`Title: ${draft.title}\n\n${body}\n`], { type: 'text/plain;charset=utf-8' }))
    const anchor = globalThis.document.createElement('a')
    anchor.href = url; anchor.download = 'screenplay.fountain'; anchor.click()
    URL.revokeObjectURL(url)
  }
  return <section className={css.scriptEditor} aria-label={t(`studio.${mode}`)}>
    <div className={css.scriptToolbar}>
      <button type="button" disabled={busy} onClick={() => { void refresh() }}>{t('script.list')}</button>
      <select aria-label={t('script.work')} disabled={busy} value={choice} onChange={(e) => { setChoice(e.target.value); setDiscard(false) }}>
        <option value="">{t('script.new')}</option>
        {works.map(work => <option key={work.id} value={work.id}>{work.title}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => { void open() }}>{t(discard ? 'script.discard' : 'script.open')}</button>
      <button type="button" disabled={busy || !draft.title.trim() || !dirty} onClick={() => { void save() }}>{t(busy ? 'script.busy' : 'script.save')}</button>
      <button type="button" disabled={busy || history.past.length === 0} onClick={() => {
        const previous = history.past.at(-1)
        if (previous) {
          setHistory({ past: history.past.slice(0, -1), present: previous, future: [draft, ...history.future] }); setNotice(null)
        }
      }}>{t('script.undo')}</button>
      <button type="button" disabled={busy || history.future.length === 0} onClick={() => {
        const next = history.future[0]
        if (next) { setHistory({ past: [...history.past, draft], present: next, future: history.future.slice(1) }); setNotice(null)
        }
      }}>{t('script.redo')}</button>
      {mode === 'editor' && exportWork !== undefined && <button type="button"
        disabled={busy || dirty || document === null} onClick={() => { void renderMovie() }}>{t('editor.export')}</button>}
      <button type="button" disabled={busy} onClick={downloadProject}>{t('studio.backup')}</button>
      <button type="button" disabled={busy || !draft.title.trim()} onClick={download}>{t('script.export')}</button>
    </div>
    <p role="status" className={notice === 'failed' || notice === 'conflict' || notice === 'damaged' ? css.error : css.hint}>
      {notice ? t(`script.${notice}`) : t(dirty ? 'script.dirty' : 'script.ready')}
      {document !== null ? ` · ${t('revision')} ${document.revision}` : ''}
    </p>
    {exported !== null && <div>
      <p>{t('revision')} {exported.revision}</p>
      <video controls src={workbenchFileUrl(exported.path, '')} />
      <a href={workbenchFileUrl(exported.path, '')} download>{t('editor.download')}</a>
    </div>}
    <fieldset disabled={busy} className={css.scriptFields}>
      <label>{t('script.title')}<input value={draft.title} onChange={(e) => { change({ ...draft, title: e.target.value }) }} /></label>
      {mode === 'screenplay' ? <div className={css.scriptColumns}>
        <label>{t('script.source')}<textarea className={css.scriptSource} value={draft.source} onChange={(e) => { change({ ...draft, source: e.target.value }) }} /></label>
        <div className={css.scriptBlocks}>
          {draft.blocks.map((block, index) => <div key={block.id} className={css.scriptBlock} data-kind={block.kind}>
            <div className={css.scriptToolbar}>
              <select aria-label={`${t('script.kind')} ${index + 1}`} value={block.kind} onChange={(e) => {
                change({ ...draft, blocks: draft.blocks.map(row =>
                  row.id === block.id ? { ...row, kind: e.target.value as ScriptKind } : row) })
              }}>{KINDS.map(kind => <option key={kind} value={kind}>{t(`script.kind.${kind}`)}</option>)}</select>
              <button type="button" disabled={index === 0} onClick={() => { move(index, -1) }}>{t('script.up')}</button>
              <button type="button" disabled={index === draft.blocks.length - 1} onClick={() => { move(index, 1) }}>{t('script.down')}</button>
              <button type="button" onClick={() => { change({ ...draft, blocks: draft.blocks.filter(row => row.id !== block.id) }) }}>{t('script.remove')}</button>
            </div>
            <textarea aria-label={`${t(`script.kind.${block.kind}`)} ${index + 1}`} value={block.text} onChange={(e) => {
              change({ ...draft, blocks: draft.blocks.map(row => row.id === block.id ? { ...row, text: e.target.value } : row) })
            }} />
          </div>)}
          <button type="button" onClick={() => {
            change({ ...draft, blocks: [...draft.blocks, { id: randomUUID() as StudioId, kind: draft.blocks.length === 0 ? 'scene' : 'action', text: '' }] })
          }}>{t('script.add')}</button>
        </div>
      </div> : mode === 'skills' ? <div className={css.studioGrid}>
        {([
          ['characterConsistency', 'character-consistency'], ['personaDesign', 'character-design'],
          ['goldenThree', 'opening-three-chapters'], ['humanizeAi', 'natural-prose-editing'],
        ] as const).map(([label, skill]) => <article key={skill} className={css.studioCard}>
          <strong>{t(`skill.${label}`)}</strong><p>{t(`skill.${label}Hint`)}</p>
          <button type="button" disabled={busy || dirty || document === null || requestSkill === undefined} onClick={() => {
            if (document === null || requestSkill === undefined) return
            void requestSkill(skill, document.id, document.revision).catch(failed)
          }}>{t('studio.useSkill')}</button>
        </article>)}
        <p>{t('studio.skillHint')}</p>
      </div> : <StudioAuthoringPanel media={media} mode={mode} content={draft} onChange={change} t={t} />}
    </fieldset>
  </section>
}
