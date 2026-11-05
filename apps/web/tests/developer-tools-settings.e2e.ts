/** Coding Tools persist while Standard, Creator, and custom presets remain selectable when disabled. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, expertCard, newEnglishPage, openExperts, openSettings } from './support.ts'

it('persists Coding Tools and limits the built-in PTC and Minimal choices in sessions and Settings', async () => {
  const scaffold = await launchWebScaffold({
    agentPresets: { default: 'standard', definitions: [{ id: 'custom', name: 'Custom mode', plugins: [] }] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  const livePresets = async () => (await scaffold.ctx.sessionController.list({}, new AbortController().signal))
    .items.map(item => item.projections?.values.agentPreset)
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const toggle = page.getByRole('switch', { name: 'Show coding view' })
  expect(await toggle.getAttribute('aria-checked')).toBe('true')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).not.toMatch(/id: ui-settings(?:\r?\n|$)/)
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
  await page.reload()
  await openSettings(page, 'en')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')

  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  expect(await settings.getByRole('button', { name: 'Agent presets', exact: true }).count()).toBe(0)
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()

  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await expect.poll(livePresets).toEqual(['standard'])
  await scaffold.ctx.settings.update('ui-settings', { enabled: true })
  await openExperts(page)
  await expertCard(page, 'Minimal expert').getByRole('button', { name: 'Set as new task default: Minimal expert' }).click()
  await expertCard(page, 'Minimal expert').getByText('New task default', { exact: true }).waitFor()
  await expect.poll(async () => (await scaffold.ctx.agentPresets.remoteExportList()).presets.find(preset => preset.isDefault)?.id).toBe('minimal')
  await scaffold.ctx.settings.update('ui-settings', { enabled: false })
  await page.getByRole('button', { name: 'Experts', exact: true }).click()
  await openExperts(page)
  await expertCard(page, 'Standard expert').getByText('New task default', { exact: true }).waitFor({ timeout: 10_000 })
  await expect.poll(async () => (await scaffold.ctx.agentPresets.remoteExportList()).presets.find(preset => preset.isDefault)?.id).toBe('standard')
  expect(tripwire.pageErrors).toEqual([])
})
