import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = path.dirname(fileURLToPath(import.meta.url))
let source = await fs.readFile(path.join(root, 'client.js'), 'utf8')
source = source.replace('function refresh() {', 'function refresh() { window.perfCounters.conflictScans++;')
  .replace('function onMutations(records) {', 'function onMutations(records) { window.perfCounters.mutationCallbacks++;')
  .replace('function place() {', 'function place() { window.perfCounters.placements++;')
  .replace('resizeFrame = window.requestAnimationFrame(function',
    'window.perfCounters.resizePlacements++; resizeFrame = window.requestAnimationFrame(function')
  .replace('for (var entry of ends.entries()) {', 'for (var entry of ends.entries()) { window.perfCounters.turnIterations++;')
let fixture = await fs.readFile(path.join(root, 'tests/browser-fixture.jsx'), 'utf8')
fixture = fixture.replace("import React from 'react'", `import React from 'react'
window.perfCounters = { conflictScans: 0, mutationCallbacks: 0, fullDocumentQueries: 0, placements: 0, resizePlacements: 0, turnIterations: 0 }
const originalQuery = Document.prototype.querySelectorAll
Document.prototype.querySelectorAll = function(selector) {
  if (selector.includes('data-composer-ghost')) window.perfCounters.fullDocumentQueries++
  return originalQuery.call(this, selector)
}
window.resizeCallbacks = []
const OriginalResizeObserver = window.ResizeObserver
window.ResizeObserver = class extends OriginalResizeObserver {
  constructor(callback) { super(callback); window.resizeCallbacks.push(() => callback([], this)) }
}`)
const compiled = await build({ stdin: { contents: 'const clientSource = ' + JSON.stringify(source) + ';\n' + fixture,
  loader: 'jsx', resolveDir: root }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"development"' } })
const html = await fs.readFile(path.join(root, 'tests/browser.html'))
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/bundle.js' ? compiled.outputFiles[0].contents : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const report = {}
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  async function open(query = '') {
    await page.goto('http://127.0.0.1:' + server.address().port + '/?' + query)
    await page.waitForFunction(() => window.fixture?.ready)
  }
  async function reset() {
    await page.evaluate(() => { for (const key of Object.keys(perfCounters)) perfCounters[key] = 0 })
  }
  async function unrelatedChanges() {
    await page.evaluate(() => { document.getElementById('unrelated')?.remove(); const box = document.createElement('div'); box.id = 'unrelated'; document.body.append(box) })
    for (let i = 0; i < 100; i++) {
      await page.evaluate(i => { const row = document.createElement('span'); row.textContent = 'process row ' + i; document.getElementById('unrelated').append(row) }, i)
      await page.clock.runFor(5)
    }
  }
  await open('case=short'); await page.clock.runFor(450)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  await page.evaluate(() => fixture.enable(false)); await page.clock.runFor(50); await reset()
  await unrelatedChanges()
  report.disabled = await page.evaluate(() => ({ ...perfCounters }))
  assert.equal(report.disabled.conflictScans, 0)
  assert.equal(report.disabled.mutationCallbacks, 0)
  assert.equal(report.disabled.fullDocumentQueries, 0)
  await page.evaluate(() => fixture.enable(true)); await page.clock.runFor(450)
  await page.locator('.dshcp-ghost').waitFor(); await page.clock.runFor(50); await reset()
  await unrelatedChanges()
  report.enabledUnrelated = await page.evaluate(() => ({ ...perfCounters }))
  assert.equal(report.enabledUnrelated.conflictScans, 0)
  assert.equal(report.enabledUnrelated.fullDocumentQueries, 0)
  // Relevant additions, attribute changes and removal still invalidate conflicts.
  await page.evaluate(() => { const node = document.createElement('div'); node.id = 'peer'; node.setAttribute('data-composer-ghost', 'another-plugin'); document.body.append(node) })
  await page.clock.runFor(30)
  assert.equal(await page.locator('.dshcp-ghost').count(), 0)
  await page.evaluate(() => document.getElementById('peer').setAttribute('data-composer-ghost-priority', '50'))
  await page.clock.runFor(30)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  await page.evaluate(() => document.getElementById('peer').setAttribute('data-composer-ghost-priority', '200'))
  await page.clock.runFor(30)
  assert.equal(await page.locator('.dshcp-ghost').count(), 0)
  await page.evaluate(() => document.getElementById('peer').remove()); await page.clock.runFor(30)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  // Signals introduced on an already-connected element are observed as well.
  await page.evaluate(() => document.getElementById('unrelated').setAttribute('data-next-hint-anchor', ''))
  await page.clock.runFor(30)
  assert.equal(await page.locator('.dshcp-ghost').count(), 0)
  await page.evaluate(() => document.getElementById('unrelated').removeAttribute('data-next-hint-anchor'))
  await page.clock.runFor(50)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  report.incrementalConflicts = 'add / priority / remove / existing-node attributes passed'
  // Both ResizeObservers share the same requestAnimationFrame placement slot.
  await reset()
  report.resizeBurst = await page.evaluate(() => {
    for (let i = 0; i < 100; i++) for (const fire of resizeCallbacks) fire()
    return { ...perfCounters }
  })
  assert.ok(report.resizeBurst.resizePlacements <= 1, 'resize burst performed duplicate resize placements in one frame')
  await page.clock.runFor(50)
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    editor.style.width = '300px'
    resizeCallbacks.forEach(fire => fire())
    editor.style.width = '350px'
    resizeCallbacks.forEach(fire => fire())
  })
  await page.clock.runFor(80)
  assert.ok(await page.evaluate(() => fixture.metrics().alignment < .1), 'later geometry was dropped by the frame latch')
  await page.evaluate(() => { document.querySelector('[data-composer-input]').style.width = '' }); await page.clock.runFor(50)
  // Re-rendering on draft changes must not rescan the unchanged native map.
  await reset()
  for (let i = 0; i < 100; i++) await page.evaluate(i => fixture.update({ draft: 'typing ' + i }), i)
  report.stableTurnMap = await page.evaluate(() => ({ ...perfCounters }))
  assert.equal(report.stableTurnMap.turnIterations, 0)
  await page.evaluate(() => fixture.update({ draft: '', endSeq: 11 })); await page.clock.runFor(450)
  assert.equal(await page.evaluate(() => perfCounters.turnIterations), 1)
  // Start hidden, complete multiple turns, then request only the newest turn.
  await open('case=short&visibility=hidden'); await page.clock.runFor(1500)
  assert.equal(await page.evaluate(() => fixture.requests.length), 0)
  await page.evaluate(() => fixture.update({ running: true })); await page.clock.runFor(50)
  await page.evaluate(() => fixture.update({ running: false, turn: 2, endSeq: 20 })); await page.clock.runFor(500)
  assert.equal(await page.evaluate(() => fixture.requests.length), 0)
  await page.evaluate(() => fixture.setVisibility('visible')); await page.clock.runFor(450)
  assert.equal(await page.evaluate(() => fixture.requests.length), 1)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  // A completed offer resumes without asking again.
  await page.evaluate(() => fixture.setVisibility('hidden')); await page.clock.runFor(500)
  assert.equal(await page.locator('.dshcp-ghost').count(), 0)
  await page.evaluate(() => fixture.setVisibility('visible')); await page.clock.runFor(450)
  assert.equal(await page.evaluate(() => fixture.requests.length), 1)
  assert.equal(await page.locator('.dshcp-ghost').count(), 1)
  report.visibility = 'hidden startup / newest-turn catch-up / cached resume passed'
  // Abort on hide; an adapter ignoring abort must not resurrect its old result.
  await open('mode=pending'); await page.clock.runFor(400)
  await page.evaluate(() => fixture.setVisibility('hidden')); await page.clock.runFor(30)
  assert.equal(await page.evaluate(() => fixture.requests[0].aborted), true)
  await page.evaluate(() => fixture.update({ turn: 2, endSeq: 20 })); await page.clock.runFor(500)
  assert.equal(await page.evaluate(() => fixture.requests.length), 1)
  await page.evaluate(() => fixture.setVisibility('visible')); await page.clock.runFor(450)
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  await page.evaluate(() => {
    fixture.pending[0]({ ok: true, text: 'Old hidden result', turnId: 1 })
    fixture.pending[1]({ ok: true, text: 'Current foreground result', turnId: 2 })
  }); await page.clock.runFor(50)
  assert.equal(await page.locator('.dshcp-ghost').getAttribute('title'), 'Current foreground result')
  report.hiddenAbort = 'cancellation and stale-result rejection passed'
  assert.deepEqual(errors, [])
  if (process.env.DSHCP_PERFORMANCE_REPORT) await fs.writeFile(process.env.DSHCP_PERFORMANCE_REPORT, JSON.stringify(report, null, 2))
  console.log('performance/visibility regressions: ' + JSON.stringify(report))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
