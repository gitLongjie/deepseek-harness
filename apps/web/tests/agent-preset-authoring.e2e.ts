/** Settings no longer lists Agent presets; the experts page owns the new-task default. */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { expertCard, openSettings, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

describe('web e2e: preset roster guidance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ profile: { packages: [] } })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('leaves Agent presets out of Settings and marks the new-task default on the experts page', async () => {
    onTestFailed(() => saveFailureShot(page, 'preset-roster-section'))
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '设置' })
    expect(await settings.getByRole('button', { name: 'Agent 预设' }).count()).toBe(0)
    await settings.getByRole('button', { name: '关闭', exact: true }).last().click()
    await page.getByRole('button', { name: '专家', exact: true }).click()
    await page.getByRole('heading', { name: '专家', exact: true }).waitFor()
    await expertCard(page, '标准专家').getByText('新任务默认', { exact: true }).waitFor()
    expect(scaffold.ctx.agentPresets.defaultId).toBe('standard')
  })

  it('runs without page errors or model calls', () => { expect(tripwire.pageErrors).toEqual([]) })
})
