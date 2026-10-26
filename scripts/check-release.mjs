import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { npm } from './npm-command.mjs'
import './check-package.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
assert.equal(lock.version, pkg.version)
assert.equal(lock.packages[''].version, pkg.version)
assert.equal(lock.packages[''].license, pkg.license)
assert.deepEqual(lock.packages[''].engines, pkg.engines)
for (const [name, entry] of Object.entries(lock.packages)) {
  assert.ok(!entry.link && !name.startsWith('../'), 'machine-local lock entry: ' + name)
  if (entry.resolved) assert.match(entry.resolved, /^https:\/\//, 'nonportable dependency: ' + name)
}
assert.equal(pkg.scripts.prepack, 'node scripts/check-package.mjs')
assert.equal(pkg.scripts.prepublishOnly, 'npm run check')
for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
  assert.equal(pkg.scripts[name], undefined, 'unexpected installation script: ' + name)
}

function walk(directory, excluded = new Set()) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name) || /\.(tgz|zip|log)$/.test(entry.name)) return []
    assert.ok(!entry.isSymbolicLink(), 'unexpected source symlink: ' + entry.name)
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(file, excluded) : [file]
  })
}
const publicFiles = walk(root, new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'coverage']))
for (const file of publicFiles) {
  const relative = path.relative(root, file)
  assert.ok(!/(^|[\\/])(\.env(?:\..*)?|\.npmrc|\.DS_Store|backups?)([\\/]|$)/.test(relative), 'private source file: ' + relative)
  if (!/\.(md|js|mjs|jsx|json|html|ya?ml)$/.test(file)) continue
  const content = fs.readFileSync(file, 'utf8')
  assert.ok(!/(?:\/Users\/|\/home\/[\w.-]+\/|[A-Za-z]:\\Users\\)/.test(content), 'personal path in: ' + relative)
  assert.ok(!/\b(?:gh[pousr]_|github_pat_|sk-(?:proj-|ant-))[A-Za-z0-9_-]{20,}\b/.test(content), 'possible credential in: ' + relative)
  if (file.endsWith('.md')) {
    // Repository-local links only; external links are maintained separately.
    for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const local = decodeURIComponent(target.split('#')[0])
      if (local) assert.ok(fs.existsSync(path.resolve(path.dirname(file), local)), 'broken link in ' + relative + ': ' + target)
    }
  }
}

const [archive] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' }))
const expected = new Set(['package.json', 'host.js', 'client.js', 'cordis.patch.yml',
  'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md',
  'CONTRIBUTING.md', 'scripts/check-package.mjs',
  ...walk(path.join(root, 'docs')).map(file => path.relative(root, file).split(path.sep).join('/'))])
const actual = new Set(archive.files.map(file => file.path))
assert.deepEqual([...actual].sort(), [...expected].sort(), 'unexpected or missing archive file')
console.log('release: metadata, source hygiene, documentation links and ' + actual.size + ' package files: ok')
