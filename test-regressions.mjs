import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply, generate, optionsOf, clampSuggestion, splitGraphemes, PREDICTION_SYSTEM } from './host.js'

function fakeSession() {
  return {
    id: 's1',
    snapshotEvents: () => [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'hi' }] },
    ],
  }
}

function fakeCtx(streamFactory) {
  let route = null
  const turnListeners = []
  const disposers = []
  const ctx = {
    sessions: { get: (id) => (id === 's1' ? fakeSession() : undefined) },
    llm: { stream: streamFactory },
    on: (name, listener) => {
      if (name === 'session/event') turnListeners.push(listener)
      return () => {}
    },
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    get: () => undefined,
    inject: (names, cb) => {
      if (names.includes('webServer')) {
        cb({
          effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
          webServer: { register: (value) => { route = value; return () => {} } },
        })
      }
    },
    logger: { info: () => {}, warn: () => {} },
  }
  return {
    ctx,
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
    route: () => route,
    turnStart: () => {
      const session = fakeSession()
      for (const listener of turnListeners) listener(session, { type: 'turn/start' })
    },
  }
}

function fakeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function fakeRes() {
  const out = { status: 0, body: '' }
  let done
  const wait = new Promise((resolve) => { done = resolve })
  return {
    out, wait,
    res: {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead(status) { out.status = status; this.headersSent = true },
      on() {},
      off() {},
      end(body) {
        out.body += body?.toString?.() ?? ''
        this.writableEnded = true
        done()
      },
    },
  }
}

async function call(handle, body = { sessionId: 's1' }) {
  const { res, out, wait } = fakeRes()
  handle.handler(fakeReq(body), res)
  await wait
  return JSON.parse(out.body)
}

async function* textStream(text) {
  yield { type: 'text-delta', text }
  yield { type: 'finish', reason: { kind: 'stop' } }
}


function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return
    await new Promise(r => setTimeout(r, 5))
  }
  assert.fail('stream did not start')
}
function start(route, body = { sessionId: 's1' }) {
  const f = fakeRes(), events = new Map()
  f.res.on = (name, fn) => events.set(name, fn)
  f.res.off = name => events.delete(name)
  route.handler(fakeReq(body), f.res)
  return { answer: f.wait.then(() => JSON.parse(f.out.body)),
    disconnect() { f.res.destroyed = true; events.get('close')?.() } }
}
function gatedStream(gate, signal, text, onAbort = () => {}) {
  return (async function* () {
    const abort = () => { onAbort(); gate.resolve() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await gate.promise
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      yield* textStream(JSON.stringify({ suggestion: text }))
    } finally { signal.removeEventListener('abort', abort) }
  })()
}

// A first OR later subscriber can disconnect independently. The final
// disconnect cancels the stream, and an immediate retry starts fresh work.
for (const disconnected of [0, 1]) {
  const gate = deferred()
  let calls = 0, aborted = 0
  const fake = fakeCtx(req => { calls++; return gatedStream(gate, req.signal, 'Shared result', () => aborted++) })
  apply(fake.ctx, { enabled: true })
  const clients = [start(fake.route()), start(fake.route())]
  await until(() => calls === 1)
  // Let both route readers subscribe before disconnecting either.
  await new Promise(r => setImmediate(r))
  clients[disconnected].disconnect()
  assert.equal(aborted, 0)
  gate.resolve()
  assert.equal((await clients[1 - disconnected].answer).text, 'Shared result')
  assert.equal(calls, 1)
  assert.equal(aborted, 0)
  fake.dispose()
}
{
  const gates = [deferred(), deferred()]
  let calls = 0, aborted = 0
  const fake = fakeCtx(req => { const id = calls++; return gatedStream(gates[id], req.signal, 'Retry result', () => aborted++) })
  apply(fake.ctx, { enabled: true })
  const clients = [start(fake.route()), start(fake.route())]
  await until(() => calls === 1)
  await new Promise(r => setImmediate(r))
  clients.forEach(c => c.disconnect())
  await until(() => aborted === 1)
  const retry = start(fake.route())
  await until(() => calls === 2)
  gates[1].resolve()
  assert.equal((await retry.answer).text, 'Retry result')
  fake.dispose()
}

// A forced generation wins the shared cache regardless of completion order.
for (const newerFinishesFirst of [true, false]) {
  const gates = [deferred(), deferred()]
  let calls = 0
  const fake = fakeCtx(req => { const id = calls++; return gatedStream(gates[id], req.signal, id === 0 ? 'Old result' : 'New result') })
  apply(fake.ctx, { enabled: true })
  const old = start(fake.route())
  await until(() => calls === 1)
  const fresh = start(fake.route(), { sessionId: 's1', force: true })
  await until(() => calls === 2)
  if (newerFinishesFirst) { gates[1].resolve(); await fresh.answer; gates[0].resolve() }
  else { gates[0].resolve(); await old.answer; gates[1].resolve() }
  assert.equal((await old.answer).text, 'Old result')
  assert.equal((await fresh.answer).text, 'New result')
  assert.equal((await call(fake.route())).text, 'New result')
  assert.equal(calls, 2)
  fake.dispose()
}
// Dispose and the configurable host deadline still cancel model work.
for (const mode of ['dispose', 'timeout']) {
  const gate = deferred()
  let calls = 0, aborted = 0
  const fake = fakeCtx(req => { calls++; return gatedStream(gate, req.signal, 'Unused', () => aborted++) })
  apply(fake.ctx, { enabled: true, timeoutMs: 1000 })
  const pending = start(fake.route())
  await until(() => calls === 1)
  if (mode === 'dispose') fake.dispose()
  assert.equal((await pending.answer).reason, mode === 'timeout' ? 'timeout' : 'aborted')
  assert.equal(aborted, 1)
  if (mode !== 'dispose') fake.dispose()
}
{
  let request
  const session = { ...fakeSession(), deriveMessages: () => [
    { role: 'system', content: [{ type: 'text', text: 'S'.repeat(100000) }] },
    ...fakeSession().deriveMessages(),
  ] }
  for (const mode of ['prefix', 'cache']) {
    const result = await generate({ on: () => () => {}, llm: { stream: r => {
      request = r; return textStream('{"suggestion":"Add tests"}')
    } } }, session, { turn: 1 }, optionsOf({ contextMode: mode, maxPrefixChars: 2000, maxTotalChars: 2000 }))
    assert.ok(result.contextChars <= 2000)
    assert.equal(request.system, PREDICTION_SYSTEM)
    assert.equal(request.messages.some(m => m.role === 'system'), false)
  }
}
for (const segmenter of [Intl.Segmenter, undefined]) {
  const original = Intl.Segmenter
  try {
    Intl.Segmenter = segmenter
    for (const cluster of ['😀', '🇨🇳', '👨‍👩‍👧‍👦', 'e\u0301', '👍🏽']) {
      assert.deepEqual(splitGraphemes('A' + cluster + 'B'), ['A', cluster, 'B'])
      const out = clampSuggestion('A'.repeat(79) + cluster + 'B'.repeat(20), 80)
      assert.equal(out, 'A'.repeat(79) + '…')
    }
  } finally { Intl.Segmenter = original }
}
console.log('request isolation / cache ordering / disposal / timeout / budget / Unicode: ok')
