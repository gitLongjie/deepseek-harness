import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assembleVideo } from './packages/video/h3-video/src/assembly.ts'

const root = 'C:\\Users\\jiege\\.dsh\\cache\\video'
const planId = process.argv[2] ?? 'vp-7'
const transition = (process.argv[3] ?? 'dip') as 'cut' | 'dip'

const plan = JSON.parse(
  readFileSync(join(root, 'plans', `${planId}.json`), 'utf8'),
) as { segments: Array<{ id: string; durationSeconds: number }> }

const segments = plan.segments.map(segment => ({
  file: join(root, 'segments', `${planId}-${segment.id}.mp4`),
}))
const missing = segments.filter(segment => !existsSync(segment.file))
if (missing.length > 0) {
  console.log('missing segments:', missing.map(segment => segment.file))
  process.exit(1)
}

const outputFile = join(root, 'final', `${planId}.mp4`)
mkdirSync(join(root, 'final'), { recursive: true })
const started = Date.now()
try {
  await assembleVideo(segments, {
    outputFile,
    transition: transition === 'dip' ? { kind: 'dip', seconds: 0.3 } : { kind: 'cut', seconds: 0 },
    durations: plan.segments.map(segment => segment.durationSeconds),
  })
  console.log(`assembled ${segments.length} segments in ${Math.round((Date.now() - started) / 1000)}s -> ${outputFile}`)
} catch (error: unknown) {
  console.log('assembly failed:', error instanceof Error ? error.message.slice(0, 1500) : String(error))
  process.exit(1)
}
