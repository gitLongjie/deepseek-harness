/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** 喵工作台 brand mark, kept in sync with ui-primitives MewoLogo. */
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
    const name = div(css.wordmarkName, process.env.DSH_CLIENT_BRAND_NAME ?? '喵工作台')
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
