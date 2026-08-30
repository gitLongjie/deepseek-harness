/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** 深度Works brand mark, kept in sync with ui-primitives MewoLogo. */
const MARK_URI = 'data:image/png;base64,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'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.wordmark = div(css.wordmark)
    const mark = document.createElement('img')
    mark.className = css.mark ?? ''
    mark.src = process.env.DSH_CLIENT_BRAND_ICON ?? MARK_URI
    mark.alt = ''
    const name = div(css.wordmarkName, process.env.DSH_CLIENT_BRAND_NAME ?? '深度Works')
    this.wordmark.append(mark, name)
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.hint = div(css.hint, '加载插件中…')
    this.card.append(this.wordmark, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.wordmark, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, '插件加载失败'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.wordmark, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
