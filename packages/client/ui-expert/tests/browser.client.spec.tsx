// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ExpertBrowserProps, ExpertRecord } from '../src/client/contract/slots.ts'
import { ExpertBrowser } from '../src/client/ExpertBrowser.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is expert ∪ common; the stub mirrors the real lookup
// chain (namespace, then common vocabulary, then the key).
const t: ExpertBrowserProps['t'] = makeTranslate(zh, commonZh)

const ROWS: readonly ExpertRecord[] = [
  { id: 'standard', name: '标准模式', subtitle: '默认助手', description: '完整的编码 agent。' },
  {
    id: 'geo-optimizer', name: 'GEO 优化专家', subtitle: '可见度实验室', badge: '特邀专家',
    description: '诊断品牌在 AI 搜索中的可见度。', category: 'marketing',
    tags: ['GEO', '报价'], quickPrompts: ['先诊断可见度'], icon: '🔍',
  },
  {
    id: 'painted', name: '插画师', avatar: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  },
]

function mount(overrides: Partial<ExpertBrowserProps> = {}) {
  // The spec stubs the GlobalStandardProps members the page never reads; the
  // cast mirrors the sibling component specs' seat stubs.
  const props = {
    load: vi.fn(async () => ({ experts: ROWS })),
    hire: vi.fn(),
    t,
    ...overrides,
  } as unknown as ExpertBrowserProps
  render(<ExpertBrowser {...props} />)
  return { props, hire: props.hire as ReturnType<typeof vi.fn>, load: props.load as ReturnType<typeof vi.fn> }
}

describe('ExpertBrowser', () => {
  it('renders one hireable card per roster row with its record design', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    })
    expect(screen.getByText('标准模式')).toBeTruthy()
    // The attribution subtitle renders under the name.
    expect(screen.getByText('可见度实验室')).toBeTruthy()
    // The curator badge renders beside the name.
    expect(screen.getByText('特邀专家')).toBeTruthy()
    expect(screen.getByText('诊断品牌在 AI 搜索中的可见度。')).toBeTruthy()
    expect(screen.getByText('GEO')).toBeTruthy()
    expect(screen.getByText('先诊断可见度')).toBeTruthy()
  })

  it('renders the avatar image over the glyph tile when the record carries one', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('插画师')).toBeTruthy()
    })
    // The avatar tile is decorative (aria-hidden), so the img is reached in
    // the DOM, not the accessibility tree.
    expect(document.querySelector('img')).toBeTruthy()
  })

  it('filters cards by the search text across name, subtitle, description, and tags', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('搜索专家'), { target: { value: '报价' } })

    // '报价' matches geo-optimizer's tags, not the other two rows.
    expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    expect(screen.queryByText('标准模式')).toBeNull()
    expect(screen.queryByText('插画师')).toBeNull()

    // The subtitle is searchable too.
    fireEvent.change(screen.getByLabelText('搜索专家'), { target: { value: '默认助手' } })
    expect(screen.getByText('标准模式')).toBeTruthy()
    expect(screen.queryByText('GEO 优化专家')).toBeNull()
  })

  it('narrows and clears the category filter through the chip bar', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'marketing' }))
    expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    expect(screen.queryByText('标准模式')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText('标准模式')).toBeTruthy()
  })

  it('hires through the card button with the expert id', async () => {
    const b = mount()
    await waitFor(() => {
      expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    })

    const hireButtons = screen.getAllByRole('button', { name: '聘用到新对话' })
    fireEvent.click(hireButtons[1]!)

    expect(b.hire).toHaveBeenCalledWith('geo-optimizer')
  })

  it('renders the error state with a retry that re-reads the market', async () => {
    const b = mount({ load: vi.fn(async () => { throw new Error('transport down') }) })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByText('transport down')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(b.load).toHaveBeenCalledTimes(2)
  })

  it('renders the empty market when the roster ships no experts', async () => {
    mount({ load: vi.fn(async () => ({ experts: [] })) })

    await waitFor(() => {
      expect(screen.getByText('市场暂无专家')).toBeTruthy()
    })
  })

  it('renders the no-match state when the filter admits nothing', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('GEO 优化专家')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('搜索专家'), { target: { value: '不存在的专长' } })

    await waitFor(() => {
      expect(screen.getByText('无匹配专家')).toBeTruthy()
    })
  })
})
