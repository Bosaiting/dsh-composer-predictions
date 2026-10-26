import React from 'react'
import { createRoot } from 'react-dom/client'
let loaded, Overlay, SettingsRow
window.__ModuleLoader__ = { load(definition) { loaded = definition } }
new Function(clientSource)()
const cases = {
  short: '补充测试。', two: '先检查灰字的换行。\n再检查工具栏的位置。',
  screenshot: '用 `git diff` 确认 `client.js`、`package.json`、`README.md` 与撤销前完全一致，并重新跑一遍全部测试。',
  edge: '字'.repeat(51),
  long: '请把这次修改整理为一份可复现的验证记录，说明具体改动、操作步骤和预期结果。再检查短文本、长文本、中文输入、重新生成和接受建议后的恢复效果。请保留必要的截图，并确认输入框最多显示三行建议，超过三行的内容会被截断，下方工具栏仍然完整可见，原来的会话内容也没有改变。',
  emoji: ('👨‍👩‍👧‍👦🇨🇳e\u0301👍🏽').repeat(20),
}
const params = new URLSearchParams(location.search)
let visibility = params.get('visibility') || 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
let mode = params.get('mode') || 'layout'
let suggestion = cases[params.get('case')] || cases.long
let state = { draft: '', phase: 'plain', attachmentIds: [], running: false, sessionId: 'fixture', turn: 1, endSeq: 10 }
let turnEnds = new Map([[state.turn, state.endSeq]])
let settings = { status: 'ready', value: { enabled: true }, writable: true }
const listeners = new Set(), settingsListeners = new Set()
const requests = [], pending = []
let overlayEntries = []
const overlayListeners = new Set()
const headers = { get: name => name === 'x-bscp-timeout-ms' ? params.get('hostTimeout') || '8000' : null }
function update(patch) {
  const before = state
  state = { ...state, ...patch }
  if (before.turn !== state.turn || before.endSeq !== state.endSeq) turnEnds = new Map([[state.turn, state.endSeq]])
  listeners.forEach(fn => fn())
}
window.fetch = (url, options) => {
  const body = JSON.parse(options.body)
  const record = { ...body, aborted: false }
  requests.push(record)
  options.signal.addEventListener('abort', () => { record.aborted = true })
  if (mode === 'pending' || mode === 'timeout') {
    const body = new Promise((resolve, reject) => {
      pending.push(data => resolve(data))
      // Deliberately ignore cancellation in pending mode to check stale guards.
      if (mode === 'timeout') options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    return Promise.resolve({ ok: true, headers, json: () => body })
  }
  if (mode === 'no-turn') return Promise.resolve({ ok: true, json: async () => ({ ok: true, reason: 'no-turn' }) })
  if (mode === 'failure') return Promise.resolve({ ok: true, json: async () => ({ ok: true, reason: 'auth' }) })
  if (mode === 'untrusted-error') return Promise.resolve({ ok: true, json: async () => ({ ok: true, reason: 'SECRET_PROVIDER_DETAIL' }) })
  if (body.force) suggestion = suggestion === cases.short ? cases.long : cases.short
  return Promise.resolve({ ok: true, json: async () => ({ ok: true, text: suggestion, turnId: state.turn }) })
}
const api = loaded.factory(() => React)
api.apply({
  effect(fn) { fn() }, locale: { register() {} },
  configForms: { get() { return { getSnapshot: () => settings,
    subscribe(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn) } } } },
  slots: { inject(name, fn) { fn() },
    entriesOfSlot() { return overlayEntries },
    subscribe(name, fn) { overlayListeners.add(fn); return () => overlayListeners.delete(fn) },
    register(options, component) {
    if (options.name === 'conversation.input.overlay') Overlay = component
    if (options.name === 'settings.general.item') SettingsRow = component
  } },
})
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = selector => selector(React.useSyncExternalStore(subscribe, () => state))
const t = (key, data) => ({ hint: 'Tab 接受', regenerate: '重新生成', regenerating: '正在重新生成',
  recentStatus: data?.reason + (data?.timing || ''), retry: '重试预测',
})[key] || data?.text || key
const useChat = selector => selector({ legacy: { turnEnds } })
function Composer() {
  const s = useStore(s => s)
  React.useEffect(() => { window.fixture.ready = true }, [])
  return <div data-composer-card data-composer-variant="inline" className="yhfFVG_card">
    <div data-composer-overlay className="yhfFVG_overlayAnchor"><div style={{ display: 'contents' }}><Overlay
      sessionId={s.sessionId} useSession={useStore} useInput={useStore} useChat={useChat} t={t}
      inputActions={{ captureInsertion: () => ({}), insertText(text) { update({ draft: text }); return true } }}
    /></div></div>
    <div data-input-scroll className="yhfFVG_scroll"><div className="yhfFVG_grow">
      <div data-composer-input className="yhfFVG_input" contentEditable suppressContentEditableWarning role="textbox">{s.draft}</div>
      <div data-composer-placeholder className="yhfFVG_placeholder">发消息</div>
    </div></div>
    <div data-dsh-claude-part="row" className="yhfFVG_row">模型与权限</div>
  </div>
}
let toggle, unmount
function Shell() {
  const [open, setOpen] = React.useState(true)
  const [mounted, setMounted] = React.useState(true)
  toggle = () => setOpen(v => !v)
  unmount = () => setMounted(false)
  return <><button onClick={toggle}>切换侧边栏</button><div className="shell">
    <aside style={{ width: open ? 280 : 0 }}>侧边栏</aside><main>{mounted && <Composer />}</main>
    <div style={{ display: 'none' }} data-test-settings><SettingsRow t={t} /></div>
  </div></>
}
const counters = { rectangles: 0, textMeasurements: 0 }
const rect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function () { counters.rectangles++; return rect.call(this) }
const rangeRect = Range.prototype.getBoundingClientRect
Range.prototype.getBoundingClientRect = function () { counters.textMeasurements++; return rangeRect.call(this) }
function metrics() {
  const editor = document.querySelector('[data-composer-input]'), ghost = document.querySelector('.bscp-ghost'),
    text = document.querySelector('.bscp-ghost-text'), content = document.querySelector('.bscp-ghost-content'),
    actions = document.querySelector('.bscp-actions'), row = document.querySelector('.yhfFVG_row')
  if (!editor || !ghost) return null
  const er = editor.getBoundingClientRect(), gr = ghost.getBoundingClientRect(), tr = text.getBoundingClientRect(), ar = actions.getBoundingClientRect()
  const range = document.createRange(); range.selectNodeContents(content)
  const rects = Array.from(range.getClientRects())
  return {
    width: er.width, lines: tr.height / parseFloat(getComputedStyle(text).lineHeight),
    alignment: Math.abs(er.x - gr.x) + Math.abs(er.width - gr.width),
    right: gr.right - ar.right, bottom: tr.bottom - ar.bottom,
    overlaps: rects.filter(r => r.top < tr.bottom - .5 && r.bottom > ar.top && r.right + 7 > ar.left && r.left < ar.right).length,
    textOnButtonLine: rects.some(r => r.bottom > ar.top && r.top < ar.bottom),
    toolbarGap: row.getBoundingClientRect().top - Math.max(tr.bottom, ar.bottom),
    displayed: content.textContent, full: ghost.title,
    font: getComputedStyle(ghost).fontFamily, editorFont: getComputedStyle(editor).fontFamily,
  }
}
window.fixture = {
  ready: false, requests, pending, update, metrics, cases, counters,
  overlays(entries) { overlayEntries = entries; overlayListeners.forEach(fn => fn()) },
  toggle: () => toggle(), unmount: () => unmount(),
  enable(value) { settings = { ...settings, value: { enabled: value } }; settingsListeners.forEach(fn => fn()) },
  reviseSettings() { settings = { ...settings, revision: (settings.revision || 0) + 1 }; settingsListeners.forEach(fn => fn()) },
  setMode(value) { mode = value },
  setVisibility(value) { visibility = value; document.dispatchEvent(new Event('visibilitychange')) },
  stress() { counters.rectangles = 0; counters.textMeasurements = 0; for (let i = 0; i < 100; i++) document.dispatchEvent(new Event('scroll', { bubbles: true })) },
  async frames() {
    const result = [], started = performance.now()
    toggle()
    while (performance.now() - started < 350) {
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
      const m = metrics(); if (m) result.push(m)
    }
    return result
  },
}
createRoot(document.getElementById('app')).render(<Shell />)
