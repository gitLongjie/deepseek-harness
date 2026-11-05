/** Real local media export; no model or paid generation service is involved. */
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { StudioStore, studioId } from '../src/studio-store.ts'

const run = promisify(execFile)
const hasMediaTools = ['ffmpeg', 'ffprobe'].every(command =>
  spawnSync(command, ['-version'], { windowsHide: true, timeout: 5000 }).status === 0)
it.skipIf(!hasMediaTools)('exports video, mixed audio and subtitles with the saved duration; refuses escaping sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-render-'))
  try {
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', join(root, 'source.mp4')], { windowsHide: true, timeout: 30000 })
    const store = new StudioStore(root, 65536, {
      ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', timeoutMs: 30000, maxDurationSeconds: 30,
      maxClips: 10, width: 160, height: 90, fps: 10,
    })
    const uuid = () => studioId(randomUUID())
    const content = { title: 'Sample', source: '', blocks: [], edit: { tracks: [
      { id: uuid(), name: 'Video', kind: 'video' as const,
        clips: [{ id: uuid(), name: 'Red', source: 'source.mp4', start: 0, duration: 1, sourceStart: 0.5 }] },
      { id: uuid(), name: 'Music', kind: 'music' as const,
        clips: [{ id: uuid(), name: 'Tone', source: 'source.mp4', start: 0, duration: 1, volume: 0.5 }] },
      { id: uuid(), name: 'Subtitles', kind: 'subtitle' as const,
        clips: [{ id: uuid(), name: 'Arrival', start: 0, duration: 1 }] },
    ] } }
    const doc = await store.create(content)
    const result = await store.export(doc.id, 1, new AbortController().signal)
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration',
      '-of', 'json', join(root, result.path)], { windowsHide: true })
    expect(JSON.parse(probe.stdout)).toMatchObject({ streams: [
      { codec_type: 'video' }, { codec_type: 'audio' }, { codec_type: 'subtitle' },
    ] })
    expect(Number(JSON.parse(probe.stdout).format.duration)).toBeCloseTo(1, 1)
    expect(await store.read(doc.id)).toEqual(doc)
    await expect(store.export(doc.id, 2, new AbortController().signal)).rejects.toMatchObject({ code: 'conflict' })
    const broken = await store.save(doc.id, 1, { ...content, edit: { tracks: [{ id: uuid(), kind: 'video', name: 'Bad',
      clips: [{ id: uuid(), name: 'Escape', start: 0, duration: 1, source: '../secret.mp4' }],
    }] } })
    await expect(store.export(doc.id, broken.revision, new AbortController().signal)).rejects.toThrow('outside')
    expect((await readdir(join(root, 'studio', doc.id))).filter(name => name.startsWith('export-'))).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)
