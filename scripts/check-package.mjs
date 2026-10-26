// Runs during packing, including Git installs. No dev dependencies, network,
// browser or model calls are required here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.name, '@bosaiting/dsh-composer-predictions')
assert.notEqual(pkg.private, true, 'public distribution must not be marked private')
assert.equal(pkg.license, 'MIT')
assert.equal(typeof pkg.engines?.dsh, 'string', 'declare engines.dsh at package root')
assert.equal(typeof pkg.engines?.node, 'string')
assert.equal(pkg.dsh.engines, undefined, 'nested dsh.engines is not the compatibility field')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(pkg.exports['.'], './host.js')
assert.equal(pkg.exports['./client'], './client.js')
assert.equal(pkg.exports['./package.json'], './package.json')
for (const name of ['host.js', 'client.js', 'cordis.patch.yml', 'README.md',
  'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/INSTALL.md',
  'docs/PRIVACY.md', 'docs/KNOWN_ISSUES.md', 'docs/images/preview.png']) {
  assert.ok(fs.statSync(path.join(root, name)).isFile(), 'missing package file: ' + name)
}
for (const name of ['host.js', 'client.js']) {
  execFileSync(process.execPath, ['--check', path.join(root, name)], { stdio: 'pipe' })
}
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
assert.ok(patch.includes("name: '" + pkg.name + "'"))
assert.match(patch, /id: bosaiting-composer-predictions\s/)
assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /MIT License/)
assert.ok(fs.readFileSync(path.join(root, 'client.js'), 'utf8').includes("id: '" + pkg.name + "'"), 'client module id must match package name')
console.log('package: runtime files, metadata and syntax: ok')
