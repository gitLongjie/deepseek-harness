// @vitest-environment jsdom
/** The write-only credential control reveals the staged draft and nothing stored. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretField, ValueField } from '../src/client/fields.tsx'

afterEach(cleanup)

function Draft() {
  const [text, setText] = useState('s3cret')
  return (
    <SecretField
      id="plugin-config-geo-password"
      label="密码"
      hint="留空表示保持现有密码。"
      text={text}
      disabled={false}
      configured
      stateLabel="已配置密码。"
      showLabel="显示密码"
      hideLabel="隐藏密码"
      onEdit={setText}
    />
  )
}

describe('SecretField', () => {
  it('masks the staged draft until the reveal is pressed', () => {
    render(<Draft />)

    const input = screen.getByLabelText('密码')
    expect(input.getAttribute('type')).toBe('password')
    expect((input as HTMLInputElement).value).toBe('s3cret')

    fireEvent.change(input, { target: { value: 'next' } })
    expect((input as HTMLInputElement).value).toBe('next')

    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))

    expect(input.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: '隐藏密码' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))

    expect(input.getAttribute('type')).toBe('password')
  })

  it('marks a reference that has no stored credential', () => {
    render(
      <SecretField
        id="plugin-config-geo-password-empty"
        label="密码"
        hint="留空表示保持现有密码。"
        text=""
        disabled={false}
        configured={false}
        stateLabel="未配置密码。"
        showLabel="显示密码"
        hideLabel="隐藏密码"
        onEdit={() => {}}
      />,
    )
    expect(screen.getByText('未配置密码。')).toBeTruthy()
  })
})

describe('ValueField', () => {
  it('renders a plain draft and stages what is typed', () => {
    const onEdit = (text: string) => { edited = text }
    let edited = ''
    render(
      <ValueField
        id="geo-admin-username"
        label="账号"
        hint="发文账号"
        text="admin"
        overridden={false}
        invalid={false}
        overriddenLabel="已覆盖"
        resetLabel="恢复默认"
        invalidLabel="请输入数字"
        disabled={false}
        onEdit={onEdit}
        onReset={() => {}}
      />,
    )
    const input = screen.getByLabelText('账号')
    expect(input.getAttribute('placeholder')).toBe('')
    expect(screen.queryByRole('button', { name: '恢复默认' })).toBeNull()
    fireEvent.change(input, { target: { value: 'editor' } })
    expect(edited).toBe('editor')
  })

  it('omits the hint line when the field has none', () => {
    const { container } = render(
      <ValueField
        id="geo-admin-base-url"
        label="后台地址"
        hint=""
        text=""
        overridden={false}
        invalid={false}
        overriddenLabel="已覆盖"
        resetLabel="恢复默认"
        invalidLabel="请输入数字"
        disabled={false}
        onEdit={() => {}}
        onReset={() => {}}
      />,
    )
    expect(screen.getByLabelText('后台地址')).toBeDefined()
    expect(container.querySelector('p')).toBeNull()
  })

  it('shows an override, a numeric keypad hint, and a placeholder', () => {
    let reset = false
    render(
      <ValueField
        id="geo-admin-base-url"
        label="后台地址"
        hint="例如 http://localhost:8001"
        text="http://localhost:8001"
        overridden
        invalid={false}
        numeric
        placeholder="http://localhost:8001"
        overriddenLabel="已覆盖"
        resetLabel="恢复默认"
        invalidLabel="请输入数字"
        disabled={false}
        onEdit={() => {}}
        onReset={() => { reset = true }}
      />,
    )
    expect(screen.getByLabelText('后台地址').getAttribute('inputmode')).toBe('numeric')
    expect(screen.getByLabelText('后台地址').getAttribute('placeholder')).toBe('http://localhost:8001')
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(reset).toBe(true)
  })

  it('replaces the hint when the draft is not acceptable', () => {
    render(
      <ValueField
        id="h3-duration"
        label="时长"
        hint="秒"
        text="nope"
        overridden={false}
        invalid
        overriddenLabel="已覆盖"
        resetLabel="恢复默认"
        invalidLabel="请输入数字"
        disabled
        onEdit={() => {}}
        onReset={() => {}}
      />,
    )
    const input = screen.getByLabelText('时长')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('请输入数字')).toBeTruthy()
  })
})
