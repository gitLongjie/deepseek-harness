/** Settings panel section: 业务入口 — the deployment's business entries tab. */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BusinessSection.module.css'

/** The deployed business-entry plugin this section drives. */
const PLUGIN_ID = 'xmanrui-dsh-business-entry'

/** The CustomEvent the plugin's client listens for to hot-reload its sidebar slot. */
const TOGGLE_EVENT = 'dsh-business-entry:toggle'

/** The desktop preload-bridge subset this section drives; absent on the plain web. */
interface DesktopIpcBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

/** Full section props. */
export type BusinessSectionProps = PropsLocale<'conversation'>

/**
 * Render the 业务入口 section: a resident visibility switch for the deployed
 * business-entry plugin, plus the home of future business features. Desktop
 * only (`__DSH_IPC__` bridge) and mounted regardless of the plugin's enabled
 * state, so a disabled plugin can always be re-enabled from Settings.
 * @param props - composed Settings slot props.
 * @returns the section element tree, or null off the desktop shell.
 */
export function BusinessSection({ t }: BusinessSectionProps) {
  const ipc = (window as { __DSH_IPC__?: DesktopIpcBridge }).__DSH_IPC__
  const [enabled, setEnabled] = useState(true)
  const [settled, setSettled] = useState(ipc === undefined)

  useEffect(() => {
    if (ipc === undefined) return
    let cancelled = false
    ipc.invoke('dsh:plugin:isEnabled', PLUGIN_ID).then((value) => {
      if (cancelled) return
      setEnabled(value === true)
      setSettled(true)
    }).catch(() => {
      if (cancelled) return
      setSettled(true)
    })
    return () => { cancelled = true }
  }, [ipc])

  if (ipc === undefined) return null

  const toggle = () => {
    if (!settled) return
    const next = !enabled
    setEnabled(next)
    void ipc.invoke('dsh:plugin:setEnabled', PLUGIN_ID, next).then(() => {
      window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { enabled: next } }))
    }).catch(() => { setEnabled(!next) })
  }

  return (
    <div className={css.section}>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('settings.business.visibility')}</div>
          <div className={css.desc}>{t('settings.business.description')}</div>
        </div>
        <button
          type="button"
          className={clsx(css.switch, enabled && css.switchOn)}
          role="switch"
          aria-checked={enabled}
          aria-label={t('settings.business.visibility')}
          onClick={toggle}
        >
          <span className={css.knob} />
        </button>
      </div>
    </div>
  )
}
