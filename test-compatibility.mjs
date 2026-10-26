import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.dirname(fileURLToPath(import.meta.url))
const client = await fs.readFile(process.env.DSHCP_TEST_CLIENT || path.join(root, 'client.js'), 'utf8')
const fixture = await fs.readFile(path.join(root, 'tests/browser-fixture.jsx'), 'utf8')
const html = await fs.readFile(path.join(root, 'tests/browser.html'))
const compiled = await build({ stdin: { contents: 'const clientSource = ' + JSON.stringify(client) + ';\n' + fixture,
  loader: 'jsx', resolveDir: root }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"development"' } })
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/bundle.js' ? compiled.outputFiles[0].contents : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const report = {}
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
  async function open(query = '') {
    await page.goto('http://127.0.0.1:' + server.address().port + '/?case=short&' + query)
    await page.waitForFunction(() => window.fixture?.ready)
  }
  async function key() {
    const prevented = await page.evaluate(() => {
      const editor = document.querySelector('[data-composer-input]')
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      editor.dispatchEvent(event)
      return event.defaultPrevented
    })
    return { prevented, draft: await page.getByRole('textbox').textContent() }
  }
  // The DOM marker must protect the very same task, before React or an observer runs.
  await open(); await page.clock.runFor(400)
  report.nativeMarker = await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    editor.setAttribute('data-composer-composing', '')
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    editor.dispatchEvent(event)
    return { prevented: event.defaultPrevented, draft: editor.textContent }
  })
  // React can finish composition before DSH's native 10 ms handoff is safe.
  await open(); await page.clock.runFor(400)
  await page.evaluate(() => document.querySelector('[data-composer-input]').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await page.clock.runFor(30)
  await page.evaluate(() => document.querySelector('[data-composer-input]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await page.clock.runFor(0)
  report.handoff = await key()
  await page.clock.runFor(11)
  report.afterHandoff = await key()
  // An IME overlapping initial catch-up must recover when it clears.
  await open(); await page.clock.runFor(50)
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    editor.setAttribute('data-composer-composing', '')
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  })
  await page.clock.runFor(500)
  const during = await page.evaluate(() => fixture.requests.length)
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    editor.removeAttribute('data-composer-composing')
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await page.clock.runFor(500)
  report.initialCatchUp = { during, after: await page.evaluate(() => fixture.requests.length) }
  await page.clock.runFor(1500)
  report.initialCatchUp.stable = await page.evaluate(() => fixture.requests.length)
  // A failure consumes the attempt; composition cannot turn it into a retry loop.
  await open('mode=failure'); await page.clock.runFor(400)
  await page.evaluate(() => document.querySelector('[data-composer-input]').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await page.clock.runFor(30)
  await page.evaluate(() => document.querySelector('[data-composer-input]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await page.clock.runFor(1000)
  report.failedRequestCount = await page.evaluate(() => fixture.requests.length)
  // An unrelated editor's composition and Tab cannot consume this offer.
  await open(); await page.clock.runFor(400)
  report.otherEditor = await page.evaluate(() => {
    const card = document.createElement('div'); card.setAttribute('data-composer-card', '')
    const editor = document.createElement('div'); editor.setAttribute('data-composer-input', '')
    card.append(editor); document.body.append(card)
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    editor.dispatchEvent(event)
    return event.defaultPrevented
  })
  await page.clock.runFor(30)
  report.ownOfferDuringOtherIME = await page.locator('.bscp-ghost').count()
  // Completion/help UI is not evidence that another plugin paints a ghost.
  await open(); await page.clock.runFor(400)
  await page.evaluate(() => fixture.overlays([{ options: { id: 'completion-help-dialog' }, registrant: 'completion-help' }]))
  await page.clock.runFor(30)
  report.unrelatedOverlay = await page.locator('.bscp-ghost').count()
  // Explicit low priority wins over the same owner's ghost-like slot name.
  await open(); await page.clock.runFor(400)
  await page.evaluate(() => {
    const node = document.createElement('div'); node.setAttribute('data-composer-ghost', 'peer-package')
    node.setAttribute('data-composer-ghost-priority', '50'); document.body.append(node)
    fixture.overlays([{ options: { id: 'peer-ghost' }, registrant: 'peer-package' }])
  })
  await page.clock.runFor(30)
  report.explicitLowPriority = await page.locator('.bscp-ghost').count()
  await page.evaluate(() => document.querySelector('[data-composer-ghost="peer-package"]').setAttribute('data-composer-ghost-priority', '200'))
  await page.clock.runFor(30)
  report.explicitHighPriority = await page.locator('.bscp-ghost').count()
  await open('mode=pending'); await page.clock.runFor(400)
  await page.evaluate(() => {
    const node = document.createElement('div'); node.setAttribute('data-composer-ghost', 'peer-package')
    node.setAttribute('data-composer-ghost-priority', '50'); document.body.append(node)
    fixture.overlays([{ options: { id: 'peer-ghost' }, registrant: 'peer-package' }])
  })
  await page.clock.runFor(30)
  report.lowPriorityDidNotAbort = !(await page.evaluate(() => fixture.requests[0].aborted))
  // Both ends use the Host budget plus 5 s transport allowance, including 60 s.
  await open('mode=timeout&hostTimeout=60000'); await page.clock.runFor(400)
  await page.clock.runFor(30000)
  report.longRequestAbortedEarly = await page.evaluate(() => fixture.requests[0].aborted)
  await page.clock.runFor(34000)
  report.longRequestBeforeDeadline = await page.evaluate(() => fixture.requests[0].aborted)
  await page.clock.runFor(1100)
  report.longRequestAtDeadline = await page.evaluate(() => fixture.requests[0].aborted)
  await open('mode=timeout&hostTimeout=1000'); await page.clock.runFor(400)
  await page.clock.runFor(5500)
  report.shortRequestBeforeDeadline = await page.evaluate(() => fixture.requests[0].aborted)
  await page.clock.runFor(600)
  report.shortRequestAtDeadline = await page.evaluate(() => fixture.requests[0].aborted)
  if (process.env.DSHCP_COMPATIBILITY_REPORT) await fs.writeFile(process.env.DSHCP_COMPATIBILITY_REPORT, JSON.stringify(report, null, 2))
  console.log('compatibility regressions: ' + JSON.stringify(report))
  assert.deepEqual(errors, [])
  assert.deepEqual(report.nativeMarker, { prevented: false, draft: '' })
  assert.deepEqual(report.handoff, { prevented: false, draft: '' })
  assert.equal(report.afterHandoff.prevented, true)
  assert.equal(report.afterHandoff.draft, '补充测试。')
  assert.deepEqual(report.initialCatchUp, { during: 0, after: 1, stable: 1 })
  assert.equal(report.failedRequestCount, 1)
  assert.equal(report.otherEditor, false)
  assert.equal(report.ownOfferDuringOtherIME, 1)
  assert.equal(report.unrelatedOverlay, 1)
  assert.equal(report.explicitLowPriority, 1)
  assert.equal(report.explicitHighPriority, 0)
  assert.equal(report.lowPriorityDidNotAbort, true)
  assert.equal(report.longRequestAbortedEarly, false)
  assert.equal(report.longRequestBeforeDeadline, false)
  assert.equal(report.longRequestAtDeadline, true)
  assert.equal(report.shortRequestBeforeDeadline, false)
  assert.equal(report.shortRequestAtDeadline, true)
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
