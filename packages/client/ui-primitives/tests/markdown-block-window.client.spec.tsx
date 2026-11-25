// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'
import { markdownLabels } from './labels.client.ts'

afterEach(cleanup)

const earlierLabels = { ...markdownLabels, showEarlier: 'Expand' }

function paragraphs(count: number, prefix: string): string {
  return Array.from({ length: count }, (_value, index) => `${prefix}-${index}`).join('\n\n')
}

describe('settled markdown block window', () => {
  it('renders the whole document when the earlier control is omitted', () => {
    const view = render(<MarkdownText text={paragraphs(400, 'full')} labels={markdownLabels} />)
    expect(view.queryByRole('button', { name: 'Expand' })).toBeNull()
    expect(view.container.querySelectorAll('p')).toHaveLength(400)
    expect(view.getByText('full-0')).toBeTruthy()
  })

  it('keeps a short document intact when the control is available', () => {
    const view = render(<MarkdownText text={paragraphs(3, 'short')} labels={earlierLabels} />)
    expect(view.queryByRole('button', { name: 'Expand' })).toBeNull()
    expect(view.container.querySelectorAll('p')).toHaveLength(3)
  })

  it('mounts the tail first and reveals earlier blocks one window at a time', () => {
    const view = render(<MarkdownText text={paragraphs(400, 'para')} labels={earlierLabels} />)
    expect(view.queryByText('para-0')).toBeNull()
    expect(view.getByText('para-399')).toBeTruthy()
    const first = view.container.querySelectorAll('p').length
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(400)

    fireEvent.click(view.getByRole('button', { name: 'Expand' }))
    const second = view.container.querySelectorAll('p').length
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThan(400)
    expect(view.queryByText('para-0')).toBeNull()

    for (let step = 0; step < 10 && view.queryByRole('button', { name: 'Expand' }) !== null; step += 1) {
      fireEvent.click(view.getByRole('button', { name: 'Expand' }))
    }
    expect(view.queryByRole('button', { name: 'Expand' })).toBeNull()
    expect(view.getByText('para-0')).toBeTruthy()
    expect(view.container.querySelectorAll('p')).toHaveLength(400)
  })

  it('resets the window when the source changes', () => {
    const view = render(<MarkdownText text={paragraphs(400, 'first')} labels={earlierLabels} />)
    fireEvent.click(view.getByRole('button', { name: 'Expand' }))
    expect(view.container.querySelectorAll('p').length).toBeGreaterThan(160)

    view.rerender(<MarkdownText text={paragraphs(400, 'second')} labels={earlierLabels} />)
    expect(view.queryByText('second-0')).toBeNull()
    expect(view.getByText('second-399')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Expand' })).toBeTruthy()
  })
})
