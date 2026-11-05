// @vitest-environment jsdom
/** Editor saves, conflict recovery and intentional draft replacement. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import type { StudioContent, StudioDocument, StudioId } from '@deepseek-ai/dsh-video-workbench'
import { ScreenplayEditor } from '../src/client/ScreenplayEditor.tsx'
import { StudioRequestError } from '../src/client/studio-api.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function setup() {
  const createWork = vi.fn(async (content: StudioContent): Promise<StudioDocument> => ({ ...content, id: 'c018c314-ece8-4616-8057-e357b2074f27' as StudioId, format: 'dsh-studio', version: 1, revision: 1, updatedAt: '2026-11-04T00:00:00Z' }))
  const saveWork = vi.fn(async (): Promise<StudioDocument> => { throw new StudioRequestError(409) })
  render(<ScreenplayEditor t={makeTranslate(en)} createWork={createWork} saveWork={saveWork}
    listWorks={async () => ({ works: [], errors: [] })} readWork={async () => { throw new Error('missing') }} />)
  return { createWork, saveWork }
}

it('saves ordered screenplay elements and retains the draft on revision conflict', async () => {
  const { createWork, saveWork } = setup()
  fireEvent.change(screen.getByLabelText('Work title'), { target: { value: 'The return' } })
  fireEvent.click(screen.getByText('Add element'))
  fireEvent.change(screen.getByLabelText('Scene heading 1'), { target: { value: 'INT. HOME - NIGHT' } })
  fireEvent.click(screen.getByText('Save'))
  await screen.findByText(/Revision saved/)
  expect(createWork).toHaveBeenCalledWith(expect.objectContaining({ title: 'The return', blocks: [expect.objectContaining({ kind: 'scene', text: 'INT. HOME - NIGHT' })] }))
  fireEvent.change(screen.getByLabelText('Work title'), { target: { value: 'My unsaved version' } })
  fireEvent.click(screen.getByText('Save'))
  await screen.findByText(/Another editor saved/)
  expect(saveWork).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('Work title') as HTMLInputElement).value).toBe('My unsaved version')
})

it('undoes and redoes edits and requires a second open action before discarding them', async () => {
  setup()
  const title = screen.getByLabelText('Work title') as HTMLInputElement
  fireEvent.change(title, { target: { value: 'Draft' } })
  fireEvent.click(screen.getByText('Undo'))
  expect(title.value).toBe('')
  fireEvent.click(screen.getByText('Redo'))
  expect(title.value).toBe('Draft')
  fireEvent.click(screen.getByText('Open'))
  expect(title.value).toBe('Draft')
  fireEvent.click(screen.getByText('Discard draft and open'))
  await waitFor(() => expect(title.value).toBe(''))
})


it('keeps graph and canvas changes in one draft across tabs and saves content without revision metadata', async () => {
  let saved: StudioContent | undefined
  const createWork = async (content: StudioContent): Promise<StudioDocument> => {
    saved = content
    return { ...content, id: 'c018c314-ece8-4616-8057-e357b2074f27' as StudioId,
      format: 'dsh-studio', version: 1, revision: 1, updatedAt: '2026-11-04T00:00:00Z' }
  }
  const saveWork = vi.fn(async (_id: StudioId, _revision: number, content: StudioContent) => {
    saved = content
    return { ...await createWork(content), revision: 2 }
  })
  const props = { t: makeTranslate(en), createWork, saveWork,
    listWorks: async () => ({ works: [], errors: [] }), readWork: async () => { throw new Error('missing') } }
  const view = render(<ScreenplayEditor {...props} mode="graph" />)
  fireEvent.change(screen.getByLabelText('Work title'), { target: { value: 'Shared work' } })
  fireEvent.click(screen.getByText('Add node'))
  fireEvent.change(screen.getByLabelText('Relationship node'), { target: { value: 'Mei' } })
  fireEvent.click(screen.getByText('Add node'))
  fireEvent.change(screen.getAllByLabelText('Relationship node')[1]!, { target: { value: 'Lin' } })
  const options = screen.getByLabelText('From node') as HTMLSelectElement
  fireEvent.change(options, { target: { value: options.options[1]!.value } })
  fireEvent.change(screen.getByLabelText('To node'), { target: { value: options.options[2]!.value } })
  fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Siblings' } })
  fireEvent.click(screen.getByText('Add relationship'))
  expect(screen.getByRole('img').querySelectorAll('line')).toHaveLength(1)
  view.rerender(<ScreenplayEditor {...props} mode="canvas" />)
  fireEvent.click(screen.getByText('Add card'))
  fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'Arrival' } })
  fireEvent.click(screen.getByText('Save'))
  await screen.findByText(/Revision saved/)
  expect(saved).toMatchObject({ canvas: [{ title: 'Arrival' }], graph: { edges: [{ label: 'Siblings' }] } })
  view.rerender(<ScreenplayEditor {...props} mode="screenplay" />)
  fireEvent.click(screen.getByText('Add element'))
  fireEvent.click(screen.getByText('Save'))
  await waitFor(() => expect(saveWork).toHaveBeenCalledOnce())
  expect(saved).toMatchObject({ canvas: [{ title: 'Arrival' }], graph: { edges: [{ label: 'Siblings' }] } })
  expect(saved).not.toHaveProperty('revision')
  view.rerender(<ScreenplayEditor {...props} mode="graph" />)
  expect((screen.getAllByLabelText('Relationship node')[0] as HTMLInputElement).value).toBe('Mei')
})


it('exports only the saved revision and prepares a skill request without modifying the work', async () => {
  const document: StudioDocument = { title: 'Saved work', source: '', blocks: [],
    id: 'c018c314-ece8-4616-8057-e357b2074f27' as StudioId, format: 'dsh-studio', version: 1,
    revision: 3, updatedAt: '2026-11-04T00:00:00Z' }
  const exportWork = vi.fn(async () => ({ path: 'studio/movie.mp4', revision: 3, duration: 5 }))
  const requestSkill = vi.fn(async () => {})
  const props = { t: makeTranslate(en), exportWork, requestSkill,
    createWork: async () => document, saveWork: async () => document,
    listWorks: async () => ({ works: [document], errors: [] }), readWork: async () => document }
  const view = render(<ScreenplayEditor {...props} mode="editor" />)
  expect((screen.getByText('Export saved movie') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByText('Refresh works'))
  await screen.findByText('Saved work')
  fireEvent.change(screen.getByLabelText('Work'), { target: { value: document.id } })
  fireEvent.click(screen.getByText('Open'))
  await waitFor(() => expect((screen.getByLabelText('Work title') as HTMLInputElement).value).toBe('Saved work'))
  fireEvent.click(screen.getByText('Export saved movie'))
  await screen.findByText('Download MP4')
  expect(exportWork).toHaveBeenCalledWith(document.id, 3)
  view.rerender(<ScreenplayEditor {...props} mode="skills" />)
  fireEvent.click(screen.getAllByText('Prepare skill request')[0]!)
  expect(requestSkill).toHaveBeenCalledWith('character-consistency', document.id, 3)
  fireEvent.change(screen.getByLabelText('Work title'), { target: { value: 'Local draft' } })
  expect((screen.getAllByText('Prepare skill request')[0] as HTMLButtonElement).disabled).toBe(true)
})
