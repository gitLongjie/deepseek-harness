/** Video skills must load from the packaged preset without repository discovery. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { expect, it } from 'vitest'

it('loads the shipped production and story skills with default roots disabled', async () => {
  const root = new URL('../config/agent-presets/h3-video-director/skills/', import.meta.url)
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false,
      watch: false,
      customSkillDirs: [fileURLToPath(root)],
    })
    for (const name of ['reveric-video-production', 'story-development-suite']) {
      const skill = await ctx.skills.get(name)
      expect(skill?.content).toBeTruthy()
      expect(skill?.path).toBe(fileURLToPath(new URL(`${name}/SKILL.md`, root)))
      const shipped = await readFile(new URL(`${name}/SKILL.md`, root), 'utf8')
      const authoring = await readFile(new URL(`../../../.agents/skills/${name}/SKILL.md`, import.meta.url), 'utf8')
      expect(shipped).toBe(authoring)
    }
    for (const name of ['character-consistency', 'character-design', 'opening-three-chapters', 'natural-prose-editing']) {
      const skill = await ctx.skills.get(name)
      expect(skill?.content).toBeTruthy()
      expect(skill?.content.length).toBeLessThan(8192)
      expect(skill?.path).toBe(fileURLToPath(new URL(`${name}/SKILL.md`, root)))
    }
  } finally {
    await ctx.fiber.dispose()
  }
})
