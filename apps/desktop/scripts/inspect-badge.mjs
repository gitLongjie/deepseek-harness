// Dev-only helper: connect to the running Electron's CDP endpoint and mount a
// preview badge button in the sidebar footer anchor so the styling can be
// reviewed without a real update feed. Not shipped.
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'

const expression = `(() => {
  const anchor = document.querySelector('[data-slot="sidebar.footer.action"]')
  if (anchor === null) return 'no anchor'
  const existing = document.getElementById('dsh-update-badge')
  if (existing !== null) { const r = existing.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height, vis:getComputedStyle(existing).visibility, opacity:getComputedStyle(existing).opacity, innerH: window.innerHeight}) }
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'dsh-update-badge'
  button.title = '1.2.3'
  button.textContent = '更新'
  anchor.appendChild(button)
  return 'mounted'
})()`

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    const target = JSON.parse(data).find((t) => t.type === 'page')
    if (target === undefined) throw new Error('no page target')
    const wsUrl = new URL(target.webSocketDebuggerUrl)
    const socket = net.connect(9222, '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64')
      socket.write(
        `GET ${wsUrl.pathname} HTTP/1.1\r\nHost: 127.0.0.1:9222\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    let upgraded = false
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!upgraded) {
        const index = buffer.indexOf('\r\n\r\n')
        if (index === -1) return
        upgraded = true
        buffer = buffer.slice(index + 4)
        const message = Buffer.from(
          JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }),
          'utf8',
        )
        const mask = crypto.randomBytes(4)
        const header = message.length < 126
          ? Buffer.from([0x81, 0x80 | message.length])
          : Buffer.from([0x81, 0x80 | 126, message.length >> 8, message.length & 0xff])
        const masked = Buffer.from(message.map((byte, i) => byte ^ mask[i % 4]))
        socket.write(Buffer.concat([header, mask, masked]))
        return
      }
      const text = buffer.toString('utf8')
      if (text.includes('"id":1')) {
        console.log(text)
        process.exit(0)
      }
    })
    socket.on('error', (error) => { console.error(error.message); process.exit(1) })
  })
})
