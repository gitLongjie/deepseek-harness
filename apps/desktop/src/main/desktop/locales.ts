/**
 * Desktop-shell copy for the main process surfaces that live outside the web
 * bundle: the application menu, the tray menu, and the about dialog. The web
 * frontend owns its own locale system (packages/client/locale); this module
 * is the minimal zh/en pair the Electron main process needs, defaulting to
 * Chinese per the product preference.
 * @module @deepseek-ai/dsh-desktop/desktop/locales
 */

/** Simplified-Chinese strings; the key-set source of truth for the pair. */
export const zh = {
  'menu.edit': '编辑',
  'menu.view': '视图',
  'menu.window': '窗口',
  'menu.help': '帮助',
  'menu.app': 'App',
  'menu.undo': '撤消',
  'menu.redo': '重做',
  'menu.cut': '剪切',
  'menu.copy': '复制',
  'menu.paste': '粘贴',
  'menu.pasteAndMatchStyle': '粘贴并匹配样式',
  'menu.delete': '删除',
  'menu.selectAll': '全选',
  'menu.reload': '重新加载',
  'menu.forceReload': '强制重新加载',
  'menu.toggleDevTools': '开发者工具',
  'menu.resetZoom': '重置缩放',
  'menu.zoomIn': '放大',
  'menu.zoomOut': '缩小',
  'menu.fullscreen': '全屏',
  'menu.minimize': '最小化',
  'menu.zoom': '缩放',
  'menu.closeWindow': '关闭窗口',
  'menu.showMainWindow': '显示主窗口',
  'menu.github': 'GitHub 仓库',
  'menu.feedback': '反馈与讨论',
  'menu.about': '关于 深度Works',
  'menu.autostart': '登录时启动',
  'menu.quit': '退出',
  'menu.checkUpdates': '检查更新',
  'tray.showWindow': '显示主窗口',
  'tray.quit': '退出',
  'about.title': '关于',
  'about.message': '深度Works 桌面版',
  'about.version': '版本',
  'update.availableTitle': '发现新版本',
  'update.availableMessage': '发现新版本 {version}，是否立即下载？',
  'update.download': '下载',
  'update.later': '稍后',
  'update.upToDate': '当前已是最新版本',
  'update.error': '检查更新失败，请稍后重试',
  'update.downloadedTitle': '更新已就绪',
  'update.downloadedMessage': '新版本 {version} 已下载，是否立即重启安装？',
  'update.restart': '立即重启',
  'update.ok': '确定',
} satisfies Record<string, string>

/** Desktop-shell string key. */
export type DesktopTextKey = keyof typeof zh

/** English strings, checked complete against the zh key set. */
export const en = {
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.window': 'Window',
  'menu.help': 'Help',
  'menu.app': 'App',
  'menu.undo': 'Undo',
  'menu.redo': 'Redo',
  'menu.cut': 'Cut',
  'menu.copy': 'Copy',
  'menu.paste': 'Paste',
  'menu.pasteAndMatchStyle': 'Paste and Match Style',
  'menu.delete': 'Delete',
  'menu.selectAll': 'Select All',
  'menu.reload': 'Reload',
  'menu.forceReload': 'Force Reload',
  'menu.toggleDevTools': 'Toggle Developer Tools',
  'menu.resetZoom': 'Reset Zoom',
  'menu.zoomIn': 'Zoom In',
  'menu.zoomOut': 'Zoom Out',
  'menu.fullscreen': 'Toggle Full Screen',
  'menu.minimize': 'Minimize',
  'menu.zoom': 'Zoom',
  'menu.closeWindow': 'Close Window',
  'menu.showMainWindow': 'Show Main Window',
  'menu.github': 'GitHub Repository',
  'menu.feedback': 'Feedback & Issues',
  'menu.about': 'About 深度Works',
  'menu.autostart': 'Launch at Login',
  'menu.quit': 'Quit',
  'menu.checkUpdates': 'Check for Updates',
  'tray.showWindow': 'Show Main Window',
  'tray.quit': 'Quit',
  'about.title': 'About',
  'about.message': '深度Works Desktop',
  'about.version': 'Version',
  'update.availableTitle': 'Update available',
  'update.availableMessage': 'A new version ({version}) is available. Download now?',
  'update.download': 'Download',
  'update.later': 'Later',
  'update.upToDate': 'You are on the latest version',
  'update.error': 'Failed to check for updates. Try again later.',
  'update.downloadedTitle': 'Update ready',
  'update.downloadedMessage': 'Version {version} has been downloaded. Restart now to apply it?',
  'update.restart': 'Restart',
  'update.ok': 'OK',
} satisfies Record<DesktopTextKey, string>

/** Locale identifiers understood by the desktop shell. */
export type DesktopLocaleId = 'zh' | 'en'

/** Pick the copy for one locale id. */
export function copy(locale: DesktopLocaleId): Record<DesktopTextKey, string> {
  return locale === 'en' ? en : zh
}

/** Translate one key for a locale id. */
export function t(locale: DesktopLocaleId, key: DesktopTextKey): string {
  return copy(locale)[key]
}

/** Whether a stored preference is a known locale id (defaults to Chinese). */
export function normalizeLocale(value: unknown): DesktopLocaleId {
  return value === 'en' ? 'en' : 'zh'
}
