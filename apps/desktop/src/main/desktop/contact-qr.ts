/**
 * Contact QR popup for the desktop Help menu: renders the bundled contact
 * image in a small modal window over the app. The image lives at
 * build/contact-qr.png in both layouts — the source checkout carries it, and
 * electron-builder's `build/**` glob packs it into app.asar — so a deployment
 * swaps that file to change the QR without touching code or configuration.
 * @module @deepseek-ai/dsh-desktop/desktop/contact-qr
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, dialog } from 'electron'
import type { DesktopTextKey } from './locales.ts'

/** Bundle-relative path of the contact QR image in both layouts. */
const CONTACT_QR_PATH = fileURLToPath(new URL('../../../build/contact-qr.png', import.meta.url))

/**
 * Modal geometry: a 320px QR (the bundled 640px image halved, so modules stay
 * crisp) with room for the hint and the close button.
 */
const CONTACT_QR_WINDOW = { width: 380, height: 480 } as const

/** Locale lookup for the popup's copy. */
export type ContactQrTranslate = (key: DesktopTextKey) => string

/**
 * Show the contact QR as a modal window over `parent`.
 * @param parent - the window the popup centers over; undefined opens it standalone.
 * @param t - locale-bound copy resolver for the popup text.
 */
export async function showContactQr(parent: BrowserWindow | undefined, t: ContactQrTranslate): Promise<void> {
  let png: Buffer
  try {
    png = await readFile(CONTACT_QR_PATH)
  } catch {
    // A missing bundle asset is the one expected read failure; name it rather
    // than opening an empty window.
    await reportUnavailable(t('contact.title'), t('contact.missing'))
    return
  }

  const popup = new BrowserWindow({
    width: CONTACT_QR_WINDOW.width,
    height: CONTACT_QR_WINDOW.height,
    ...(parent === undefined ? {} : { parent }),
    modal: parent !== undefined,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#ffffff',
    title: t('contact.title'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Escape closes the popup from the main process so the page stays a static
  // document with no privileged bridge.
  popup.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') popup.close()
  })
  try {
    const document = contactQrDocument(png.toString('base64'), t('contact.hint'), t('contact.close'))
    await popup.loadURL(`data:text/html;base64,${Buffer.from(document).toString('base64')}`)
    popup.show()
  } catch {
    popup.destroy()
    await reportUnavailable(t('contact.title'), t('contact.failed'))
  }
}

/** Report a popup failure through the native dialog the shell already owns. */
async function reportUnavailable(title: string, message: string): Promise<void> {
  await dialog.showMessageBox({ type: 'error', title, message })
}

/**
 * Build the popup document: the QR image inlined as a data URL, the scan hint,
 * and a close button. Values are escaped so localized copy cannot inject markup.
 * @param imageBase64 - the QR PNG bytes, base64 encoded.
 * @param hint - localized scan instruction.
 * @param closeLabel - localized close-button label.
 * @returns a self-contained HTML document.
 */
export function contactQrDocument(imageBase64: string, hint: string, closeLabel: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px;
    box-sizing: border-box;
    background: #ffffff;
    color: #0f1115;
    font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    user-select: none;
  }
  img { width: 320px; height: 320px; image-rendering: pixelated; }
  p { margin: 0; font-size: 14px; }
  button {
    padding: 6px 22px;
    border: 1px solid rgba(0, 0, 0, 0.16);
    border-radius: 6px;
    background: #f5f6f8;
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover { background: #e9ebef; }
</style>
</head>
<body>
<img src="data:image/png;base64,${imageBase64}" alt="${escapeHtml(hint)}">
<p>${escapeHtml(hint)}</p>
<button type="button" id="dsh-contact-close">${escapeHtml(closeLabel)}</button>
<script>
  document.getElementById('dsh-contact-close').addEventListener('click', () => window.close())
</script>
</body>
</html>`
}

/** Escape the five HTML-significant characters. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
