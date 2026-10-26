// Capture the actual client in a deterministic mocked fixture, never the
// user's desktop. No DSH profile, credentials or model transport is read.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const client = await fs.readFile(path.join(root, 'client.js'), 'utf8')
const fixture = (await fs.readFile(path.join(root, 'tests/browser-fixture.jsx'), 'utf8'))
  .replace("short: '补充测试。'", "short: '请补充边界情况的测试。'")
const html = await fs.readFile(path.join(root, 'tests/browser.html'))
const compiled = await build({ stdin: { contents: 'const clientSource = ' + JSON.stringify(client) + ';\n' + fixture,
  loader: 'jsx', resolveDir: root }, bundle: true, write: false, define: { 'process.env.NODE_ENV': '"development"' } })
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/bundle.js' ? compiled.outputFiles[0].contents : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
const frames = await fs.mkdtemp(path.join(os.tmpdir(), 'bscp-demo-'))
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 380 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port + '/?case=short')
  await page.waitForFunction(() => window.fixture?.ready)
  await page.locator('.bscp-ghost').waitFor()
  await page.addStyleTag({ content: `body{margin:36px 40px;background:#f6f7f9;font-family:Arial,sans-serif;color:#30333a}
    #app>button,.shell>aside,[data-test-settings]{display:none!important}
    .shell{display:block}main{display:block}main>[data-composer-card]{max-width:none}
    .public-heading{font-size:24px;font-weight:600;margin:0 0 8px}.public-caption{font-size:13px;color:#737985;margin:0 0 26px}
    .public-step{font-size:17px;font-weight:500;line-height:26px;margin:0 0 18px}.public-note{font-size:12px;color:#737985;margin:20px 0 0}
    [data-composer-card]{box-shadow:0 2px 18px #0000000a;border-color:#e2e5e9!important}
    [data-dsh-claude-part=row]{color:#737985;font-size:12px;padding-top:14px!important}` })
  await page.evaluate(() => {
    document.querySelector('#app').insertAdjacentHTML('beforebegin', '<h1 class="public-heading">Composer Predictions</h1><p class="public-caption">@bosaiting/dsh-composer-predictions · Tab 插入草稿 · Esc 忽略本轮</p><p class="public-step"></p>')
    document.querySelector('#app').insertAdjacentHTML('afterend', '<p class="public-note">模拟回复 / Mocked response · 实际插件组件 / Actual plugin component · 无模型请求 / No model calls</p>')
    document.querySelector('[data-dsh-claude-part=row]').textContent = '示例会话 · 消息由你决定何时发送'
  })
  const output = path.join(root, 'docs/images')
  await fs.mkdir(output, { recursive: true })
  let index = 0
  async function capture(label) {
    await page.locator('.public-step').evaluate((element, label) => { element.textContent = label }, label)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'demo overflows viewport')
    await page.screenshot({ path: path.join(frames, 'frame-' + String(index++).padStart(2, '0') + '.png') })
  }
  await capture('1 / 6 · 空白输入框显示建议 / A suggestion appears')
  await fs.copyFile(path.join(frames, 'frame-00.png'), path.join(output, 'preview.png'))
  await page.evaluate(() => fixture.update({ draft: '我想先自己写一条消息。' }))
  await page.locator('.bscp-ghost').waitFor({ state: 'detached' })
  await capture('2 / 6 · 输入文字，暂时隐藏 / Typing temporarily hides it')
  await page.evaluate(() => fixture.update({ draft: '' }))
  await page.locator('.bscp-ghost').waitFor()
  await capture('3 / 6 · 清空后恢复原建议 / Clearing restores the offer')
  await page.locator('[data-composer-input]').click()
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.querySelector('[data-composer-input]').textContent === '请补充边界情况的测试。')
  await page.locator('.bscp-ghost').waitFor({ state: 'detached' })
  await capture('4 / 6 · Tab 插入可编辑草稿，不发送 / Tab inserts a draft')
  await page.evaluate(() => fixture.update({ draft: '', turn: 2, endSeq: 20 }))
  await page.locator('.bscp-ghost').waitFor()
  await capture('5 / 6 · 新一轮可获得新建议 / The next turn has its own offer')
  await page.locator('[data-composer-input]').click()
  await page.keyboard.press('Escape')
  await page.locator('.bscp-ghost').waitFor({ state: 'detached' })
  await page.evaluate(() => fixture.reviseSettings())
  assert.equal(await page.locator('.bscp-ghost').count(), 0)
  assert.equal(await page.locator('[data-composer-input]').textContent(), '')
  await capture('6 / 6 · Esc 忽略本轮，不再恢复 / Esc dismisses this turn')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '0.5', '-i', path.join(frames, 'frame-%02d.png'),
    '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    '-loop', '0', path.join(output, 'demo.gif')], { stdio: 'pipe' })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('preview: still image and six-step GIF captured; hide/restore, Tab insertion and Esc dismissal verified; no personal data or model calls')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await fs.rm(frames, { recursive: true, force: true })
}
