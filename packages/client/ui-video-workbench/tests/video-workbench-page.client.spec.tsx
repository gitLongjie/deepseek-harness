// @vitest-environment jsdom
/**
 * Video workbench page tests: the catalog renders the injected listing, selection switches the
 * detail pane, keyframes and the final assembly point at the host file route, and failures
 * surface their message.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import { VideoWorkbenchPage, type VideoWorkbenchSummary } from '../src/client/VideoWorkbenchPage.tsx'
import { workbenchFileUrl } from '../src/client/endpoints.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const OUTPUT_DIR = 'C:/Users/demo/.dsh/cache/video'

function summary(overrides: Partial<VideoWorkbenchSummary> = {}): VideoWorkbenchSummary {
  return {
    outputDir: OUTPUT_DIR,
    projects: [
      {
        id: 'vp-1',
        revision: 2,
        goal: 'a 12s brand film',
        mode: 'per_segment',
        createdAt: 1_700_000_000_000,
        segments: [
          { id: 's1', rendered: true, keyframe: `${OUTPUT_DIR}/keyframes/vp-1-s1.png` },
          { id: 's2', rendered: false },
        ],
        final: `${OUTPUT_DIR}/final/vp-1.mp4`,
        finalBytes: 2_500_000,
      },
      {
        id: 'vp-2',
        revision: 1,
        goal: 'espresso close-up',
        mode: 'multi_shot',
        createdAt: 1_600_000_000_000,
        segments: [{ id: 'all', rendered: true }],
      },
    ],
    errors: [],
    ...overrides,
  }
}

function renderPage(load: (call: number) => VideoWorkbenchSummary | Promise<VideoWorkbenchSummary> = () => summary()) {
  const loadSummary = vi.fn(async () => await Promise.resolve(load(0)))
  const useWorkspaces = (select: (value: unknown) => unknown): unknown => select(undefined)
  const props = {
    loadSummary,
    useWorkspaces,
    t: makeTranslate(en),
  } as unknown as Parameters<typeof VideoWorkbenchPage>[0]
  const page = render(<VideoWorkbenchPage {...props} />)
  return { page, loadSummary }
}

describe('VideoWorkbenchPage', () => {
  it('renders the project catalog with mode and revision', async () => {
    renderPage()
    expect(await screen.findByText('vp-1')).toBeDefined()
    // The goal renders in both the catalog row and the detail header.
    expect(screen.getAllByText('a 12s brand film').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/per shot/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/one task/).length).toBeGreaterThan(0)
  })

  it('selects a project and renders its keyframe, shot states, and final assembly', async () => {
    renderPage()
    await screen.findByText('vp-1')
    const image = document.querySelector('img[alt^="keyframe"]') as HTMLImageElement
    expect(image?.getAttribute('src')).toBe('/api/video-workbench/file?path=keyframes%2Fvp-1-s1.png')
    expect(screen.getByText(/s1 — rendered/)).toBeDefined()
    expect(screen.getByText(/s2 — rendering…/)).toBeDefined()
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video?.getAttribute('src')).toBe('/api/video-workbench/file?path=final%2Fvp-1.mp4')
    expect(screen.getByText(/2 MB/)).toBeDefined()
  })

  it('switches the detail pane to the clicked project', async () => {
    renderPage()
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByText('espresso close-up'))
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByText(/not assembled yet/)).toBeDefined()
  })

  it('shows the empty state when no projects exist', async () => {
    renderPage(() => ({ outputDir: OUTPUT_DIR, projects: [], errors: [] }))
    expect(await screen.findByText('No video projects yet')).toBeDefined()
  })

  it('surfaces a failed listing', async () => {
    const loadSummary = vi.fn(async () => { throw new Error('offline') })
    const useWorkspaces = (select: (value: unknown) => unknown): unknown => select(undefined)
    const props = {
      loadSummary,
      useWorkspaces,
      t: makeTranslate(en),
    } as unknown as Parameters<typeof VideoWorkbenchPage>[0]
    render(<VideoWorkbenchPage {...props} />)
    expect(await screen.findByText('Could not load the video workbench listing.')).toBeDefined()
  })

  it('re-fetches on refresh', async () => {
    const { loadSummary } = renderPage()
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => { expect(loadSummary.mock.calls.length).toBeGreaterThanOrEqual(2) })
  })
})

describe('workbenchFileUrl', () => {
  it('strips the root and encodes separators for both separator styles', () => {
    expect(workbenchFileUrl('C:/Users/demo/.dsh/cache/video/final/vp-1.mp4', OUTPUT_DIR))
      .toBe('/api/video-workbench/file?path=final%2Fvp-1.mp4')
    expect(workbenchFileUrl('C:\\Users\\demo\\.dsh\\cache\\video\\keyframes\\vp-1-s1.png', OUTPUT_DIR))
      .toBe('/api/video-workbench/file?path=keyframes%2Fvp-1-s1.png')
  })
})
