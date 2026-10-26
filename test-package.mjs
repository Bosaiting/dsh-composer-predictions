// Exercise the shipped archive in a clean production installation, including
// packing that installed copy without browser/dev dependencies or a lockfile.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { npm } from './scripts/npm-command.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dshcp-package-'))
try {
  const candidate = path.join(temporary, 'candidate')
  const consumer = path.join(temporary, 'consumer')
  const repacked = path.join(temporary, 'repacked')
  for (const directory of [candidate, consumer, repacked]) fs.mkdirSync(directory)
  npm(['pack', '--pack-destination', candidate, '--silent'], { cwd: root, stdio: 'pipe' })
  const tarball = path.join(candidate, pkg.name + '-' + pkg.version + '.tgz')
  assert.ok(fs.existsSync(tarball))
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'dshcp-package-consumer', version: '1.0.0', private: true, type: 'module' }))
  npm(['install', '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: consumer, stdio: 'pipe' })
  const installed = path.join(consumer, 'node_modules', pkg.name)
  for (const name of ['playwright', 'esbuild', 'react-dom']) {
    assert.ok(!fs.existsSync(path.join(consumer, 'node_modules', name)), 'development dependency installed: ' + name)
  }
  for (const name of ['test-browser.mjs', 'tests', 'node_modules', 'package-lock.json']) {
    assert.ok(!fs.existsSync(path.join(installed, name)), 'development content shipped: ' + name)
  }
  const probe = `import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import fs from 'node:fs';
    import * as host from 'dsh-composer-predictions';
    const require = createRequire(import.meta.url);
    const pkg = require('dsh-composer-predictions/package.json');
    assert.equal(pkg.version, ${JSON.stringify(pkg.version)});
    assert.equal(typeof host.apply, 'function');
    assert.equal(typeof host.Config, 'function');
    assert.equal(typeof host.Config.toJSON, 'function');
    assert.match(fs.readFileSync(require.resolve('dsh-composer-predictions/client'), 'utf8'), /__ModuleLoader__/);
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');`
  fs.writeFileSync(path.join(consumer, 'probe.mjs'), probe)
  execFileSync(process.execPath, [path.join(consumer, 'probe.mjs')], { cwd: consumer, stdio: 'pipe' })
  npm(['pack', '--pack-destination', repacked, '--silent'], { cwd: installed, stdio: 'pipe' })
  assert.ok(fs.existsSync(path.join(repacked, path.basename(tarball))))
  console.log('package install: production dependencies, host/client exports and dev-free prepack: ok')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
