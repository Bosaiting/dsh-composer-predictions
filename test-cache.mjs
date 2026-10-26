import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from './host.js'

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
  const ctx = {
    sessions: { get: (id) => (id === 's1' ? fakeSession() : undefined) },
    llm: { stream: streamFactory },
    on: (name, listener) => {
      if (name === 'session/event') turnListeners.push(listener)
      return () => {}
    },
    effect: (fn) => { fn() },
    get: () => undefined,
    inject: (names, cb) => {
      if (names.includes('webServer')) {
        cb({
          effect: (fn) => { fn() },
          webServer: { register: (value) => { route = value; return () => {} } },
        })
      }
    },
    logger: { info: () => {}, warn: () => {} },
  }
  return {
    ctx,
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

// Cache: two requests for one turn call the model once; a new turn invalidates.
{
  let calls = 0
  const fake = fakeCtx(() => { calls += 1; return textStream('{"suggestion":"Add tests"}') })
  apply(fake.ctx, { enabled: true, stubText: '' })
  const first = await call(fake.route())
  const second = await call(fake.route())
  assert.equal(first.text, 'Add tests')
  assert.equal(second.text, 'Add tests')
  assert.equal(calls, 1)
  fake.turnStart()
  const third = await call(fake.route())
  assert.equal(third.text, 'Add tests')
  assert.equal(calls, 2)
}

// Cache key: changing a context-trimming setting must not reuse the old turn.
{
  let calls = 0
  const config = { enabled: true, maxContextMessages: 12, maxMessageChars: 4000 }
  const fake = fakeCtx(() => { calls += 1; return textStream('{"suggestion":"Add tests"}') })
  apply(fake.ctx, config)
  await call(fake.route())
  config.maxContextMessages = 6
  await call(fake.route())
  config.maxMessageChars = 1000
  await call(fake.route())
  assert.equal(calls, 3, 'context settings must be part of the cache key')
  config.reasoningEffort = 'low'
  await call(fake.route())
  assert.equal(calls, 4, 'reasoning effort must be part of the cache key')
}

// Regenerate: force bypasses the cache and refreshes it.
{
  let calls = 0
  const fake = fakeCtx(() => { calls += 1; return textStream('{"suggestion":"Add tests"}') })
  apply(fake.ctx, { enabled: true })
  await call(fake.route())
  await call(fake.route())
  assert.equal(calls, 1)
  const forced = await call(fake.route(), { sessionId: 's1', force: true })
  assert.equal(forced.text, 'Add tests')
  assert.equal(calls, 2)
  await call(fake.route())
  assert.equal(calls, 2, 'forced result must refresh the cache')
}

// Abort: a turn/start while the model is running cancels the request.
{
  let aborted = false
  const fake = fakeCtx(() => (async function* () {
    await new Promise((resolve) => setTimeout(resolve, 150))
    aborted = true
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  })())
  apply(fake.ctx, { enabled: true, stubText: '' })
  const pending = call(fake.route())
  setTimeout(() => fake.turnStart(), 20)
  const result = await pending
  assert.equal(result.reason, 'aborted', JSON.stringify(result))
  assert.equal(aborted, true)
}

console.log('cache/abort: ok')
