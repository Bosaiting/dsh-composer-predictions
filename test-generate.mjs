import assert from 'node:assert/strict'
import { generate, optionsOf } from './host.js'

function fakeSession(overrides = {}) {
  return {
    id: 's1',
    requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
    deriveMessages: () => [
      { role: 'system', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'SYSTEM' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'hi' }] },
    ],
    ...overrides,
  }
}

async function* streamOf(deltas) {
  for (const text of deltas) yield { type: 'text-delta', text }
  yield { type: 'usage', usage: { input: 10, output: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function fakeCtx(deltas) {
  return {
    on: () => () => {},
    llm: {
      stream: (request) => {
        // The request should be one-shot, tool-free, and carry the trimmed history.
        assert.equal(request.tools, undefined)
        assert.equal(request.sessionId, 's1')
        assert.equal(request.reasoningEffort, 'high')
        assert.ok(request.messages.length >= 3)
        return streamOf(deltas)
      },
    },
  }
}

{
  const result = await generate(fakeCtx(['{"suggestion":"', 'Add tests', '"}']), fakeSession(), { turn: 3 }, optionsOf({ contextMode: 'clean' }), undefined)
  assert.equal(result.text, 'Add tests')
  assert.equal(result.turnId, 3)
  assert.equal(result.provider, 'p')
  assert.equal(result.model, 'm')
}

{
  const result = await generate(fakeCtx(['{"suggestion":null}']), fakeSession(), { turn: 4 }, optionsOf({ contextMode: 'clean' }), undefined)
  assert.equal(result.skipped, 'abstained')
}

{
  const result = await generate(fakeCtx(['not json']), fakeSession(), { turn: 5 }, optionsOf({ contextMode: 'clean' }), undefined)
  assert.equal(result.skipped, 'abstained')
}

// A non-stop finish is a failure, not a suggestion.
{
  const ctx = {
    on: () => () => {},
    llm: {
      stream: async function* () {
        yield { type: 'text-delta', text: '{"suggestion":"x"}' }
        yield { type: 'finish', reason: { kind: 'length' } }
      },
    },
  }
  const result = await generate(ctx, fakeSession(), { turn: 6 }, optionsOf({ contextMode: 'clean' }), undefined)
  assert.equal(result.skipped, 'finish-length')
}

// A stream without a terminal finish chunk is a failure, not a suggestion.
{
  const ctx = {
    on: () => () => {},
    llm: {
      stream: async function* () {
        yield { type: 'text-delta', text: '{"suggestion":"x"}' }
      },
    },
  }
  const result = await generate(ctx, fakeSession(), { turn: 7 }, optionsOf({ contextMode: 'clean' }), undefined)
  assert.equal(result.skipped, 'no-finish')
}

console.log('host generate: ok')
