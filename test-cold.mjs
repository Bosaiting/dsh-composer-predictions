import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from './host.js'

const EVENTS = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

function preparedSession() {
  return {
    id: 'cold-1',
    snapshotEvents: () => EVENTS,
    requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
    deriveMessages: () => [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'cold hello' }] },
      { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'cold hi' }] },
    ],
  }
}

async function* streamOf(text) {
  yield { type: 'text-delta', text }
  yield { type: 'finish', reason: { kind: 'stop' } }
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
      end(body) { out.body += body?.toString?.() ?? ''; this.writableEnded = true; done() },
    },
  }
}

async function call(route, body) {
  const { res, out, wait } = fakeRes()
  route.handler(fakeReq(body), res)
  await wait
  return JSON.parse(out.body)
}

let prepareOptions = null
let disposed = false
let route = null

const ctx = {
  sessions: {
    get: () => undefined,
    prepare: (id, options) => {
      assert.equal(id, 'cold-1')
      prepareOptions = options
      return preparedSession()
    },
  },
  get: (name) => {
    if (name !== 'sessionQuery') return undefined
    return {
      observeSession: async (id) => {
        assert.equal(id, 'cold-1')
        return {
          events: EVENTS,
          header: { id: 'cold-1', version: 3, createdAt: 1, isSeeded: false },
          inheritedEventCount: 0,
          [Symbol.dispose]() { disposed = true },
        }
      },
    }
  },
  llm: { stream: () => streamOf('{"suggestion":"Cold suggestion"}') },
  on: () => () => {},
  effect: (fn) => { fn() },
  inject: (names, cb) => {
    if (names.includes('webServer')) {
      cb({ effect: (fn) => { fn() }, webServer: { register: (value) => { route = value; return () => {} } } })
    }
  },
  logger: { info: () => {}, warn: () => {} },
}

apply(ctx, { enabled: true })
const answer = await call(route, { sessionId: 'cold-1' })
assert.equal(answer.ok, true)
assert.equal(answer.text, 'Cold suggestion')
assert.ok(prepareOptions !== null)
assert.equal(prepareOptions.meta.id, 'cold-1')
assert.equal(prepareOptions.inheritedEventCount, 0)
assert.equal(prepareOptions.eventState, 'detached')
assert.equal(prepareOptions.seed.length, EVENTS.length)
assert.equal(disposed, true, 'cold observation must be disposed')

console.log('cold session: ok')
