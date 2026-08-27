/** Copy dictionaries for the login gate. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'login'

/** English strings (the key-set source of truth for this pair). */
export const en = {
  pageTitle: 'Sign in to 深度Works',
  tagline: 'Into the Realm of Wonder',
  username: 'Username',
  password: 'Password',
  submit: 'Sign in',
  submitting: 'Signing in…',
  register: 'Create an account',
  logout: 'Sign out',
  networkUnreachable: 'The sign-in service is unreachable. Check the network and try again.',
  invalidResponse: 'The sign-in service returned an unrecognized response.',
  credentialWriteFailed: 'Sign-in succeeded, but storing the API key was rejected (a read-only environment variable may shadow it).',
} satisfies Record<string, string>

/** The login namespace key union. */
export type LoginKey = keyof typeof en

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  pageTitle: '登录深度Works',
  tagline: '探索妙想之境',
  username: '用户名',
  password: '密码',
  submit: '登录',
  submitting: '登录中…',
  register: '注册账号',
  logout: '退出登录',
  networkUnreachable: '登录服务无法访问，请检查网络后重试。',
  invalidResponse: '登录服务返回了无法识别的响应。',
  credentialWriteFailed: '登录成功，但写入 API Key 被拒绝（可能有只读环境变量遮蔽了它）。',
} satisfies Record<LoginKey, string>
