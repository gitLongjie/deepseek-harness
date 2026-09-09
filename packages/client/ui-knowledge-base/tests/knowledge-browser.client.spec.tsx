// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { KnowledgeDocumentRow } from '../src/client/contract/slots.ts'
import type { KnowledgeBrowserProps } from '../src/client/KnowledgeBrowser.tsx'
import { KnowledgeBrowser } from '../src/client/KnowledgeBrowser.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is knowledge ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: KnowledgeBrowserProps['t'] = makeTranslate(zh, commonZh)

const DOCS: readonly KnowledgeDocumentRow[] = [
  { id: 'doc-1', title: '使用指南.docx', kind: 'file', fileType: 'docx', updatedAt: '2026-09-05T07:20:17+08:00' },
  { id: 'doc-2', title: '架构总览', kind: 'url', updatedAt: '2026-09-01T00:00:00+08:00' },
]

/** The first page of doc-1's content, as the reader reads it. */
const CONTENT = {
  id: 'doc-1',
  title: '使用指南.docx',
  summary: '产品安装与配置',
  chunks: [
    { index: 1, content: '第一步：解压安装包。' },
    { index: 2, content: '第二步：运行安装程序。' },
  ],
  total: 3,
  page: 1,
  pageSize: 2,
}

function mount(overrides: Partial<KnowledgeBrowserProps> = {}) {
  const props: KnowledgeBrowserProps = {
    base: { id: 'kb-1', name: '产品文档' },
    listDocuments: vi.fn(async () => ({ documents: DOCS, total: DOCS.length })),
    readDocument: vi.fn(async () => CONTENT),
    onAsk: vi.fn(),
    onClose: vi.fn(),
    t,
    ...overrides,
  }
  render(<KnowledgeBrowser {...props} />)
  return {
    props,
    listDocuments: props.listDocuments as ReturnType<typeof vi.fn>,
    readDocument: props.readDocument as ReturnType<typeof vi.fn>,
    onAsk: props.onAsk as ReturnType<typeof vi.fn>,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
  }
}

describe('KnowledgeBrowser', () => {
  it('renders the header, column labels, and one row per document', async () => {
    const b = mount()
    expect(screen.getByText('产品文档')).toBeTruthy()
    expect(screen.getByText('名称')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })
    expect(screen.getByText('架构总览')).toBeTruthy()
    expect(screen.getByText('DOCX')).toBeTruthy()
    expect(screen.getByText('网页')).toBeTruthy()
    expect(screen.getByText('9/5')).toBeTruthy()
    expect(b.listDocuments).toHaveBeenCalledWith('kb-1', '')
  })

  it('filters through the backend keyword and recovers on clear', async () => {
    const b = mount()
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '搜索知识库' }))
    const input = screen.getByPlaceholderText('搜索文档…')
    fireEvent.change(input, { target: { value: '指南' } })
    await waitFor(() => {
      expect(b.listDocuments).toHaveBeenLastCalledWith('kb-1', '指南')
    })

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => {
      expect(b.listDocuments).toHaveBeenLastCalledWith('kb-1', '')
    })
    expect(screen.getByText('使用指南.docx')).toBeTruthy()
  })

  it('shows the retry state on a failed read and reloads on retry', async () => {
    const listDocuments = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ documents: DOCS, total: DOCS.length })
    mount({ listDocuments })
    await waitFor(() => {
      expect(screen.getByText('知识库暂时无法访问')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('shows the loading and empty states', () => {
    mount({ listDocuments: () => new Promise(() => {}) })
    expect(screen.getByText('正在加载知识库…')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mount({ listDocuments: vi.fn(async () => ({ documents: [], total: 0 })) })
    await waitFor(() => {
      expect(screen.getByText('暂无文档')).toBeTruthy()
    })
  })

  it('asks through the header action and returns through the back action', () => {
    const b = mount({ listDocuments: () => new Promise(() => {}) })
    fireEvent.click(screen.getByRole('button', { name: '提问' }))
    expect(b.onAsk).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(b.onClose).toHaveBeenCalledOnce()
  })

  it('double-clicking a row opens the document reader with its content', async () => {
    const b = mount()
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })
    fireEvent.doubleClick(screen.getByText('使用指南.docx'))
    await waitFor(() => {
      expect(screen.getByText('第一步：解压安装包。')).toBeTruthy()
    })
    expect(screen.getByText('第二步：运行安装程序。')).toBeTruthy()
    expect(screen.getByText('产品安装与配置')).toBeTruthy()
    expect(screen.getByText('第 1/2 页')).toBeTruthy()
    expect(b.readDocument).toHaveBeenCalledWith('doc-1', 1)

    // Back returns to the table.
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => {
      expect(screen.getByText('架构总览')).toBeTruthy()
    })
  })

  it('pages the reader through the document', async () => {
    const readDocument = vi.fn()
      .mockResolvedValueOnce(CONTENT)
      .mockResolvedValueOnce({ ...CONTENT, chunks: [{ index: 3, content: '第三步：完成。' }], page: 2 })
      .mockResolvedValue(CONTENT)
    mount({ readDocument })
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })
    fireEvent.doubleClick(screen.getByText('使用指南.docx'))
    await waitFor(() => {
      expect(screen.getByText('第 1/2 页')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(screen.getByText('第三步：完成。')).toBeTruthy()
    })
    expect(readDocument).toHaveBeenLastCalledWith('doc-1', 2)

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => {
      expect(screen.getByText('第一步：解压安装包。')).toBeTruthy()
    })
  })

  it('shows the reader retry state on a failed page read and recovers', async () => {
    const readDocument = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(CONTENT)
    mount({ readDocument })
    await waitFor(() => {
      expect(screen.getByText('使用指南.docx')).toBeTruthy()
    })
    fireEvent.doubleClick(screen.getByText('使用指南.docx'))
    await waitFor(() => {
      expect(screen.getByText('知识库暂时无法访问')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(screen.getByText('第一步：解压安装包。')).toBeTruthy()
    })
  })

  it('links the original source for web-page entries', async () => {
    mount({ readDocument: vi.fn(async () => ({ ...CONTENT, sourceUrl: 'https://example.com/page' })) })
    await waitFor(() => {
      expect(screen.getByText('架构总览')).toBeTruthy()
    })
    fireEvent.doubleClick(screen.getByText('架构总览'))
    await waitFor(() => {
      expect(screen.getByText('查看来源').getAttribute('href')).toBe('https://example.com/page')
    })
  })
})
