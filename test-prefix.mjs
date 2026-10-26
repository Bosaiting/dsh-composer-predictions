import assert from 'node:assert/strict'
import { generate, optionsOf, PREDICTION_SYSTEM } from './host.js'

const SYSTEM = { role: 'system', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'SYS' }] }
const USER = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }
const TOOL = { role: 'user', source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool output' }] }
const ASSISTANT = { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'hi' }] }
const MESSAGES = [SYSTEM, USER, TOOL, ASSISTANT]

function fakeSession() {
  return {
    id: 's1',
    requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
    deriveMessages: () => MESSAGES,
  }
}

async function* streamOf(text) {
  yield { type: 'text-delta', text }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function fakeCtx(requests) {
  return {
    on: () => () => {},
    llm: {
      stream: (request) => {
        requests.push(request)
        return streamOf('{"suggestion":"Add tests"}')
      },
    },
  }
}

// True prefix: the exact messages are reused by reference, with only the
// instruction appended, and no dedicated system prompt.
{
  const requests = []
  const result = await generate(
    fakeCtx(requests),
    fakeSession(),
    { turn: 1 },
    optionsOf({ contextMode: 'cache', maxPrefixChars: 10000 }),
    undefined,
  )
  const request = requests[0]
  assert.equal(result.text, 'Add tests')
  assert.equal(result.cacheable, true)
  assert.ok(result.contextChars > 0)
  assert.equal(request.system, undefined)
  assert.equal(request.messages.length, MESSAGES.length + 1)
  for (let i = 0; i < MESSAGES.length; i += 1) assert.equal(request.messages[i], MESSAGES[i])
  assert.equal(request.messages.at(-1).role, 'user')
  assert.ok(request.messages.at(-1).content[0].text.includes('next message'))
}

// Clean: dedicated system prompt + filtered transcript, no tool result.
{
  const requests = []
  const result = await generate(
    fakeCtx(requests),
    fakeSession(),
    { turn: 2 },
    optionsOf({ contextMode: 'clean', maxTotalChars: 5000 }),
    undefined,
  )
  const request = requests[0]
  assert.equal(result.cacheable, false)
  assert.equal(request.system, PREDICTION_SYSTEM)
  assert.equal(request.messages.some((m) => m.source?.kind === 'tool'), false)
  assert.equal(request.messages.some((m) => m.role === 'system'), false)
}

// Prefix over budget falls back to the bounded clean transcript.
{
  const requests = []
  const longSession = {
    ...fakeSession(),
    deriveMessages: () => [
      ...MESSAGES,
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'z'.repeat(3000) }] },
    ],
  }
  const result = await generate(
    fakeCtx(requests),
    longSession,
    { turn: 3 },
    optionsOf({ contextMode: 'cache', maxPrefixChars: 2000, maxTotalChars: 5000 }),
    undefined,
  )
  const request = requests[0]
  assert.equal(result.cacheable, false)
  assert.equal(request.system, PREDICTION_SYSTEM)
  assert.equal(request.messages.some((m) => m.role === 'system'), false)
  assert.equal(request.messages.some((m) => m.source?.kind === 'tool'), false)
}

console.log('prefix/budget generation: ok')

// Clean mode must not read old system/tool content for prefix-only scans.
{
  const requests = []
  const session = { ...fakeSession(), deriveMessages: () => [
    { role: 'system', get content() { throw new Error('clean mode scanned prefix content') } },
    { role: 'user', source: { kind: 'tool' }, get content() { throw new Error('clean mode scanned tool content') } },
    USER, ASSISTANT,
  ] }
  const result = await generate(fakeCtx(requests), session, { turn: 4 }, optionsOf({ contextMode: 'clean' }))
  assert.equal(result.text, 'Add tests')
  assert.equal(requests[0].messages.length, 3)
}
