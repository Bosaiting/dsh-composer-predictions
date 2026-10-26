import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { npm } from './scripts/npm-command.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bscp-release-'))
try {
  const fixture = path.join(temporary, 'source'), output = path.join(temporary, 'output')
  fs.mkdirSync(fixture); fs.mkdirSync(output)
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const name of new Set(files)) {
    const target = path.join(fixture, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(root, name), target)
  }
  const git = args => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: 'pipe' })
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Release fixture'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  git(['add', '.'])
  git(['commit', '-m', 'Release fixture'])
  const cleanEnvironment = { ...process.env }
  delete cleanEnvironment.GITHUB_REF_TYPE
  delete cleanEnvironment.GITHUB_REF_NAME
  npm(['pack', '--pack-destination', output, '--silent'], { cwd: fixture, env: cleanEnvironment, stdio: 'pipe' })
  const script = path.join(fixture, 'scripts/release-assets.mjs')
  execFileSync(process.execPath, [script, '--directory', output], { cwd: fixture, env: cleanEnvironment, stdio: 'pipe' })
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'))
  assert.equal(manifest.package, pkg.name)
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.commit, git(['rev-parse', 'HEAD']).trim())
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex'), hash)
  }
  assert.throws(() => execFileSync(process.execPath, [script, '--directory', output], {
    cwd: fixture, env: { ...cleanEnvironment, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.0' }, stdio: 'pipe',
  }), /tag\/package version mismatch/)
  // A clean but different commit must reject the previously packed archive.
  fs.appendFileSync(path.join(fixture, 'host.js'), '\n// A different commit.\n')
  git(['add', 'host.js']); git(['commit', '-m', 'Change source after packing'])
  assert.throws(() => execFileSync(process.execPath, [script, '--directory', output], {
    cwd: fixture, env: cleanEnvironment, stdio: 'pipe',
  }), /tarball differs from checkout/)
  console.log('release: matching commit/archive, checksums, tag guard and stale archive rejection: ok')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
