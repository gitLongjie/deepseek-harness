// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  MarketCatalogPage,
  MarketInstallability,
  MarketInstallOutcome,
  MarketInstalledPlugin,
  MarketSource,
  MarketUninstallOutcome,
} from '@deepseek-ai/dsh-api-remotes/client'
import { MarketSettingsTab } from '../src/client/MarketSettingsTab.tsx'
import type {
  MarketSettingsTabInjected,
  MarketSettingsTabProps,
} from '../src/client/MarketSettingsTab.tsx'
import { en, type MarketLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MarketLocaleKey): string => en[key]) as MarketSettingsTabProps['t']

const PAGE = {
  entries: [
    {
      sourceId: 'src-1',
      entryId: 'store/todo-kit',
      name: 'todo kit',
      summary: 'Structured todo tools',
      categories: [],
      keywords: [],
      npmPackage: 'dsh-plugin-todo-kit',
    },
    {
      sourceId: 'src-1',
      entryId: 'store/plain',
      name: 'plain',
      summary: 'No npm identity',
      categories: [],
      keywords: [],
    },
  ],
  nextCursor: null,
  total: 2,
} as unknown as MarketCatalogPage

const INSTALLABLE = { installable: true, npmPackage: 'dsh-plugin-todo-kit', resolvedVersion: '1.2.3', reasons: [] } as unknown as MarketInstallability
const BLOCKED = { installable: false, npmPackage: null, resolvedVersion: null, reasons: ['the registry manifest declares no dsh.bundle patch'] } as unknown as MarketInstallability

const INSTALLED_ROWS = [
  { bundleId: 'dsh-plugin-todo-kit', packageName: 'dsh-plugin-todo-kit', version: '1.2.3', spec: '^1.2.3', isBundleLayer: true, removable: true },
  { bundleId: 'dsh-base', packageName: '@deepseek-ai/dsh-base', version: '0.1.0', spec: null, isBundleLayer: true, removable: false },
] as unknown as MarketInstalledPlugin[]

const SOURCES = [
  { id: 'src-1', name: 'Store', kind: 'store-v1', url: 'https://store.example/v1/plugins' },
  { id: 'src-2', name: 'Backup', kind: 'catalog', url: 'https://backup.example/v1/plugins' },
] as unknown as MarketSource[]

function stubs(): MarketSettingsTabInjected {
  return {
    listSources: vi.fn(async () => ({ sources: SOURCES })),
    selectedSource: vi.fn(async () => 'src-1'),
    selectSource: vi.fn(async () => undefined),
    browse: vi.fn(async () => PAGE),
    installability: vi.fn(async () => INSTALLABLE),
    install: vi.fn(async (): Promise<MarketInstallOutcome> => ({ ok: true, packageName: 'dsh-plugin-todo-kit', version: '1.2.3', restartRequired: true })),
    installed: vi.fn(async () => ({ plugins: INSTALLED_ROWS })),
    uninstall: vi.fn(async (): Promise<MarketUninstallOutcome> => ({ ok: true, packageName: 'dsh-plugin-todo-kit', restartRequired: true })),
  }
}

function props(injected: MarketSettingsTabInjected): MarketSettingsTabProps {
  return { t, ...injected } as MarketSettingsTabProps
}

describe('MarketSettingsTab', () => {
  it('renders discover entries and installs after an installability check', async () => {
    const injected = stubs()
    const view = render(<MarketSettingsTab {...props(injected)} />)
    expect(await screen.findByText('todo kit')).toBeTruthy()
    expect(injected.browse).toHaveBeenCalledWith({ limit: 50 })
    expect(screen.getByText('plain')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /todo kit/ }))
    expect(await screen.findByText(/npm latest 1\.2\.3/)).toBeTruthy()
    expect(screen.getByText(en.installable, { exact: false })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitForNote(view, 'success')
    expect(injected.install).toHaveBeenCalledWith({ sourceId: 'src-1', entryId: 'store/todo-kit' })
    expect(view.container.querySelector('[data-note="success"]')?.textContent).toContain('1.2.3')
    expect(view.container.querySelector('[data-note="success"]')?.textContent).toContain(en.restartRequired)
  })

  it('shows rejection reasons without an install button', async () => {
    const injected = { ...stubs(), installability: vi.fn(async () => BLOCKED) }
    render(<MarketSettingsTab {...props(injected)} />)
    fireEvent.click(await screen.findByRole('button', { name: /todo kit/ }))
    expect(await screen.findByText(en.notInstallable)).toBeTruthy()
    expect(screen.getByText(BLOCKED.reasons[0]!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.install })).toBeNull()
  })

  it('keeps installation-owned rows inert and uninstalls removable ones', async () => {
    const injected = stubs()
    const view = render(<MarketSettingsTab {...props(injected)} />)
    fireEvent.click(await screen.findByRole('button', { name: en.viewInstalled }))

    expect(await screen.findByText('dsh-plugin-todo-kit')).toBeTruthy()
    expect(view.container.querySelector('[data-installed-row="@deepseek-ai/dsh-base"]')?.textContent).toContain(en.installationOwned)
    const buttons = screen.getAllByRole('button', { name: en.uninstall })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    await waitForNote(view, 'success')
    expect(injected.uninstall).toHaveBeenCalledWith('dsh-plugin-todo-kit')
    await vi.waitFor(() => { expect(injected.installed).toHaveBeenCalledTimes(2) })
  })

  it('selects a source from the sources view and refreshes', async () => {
    const injected = stubs()
    const view = render(<MarketSettingsTab {...props(injected)} />)
    fireEvent.click(await screen.findByRole('button', { name: en.viewSources }))

    expect(await screen.findByText('Store')).toBeTruthy()
    expect(view.container.querySelector('[data-source-row="src-1"]')?.textContent).toContain(en.selected)
    const select = view.container.querySelector('[data-source-row="src-2"] button')
    expect(select?.textContent).toBe(en.select)
    fireEvent.click(select!)
    await vi.waitFor(() => { expect(injected.selectSource).toHaveBeenCalledWith('src-2') })
    // The selection refresh re-reads both faces of the view.
    await vi.waitFor(() => { expect(injected.listSources).toHaveBeenCalledTimes(2) })
    expect(view.container.querySelector('[data-note]')).toBeNull()
  })

  it('reports a failed install without a restart hint', async () => {
    const injected = {
      ...stubs(),
      install: vi.fn(async (): Promise<MarketInstallOutcome> => ({ ok: false, message: 'pnpm add failed with exit code 1', outputTail: null })),
    }
    const view = render(<MarketSettingsTab {...props(injected)} />)
    fireEvent.click(await screen.findByRole('button', { name: /todo kit/ }))
    fireEvent.click(await screen.findByRole('button', { name: en.install }))
    await waitForNote(view, 'failure')
    expect(view.container.querySelector('[data-note="failure"]')?.textContent).toContain('pnpm add failed')
    expect(view.container.querySelector('[data-note="failure"]')?.textContent).not.toContain(en.restartRequired)
  })

  it('shows the no-source hint and a generic failure with retry', async () => {
    const injected = { ...stubs(), selectedSource: vi.fn(async () => null) }
    render(<MarketSettingsTab {...props(injected)} />)
    expect(await screen.findByText(en.noSourceSelected)).toBeTruthy()
    expect(injected.browse).not.toHaveBeenCalled()

    const failing = { ...stubs(), browse: vi.fn<MarketSettingsTabInjected['browse']>().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(PAGE) }
    const failed = render(<MarketSettingsTab {...props(failing)} />)
    expect((await failed.findByRole('alert')).textContent).toBe(en.error)
    fireEvent.click(failed.getByRole('button', { name: en.retry }))
    expect(await failed.findByText('todo kit')).toBeTruthy()
    failed.unmount()

    const deferred = Promise.withResolvers<MarketCatalogPage>()
    const pending = render(<MarketSettingsTab {...props({ ...stubs(), browse: () => deferred.promise })} />)
    pending.unmount()
    await act(async () => { deferred.resolve(PAGE) })
  })
})

async function waitForNote(view: { container: HTMLElement }, kind: 'success' | 'failure'): Promise<void> {
  await vi.waitFor(() => { expect(view.container.querySelector(`[data-note="${kind}"]`)).not.toBeNull() })
}
