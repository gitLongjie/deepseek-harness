/** Immutable studio revisions published atomically with a no-replace hard link. */
import { renderStudio, type StudioRenderOptions, type StudioRenderResult } from './studio-render.ts'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import type { StudioCatalog, StudioContent, StudioDocument, StudioId, ScriptBlock, ScriptKind, StudioCanvasCard, StudioGraphNode, StudioGraphEdge, StudioDirectorScene, StudioDirectorObject, StudioEditTrack, StudioEditClip } from './studio-types.ts'

/** Stable failures handled by HTTP and model consumers. */
export class StudioError extends Error {
  constructor(readonly code: 'invalid' | 'missing' | 'conflict' | 'corrupt' | 'storage', message: string) {
    super(message)
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
const KINDS = new Set<ScriptKind>(['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition'])

/** Admit an opaque id before constructing any filesystem path.
 * @param value - untrusted identifier.
 * @returns validated studio identifier.
 */
export function studioId(value: unknown): StudioId {
  if (typeof value !== 'string' || !UUID.test(value)) throw new StudioError('invalid', 'Invalid work or block id')
  return value as StudioId
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StudioError('invalid', 'Expected an object')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new StudioError('invalid', 'Expected text')
  return value
}

/** Validate authoring input without dropping unknown fields silently.
 * @param value - JSON request content.
 * @returns validated title, original source and ordered script blocks.
 */
export function studioContent(value: unknown): StudioContent {
  const data = record(value)
  if (Object.keys(data).some(key => !['title', 'source', 'blocks', 'canvas', 'graph', 'director', 'edit'].includes(key))) throw new StudioError('invalid', 'Unknown content field')
  const title = string(data.title).trim()
  if (!title) throw new StudioError('invalid', 'Title is required')
  if (!Array.isArray(data.blocks)) throw new StudioError('invalid', 'Blocks must be an array')
  const ids = new Set<string>()
  const blocks = data.blocks.map((value): ScriptBlock => {
    const block = record(value)
    if (Object.keys(block).some(key => !['id', 'kind', 'text'].includes(key))) throw new StudioError('invalid', 'Unknown block field')
    const id = studioId(block.id)
    if (ids.has(id)) throw new StudioError('invalid', 'Duplicate block id')
    ids.add(id)
    const kind = string(block.kind)
    if (!KINDS.has(kind as ScriptKind)) throw new StudioError('invalid', 'Unknown script element')
    return { id, kind: kind as ScriptKind, text: string(block.text) }
  })
  return { title, source: string(data.source), blocks, ...production(data) }
}

function finite(value: unknown, minimum = -Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER) {
    throw new StudioError('invalid', 'Number is outside the supported range')
  }
  return value
}

function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const data = record(value)
  if (Object.keys(data).some(key => !names.includes(key))) throw new StudioError('invalid', 'Unknown production field')
  return data
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new StudioError('invalid', 'Expected collection')
  return value
}

function collection<T extends { id: StudioId }>(value: unknown, parse: (entry: unknown) => T): T[] {
  const ids = new Set<StudioId>()
  return array(value).map((entry) => {
    const item = parse(entry)
    if (ids.has(item.id)) throw new StudioError('invalid', 'Duplicate entity id')
    ids.add(item.id)
    return item
  })
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const result = allowed.find(item => item === value)
  if (result === undefined) throw new StudioError('invalid', 'Unknown production kind')
  return result
}

function production(data: Record<string, unknown>): Pick<StudioContent, 'canvas' | 'graph' | 'director' | 'edit'> {
  const canvas = collection(data.canvas === undefined ? [] : data.canvas, (entry): StudioCanvasCard => {
    const item = fields(entry, ['id', 'kind', 'title', 'text', 'x', 'y', 'source'])
    return {
      id: studioId(item.id), kind: oneOf(item.kind, ['scene', 'asset', 'note']), title: string(item.title),
      text: string(item.text), x: finite(item.x), y: finite(item.y),
      ...(item.source === undefined ? {} : { source: string(item.source) }),
    }
  })
  const graph = data.graph === undefined ? { nodes: [], edges: [] } : fields(data.graph, ['nodes', 'edges'])
  const nodes = collection(graph.nodes, (entry): StudioGraphNode => {
    const item = fields(entry, ['id', 'label', 'kind'])
    return { id: studioId(item.id), label: string(item.label), kind: oneOf(item.kind, ['character', 'place', 'event', 'asset']) }
  })
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = collection(graph.edges, (entry): StudioGraphEdge => {
    const item = fields(entry, ['id', 'from', 'to', 'label'])
    const from = studioId(item.from)
    const to = studioId(item.to)
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) throw new StudioError('invalid', 'Invalid relationship endpoints')
    return { id: studioId(item.id), from, to, label: string(item.label) }
  })
  const director = collection(data.director === undefined ? [] : data.director, (entry): StudioDirectorScene => {
    const item = fields(entry, ['id', 'name', 'camera', 'objects', 'viewpoint'])
    const objects = collection(item.objects, (entry): StudioDirectorObject => {
      const object = fields(entry, ['id', 'label', 'x', 'y', 'z'])
      return { id: studioId(object.id), label: string(object.label), x: finite(object.x), y: finite(object.y), z: finite(object.z) }
    })
    const view = item.viewpoint === undefined ? undefined : fields(item.viewpoint, ['x', 'y', 'z', 'fov'])
    const viewpoint = view === undefined ? undefined : { x: finite(view.x), y: finite(view.y), z: finite(view.z), fov: finite(view.fov, 1) }
    if (viewpoint !== undefined && (viewpoint.fov >= 180 || (viewpoint.x === 0 && viewpoint.y === 0 && viewpoint.z === 0))) {
      throw new StudioError('invalid', 'Camera must face the origin from a nonzero position with fov below 180')
    }
    return { id: studioId(item.id), name: string(item.name), camera: string(item.camera), objects,
      ...(viewpoint === undefined ? {} : { viewpoint }) }

  })
  const edit = data.edit === undefined ? { tracks: [] } : fields(data.edit, ['tracks'])
  const tracks = collection(edit.tracks, (entry): StudioEditTrack => {
    const item = fields(entry, ['id', 'kind', 'name', 'clips'])
    const clips = collection(item.clips, (entry): StudioEditClip => {
      const clip = fields(entry, ['id', 'name', 'start', 'duration', 'source', 'sourceStart', 'volume'])
      const duration = finite(clip.duration, 0)
      if (duration === 0) throw new StudioError('invalid', 'Clip duration must be positive')
      return {
        id: studioId(clip.id), name: string(clip.name), start: finite(clip.start, 0), duration,
        ...(clip.source === undefined ? {} : { source: string(clip.source) }),
        ...(clip.sourceStart === undefined ? {} : { sourceStart: finite(clip.sourceStart, 0) }),
        ...(clip.volume === undefined ? {} : { volume: finite(clip.volume, 0) }),
      }
    })
    return { id: studioId(item.id), name: string(item.name), kind: oneOf(item.kind, ['video', 'dialogue', 'sfx', 'music', 'subtitle']), clips }
  })
  return { canvas, graph: { nodes, edges }, director, edit: { tracks } }
}

function errno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** One store object shared by the workbench's authenticated routes.
 * Published files are immutable; concurrent writers of one revision cannot overwrite each other.
 */
export class StudioStore {
  constructor(private readonly root: string, private readonly maxBytes: number, private readonly renderOptions?: StudioRenderOptions) {}

  private readonly exports = new Set<StudioId>()

  /** Export a saved revision as MP4, rejecting concurrent exports of the same work.
   * @param id - work identifier.
   * @param revision - revision selected by the user.
   * @param signal - cancellation for media subprocesses.
   * @returns relative output path and source revision.
   */
  async export(id: StudioId, revision: number, signal: AbortSignal): Promise<StudioRenderResult> {
    if (this.renderOptions === undefined) throw new StudioError('storage', 'Timeline export is not configured')
    const document = await this.read(id)
    if (document.revision !== revision || this.exports.has(id)) throw new StudioError('conflict', 'Work changed or export is already running')
    this.exports.add(id)
    try { return await renderStudio(this.root, await this.directory(id), document, this.renderOptions, signal) }
    finally { this.exports.delete(id) }
  }

  private async directory(id?: StudioId): Promise<string> {
    await mkdir(this.root, { recursive: true })
    const root = await realpath(this.root)
    const studio = join(root, 'studio')
    await mkdir(studio, { recursive: true })
    if ((await lstat(studio)).isSymbolicLink()) throw new StudioError('storage', 'Studio directory cannot be a link')
    if (id === undefined) return studio
    const dir = join(studio, studioId(id))
    const actual = await realpath(dir)
    const distance = relative(root, actual)
    if (isAbsolute(distance) || distance.startsWith('..') || (await lstat(dir)).isSymbolicLink()) {
      throw new StudioError('storage', 'Work directory escapes the studio')
    }
    return actual
  }

  /** List readable works and retain a diagnostic for each damaged work.
   * @returns catalog sorted by last saved time.
   */
  async list(): Promise<StudioCatalog> {
    const root = await this.directory()
    const result: StudioCatalog = { works: [], errors: [] }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!UUID.test(entry.name)) continue
      try {
        const doc = await this.read(studioId(entry.name))
        result.works.push({ id: doc.id, title: doc.title, revision: doc.revision, updatedAt: doc.updatedAt })
      } catch (error) {
        result.errors.push({ id: entry.name, code: error instanceof StudioError ? error.code : 'storage' })
      }
    }
    result.works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return result
  }

  /** Read the latest immutable revision; corrupt latest data never falls back silently.
   * @param id - validated work identifier.
   * @returns current complete document.
   */
  async read(id: StudioId): Promise<StudioDocument> {
    studioId(id)
    let dir: string
    try { dir = await this.directory(id) } catch (error) {
      if (errno(error, 'ENOENT')) throw new StudioError('missing', 'Work not found')
      throw error
    }
    const revisions = (await readdir(dir)).filter(name => /^[1-9]\d*\.json$/u.test(name)).map(name => Number(name.slice(0, -5)))
    const revision = revisions.reduce((latest, value) => Math.max(latest, value), 0)
    if (!Number.isSafeInteger(revision) || revision === 0) throw new StudioError('corrupt', 'No valid published revision')
    const path = join(dir, `${revision}.json`)
    if ((await lstat(path)).isSymbolicLink()) throw new StudioError('corrupt', 'Revision cannot be a link')
    const file = await open(path, 'r')
    try {
      if ((await file.stat()).size > this.maxBytes) throw new StudioError('corrupt', 'Revision exceeds size limit')
      const data = record(JSON.parse(await file.readFile('utf8')))
      if (Object.keys(data).some(key => !['title', 'source', 'blocks', 'canvas', 'graph', 'director', 'edit', 'format', 'version', 'id', 'revision', 'updatedAt'].includes(key))) throw new StudioError('corrupt', 'Unknown revision field')
      if (data.format !== 'dsh-studio' || data.version !== 1 || data.id !== id || data.revision !== revision || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) {
        throw new StudioError('corrupt', 'Unsupported or damaged studio revision')
      }
      return { ...studioContent({ title: data.title, source: data.source, blocks: data.blocks, canvas: data.canvas, graph: data.graph, director: data.director, edit: data.edit }), format: 'dsh-studio', version: 1, id, revision, updatedAt: data.updatedAt }
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof StudioError) throw new StudioError('corrupt', 'Invalid studio revision')
      throw error
    } finally { await file.close() }
  }

  /** Create a work with its first durable revision.
   * @param content - authored document content.
   * @returns committed first revision.
   */
  async create(content: StudioContent): Promise<StudioDocument> {
    const admitted = studioContent(content)
    const id = studioId(randomUUID())
    const doc = this.document(id, 1, admitted)
    const root = await this.directory()
    const dir = join(root, id)
    await mkdir(dir)
    return this.publish(dir, doc)
  }

  /** Save with optimistic concurrency; stale revisions leave both committed data and draft intact.
   * @param id - work identifier.
   * @param revision - revision the editor loaded.
   * @param content - full replacement content.
   * @returns new immutable revision.
   */
  async save(id: StudioId, revision: number, content: StudioContent): Promise<StudioDocument> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new StudioError('invalid', 'Invalid revision')
    const admitted = studioContent(content)
    const current = await this.read(id)
    if (current.revision !== revision) throw new StudioError('conflict', 'Work changed; reload before saving')
    if (!Number.isSafeInteger(revision + 1)) throw new StudioError('invalid', 'Revision limit reached')
    return this.publish(await this.directory(id), this.document(id, revision + 1, admitted))
  }

  private document(id: StudioId, revision: number, content: StudioContent): StudioDocument {
    const doc: StudioDocument = { ...content, format: 'dsh-studio', version: 1, id, revision, updatedAt: new Date().toISOString() }
    if (Buffer.byteLength(`${JSON.stringify(doc)}\n`) > this.maxBytes) throw new StudioError('invalid', 'Document exceeds size limit')
    return doc
  }

  private async publish(dir: string, doc: StudioDocument): Promise<StudioDocument> {
    const text = `${JSON.stringify(doc)}\n`
    const temp = join(dir, `${randomUUID()}.tmp`)
    const file = await open(temp, 'wx')
    try {
      try { await file.writeFile(text); await file.sync() } finally { await file.close() }
      await link(temp, join(dir, `${doc.revision}.json`))
    } catch (error) {
      if (errno(error, 'EEXIST')) throw new StudioError('conflict', 'Work changed; reload before saving')
      throw error
    } finally {
      // The immutable revision is already committed; a leftover temp is ignored by readers.
      await rm(temp, { force: true }).catch((error: unknown) => { console.warn('Studio temporary file cleanup failed', error) })
    }
    return doc
  }
}
