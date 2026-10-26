// Build the Discover catalog from public registry data, never an unpublished
// local version. Offline checks are safe to run before the next package release.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const registry = 'https://registry.npmjs.org'
const indexFile = path.join(root, 'market/index.json')
const icon = await fs.readFile(path.join(root, 'market/icon.svg'))
const { values } = parseArgs({ options: { check: { type: 'boolean' }, 'verify-registry': { type: 'boolean' } } })
assert.ok(icon.length > 0 && icon.length <= 32 * 1024, 'inline icon exceeds DSH limit')
const inlineIcon = 'data:image/svg+xml;base64,' + icon.toString('base64')

async function publishedVersions() {
  const response = await fetch(registry + '/' + encodeURIComponent(pkg.name), {
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  assert.ok(response.ok, 'registry returned HTTP ' + response.status)
  const data = await response.json()
  assert.equal(data.name, pkg.name)
  const versions = Object.entries(data.versions).filter(([, meta]) =>
    meta.name === pkg.name && meta.private !== true && !meta.deprecated && meta.dsh?.bundle)
    .map(([version, meta]) => {
      const publishTimestamp = Math.floor(Date.parse(data.time[version]) / 1000)
      assert.ok(Number.isSafeInteger(publishTimestamp) && publishTimestamp > 0, 'missing registry publish time')
      assert.ok(meta.dist?.integrity && meta.dist?.tarball, 'version has no published artifact')
      assert.equal(typeof meta.engines?.dsh, 'string', 'published version must declare DSH compatibility')
      return { version, publishTimestamp, source: { type: 'npm', registry }, engines: { dsh: meta.engines.dsh } }
    }).sort((a, b) => b.publishTimestamp - a.publishTimestamp)
  assert.ok(versions.length > 0, 'no public bundle versions available')
  return versions
}

function check(index) {
  assert.equal(index.format, 1)
  assert.ok(index.title.en && index.title.zh)
  assert.equal(index.plugins.length, 1, 'this catalog contains this project only')
  const plugin = index.plugins[0]
  assert.equal(plugin.name, pkg.name)
  assert.equal(plugin.author, pkg.author.name)
  assert.equal(plugin.homepage, pkg.homepage)
  assert.equal(plugin.repository.url, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
  assert.equal(plugin.icon, inlineIcon, 'catalog icon is stale; run npm run market:update')
  assert.ok(plugin.title.en && plugin.title.zh && plugin.description.en && plugin.description.zh)
  assert.ok(index.metadata.categories[plugin.metadata.category])
  assert.ok(plugin.versions.length > 0)
  assert.equal(new Set(plugin.versions.map(v => v.version)).size, plugin.versions.length)
  for (const version of plugin.versions) {
    assert.match(version.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
    assert.ok(Number.isSafeInteger(version.publishTimestamp) && version.publishTimestamp > 0)
    assert.deepEqual(version.source, { type: 'npm', registry })
    assert.equal(typeof version.engines.dsh, 'string')
  }
}

if (values.check || values['verify-registry']) {
  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'))
  check(index)
  if (values['verify-registry']) {
    assert.deepEqual(index.plugins[0].versions, await publishedVersions(), 'catalog differs from public registry; regenerate it')
  }
  console.log('Discover catalog: package identity, inline icon, pinned npm sources and compatibility checked' +
    (values['verify-registry'] ? ' against public registry' : ' offline'))
} else {
  const index = {
    format: 1,
    title: { en: 'Bosaiting DSH plugins', zh: 'Bosaiting 的 DSH 插件' },
    description: { en: 'Community plugins maintained by Bosaiting.', zh: 'Bosaiting 维护的社区插件索引。' },
    metadata: { categories: { productivity: { title: { en: 'Productivity', zh: '效率工具' } } } },
    plugins: [{
      name: pkg.name,
      title: { en: 'Composer Predictions', zh: '下一条消息建议' },
      description: {
        en: 'Suggest your next message after a reply. Tab inserts a draft; Esc dismisses. Includes session caching, retry and diagnostics.',
        zh: '回复结束后预测下一条用户消息。Tab 插入草稿，Esc 忽略本轮；支持会话缓存、重新生成和失败原因显示。',
      },
      icon: inlineIcon,
      author: pkg.author.name,
      homepage: pkg.homepage,
      repository: { url: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '') },
      metadata: { category: 'productivity', keywords: [...pkg.keywords, 'Tab', 'Esc', '补全', '预测', '提示词'] },
      versions: await publishedVersions(),
    }],
  }
  check(index)
  await fs.writeFile(indexFile, JSON.stringify(index, null, 2) + '\n')
  console.log('Discover catalog: generated ' + index.plugins[0].versions.length + ' published bundle version(s)')
}
