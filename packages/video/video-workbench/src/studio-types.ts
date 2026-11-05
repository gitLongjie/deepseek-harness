/** Versioned authoring documents, independent of generated H3 plans. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifier admitted by the studio store. */
export type StudioId = Branded<'StudioId'>

/** Script element categories with distinct screenplay formatting. */
export type ScriptKind = 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'

/** One ordered script block; its id survives moves and edits. */
export interface ScriptBlock {
  id: StudioId
  kind: ScriptKind
  text: string
}

/** A movable storyboard card persisted in the visual canvas. */
export interface StudioCanvasCard {
  id: StudioId
  kind: 'scene' | 'asset' | 'note'
  title: string
  text: string
  x: number
  y: number
  source?: string
}
/** A named character, location, event or asset in the relationship graph. */
export interface StudioGraphNode { id: StudioId; label: string; kind: 'character' | 'place' | 'event' | 'asset' }
/** Directed named relationship whose endpoints belong to the same work. */
export interface StudioGraphEdge { id: StudioId; from: StudioId; to: StudioId; label: string }
/** One director object and camera preset used for spatial previsualization. */
export interface StudioDirectorObject { id: StudioId; label: string; x: number; y: number; z: number }
/** Staging objects and an origin-facing perspective camera. */
export interface StudioDirectorScene {
  id: StudioId
  name: string
  camera: string
  objects: StudioDirectorObject[]
  viewpoint?: { x: number; y: number; z: number; fov: number }
}
/** A clip on one of the editor's independent tracks. */
export interface StudioEditClip {
  id: StudioId
  name: string
  start: number
  duration: number
  source?: string
  sourceStart?: number
  volume?: number
}
/** Ordered media layer; later video tracks cover earlier ones during export. */
export interface StudioEditTrack { id: StudioId; kind: 'video' | 'dialogue' | 'sfx' | 'music' | 'subtitle'; name: string; clips: StudioEditClip[] }

/** User-authored content, saved as a complete revision. */
export interface StudioContent {
  title: string
  source: string
  blocks: ScriptBlock[]
  canvas?: StudioCanvasCard[]
  graph?: { nodes: StudioGraphNode[]; edges: StudioGraphEdge[] }
  director?: StudioDirectorScene[]
  edit?: { tracks: StudioEditTrack[] }
}

/** Immutable revision; unknown versions are refused, never rewritten. */
export interface StudioDocument extends StudioContent {
  format: 'dsh-studio'
  version: 1
  id: StudioId
  revision: number
  updatedAt: string
}

/** Catalog metadata without loading script text into the UI. */
export type StudioSummary = Pick<StudioDocument, 'id' | 'title' | 'revision' | 'updatedAt'>

/** A damaged work remains visible while other works can be opened. */
export interface StudioCatalog {
  works: StudioSummary[]
  errors: { id: string; code: string }[]
}
