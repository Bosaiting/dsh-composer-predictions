import assert from 'node:assert/strict'
import { currentOptions } from './host.js'

// The settings form's descriptor wins over the patch base.
{
  const config = { enabled: true, stubText: 'STUB', maxContextMessages: 12 }
  const settings = {
    describe: () => [{ ns: 'dsh-composer-predictions', value: { enabled: false } }],
  }
  const options = currentOptions(config, settings)
  assert.equal(options.enabled, false)
  assert.equal(options.stubText, 'STUB')
  assert.equal(options.maxContextMessages, 12)
}

// A volatile Config accessor is read through get().
{
  const config = { enabled: { get: () => false }, stubText: 'STUB' }
  const options = currentOptions(config, null)
  assert.equal(options.enabled, false)
  assert.equal(options.stubText, 'STUB')
}

// A settings service without our entry keeps the base.
{
  const options = currentOptions({ enabled: true }, { describe: () => [] })
  assert.equal(options.enabled, true)
}

console.log('host settings: ok')
