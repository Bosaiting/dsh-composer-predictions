import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const source = await fs.readFile(process.env.DSHCP_TEST_CLIENT || path.join(here, 'client.js'), 'utf8')
const fixture = await fs.readFile(path.join(here, 'tests/browser-fixture.jsx'), 'utf8')
const html = await fs.readFile(path.join(here, 'tests/browser.html'))
const compiled = await build({ stdin: { contents: 'const clientSource = ' + JSON.stringify(source) + ';\n' + fixture,
  loader: 'jsx', resolveDir: here }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"development"' } })
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/bundle.js' ? compiled.outputFiles[0].contents : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const report = { states: [], transitionFrames: 0, performance: null, lifecycle: [] }
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  const base = 'http://127.0.0.1:' + server.address().port
  async function open(query = '') {
    await page.goto(base + '/?' + query)
    await page.waitForFunction(() => window.fixture?.ready)
  }
  async function painted() {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  async function visible() { await page.locator('.bscp-ghost').waitFor(); await painted() }
  function check(m, label, animated = false) {
    assert.ok(m, label + ': no overlay')
    assert.ok(m.lines >= .99 && m.lines <= 3.01, label + ': line cap ' + m.lines)
    assert.ok(m.alignment < (animated ? 1 : .1), label + ': alignment ' + m.alignment)
    assert.ok(Math.abs(m.right - 4) < .1, label + ': lower-right x')
    assert.ok(Math.abs(m.bottom) < .1, label + ': lower-right y')
    assert.equal(m.overlaps, 0, label + ': text overlaps controls')
    assert.ok(m.textOnButtonLine, label + ': button-only row')
    assert.ok(m.toolbarGap >= 0, label + ': toolbar overlap')
  }
  if (process.env.DSHCP_PERF_ONLY) {
    await page.setViewportSize({ width: 740, height: 800 })
    await open('case=long'); await visible()
    await page.evaluate(() => fixture.stress()); await painted()
    report.performance = await page.evaluate(() => ({ ...fixture.counters }))
    report.states.push(await page.evaluate(() => fixture.metrics()))
  } else {
  // Width + sidebar matrix, including both directions of the animated resize.
  for (const name of ['long', 'short', 'two', 'screenshot', 'edge']) {
    await open('case=' + name); await visible()
    for (const width of [1280, 900, 640, 1100, 1600]) {
      await page.setViewportSize({ width, height: 800 }); await painted()
      for (let i = 0; i < 2; i++) {
        const frames = await page.evaluate(() => fixture.frames())
        for (const frame of frames) check(frame, `${name}/${width}/animation`, true)
        report.transitionFrames += frames.length
        const m = await page.evaluate(() => fixture.metrics())
        check(m, name + '/' + width)
        if (name === 'short') assert.equal(m.lines, 1)
        if (name === 'two' && m.width >= 500) assert.equal(m.lines, 2)
        report.states.push({ name, width, lines: m.lines })
      }
    }
  }
  // Same dimensions, different font via a custom theme data attribute.
  await page.setViewportSize({ width: 900, height: 800 })
  await open('case=long'); await visible()
  await page.evaluate(() => document.body.setAttribute('data-test-font', 'mono'))
  await painted()
  let m = await page.evaluate(() => fixture.metrics())
  assert.equal(m.font, m.editorFont)
  check(m, 'font switch')
  // Explicit font-load completion invalidates cached glyph measurements.
  await page.evaluate(() => { fixture.counters.textMeasurements = 0; document.fonts.dispatchEvent(new Event('loadingdone')) })
  await painted()
  assert.ok(await page.evaluate(() => fixture.counters.textMeasurements > 0))
  // 100 synchronous scroll notifications must merge into one cheap placement,
  // and must never redo glyph fitting when dimensions/typography are unchanged.
  await page.evaluate(() => fixture.stress()); await painted()
  report.performance = await page.evaluate(() => ({ ...fixture.counters }))
  assert.equal(report.performance.textMeasurements, 0)
  assert.ok(report.performance.rectangles <= 12, JSON.stringify(report.performance))
  // Tab inserts the full suggestion even when its visual preview is ellipsized.
  await page.setViewportSize({ width: 640, height: 800 }); await painted()
  const full = await page.locator('.bscp-ghost').getAttribute('title')
  assert.ok((await page.locator('.bscp-ghost-content').textContent()).endsWith('…'))
  await page.getByRole('textbox').focus(); await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('textbox').textContent(), full)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  assert.equal(await page.locator('[data-composer-card]').getAttribute('data-bosaiting-cp-visible'), null)
  assert.equal(await page.locator('[data-composer-card]').evaluate(el => el.style.getPropertyValue('--bscp-editor-min-height')), '')
  // Regeneration shrinks/grows again without losing the exclusion geometry.
  await open('case=long'); await visible()
  await page.getByRole('button', { name: '重新生成', exact: true }).click(); await painted()
  m = await page.evaluate(() => fixture.metrics()); check(m, 'regenerated short'); assert.equal(m.lines, 1)
  await page.getByRole('button', { name: '重新生成', exact: true }).click(); await painted()
  m = await page.evaluate(() => fixture.metrics()); check(m, 'regenerated long'); assert.equal(m.lines, 3)
  // The visual cutoff must also stop at a grapheme boundary.
  await open('case=emoji'); await visible()
  m = await page.evaluate(() => fixture.metrics()); check(m, 'emoji')
  const prefix = m.displayed.replace(/…$/, '')
  const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(m.full), p => p.index))
  boundaries.add(m.full.length)
  assert.ok(boundaries.has(prefix.length), 'visual truncation split a grapheme')

  // Deterministic lifecycle/deadline tests use a virtual clock, no 25 s wait.
  await page.clock.install()
  // Temporary guards hide a completed offer; clearing them restores it without
  // any request. Explicit rejection is remembered across session switches.
  await open('case=short'); await page.clock.runFor(400); await visible()
  const original = await page.locator('.bscp-ghost').getAttribute('title')
  for (const [hidden, restored] of [
    [{ draft: 'typed' }, { draft: '' }],
    [{ attachmentIds: ['file'] }, { attachmentIds: [] }],
    [{ phase: 'command' }, { phase: 'plain' }],
  ]) {
    await page.evaluate(patch => fixture.update(patch), hidden); await page.clock.runFor(30)
    assert.equal(await page.locator('.bscp-ghost').count(), 0)
    await page.evaluate(patch => fixture.update(patch), restored); await page.clock.runFor(30)
    assert.equal(await page.locator('.bscp-ghost').getAttribute('title'), original)
  }
  assert.equal(await page.evaluate(() => fixture.requests.length), 1)
  await page.getByRole('textbox').focus(); await page.keyboard.press('Escape'); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  await page.evaluate(() => fixture.update({ sessionId: 'second' })); await page.clock.runFor(400)
  await visible()
  await page.evaluate(() => fixture.update({ sessionId: 'fixture' })); await page.clock.runFor(400)
  assert.equal(await page.locator('.bscp-ghost').count(), 0, 'Esc rejection resurrected')
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  // A new native turn releases the rejection and predicts normally.
  await page.evaluate(() => fixture.update({ running: true })); await page.clock.runFor(30)
  await page.evaluate(() => fixture.update({ running: false, turn: 2, endSeq: 20 })); await page.clock.runFor(450)
  await visible()
  assert.equal(await page.evaluate(() => fixture.requests.length), 3)
  report.lifecycle.push('hidden-vs-rejected')

  // Restoring a cached session takes no timer/network round trip. Reopening a
  // different native turn, or a changed settings revision, invalidates it.
  await open('case=short'); await page.clock.runFor(400); await visible()
  await page.evaluate(() => fixture.update({ sessionId: 'second' })); await page.clock.runFor(400); await visible()
  await page.evaluate(() => fixture.update({ sessionId: 'fixture' })); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').getAttribute('title'), original)
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  await page.evaluate(() => fixture.reviseSettings()); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  await page.clock.runFor(400); await visible()
  assert.equal(await page.evaluate(() => fixture.requests.length), 3)
  await page.evaluate(() => fixture.update({ turn: 2, endSeq: 20 })); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  await page.clock.runFor(400); await visible()
  await page.getByRole('textbox').focus(); await page.keyboard.press('Tab'); await page.clock.runFor(30)
  await page.evaluate(() => fixture.update({ draft: '' })); await page.clock.runFor(400)
  assert.equal(await page.locator('.bscp-ghost').count(), 0, 'accepted offer resurrected')
  assert.equal(await page.evaluate(() => fixture.requests.length), 4)
  report.lifecycle.push('front-cache-turn-settings-accept')

  // Disabling invalidates all session offers. Enabling schedules one request,
  // even for an abstention, rather than competing catch-up timers.
  await open('case=short'); await page.clock.runFor(400); await visible()
  await page.evaluate(() => fixture.enable(false)); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  await page.evaluate(() => fixture.enable(true)); await page.clock.runFor(700); await visible()
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  await open('mode=failure'); await page.clock.runFor(400)
  await page.evaluate(() => fixture.enable(false)); await page.clock.runFor(30)
  await page.evaluate(() => fixture.enable(true)); await page.clock.runFor(700)
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  report.lifecycle.push('enable-dedupe')

  // Counterpart yields to us. A higher-priority foreign ghost hides our offer
  // and disables retry; removing it restores the existing offer.
  await open('case=short'); await page.clock.runFor(400); await visible()
  await page.evaluate(() => {
    const node = document.createElement('div'); node.id = 'foreign-ghost'
    node.setAttribute('data-composer-ghost', 'dsh-composer-prediction'); document.body.append(node)
  }); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 1)
  await page.evaluate(() => document.getElementById('foreign-ghost').setAttribute('data-composer-ghost', 'another-plugin'))
  await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  assert.equal(await page.locator('.bscp-setting-status button').isDisabled(), true)
  await page.getByRole('textbox').focus(); await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('textbox').textContent(), '')
  await page.evaluate(() => document.getElementById('foreign-ghost').remove()); await page.clock.runFor(30)
  assert.equal(await page.locator('.bscp-ghost').count(), 1)
  assert.equal(await page.evaluate(() => fixture.requests.length), 1)
  report.lifecycle.push('coexistence')

  // Failed predictions have a friendly, content-free status and an explicit
  // retry path. Unrecognised provider text never reaches the Settings display.
  await open('mode=failure'); await page.clock.runFor(400)
  assert.match(await page.locator('.bscp-setting-status').textContent(), /reason.auth/)
  await page.evaluate(() => { fixture.setMode('layout'); document.querySelector('[data-test-settings] .bscp-setting-status button').click() })
  await page.clock.runFor(30); await visible()
  assert.equal(await page.evaluate(() => fixture.requests.length), 2)
  await open('mode=untrusted-error'); await page.clock.runFor(400)
  const diagnostic = await page.locator('.bscp-setting-status').textContent()
  assert.match(diagnostic, /reason.error/)
  assert.ok(!diagnostic.includes('SECRET_PROVIDER_DETAIL'))
  report.lifecycle.push('diagnostics-retry')

  for (const action of ['unmount', 'session', 'draft', 'disable', 'turn']) {
    await open('mode=no-turn')
    await page.clock.runFor(400)
    assert.equal(await page.evaluate(() => fixture.requests.length), 1)
    await page.evaluate(action => {
      if (action === 'unmount') fixture.unmount()
      if (action === 'session') fixture.update({ sessionId: 'new-session' })
      if (action === 'draft') fixture.update({ draft: 'typed' })
      if (action === 'disable') fixture.enable(false)
      if (action === 'turn') fixture.update({ running: true })
    }, action)
    await page.clock.runFor(50)
    if (action === 'draft') await page.evaluate(() => fixture.update({ draft: '' }))
    await page.clock.runFor(action === 'session' ? 950 : 1500)
    const requests = await page.evaluate(() => fixture.requests)
    assert.equal(requests.length, action === 'session' ? 2 : 1, action + ': delayed retry leaked')
    if (action === 'session') assert.equal(requests[1].sessionId, 'new-session')
    report.lifecycle.push(action)
  }
  // A response ignoring AbortSignal still cannot reappear after draft edits.
  await open('mode=pending'); await page.clock.runFor(400)
  await page.evaluate(() => fixture.update({ draft: 'typed' })); await page.clock.runFor(50)
  await page.evaluate(() => { fixture.update({ draft: '' }); fixture.pending[0]({ ok: true, text: 'Stale result', turnId: 1 }) })
  await page.clock.runFor(50)
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  // A 20 s Host budget leaves another 5 s for transport.
  await open('mode=timeout&hostTimeout=20000'); await page.clock.runFor(400)
  await page.clock.runFor(20000)
  assert.equal(await page.evaluate(() => fixture.requests[0].aborted), false)
  await page.clock.runFor(5000)
  assert.equal(await page.evaluate(() => fixture.requests[0].aborted), true)
  assert.deepEqual(errors, [], 'browser errors')
  }
  if (process.env.DSHCP_TEST_REPORT) await fs.writeFile(process.env.DSHCP_TEST_REPORT, JSON.stringify(report, null, 2))
  console.log((process.env.DSHCP_PERF_ONLY ? 'browser benchmark: ' : 'browser regression: ') + report.states.length + ' layouts, ' + report.transitionFrames + ' animation frames; scroll=' + JSON.stringify(report.performance) + '; lifecycle/font/Unicode/deadline/Tab: ok')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
