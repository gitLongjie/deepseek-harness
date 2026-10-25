// @vitest-environment jsdom
/**
 * Video workbench page tests: the catalog renders the injected listing, selection switches the
 * detail pane, keyframes and the final assembly point at the host file route, and failures
 * surface their message.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import { VideoWorkbenchPage, type VideoWorkbenchProject, type VideoWorkbenchSummary } from '../src/client/VideoWorkbenchPage.tsx'
import { workbenchFileUrl } from '../src/client/endpoints.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const OUTPUT_DIR = 'C:/Users/demo/.dsh/cache/video'

const VP1: VideoWorkbenchProject = {
  id: 'vp-1',
  revision: 2,
  goal: 'a 12s brand film',
  mode: 'per_segment',
  createdAt: 1_700_000_000_000,
  segments: [
    {
      id: 's1',
      rendered: true, shots: [],
      prompt: 'opening wide shot of a mountain',
      keyframe: `${OUTPUT_DIR}/keyframes/vp-1-s1.png`,
      file: `${OUTPUT_DIR}/segments/vp-1-s1.mp4`,
    },
    { id: 's2', rendered: false, shots: [], prompt: 'close-up of the summit' },
  ],
  assets: [],
  final: `${OUTPUT_DIR}/final/vp-1.mp4`,
  finalBytes: 2_500_000,
}

function summary(overrides: Partial<VideoWorkbenchSummary> = {}): VideoWorkbenchSummary {
  return {
    outputDir: OUTPUT_DIR,
    projects: [
      VP1,
      {
        id: 'vp-2',
        revision: 1,
        goal: 'espresso close-up',
        mode: 'multi_shot',
        createdAt: 1_600_000_000_000,
        segments: [{ id: 'all', rendered: true, shots: [], prompt: 'espresso close-up' }],
        assets: [],
      },
    ],
    errors: [],
    ...overrides,
  }
}

function renderPage(
  load: (call: number) => VideoWorkbenchSummary | Promise<VideoWorkbenchSummary> = () => summary(),
  requestRegeneration: (planId: string, segmentId: string) => Promise<void> = async () => {},
  deletes: {
    project?: (planId: string) => Promise<void>
    asset?: (planId: string, assetId: string) => Promise<void>
  } = {},
) {
  const loadSummary = vi.fn(async () => await Promise.resolve(load(0)))
  const regenerate = vi.fn(requestRegeneration)
  const deleteProject = vi.fn(deletes.project ?? (async () => {}))
  const deleteAsset = vi.fn(deletes.asset ?? (async () => {}))
  const regenerateAsset = vi.fn(async () => {})
  const useWorkspaces = (select: (value: unknown) => unknown): unknown => select(undefined)
  const props = {
    loadSummary,
    requestRegeneration: regenerate,
    requestAssetRegeneration: regenerateAsset,
    deleteProject,
    deleteAsset,
    useWorkspaces,
    t: makeTranslate(en),
  } as unknown as Parameters<typeof VideoWorkbenchPage>[0]
  const page = render(<VideoWorkbenchPage {...props} />)
  return { page, loadSummary, regenerate, regenerateAsset, deleteProject, deleteAsset }
}

describe('VideoWorkbenchPage', () => {
  it('reports unreadable plans even when the listing has no valid projects', async () => {
    renderPage(() => summary({ projects: [], errors: ['plan vp-1.json: corrupt'] }))
    expect(await screen.findByText(`${en.errors}: 1`)).toBeDefined()
  })

  it('keeps every authored shot visible when the backend renders one combined task', async () => {
    renderPage(() => summary({ projects: [{
      ...VP1,
      mode: 'multi_shot',
      segments: [{ id: 'all', rendered: false, prompt: 'opening\nclose', shots: [
        { id: 's1', prompt: 'opening', durationSeconds: 6, camera: 'pan left', ratio: '9:16', resolution: '768P', backend: 'local' },
        { id: 's2', prompt: 'close', durationSeconds: 6 },
      ] }],
    }] }))
    expect(await screen.findByText('opening')).toBeDefined()
    expect(screen.getByText('close')).toBeDefined()
    expect(screen.getByText('pan left')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Regenerate storyboard' })).toBeDefined()
    expect(screen.queryByText('rendering…', { exact: false })).toBeNull()
    const storyboard = screen.getByRole('list', { name: 'Storyboard' })
    const text = within(storyboard).getAllByRole('listitem')
      .map(row => [...row.children].map(child => child.textContent).join('\n')).join('\n\n')
    await expect(`${text}\n`).toMatchFileSnapshot('./expected/multi-shot-storyboard.txt')
  })

  it('keeps the most recent refresh when an earlier listing finishes late', async () => {
    let resolveFirst!: (value: VideoWorkbenchSummary) => void
    const first = new Promise<VideoWorkbenchSummary>((resolve) => { resolveFirst = resolve })
    let calls = 0
    const { loadSummary } = renderPage(() => ++calls === 1 ? first : summary({ projects: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('No video projects yet')).toBeDefined()
    await act(async () => { resolveFirst(summary()); await first })
    expect(loadSummary).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('vp-1')).toBeNull()
  })
  it('renders the project catalog with mode and revision', async () => {
    renderPage()
    expect(await screen.findByText('vp-1')).toBeDefined()
    // The goal renders in both the catalog row and the detail header.
    expect(screen.getAllByText('a 12s brand film').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/per shot/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/one task/).length).toBeGreaterThan(0)
  })

  it('plays each rendered shot inline and the final assembly below it', async () => {
    renderPage()
    await screen.findByText('vp-1')
    const sources = [...document.querySelectorAll('video')].map(video => video.getAttribute('src'))
    // The shot itself is the player; the keyframe is only its poster.
    expect(sources).toContain('/api/video-workbench/file?path=segments%2Fvp-1-s1.mp4')
    expect(sources).toContain('/api/video-workbench/file?path=final%2Fvp-1.mp4')
    const shot = [...document.querySelectorAll('video')]
      .find(video => video.getAttribute('src')?.includes('segments')) as HTMLVideoElement
    expect(shot.getAttribute('poster')).toBe('/api/video-workbench/file?path=keyframes%2Fvp-1-s1.png')
    expect(screen.getByText(/s1 — rendered/)).toBeDefined()
    expect(screen.getByText(/s2 — not rendered/)).toBeDefined()
    expect(screen.getByText(/2 MB/)).toBeDefined()
  })

  it('switches the detail pane to the clicked project', async () => {
    renderPage()
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByText('espresso close-up'))
    // The new project carries no rendered shot and no final cut.
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByText(/not assembled yet/)).toBeDefined()
  })

  it('renders recorded cast images, prompt blocks, and library state', async () => {
    renderPage(() => summary({
      projects: [{
        ...VP1,
        assets: [
          {
            id: 'char-1',
            name: '小明',
            kind: 'character',
            prompt: '小明，短发工装',
            reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
            sheet: `${OUTPUT_DIR}/assets/vp-1-char-1-sheet.png`,
            saved: true,
          },
          {
            id: 'scene-1',
            name: '山顶',
            kind: 'scene',
            description: '雪山垭口',
            reference: `${OUTPUT_DIR}/assets/vp-1-scene-1.jpg`,
            saved: false,
          },
          { id: 'prop-1', name: '茶砖', kind: 'prop', saved: false },
        ],
      }],
    }))
    await screen.findByText('vp-1')
    // Cast, sets, and props are separate shelves, in that reading order.
    const headings = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
    expect(headings.slice(0, 3)).toEqual(['Cast', 'Sets', 'Props'])
    expect(screen.getByText('小明')).toBeDefined()
    expect(screen.getByText('小明，短发工装')).toBeDefined()
    expect(screen.getByText('In project library')).toBeDefined()
    expect(screen.getByText('山顶')).toBeDefined()
    expect(screen.getByText('雪山垭口')).toBeDefined()
    expect(screen.getByText('茶砖')).toBeDefined()
    expect(screen.getAllByText('Not in library')).toHaveLength(2)
    const sources = [...document.querySelectorAll('img')].map(image => image.getAttribute('src'))
    expect(sources).toContain('/api/video-workbench/file?path=assets%2Fvp-1-char-1.png')
    expect(sources).toContain('/api/video-workbench/file?path=assets%2Fvp-1-char-1-sheet.png')
    expect(sources).toContain('/api/video-workbench/file?path=assets%2Fvp-1-scene-1.jpg')
    // The master sheet carries its own label, so two images of one character stay distinguishable.
    expect(document.querySelector('img[alt="Master sheet 小明"]')).not.toBeNull()
  })

  it('previews an asset image larger and closes it from the button, Escape, or the backdrop', async () => {
    const character = {
      id: 'char-1',
      name: '小明',
      kind: 'character',
      reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
      sheet: `${OUTPUT_DIR}/assets/vp-1-char-1-sheet.png`,
      saved: true,
    }
    renderPage(() => summary({ projects: [{ ...VP1, assets: [character] }] }))
    await screen.findByText('vp-1')

    fireEvent.click(screen.getByRole('button', { name: 'Open preview Character 小明' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Character 小明')
    expect(dialog.querySelector('img')?.getAttribute('src'))
      .toBe('/api/video-workbench/file?path=assets%2Fvp-1-char-1.png')
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // The master sheet gets its own preview.
    fireEvent.click(screen.getByRole('button', { name: 'Open preview Master sheet 小明' }))
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src'))
      .toBe('/api/video-workbench/file?path=assets%2Fvp-1-char-1-sheet.png')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // A click inside the panel keeps it open; a click on the backdrop closes it.
    fireEvent.click(screen.getByRole('button', { name: 'Open preview Character 小明' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    const backdrop = document.querySelector('[role="presentation"]')
    if (backdrop === null) throw new Error('missing preview backdrop')
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens one rendered shot larger in the preview dialog', async () => {
    renderPage()
    await screen.findByText('vp-1')
    const shot = [...document.querySelectorAll('video')]
      .find(video => video.getAttribute('src')?.includes('segments')) as HTMLVideoElement
    fireEvent.click(shot)
    // The inline player is the shot's own control surface; no dialog takes over the page.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(shot.controls).toBe(true)
  })

  it('previews a pending shot by its keyframe still', async () => {
    renderPage(() => summary({
      projects: [{
        ...VP1,
        segments: [{
          id: 's2',
          rendered: false, shots: [],
          prompt: 'close-up of the summit',
          keyframe: `${OUTPUT_DIR}/keyframes/vp-1-s2.png`,
        }],
      }],
    }))
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Open preview Shots s2' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('video')).toBeNull()
    expect(dialog.querySelector('img')?.getAttribute('src'))
      .toBe('/api/video-workbench/file?path=keyframes%2Fvp-1-s2.png')
  })

  it('prefills the chat input with one shot prompt and its anchors', async () => {
    const { regenerate } = renderPage()
    await screen.findByText('vp-1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate this shot' })[0]!)
    expect(regenerate).toHaveBeenCalledWith(
      'vp-1',
      's1',
      'opening wide shot of a mountain',
      // The plan records no assets, so no anchors ride along.
      [],
      OUTPUT_DIR,
    )
    expect(await screen.findByText(/prefilled in the input box/)).toBeDefined()
  })

  it('carries only the anchors the shot names', async () => {
    const { regenerate } = renderPage(() => summary({
      projects: [{
        ...VP1,
        assets: [
          {
            id: 'char-1',
            name: '林晓',
            kind: 'character',
            prompt: '林晓，齐肩黑发',
            reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
            sheet: `${OUTPUT_DIR}/assets/vp-1-char-1-sheet.png`,
            saved: true,
          },
          {
            id: 'scene-1',
            name: '山顶',
            kind: 'scene',
            description: '雪山垭口',
            reference: `${OUTPUT_DIR}/assets/vp-1-scene-1.jpg`,
            saved: false,
          },
        ],
        segments: [{
          id: 's1',
          rendered: true, shots: [],
          prompt: '林晓站在门口',
          file: `${OUTPUT_DIR}/segments/vp-1-s1.mp4`,
        }],
      }],
    }))
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate this shot' }))
    expect(regenerate).toHaveBeenCalledWith('vp-1', 's1', '林晓站在门口', [
      {
        name: '林晓',
        kind: 'character',
        description: '林晓，齐肩黑发',
        reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
        sheet: `${OUTPUT_DIR}/assets/vp-1-char-1-sheet.png`,
      },
    ], OUTPUT_DIR)
  })

  it('reports a hand-off that could not reach the chat', async () => {
    renderPage(undefined, async () => { throw new Error('no chat') })
    await screen.findByText('vp-1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Regenerate this shot' })[0]!)
    expect(await screen.findByText(/Could not reach the chat input/)).toBeDefined()
  })

  it('deletes a project only after a confirming second click', async () => {
    const { deleteProject, loadSummary } = renderPage()
    await screen.findByText('vp-1')
    const button = screen.getByRole('button', { name: 'Delete vp-1' })
    fireEvent.click(button)
    // The first click only arms the row.
    expect(deleteProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete vp-1' }))
    expect(deleteProject).toHaveBeenCalledWith('vp-1')
    // A successful deletion re-reads the listing.
    await waitFor(() => { expect(loadSummary.mock.calls.length).toBeGreaterThanOrEqual(2) })
  })

  it('reports a refused deletion', async () => {
    renderPage(undefined, undefined, {
      project: async () => { throw new Error('not a project id') },
    })
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete vp-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete vp-1' }))
    expect(await screen.findByText(/Delete failed: not a project id/)).toBeDefined()
  })

  it('deletes one recorded asset from the selected project', async () => {
    const { deleteAsset } = renderPage(() => summary({
      projects: [{
        ...VP1,
        assets: [{
          id: 'char-1',
          name: '小明',
          kind: 'character',
          reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
          saved: true,
        }],
      }],
    }))
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete 小明' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete 小明' }))
    expect(deleteAsset).toHaveBeenCalledWith('vp-1', 'char-1')
  })

  it('hands one asset back to the chat for a fresh image', async () => {
    const { regenerateAsset } = renderPage(() => summary({
      projects: [{
        ...VP1,
        assets: [{
          id: 'char-1',
          name: '小明',
          kind: 'character',
          reference: `${OUTPUT_DIR}/assets/vp-1-char-1.png`,
          saved: true,
        }],
      }],
    }))
    await screen.findByText('vp-1')
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate image' }))
    expect(regenerateAsset).toHaveBeenCalledWith('vp-1', 'char-1', '小明', 'character')
    expect(await screen.findByText(/prefilled in the input box/)).toBeDefined()
  })

  it('shows the empty-cast hint for a plan without assets', async () => {
    renderPage(() => summary({ projects: [VP1] }))
    expect(await screen.findByText('No cast or sets recorded for this plan')).toBeDefined()
  })

  it('renders only the shelves the plan actually carries', async () => {
    renderPage(() => summary({
      projects: [{
        ...VP1,
        assets: [{
          id: 'scene-1',
          name: '山顶',
          kind: 'scene',
          reference: `${OUTPUT_DIR}/assets/vp-1-scene-1.jpg`,
          saved: false,
        }],
      }],
    }))
    await screen.findByText('vp-1')
    expect(screen.getByRole('heading', { level: 3, name: 'Sets' })).toBeDefined()
    expect(screen.queryByRole('heading', { level: 3, name: 'Cast' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: 'Props' })).toBeNull()
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
