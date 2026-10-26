/** Real ffmpeg regressions for picture and sound transitions, including silent inputs. */
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleVideo } from '../src/assembly.ts'

const run = promisify(execFile)
const available = spawnSync('ffmpeg', ['-version']).status === 0
  && spawnSync('ffprobe', ['-version']).status === 0
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'h3-transition-'))
  roots.push(root)
  return root
}

async function clip(root: string, color: string, audio = false, size = '64x64', fps = 24): Promise<string> {
  const file = join(root, `${color}.mp4`)
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=${fps}:d=1`,
    ...audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'] : [],
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file,
  ])
  return file
}

async function probe(file: string): Promise<{ duration: number; audio: boolean }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file,
  ])
  const result = JSON.parse(stdout) as { format: { duration: string }; streams: Array<{ codec_type: string }> }
  return { duration: Number(result.format.duration), audio: result.streams.some(stream => stream.codec_type === 'audio') }
}

async function pixel(file: string, time: number): Promise<number[]> {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1',
    '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: 'buffer' })
  return [...stdout]
}

async function volume(file: string, time: number): Promise<number> {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-ss', String(time), '-i', file, '-t', '0.04', '-vn',
    '-ac', '1', '-f', 'f32le', 'pipe:1',
  ], { encoding: 'buffer' })
  let squared = 0
  for (let offset = 0; offset < stdout.length; offset += 4) squared += stdout.readFloatLE(offset) ** 2
  return Math.sqrt(squared / (stdout.length / 4))
}

describe.skipIf(!available)('real ffmpeg transitions (requires ffmpeg and ffprobe)', () => {
  it('blends pictures across both joins, normalizing size, rate, and missing audio', async () => {
    const root = await fixture()
    const red = await clip(root, 'red', true, '64x64', 12)
    const blue = await clip(root, 'blue', false, '96x64', 30)
    const green = await clip(root, 'green')
    const outputFile = join(root, 'film.mp4')
    await assembleVideo([red, blue, green].map(file => ({ file })), {
      outputFile, transition: { kind: 'crossfade', seconds: 0.4 }, durations: [1, 1, 1],
    })
    const result = await probe(outputFile)
    expect(result.duration).toBeCloseTo(2.2, 1)
    expect(result.audio).toBe(true)
    const firstJoin = await pixel(outputFile, 0.8)
    expect(firstJoin[0]).toBeGreaterThan(60)
    expect(firstJoin[2]).toBeGreaterThan(60)
    expect(firstJoin[1]).toBeLessThan(30)
    const startVolume = await volume(outputFile, 0.3)
    const joinVolume = await volume(outputFile, 0.8)
    expect(joinVolume).toBeGreaterThan(startVolume * 0.2)
    expect(joinVolume).toBeLessThan(startVolume * 0.8)
    expect(await volume(outputFile, 1.4)).toBeLessThan(0.001)
    const secondJoin = await pixel(outputFile, 1.4)
    expect(secondJoin[1]).toBeGreaterThan(25)
    expect(secondJoin[2]).toBeGreaterThan(60)
    const end = await pixel(outputFile, 2)
    expect(end[1]).toBeGreaterThan(90)
  })

  it('fades silent clips through black without replacing the transition with a cut', async () => {
    const root = await fixture()
    const red = await clip(root, 'red')
    const blue = await clip(root, 'blue')
    const outputFile = join(root, 'dip.mp4')
    await assembleVideo([{ file: red }, { file: blue }], {
      outputFile, transition: { kind: 'dip', seconds: 0.25 }, durations: [1, 1],
    })
    expect((await probe(outputFile)).duration).toBeCloseTo(2, 1)
    expect(Math.max(...await pixel(outputFile, 1))).toBeLessThan(30)
    expect((await pixel(outputFile, 1.6))[2]).toBeGreaterThan(200)
  })

  it('caps long overlaps and supports a single silent clip', async () => {
    const root = await fixture()
    const red = await clip(root, 'red')
    const blue = await clip(root, 'blue')
    const outputFile = join(root, 'capped.mp4')
    await assembleVideo([{ file: red }, { file: blue }], {
      outputFile, transition: { kind: 'crossfade', seconds: 10 }, durations: [1, 1],
    })
    expect((await probe(outputFile)).duration).toBeCloseTo(1.5, 1)
    await assembleVideo([{ file: red }], {
      outputFile, transition: { kind: 'crossfade', seconds: 0.4 }, durations: [1],
    })
    expect((await probe(outputFile)).duration).toBeCloseTo(1, 1)
  })
})

describe('transition refusals', () => {
  it.each([0, -1, NaN, Infinity])('refuses invalid transition duration %s', async (seconds) => {
    const root = await fixture()
    await expect(assembleVideo([{ file: 'unused.mp4' }], {
      outputFile: join(root, 'out.mp4'), transition: { kind: 'crossfade', seconds }, durations: [1],
    })).rejects.toThrow('transition seconds')
  })

  it('requires clip timing and reports probe failures instead of delivering a hard cut', async () => {
    const root = await fixture()
    const options = { outputFile: join(root, 'out.mp4'), transition: { kind: 'crossfade' as const, seconds: 0.4 } }
    await expect(assembleVideo([{ file: 'unused.mp4' }], options)).rejects.toThrow('duration per clip')
    await expect(assembleVideo([{ file: join(root, 'missing.mp4') }], {
      ...options, durations: [1],
    })).rejects.toThrow()
  })
})
