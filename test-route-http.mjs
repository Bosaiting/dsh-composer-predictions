import assert from 'node:assert/strict'
import http from 'node:http'
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

function makeCtx(streamFactory) {
  let route = null
  const ctx = {
    sessions: { get: (id) => (id === 's1' ? fakeSession() : undefined) },
    llm: { stream: streamFactory },
    on: () => () => {},
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
  return { ctx, route: () => route }
}

function listen(route) {
  const server = http.createServer((req, res) => route.handler(req, res))
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => {
          server.closeAllConnections?.()
          server.close(done)
        }),
      })
    })
  })
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function* abortableStream(signal, text, waitMs, state) {
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        state.aborted = true
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
    yield { type: 'text-delta', text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } catch (error) {
    state.aborted = true
    throw error
  }
}

// Normal request: the response completes, so res.close must NOT abort it.
{
  const state = { aborted: false }
  const { ctx, route } = makeCtx((request) => abortableStream(request.signal, '{"suggestion":"Add tests"}', 150, state))
  apply(ctx, { enabled: true })
  const server = await listen(route())
  try {
    const response = await fetch('http://127.0.0.1:' + server.port, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-bscp-timeout-ms'), '8000')
    const body = await response.json()
    assert.equal(body.text, 'Add tests')
    assert.equal(state.aborted, false)
  } finally {
    await server.close()
  }
}

// Client disconnect: res.close with writableEnded === false must abort the
// in-flight model stream. This is the regression that req.on('close') missed.
{
  const state = { aborted: false }
  const { ctx, route } = makeCtx((request) => abortableStream(request.signal, '{"suggestion":"Add tests"}', 700, state))
  apply(ctx, { enabled: true })
  const server = await listen(route())
  try {
    const controller = new AbortController()
    const request = fetch('http://127.0.0.1:' + server.port, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
      signal: controller.signal,
    }).then(response => response.json()).catch((error) => error.name)
    await delay(80)
    controller.abort()
    assert.equal(await request, 'AbortError')
    await delay(350)
    assert.equal(state.aborted, true, 'client disconnect must abort the prediction stream')
  } finally {
    await server.close()
  }
}

// Budget headers must arrive before model completion, including the 60 s cap.
{
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { ctx, route } = makeCtx(async function* () {
    await gate
    yield { type: 'text-delta', text: '{"suggestion":"After the gate"}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  apply(ctx, { enabled: true, timeoutMs: 60000 })
  const server = await listen(route())
  try {
    const response = await fetch('http://127.0.0.1:' + server.port, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }), signal: AbortSignal.timeout(2000),
    })
    assert.equal(response.headers.get('x-bscp-timeout-ms'), '60000')
    release()
    assert.equal((await response.json()).text, 'After the gate')
  } finally {
    release()
    await server.close()
  }
}

console.log('host route HTTP abort: ok')
