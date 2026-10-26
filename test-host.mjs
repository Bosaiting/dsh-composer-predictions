import assert from 'node:assert/strict'
import { latestClosedTurn, buildConversation, parseSuggestion, clampSuggestion, optionsOf } from './host.js'

function event(type, data = {}) {
  return { type, data }
}

const sessionWith = (events) => ({ snapshotEvents: () => events })

// latestClosedTurn
assert.equal(latestClosedTurn(sessionWith([])), null)
assert.equal(latestClosedTurn(sessionWith([event('turn/start', { turn: 1 })])), null)
assert.deepEqual(
  latestClosedTurn(sessionWith([
    event('turn/start', { turn: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ])),
  { turn: 1, reason: 'completed' },
)
assert.equal(
  latestClosedTurn(sessionWith([
    event('turn/start', { turn: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event('turn/start', { turn: 2 }),
  ])),
  null,
)
assert.equal(
  latestClosedTurn(sessionWith([
    event('turn/start', { turn: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'error' } }),
  ])),
  null,
)

// buildConversation keeps system only in cache mode, skips tools/plugin context
const messages = [
  { role: 'system', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'SYSTEM' }] },
  { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
  { role: 'user', source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool output' }] },
  { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'hi' }] },
  { role: 'user', source: { kind: 'plugin', plugin: 'ctx' }, content: [{ type: 'text', text: 'injected' }] },
  { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'do it' }] },
]
const clean = buildConversation(messages, optionsOf({ contextMode: 'clean', maxContextMessages: 10 }))
assert.equal(clean.system, null)
assert.deepEqual(clean.conversation, [
  { role: 'user', text: 'hello' },
  { role: 'assistant', text: 'hi' },
  { role: 'user', text: 'do it' },
])
const cache = buildConversation(messages, optionsOf({ contextMode: 'cache', maxContextMessages: 10 }))
assert.equal(cache.system.role, 'system')
assert.equal(cache.conversation.length, 3)

// DSH can append a replacement system message; the last non-empty one is in
// force, never the first.
const replaced = buildConversation([
  { role: 'system', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'OLD SYSTEM' }] },
  { role: 'system', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: 'NEW SYSTEM' }] },
  { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
], optionsOf({ contextMode: 'cache', maxContextMessages: 10 }))
assert.equal(replaced.system.content[0].text, 'NEW SYSTEM')

// Total context budget: oldest messages are dropped and the newest is
// trimmed so the final text stays inside maxTotalChars.
const longMessages = Array.from({ length: 6 }, (_, index) => ({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: String(index) + ':' + 'x'.repeat(100) }],
}))
const budgeted = buildConversation(longMessages, optionsOf({
  contextMode: 'clean',
  maxContextMessages: 10,
  maxMessageChars: 2000,
  maxTotalChars: 2000,
}))
assert.ok(budgeted.chars <= 2000, 'budget must be strict, got ' + budgeted.chars)
assert.ok(budgeted.conversation.length >= 1)
assert.ok(budgeted.conversation.at(-1).text.startsWith('5:'))

const oversized = buildConversation([{
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: 'y'.repeat(3000) }],
}], optionsOf({
  contextMode: 'clean',
  maxContextMessages: 10,
  maxMessageChars: 4000,
  maxTotalChars: 2000,
}))
assert.ok(oversized.chars <= 2000, 'single message must be trimmed, got ' + oversized.chars)
assert.ok(oversized.conversation[0].text.includes('…[truncated]…'))

// Preserve the latest question under both per-message and total budgets.
for (const limits of [
  { maxMessageChars: 400, maxTotalChars: 2000 },
  { maxMessageChars: 8000, maxTotalChars: 2000 },
]) {
  const text = 'Original request: preserve backups. ' + '👨‍👩‍👧‍👦e\u0301'.repeat(600) + ' Final question: choose A or B?'
  const result = buildConversation([{ role: 'assistant', content: [{ type: 'text', text }] }], optionsOf(limits))
  const kept = result.conversation[0].text
  assert.ok(kept.startsWith('Original request: preserve backups.'))
  assert.ok(kept.endsWith('Final question: choose A or B?'))
  assert.ok(kept.length <= Math.min(limits.maxMessageChars, limits.maxTotalChars))
  assert.equal(result.chars, kept.length)
  assert.ok(!/^[\u0300-\u036f]/.test(kept.split('…[truncated]…\n')[1]))
}

// parseSuggestion
assert.equal(parseSuggestion('{"suggestion":"Add tests"}'), 'Add tests')
assert.equal(parseSuggestion('\u0060\u0060\u0060json\n{"suggestion":"Add tests"}\n\u0060\u0060\u0060'), 'Add tests')
assert.equal(parseSuggestion('{"suggestion":null}'), null)
assert.equal(parseSuggestion('not json'), null)
assert.equal(parseSuggestion('{"suggestion":""}'), null)
assert.equal(parseSuggestion('{"suggestion":"' + 'x'.repeat(2001) + '"}'), null)
assert.equal(parseSuggestion('{"suggestion":"a\u0000b"}'), null)
assert.equal(
  parseSuggestion('Actually write the file now and confirm with `wc -l README.md`.'),
  'Actually write the file now and confirm with `wc -l README.md`.',
)
assert.equal(parseSuggestion('Suggestion: Add a CLI example.'), 'Add a CLI example.')
assert.equal(parseSuggestion('The user would probably ask for tests.'), null)
assert.equal(parseSuggestion('line one\nline two\nline three\nline four'), null)

// clampSuggestion keeps bounded output and prefers a sentence boundary
assert.equal(clampSuggestion('short', 300), 'short')
const long = 'Add tests. ' + 'x'.repeat(500)
const clamped = clampSuggestion(long, 100)
assert.ok(clamped.length <= 101)
assert.ok(clamped.endsWith('…'))
assert.equal(clampSuggestion('x'.repeat(50), 80), 'x'.repeat(50))

console.log('host helpers: ok')

// Older content must not be inspected once the message cap or total budget
// is satisfied. A large history should cost the same as its selected suffix.
const inaccessible = { role: 'assistant', get content() { throw new Error('discarded historical content was read') } }
const recent = Array.from({ length: 12 }, (_, i) => ({ role: 'assistant', content: [{ type: 'text', text: 'recent-' + i }] }))
const selected = buildConversation([inaccessible, ...recent], optionsOf({}))
assert.equal(selected.conversation.length, 12)
assert.equal(selected.conversation[0].text, 'recent-0')
const budgetSuffix = buildConversation([inaccessible, {
  role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(4000) }],
}], optionsOf({ maxTotalChars: 4000 }))
assert.equal(budgetSuffix.chars, 4000)
// Do not skip a non-fitting older message to fill holes with even older text:
// preserve the established contiguous newest-suffix policy and chronology.
const noHoles = buildConversation([
  { role: 'assistant', content: [{ type: 'text', text: 'tiny old message' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(1500) }] },
  { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(1500) }] },
], optionsOf({ maxTotalChars: 2000 }))
assert.deepEqual(noHoles.conversation.map(message => message.text), ['b'.repeat(1500)])
