/**
 * Sync the packaged expert content from the deployment's source of truth:
 * `apps/desktop/config/agent-presets/article-publisher/` owns the expert's
 * composition, skills, and display metadata, and the published package
 * carries a verbatim copy so the two never drift by hand.
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(packageDir, '../../apps/desktop/config/agent-presets/article-publisher')
const target = join(packageDir, 'experts', 'article-publisher')

if (!existsSync(source)) {
  console.error(`expert-article-publisher: the deployment source of truth is missing: ${source}`)
  process.exit(1)
}

rmSync(join(packageDir, 'experts'), { recursive: true, force: true })
cpSync(source, target, { recursive: true })

for (const artifact of ['preset.yml', 'agent.cordis.yml', 'skills']) {
  if (!existsSync(join(target, artifact))) {
    console.error(`expert-article-publisher: the synced expert is missing ${artifact}`)
    process.exit(1)
  }
}

console.log(`expert-article-publisher: synced ${source} -> ${target}`)