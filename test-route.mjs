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

async function* streamOf(text) {
  yield { type: 'text-delta', text }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function fakeCtx() {
  let route = null
  const ctx = {
    sessions: { get: (id) => (id === 's1' ? fakeSession() : undefined) },
    llm: {
      stream: () => streamOf('{"suggestion":"Add tests"}'),
    },
    on: () => () => {},
    effect: (fn) => { fn() },
    get: () => undefined,
    inject: (names, cb) => {
      if (names.includes('webServer')) {
        cb({
          effect: (fn) => { fn() },
          webServer: {
            register: (value) => { route = value; return () => {} },
          },
        })
      }
    },
    logger: { warn: () => {} },
  }
  return { ctx, route: () => route }
}

function fakeReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function fakeRes() {
  const out = { status: 0, headers: null, body: '' }
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  return {
    out,
    done,
    res: {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead(status, headers) { out.status = status; out.headers = headers; this.headersSent = true },
      on() {},
      off() {},
      end(body) {
        out.body += body?.toString?.() ?? ''
        this.writableEnded = true
        resolveDone()
      },
    },
  }
}

async function call(route, body) {
  const { res, out, done } = fakeRes()
  route.handler(fakeReq(body), res)
  await done
  return { status: out.status, json: JSON.parse(out.body) }
}

{
  const { ctx, route } = fakeCtx()
  apply(ctx, { enabled: true, stubText: 'STUB' })
  assert.ok(route() !== null)
  const answer = await call(route(), { sessionId: 's1' })
  assert.equal(answer.status, 200)
  assert.equal(answer.json.ok, true)
  assert.equal(answer.json.text, 'STUB')
}

{
  const { ctx, route } = fakeCtx()
  apply(ctx, { enabled: true, stubText: '' })
  const answer = await call(route(), { sessionId: 's1' })
  assert.equal(answer.status, 200)
  assert.equal(answer.json.text, 'Add tests')
}

{
  const { ctx, route } = fakeCtx()
  apply(ctx, { enabled: false })
  const answer = await call(route(), { sessionId: 's1' })
  assert.equal(answer.json.reason, 'disabled')
}

console.log('host route: ok')
