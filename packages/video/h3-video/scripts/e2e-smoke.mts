/**
 * Manual end-to-end smoke of the ComfyUI provider + ffmpeg assembly against a live server
 * (default 127.0.0.1:8188) with a text2img checkpoint. Not part of the test suite.
 *
 * Run with the repo's source launcher:
 *   node --import tsx/esm packages/video/h3-video/scripts/e2e-smoke.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComfyUIProvider } from '../src/comfyui.ts'
import { assembleVideo } from '../src/assembly.ts'

const root = join(tmpdir(), 'h3-e2e')
mkdirSync(root, { recursive: true })

// Minimal SD1.5 txt2img workflow in ComfyUI API format; only {{prompt}} and {{seed}} are used.
const workflow = JSON.stringify({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['1', 1] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['1', 1] } },
  4: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  5: {
    class_type: 'KSampler',
    inputs: {
      seed: '{{seed}}', steps: 12, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
    },
  },
  6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { filename_prefix: 'h3e2e', images: ['6', 0] } },
}, null, 2)
const workflowPath = join(root, 'workflow.json')
writeFileSync(workflowPath, workflow)

const provider = createComfyUIProvider({
  baseUrl: 'http://127.0.0.1:8188',
  workflowPath,
  promptField: 'prompt',
  seedField: 'seed',
  resolutionField: 'resolution',
  durationField: 'duration',
  ratioField: 'ratio',
  outputDir: join(root, 'out'),
  pollIntervalMs: 2_000,
  taskTimeoutMs: 300_000,
  maxConcurrency: 1,
  resolutions: ['768P'],
  minDurationSeconds: 1,
  maxDurationSeconds: 10,
})

const signal = new AbortController().signal

async function renderOnce(prompt: string, label: string): Promise<string> {
  const ref = await provider.submit({
    inputs: [{ type: 'text', text: prompt }],
    resolution: '768P',
    durationSeconds: 5,
    ratio: '16:9',
  }, signal)
  console.log(`[${label}] submitted ${String(ref)}`)
  const status = await provider.poll(ref, signal)
  if (status.state !== 'succeeded') {
    throw new Error(`[${label}] failed: ${status.state === 'failed' ? status.reason : status.state}`)
  }
  console.log(`[${label}] succeeded -> ${status.localFile}`)
  return status.localFile
}

const first = await renderOnce('a red robot walking in a sunny park', 'seg1')
const second = await renderOnce('a blue robot flying over mountains at sunset', 'seg2')

// Turn the two images into short mp4 clips, then concat them with the shared assembly.
const clip1 = join(root, 'clip1.mp4')
const clip2 = join(root, 'clip2.mp4')
const { execFileSync } = await import('node:child_process')
execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', first, '-t', '2', '-pix_fmt', 'yuv420p', '-r', '24', clip1])
execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', second, '-t', '2', '-pix_fmt', 'yuv420p', '-r', '24', clip2])

const final = join(root, 'final.mp4')
await assembleVideo([{ file: clip1 }, { file: clip2 }], { outputFile: final })
console.log(`[assemble] final -> ${final}`)

const { statSync } = await import('node:fs')
console.log(`sizes: clip1=${statSync(clip1).size} clip2=${statSync(clip2).size} final=${statSync(final).size}`)
console.log(`E2E_OK root=${root}`)
