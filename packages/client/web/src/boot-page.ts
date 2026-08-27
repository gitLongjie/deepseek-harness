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
    mark.src = MARK_URI
    mark.alt = ''
    const name = div(css.wordmarkName, '深度Works')
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
