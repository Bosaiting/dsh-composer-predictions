import assert from 'node:assert/strict'
import {
  PREDICTION_SYSTEM,
  PREDICTION_INSTRUCTION,
  PROMPT_VERSION,
  optionsOf,
  parseSuggestion,
} from './host.js'

assert.equal(PROMPT_VERSION, '4')
assert.ok(PREDICTION_SYSTEM.includes("user's next message"))
assert.ok(PREDICTION_SYSTEM.includes('next concrete action'))
assert.ok(PREDICTION_SYSTEM.includes('Return exactly one JSON object'))
assert.ok(PREDICTION_SYSTEM.includes('Do not restate'))
assert.ok(PREDICTION_INSTRUCTION.includes('Return only one JSON object'))

// The prompt must force a useful, bounded default.
const defaults = optionsOf({})
assert.equal(defaults.maxOutputTokens, 400)
assert.ok(defaults.maxSuggestionChars >= 80)

// A model may ignore the JSON wrapper; accept one message, reject analysis.
assert.equal(parseSuggestion('Actually write the file now and confirm with `wc -l README.md`.'), 'Actually write the file now and confirm with `wc -l README.md`.')
assert.equal(parseSuggestion('Suggestion: Add a CLI example.'), 'Add a CLI example.')
assert.equal(parseSuggestion('The user would probably ask for tests.'), null)
assert.equal(parseSuggestion('not json'), null)

console.log('prompt: ok')
