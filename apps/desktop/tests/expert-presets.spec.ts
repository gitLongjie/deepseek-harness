/** Shipped expert declarations reach the same registry roster the client reads. */
import { afterEach, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Preset from '../../../packages/preset/agent-preset/src/index.ts'
import { isExpertPreset } from '../../../packages/preset/agent-preset-registry/src/display.ts'
import { harness } from '../../../packages/preset/agent-preset-registry/tests/harness.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** Load the shipped expert include with tool providers stubbed out. */
async function loadShippedExperts(): Promise<{ presets: Awaited<ReturnType<Context['agentPresets']['remoteExportList']>>['presets']; skillRoots: string[] }> {
  const ctx = await harness()
  contexts.push(ctx)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.preset = Preset
  const skillRoots: string[] = []
  const internal = ctx.loader.internal
  if (internal === undefined) throw new Error('Loader module importer is unavailable')
  // Exercise declarations and includes without starting external tool providers.
  vi.spyOn(internal, 'import').mockImplementation(async (name: string) => {
    if (name === '@deepseek-ai/dsh-agent-preset') return { default: Preset }
    if (name === '@deepseek-ai/cordis-plugin-include') return { default: Include }
    if (name === '@deepseek-ai/dsh-skill-filesystem') return {
      apply(_ctx: Context, config: { customSkillDirs?: string[] } = {}) { skillRoots.push(...config.customSkillDirs ?? []) },
    }
    return { apply() {} }
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: new URL('../config/agent-presets/cordis.yml', import.meta.url).href } })
  await ctx.loader.await()
  const { presets } = await ctx.agentPresets.remoteExportList()
  return { presets, skillRoots }
}

it('loads all four desktop experts with their card metadata and preset-local compositions', async () => {
  // The H3 director stays development-only; this source check runs under the
  // same switch the branded desktop launcher sets for checkout sessions.
  vi.stubEnv('DSH_DESKTOP_DEV', '1')
  const { presets, skillRoots } = await loadShippedExperts()
  expect(presets.filter(isExpertPreset).map(row => row.id))
    .toEqual(['geo-optimizer', 'article-publisher', 'geo-admin', 'h3-video-director'])
  expect(presets.map(row => ({ id: row.id, broken: row.broken })))
    .toEqual(presets.map(row => ({ id: row.id, broken: undefined })))
  expect(presets.every(row => row.name && row.quickPrompts?.length)).toBe(true)
  expect(presets.find(row => row.id === 'geo-optimizer')).toMatchObject({ subtitle: '喵工作台 官方', badge: '官方', icon: '🔍', avatar: expect.any(String) as string })
  expect(skillRoots).toContain(fileURLToPath(new URL('../config/agent-presets/geo-optimizer/skills/', import.meta.url)))
  expect(skillRoots).toContain(fileURLToPath(new URL('../config/agent-presets/h3-video-director/skills/', import.meta.url)))
  expect(presets).toMatchSnapshot()
})

it('hides the H3 video director on installed desktop launches', async () => {
  vi.stubEnv('DSH_DESKTOP_DEV', '')
  const { presets } = await loadShippedExperts()
  expect(presets.filter(isExpertPreset).map(row => row.id))
    .toEqual(['geo-optimizer', 'article-publisher', 'geo-admin'])
})
