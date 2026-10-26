// Capture the actual client in a deterministic mocked fixture, never the
// user's desktop. No DSH profile, credentials or model transport is read.
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const client = await fs.readFile(path.join(root, 'client.js'), 'utf8')
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
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 260 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port + '/?case=short')
  await page.waitForFunction(() => window.fixture?.ready)
  await page.locator('.bscp-ghost').waitFor()
  await page.addStyleTag({ content: `body{margin:40px;background:#f6f7f9;font-family:Arial,sans-serif;color:#30333a}
    #app>button,.shell>aside,[data-test-settings]{display:none!important}
    .shell{display:block}main{display:block}main>[data-composer-card]{max-width:none}
    .public-heading{font-size:23px;font-weight:600;margin:0 0 10px}.public-caption{font-size:13px;color:#737985;margin:0 0 30px}
    [data-composer-card]{box-shadow:0 2px 18px #0000000a;border-color:#e2e5e9!important}
    [data-dsh-claude-part=row]{color:#737985;font-size:12px;padding-top:14px!important}` })
  await page.evaluate(() => {
    document.querySelector('#app').insertAdjacentHTML('beforebegin', '<h1 class="public-heading">dsh-composer-predictions</h1><p class="public-caption">Isolated browser fixture · Mocked response · Tab inserts a draft · Esc dismisses</p>')
    document.querySelector('[data-dsh-claude-part=row]').textContent = 'Synthetic session · No model request'
  })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const output = path.join(root, 'docs/images')
  await fs.mkdir(output, { recursive: true })
  await page.screenshot({ path: path.join(output, 'preview.png'), fullPage: true })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('preview: mocked browser fixture captured without personal data')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
