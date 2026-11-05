/** Production collection fields sharing the parent-owned work and undo history. */
import { useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioContent, StudioId } from '@deepseek-ai/dsh-video-workbench'
import { DirectorViewport } from './DirectorViewport.tsx'
import { workbenchFileUrl } from './endpoints.ts'
import { NS } from './locales.ts'
import css from './VideoWorkbenchPage.module.css'

type Mode = 'canvas' | 'director' | 'editor' | 'graph'
type Props = Pick<PropsLocale<typeof NS>, 't'> & {
  mode: Mode
  media: readonly string[]
  content: StudioContent
  onChange: (next: StudioContent) => void
}
const id = (): StudioId => randomUUID() as StudioId

/** Edit collections within the parent-owned work.
 * @param props - mode, complete draft, mutation callback and locale.
 * @returns fields covered by the parent save, conflict and undo behavior.
 */
export function StudioAuthoringPanel({ mode, content, media, onChange, t }: Props) {
  const cards = content.canvas ?? []
  const graph = content.graph ?? { nodes: [], edges: [] }
  const scenes = content.director ?? []
  const tracks = content.edit?.tracks ?? []
  const timelineDuration = tracks.reduce((end, track) =>
    track.clips.reduce((last, clip) => Math.max(last, clip.start + clip.duration), end), 1)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ id: StudioId; x: number; y: number } | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [relationship, setRelationship] = useState('')
  const positions = new Map(graph.nodes.map((node, index) => [node.id, {
    x: 300 + 220 * Math.cos(index * Math.PI * 2 / graph.nodes.length),
    y: 220 + 150 * Math.sin(index * Math.PI * 2 / graph.nodes.length),
  }]))

  if (mode === 'canvas') return <section className={css.scriptEditor}>
    <div className={css.scriptToolbar}>
      <button type="button" onClick={() => { onChange({ ...content, canvas: [...cards, {
        id: id(), kind: 'scene', title: t('canvas.newCard'), text: '', x: cards.length * 220, y: 60,
      }] }) }}>{t('canvas.add')}</button>
      <label>{t('canvas.zoom')}<input type="range" min="0.25" max="2" step="0.05" value={zoom}
        onChange={(event) => { setZoom(Number(event.target.value)) }} /></label>
    </div>
    <div className={css.canvasBoard}>
      <div style={{ position: 'relative', width: Math.max(1200, ...cards.map(card => card.x + 240)) * zoom,
        height: Math.max(600, ...cards.map(card => card.y + 230)) * zoom }}>
        {cards.map(card => <article key={card.id} className={css.canvasCard}
          style={{ left: card.x * zoom, top: card.y * zoom, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <button type="button" aria-label={`${t('canvas.move')} ${card.title}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setDrag({ id: card.id, x: event.clientX, y: event.clientY })
            }}
            onPointerUp={(event) => {
              if (drag?.id !== card.id) return
              onChange({ ...content, canvas: cards.map(row => row.id === card.id ? {
                ...row, x: Math.max(0, row.x + (event.clientX - drag.x) / zoom),
                y: Math.max(0, row.y + (event.clientY - drag.y) / zoom),
              } : row) })
              setDrag(null)
            }}
            onPointerCancel={() => { setDrag(null) }}>{t('canvas.move')}</button>
          <input value={card.title} aria-label={t('canvas.cardTitle')}
            onChange={(event) => { onChange({ ...content, canvas: cards.map(row =>
              row.id === card.id ? { ...row, title: event.target.value } : row) }) }} />
          <label>{t('editor.source')}<input value={card.source ?? ''} onChange={(event) => {
            onChange({ ...content, canvas: cards.map(row => row.id === card.id ? { ...row, source: event.target.value } : row) })
          }} /></label>
          {card.source && (/\.(mp4|webm|mov)$/iu.test(card.source)
            ? <video controls src={workbenchFileUrl(card.source, '')} />
            : /\.(mp3|wav)$/iu.test(card.source)
              ? <audio controls src={workbenchFileUrl(card.source, '')} />
              : <img src={workbenchFileUrl(card.source, '')} alt={card.title} />)}
          <textarea value={card.text} aria-label={t('canvas.cardText')}
            onChange={(event) => { onChange({ ...content, canvas: cards.map(row =>
              row.id === card.id ? { ...row, text: event.target.value } : row) }) }} />
          {(['x', 'y'] as const).map(axis => <label key={axis}>{axis}<input type="number" min="0" value={card[axis]}
            onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ ...content,
              canvas: cards.map(row => row.id === card.id ? { ...row, [axis]: Math.max(0, event.target.valueAsNumber) } : row),
            }) }} /></label>)}
          <button type="button" onClick={() => { onChange({ ...content, canvas: cards.filter(row => row.id !== card.id) }) }}>
            {t('script.remove')}</button>
        </article>)}
      </div>
    </div>
  </section>

  if (mode === 'graph') return <section className={css.scriptEditor}>
    <svg viewBox="0 0 600 440" className={css.relationshipMap} role="img" aria-label={t('studio.graph')}>
      {graph.edges.map((edge) => {
        const a = positions.get(edge.from)
        const b = positions.get(edge.to)
        if (a === undefined || b === undefined) return null
        return <g key={edge.id}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" />
          <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2}>{edge.label}</text>
        </g>
      })}
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)
        if (position === undefined) return null
        return <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
          <circle r="30" /><text textAnchor="middle" y="45">{node.label}</text>
        </g>
      })}
    </svg>
    <div className={css.graphEditor}>{graph.nodes.map(node => <div key={node.id} className={css.graphEditRow}>
      <input value={node.label} aria-label={t('graph.node')} onChange={(event) => { onChange({ ...content,
        graph: { ...graph, nodes: graph.nodes.map(row => row.id === node.id ? { ...row, label: event.target.value } : row) },
      }) }} />
      <button type="button" onClick={() => { onChange({ ...content, graph: {
        nodes: graph.nodes.filter(row => row.id !== node.id),
        edges: graph.edges.filter(edge => edge.from !== node.id && edge.to !== node.id),
      } }) }}>{t('script.remove')}</button>
    </div>)}</div>
    <button type="button" onClick={() => { onChange({ ...content, graph: {
      ...graph, nodes: [...graph.nodes, { id: id(), label: t('graph.newNode'), kind: 'character' }],
    } }) }}>{t('graph.addNode')}</button>
    <div className={css.scriptToolbar}>
      <select aria-label={t('graph.from')} value={from} onChange={(event) => { setFrom(event.target.value) }}>
        <option value="">{t('graph.from')}</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
      </select>
      <input aria-label={t('graph.relationship')} value={relationship} onChange={(event) => { setRelationship(event.target.value) }} />
      <select aria-label={t('graph.to')} value={to} onChange={(event) => { setTo(event.target.value) }}>
        <option value="">{t('graph.to')}</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
      </select>
      <button type="button" disabled={!relationship.trim() || from === to || !positions.has(from as StudioId) || !positions.has(to as StudioId)}
        onClick={() => { onChange({ ...content, graph: { ...graph, edges: [...graph.edges, {
          id: id(), from: from as StudioId, to: to as StudioId, label: relationship,
        }] } }) }}>{t('graph.addEdge')}</button>
    </div>
    {graph.edges.map(edge => <div key={edge.id} className={css.graphEditRow}>
      <span>{graph.nodes.find(node => node.id === edge.from)?.label}
        {` → ${edge.label} → `}{graph.nodes.find(node => node.id === edge.to)?.label}</span>
      <button type="button" onClick={() => { onChange({ ...content, graph: {
        ...graph, edges: graph.edges.filter(row => row.id !== edge.id),
      } }) }}>{t('script.remove')}</button>
    </div>)}
  </section>

  if (mode === 'director') return <section className={css.scriptEditor}>
    <p className={css.hint}>{t('director.dataOnly')}</p>
    <div className={css.studioGrid}>{scenes.map(scene => <article key={scene.id} className={css.studioCard}>
      <input value={scene.name} aria-label={t('director.scene')}
        onChange={(event) => { onChange({ ...content, director: scenes.map(row =>
          row.id === scene.id ? { ...row, name: event.target.value } : row) }) }} />
      <label>{t('director.camera')}<input value={scene.camera} onChange={(event) => { onChange({ ...content,
        director: scenes.map(row => row.id === scene.id ? { ...row, camera: event.target.value } : row),
      }) }} /></label>
      <DirectorViewport scene={scene} t={t} />
      <div className={css.scriptToolbar}>
        {(['x', 'y', 'z', 'fov'] as const).map(axis => <label key={axis}>{t('director.camera')} {axis}
          <input type="number" value={(scene.viewpoint ?? { x: 8, y: 6, z: 8, fov: 45 })[axis]}
            onChange={(event) => {
              const value = event.target.valueAsNumber
              if (!Number.isFinite(value)) return
              const viewpoint = { ...(scene.viewpoint ?? { x: 8, y: 6, z: 8, fov: 45 }), [axis]: value }
              if (viewpoint.fov < 1 || viewpoint.fov >= 180 || (viewpoint.x === 0 && viewpoint.y === 0 && viewpoint.z === 0)) return
              onChange({ ...content, director: scenes.map(row => row.id === scene.id ? { ...row, viewpoint } : row) })
            }} />
        </label>)}
      </div>
      {scene.objects.map(object => <div key={object.id} className={css.graphEditRow}>
        <input aria-label={t('director.object')} value={object.label} onChange={(event) => { onChange({ ...content,
          director: scenes.map(row => row.id === scene.id ? { ...row, objects: row.objects.map(item =>
            item.id === object.id ? { ...item, label: event.target.value } : item) } : row),
        }) }} />
        {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>{axis}<input type="number" value={object[axis]}
          onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ ...content,
            director: scenes.map(row => row.id === scene.id ? { ...row, objects: row.objects.map(item =>
              item.id === object.id ? { ...item, [axis]: event.target.valueAsNumber } : item) } : row),
          }) }} /></label>)}
        <button type="button" onClick={() => { onChange({ ...content, director: scenes.map(row =>
          row.id === scene.id ? { ...row, objects: row.objects.filter(item => item.id !== object.id) } : row) }) }}>{t('script.remove')}</button>
      </div>)}
      <button type="button" onClick={() => { onChange({ ...content, director: scenes.map(row => row.id === scene.id ? {
        ...row, objects: [...row.objects, { id: id(), label: t('director.object'), x: 0, y: 0, z: 0 }],
      } : row) }) }}>{t('director.addObject')}</button>
      <button type="button" onClick={() => { onChange({ ...content, director: scenes.filter(row => row.id !== scene.id) }) }}>
        {t('script.remove')}</button>
    </article>)}</div>
    <button type="button" onClick={() => { onChange({ ...content, director: [...scenes, {
      id: id(), name: t('director.newScene'), camera: '', objects: [],
    }] }) }}>{t('director.addScene')}</button>
  </section>

  return <section className={css.scriptEditor}>
    <p className={css.hint}>{t('editor.dataOnly')}</p>
    <svg viewBox={`0 0 900 ${Math.max(60, tracks.length * 48)}`} className={css.timelineMap} role="img" aria-label={t('studio.editor')}>
      {tracks.flatMap((track, index) => track.clips.map(clip => <g key={clip.id}>
        <rect x={clip.start / timelineDuration * 900}
          y={index * 48 + 4} width={clip.duration / timelineDuration * 900}
          height="36" rx="4" />
        <title>{track.name}: {clip.name} ({clip.start}–{clip.start + clip.duration})</title>
      </g>))}
    </svg>
    <div className={css.timeline}>{tracks.map(track => <article key={track.id} className={css.trackRow}>
      <input aria-label={t('editor.track')} value={track.name} onChange={(event) => { onChange({ ...content, edit: {
        tracks: tracks.map(row => row.id === track.id ? { ...row, name: event.target.value } : row),
      } }) }} />
      <select aria-label={t('editor.trackKind')} value={track.kind} onChange={(event) => {
        const kind = (['video', 'dialogue', 'sfx', 'music', 'subtitle'] as const).find(value => value === event.target.value)
        if (kind !== undefined) onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? { ...row, kind } : row) } })
      }}>{(['video', 'dialogue', 'sfx', 'music', 'subtitle'] as const).map(kind => <option key={kind} value={kind}>{t(`editor.kind.${kind}`)}</option>)}</select>
      {track.clips.map(clip => <div key={clip.id} className={css.clip}>
        <input value={clip.name} aria-label={t('editor.clip')} onChange={(event) => { onChange({ ...content, edit: {
          tracks: tracks.map(row => row.id === track.id ? { ...row, clips: row.clips.map(item =>
            item.id === clip.id ? { ...item, name: event.target.value } : item) } : row),
        } }) }} />
        {media.length > 0 && <select aria-label={t('editor.chooseMedia')} value={media.includes(clip.source ?? '') ? clip.source : ''}
          onChange={(event) => { onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? { ...row,
            clips: row.clips.map(item => item.id === clip.id ? { ...item, source: event.target.value } : item),
          } : row) } }) }}>
          <option value="">{t('editor.chooseMedia')}</option>{[...new Set(media)].map(path => <option key={path} value={path}>{path}</option>)}
        </select>}
        <label>{t('editor.source')}<input value={clip.source ?? ''} onChange={(event) => {
          onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? { ...row,
            clips: row.clips.map(item => item.id === clip.id ? { ...item, source: event.target.value } : item),
          } : row) } })
        }} /></label>
        {(['sourceStart', 'volume'] as const).map(field => <label key={field}>{t(`editor.${field}`)}
          <input type="number" min="0" step="0.1" value={clip[field] ?? (field === 'volume' ? 1 : 0)} onChange={(event) => {
            const value = event.target.valueAsNumber
            if (!Number.isFinite(value) || value < 0) return
            onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? { ...row,
              clips: row.clips.map(item => item.id === clip.id ? { ...item, [field]: value } : item),
            } : row) } })
          }} /></label>)}
        {(['start', 'duration'] as const).map(field => <label key={field}>{t(`editor.${field}`)}
          <input type="number" min={field === 'start' ? 0 : 0.01} step="0.01" value={clip[field]} onChange={(event) => {
            const value = event.target.valueAsNumber
            if (!Number.isFinite(value) || (field === 'start' ? value < 0 : value <= 0)) return
            onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? { ...row,
              clips: row.clips.map(item => item.id === clip.id ? { ...item, [field]: value } : item),
            } : row) } })
          }} /></label>)}
        <button type="button" onClick={() => { onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? {
          ...row, clips: row.clips.filter(item => item.id !== clip.id),
        } : row) } }) }}>{t('script.remove')}</button>
      </div>)}
      <button type="button" onClick={() => { onChange({ ...content, edit: { tracks: tracks.map(row => row.id === track.id ? {
        ...row, clips: [...row.clips, { id: id(), name: t('editor.clip'), start: 0, duration: 5 }],
      } : row) } }) }}>{t('editor.addClip')}</button>
      <button type="button" onClick={() => { onChange({ ...content, edit: { tracks: tracks.filter(row => row.id !== track.id) } }) }}>
        {t('script.remove')}</button>
    </article>)}</div>
    <button type="button" onClick={() => { onChange({ ...content, edit: { tracks: [...tracks, {
      id: id(), kind: 'video', name: t('editor.newTrack'), clips: [],
    }] } }) }}>{t('editor.addTrack')}</button>
  </section>
}
