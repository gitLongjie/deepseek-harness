// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HeroSkillBar, HeroSuggestions } from '../src/client/skeleton/HeroExtras.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

afterEach(() => {
  cleanup()
})

describe('HeroSkillBar', () => {
  it('renders one pill per starter skill and fills the draft with its prompt', () => {
    const onPick = vi.fn()
    render(<HeroSkillBar t={t} onPick={onPick} />)
    expect(screen.getByText('Slides')).toBeDefined()
    expect(screen.getByText('Deep research report')).toBeDefined()
    expect(screen.getByText('Video')).toBeDefined()
    fireEvent.click(screen.getByText('Slides'))
    expect(onPick).toHaveBeenCalledWith('Create a well-structured, polished slide deck for me')
  })
})

describe('HeroSuggestions', () => {
  it('shows one page of suggestions and picks the clicked prompt', () => {
    const onPick = vi.fn()
    render(<HeroSuggestions t={t} onPick={onPick} />)
    expect(screen.getByText('Design a Mid-Autumn reunion poster in Chinese national-trend style')).toBeDefined()
    expect(screen.queryByText('Build a team knowledge-base website with full-text search')).toBeNull()
    fireEvent.click(screen.getByText('Write an analysis article on AI industry trends'))
    expect(onPick).toHaveBeenCalledWith('Write an analysis article on AI industry trends')
  })

  it('refresh cycles to the next page and wraps back to the first', () => {
    render(<HeroSuggestions t={t} onPick={vi.fn()} />)
    fireEvent.click(screen.getByText('More'))
    expect(screen.getByText('Build a team knowledge-base website with full-text search')).toBeDefined()
    expect(screen.queryByText('Design a Mid-Autumn reunion poster in Chinese national-trend style')).toBeNull()
    fireEvent.click(screen.getByText('More'))
    expect(screen.queryByText('Design a Mid-Autumn reunion poster in Chinese national-trend style')).toBeDefined()
  })
})
