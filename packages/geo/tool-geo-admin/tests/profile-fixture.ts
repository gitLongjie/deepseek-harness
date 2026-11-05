/** Loader composition for durable GEO configuration and real tool execution. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as executor from '@deepseek-ai/dsh-tool-executor-native'
import * as account from '../src/settings.ts'
import * as tools from '../src/index.ts'

/** Start a complete profile, retaining its directory for restart assertions. */
export async function profileFixture(mountAccount = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'geo-profile-')))
  const profileDir = join(dir, 'profiles', 'test')
  initProfile(profileDir, ['geo-test'])
  const bundle = join(profileDir, 'node_modules', 'geo-test')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"geo-test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'geo-test', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'credentials', name: 'cordis:credentials', config: { path: join(dir, '.credentials.yaml'), watch: false } },
    { id: 'system-prompt', name: 'cordis:prompt' },
    { id: 'tools', name: 'cordis:tools' },
    { id: 'executor', name: 'cordis:executor' },
    ...(mountAccount ? [{ id: 'geo-admin', name: 'cordis:account' }] : []),
    { id: 'geo-tools', name: 'cordis:geo' },
  ] }]))
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['geo-test'], dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(dir, 'package.json'),
    cwd: dir, home: dir, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = () => boot('test', join(profileDir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(ctx.loader.builtins, {
      editor: ConfigEditor, settings: Settings, credentials: CredentialsLocal,
      prompt: SystemPrompt, tools: Tools, executor, account, geo: tools,
    })
  })
  return { ctx: await start(), dir, profile, start }
}
