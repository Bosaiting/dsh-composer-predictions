import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'client.js'), 'utf8')

let loaded = null
const styleTags = []
function makeElement() {
  return { dataset: {}, textContent: '', remove() {} }
}
const document = {
  head: { appendChild: (el) => styleTags.push(el) },
  querySelector: () => null,
  createElement: () => makeElement(),
  fonts: { ready: Promise.resolve() },
  addEventListener() {},
  removeEventListener() {},
}
const window = {
  __ModuleLoader__: { load(def) { loaded = def } },
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({}),
}
const sandbox = {
  window, document,
  Element: class {},
  ResizeObserver: class {},
  fetch: async () => ({ ok: false }),
  console, setTimeout, clearTimeout, AbortController,
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })
assert.ok(loaded !== null)
assert.equal(loaded.id, 'dsh-composer-predictions')

const registrations = []
const effects = []
const configForms = {
  get(namespace) {
    assert.equal(namespace, 'dsh-composer-predictions')
    return {
      getSnapshot: () => ({ status: 'ready', value: { enabled: true }, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }
  },
}
const ctx = {
  effect(fn) { effects.push(fn); return fn() },
  locale: { register(ns, dicts) { assert.equal(ns, 'composerPredictions'); assert.ok(dicts.zh && dicts.en) } },
  configForms,
  slots: {
    inject(name, cb) { cb() },
    register(options, component) { registrations.push({ options, component }) },
  },
}
const exports = loaded.factory((name) => {
  assert.equal(name, 'react')
  return {}
})
assert.equal(typeof exports.apply, 'function')
assert.deepEqual(Array.from(exports.inject), ['slots', 'locale', 'configForms'])
exports.apply(ctx)
assert.equal(registrations.length, 2)
assert.deepEqual(registrations.map((r) => r.options.name), [
  'conversation.input.overlay',
  'settings.general.item',
])
assert.equal(registrations[0].options.id, 'dsh-composer-predictions')
assert.equal(registrations[1].options.id, 'dsh-composer-predictions-setting')
assert.ok(styleTags.length === 1)
assert.ok(styleTags[0].dataset.pluginCss.includes('dsh-composer-predictions'))

// The pure Tab guard must fail closed: disabled, running, composing, typing,
// attachments and a missing prediction all reject.
const { canAccept, isBlankDraft, isFeatureEnabled } = exports.__test
const { closedTurnStamp, rememberOffer, readOffer, findConflict } = exports.__test
assert.equal(closedTurnStamp({ legacy: { turnEnds: new Map([[1, 10], [2, 20]]) } }), '2:20')
assert.equal(closedTurnStamp({}), '')
let turnIterations = 0
const stableEnds = { entries() { turnIterations++; return new Map([[1, 10], [2, 20]]).entries() } }
for (let i = 0; i < 100; i++) assert.equal(closedTurnStamp({ legacy: { turnEnds: stableEnds } }), '2:20')
assert.equal(turnIterations, 1, 'streaming snapshots sharing a turnEnds map must not rescan it')
assert.equal(closedTurnStamp({ legacy: { turnEnds: new Map([[3, 30]]) } }), '3:30')
rememberOffer('cache-probe', '1:10', 'config-a', { text: 'Next' }, 'offered')
assert.equal(readOffer('cache-probe', '1:10', 'config-a').prediction.text, 'Next')
assert.equal(readOffer('cache-probe', '2:20', 'config-a'), null)
rememberOffer('cache-probe', '1:10', 'config-a', null, 'dismissed')
assert.equal(readOffer('cache-probe', '1:10', 'config-a').disposition, 'dismissed')
assert.equal(readOffer('cache-probe', '1:10', 'config-b'), null)
rememberOffer('unknown-turn', '', 'config-a', { text: 'Unsafe cache' }, 'offered')
assert.equal(readOffer('unknown-turn', '', 'config-a'), null)
const RealDate = vm.runInContext('Date', sandbox)
let now = RealDate.now()
sandbox.Date = { now: () => now }
rememberOffer('expiry', '1:10', 'a', { text: 'Old offer' }, 'offered')
rememberOffer('refusal', '1:10', 'a', null, 'dismissed')
now += 600001
assert.equal(readOffer('expiry', '1:10', 'a'), null)
assert.equal(readOffer('refusal', '1:10', 'a').disposition, 'dismissed')
sandbox.Date = RealDate
for (let i = 0; i < 41; i++) rememberOffer('bounded-' + i, '1:10', 'a', null, 'accepted')
assert.equal(readOffer('bounded-0', '1:10', 'a'), null)
assert.equal(readOffer('bounded-40', '1:10', 'a').disposition, 'accepted')
assert.equal(findConflict([{ options: { id: 'dsh-composer-predictions' } }, { options: { id: 'composer-predict-ghost' } }], [], []), '')
assert.equal(findConflict([{ options: { id: 'slash-menu' } }], [], []), '')
assert.equal(findConflict([{ options: { id: 'another-ghost' } }], [], []), 'another-ghost')
assert.equal(findConflict([], [], ['dsh-next-hint']), 'dsh-next-hint')
const marker = (name, priority) => ({ getAttribute: key => key === 'data-composer-ghost' ? name : priority })
assert.equal(findConflict([], [marker('dsh-composer-prediction', '999')], []), '')
assert.equal(findConflict([], [marker('another-plugin', '200')], []), 'another-plugin')
assert.equal(findConflict([], [marker('another-plugin', '50')], []), '')
for (const id of ['completion-help-dialog', 'hint-tooltip', 'suggestion-menu', 'predict-settings']) {
  assert.equal(findConflict([{ options: { id }, registrant: 'input-completion' }], [], []), '')
}
assert.equal(findConflict([{ options: { id: 'peer-ghost' }, registrant: 'peer-package' }], [marker('peer-package', '50')], []), '')
assert.equal(findConflict([{ options: { id: 'peer-ghost' }, registrant: 'peer-package' }], [marker('peer-package', '200')], []), 'peer-package')
assert.equal(findConflict([], [marker('another-plugin', 'not-a-number')], []), 'another-plugin')
assert.equal(findConflict([], [marker('another-plugin', 'Infinity')], []), 'another-plugin')
for (const [budget, expected] of [[8000, 13000], [60000, 65000], [1000, 6000], [null, 65000], ['invalid', 65000], [-1, 65000], [900000, 65000]]) {
  assert.equal(exports.__test.clientDeadlineMs(budget), expected)
}
assert.equal(isFeatureEnabled({ status: 'loading', value: undefined }), false)
assert.equal(isFeatureEnabled({ status: 'unavailable', value: undefined }), false)
assert.equal(isFeatureEnabled({ status: 'ready', value: { enabled: false } }), false)
assert.equal(isFeatureEnabled({ status: 'ready', value: { enabled: true } }), true)
const prediction = { text: 'Add tests' }
assert.equal(canAccept(prediction, '', 'plain', 0, false, true, false), true)
assert.equal(canAccept(prediction, '\u200b', 'plain', 0, false, true, false), true)
assert.equal(canAccept(prediction, 'typed', 'plain', 0, false, true, false), false)
assert.equal(canAccept(prediction, '', 'plain', 1, false, true, false), false)
assert.equal(canAccept(prediction, '', 'plain', 0, true, true, false), false)
assert.equal(canAccept(prediction, '', 'plain', 0, false, false, false), false)
assert.equal(canAccept(prediction, '', 'plain', 0, false, true, true), false)
assert.equal(canAccept(null, '', 'plain', 0, false, true, false), false)
assert.equal(canAccept({ text: '' }, '', 'plain', 0, false, true, false), false)
assert.equal(isBlankDraft('\u200b'), true)
// Exercise both Segmenter and older-engine fallback in the actual bundle.
for (const segmenter of [Intl.Segmenter, undefined]) {
  sandbox.Intl = { Segmenter: segmenter }
  for (const cluster of ['😀', '🇨🇳', '👨‍👩‍👧‍👦', 'e\u0301', '👍🏽']) {
    assert.deepEqual(Array.from(exports.__test.splitGraphemes('A' + cluster + 'B')), ['A', cluster, 'B'])
  }
}
console.log('client bundle: ok')
