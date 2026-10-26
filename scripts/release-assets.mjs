// Prepare a release from a checked CI tarball. Use tracked source, not a
// hand-maintained source-file list, so browser fixtures cannot be omitted.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const { values } = parseArgs({ options: { directory: { type: 'string', default: 'dist' } } })
const directory = path.resolve(root, values.directory)
fs.mkdirSync(directory, { recursive: true })
const tag = 'v' + pkg.version
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, tag, 'tag/package version mismatch')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const commit = git(['rev-parse', 'HEAD'])
assert.equal(git(['status', '--porcelain']), '', 'release source must match its commit')
const tarballs = fs.readdirSync(directory).filter(name => name.endsWith('.tgz'))
assert.equal(tarballs.length, 1, 'release needs exactly one checked tarball')
const tarball = path.join(directory, tarballs[0])
const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
for (const entry of entries) {
  if (entry.endsWith('/')) continue
  assert.ok(entry.startsWith('package/'), 'unexpected tar root')
  const relative = entry.slice('package/'.length)
  assert.ok(relative && !relative.split('/').includes('..') && !path.isAbsolute(relative))
  const content = execFileSync('tar', ['-xOf', tarball, entry])
  assert.deepEqual(content, fs.readFileSync(path.join(root, relative)), 'tarball differs from checkout: ' + relative)
}
const sourceName = 'dsh-composer-predictions-' + pkg.version + '-source.zip'
const source = path.join(directory, sourceName)
execFileSync('git', ['archive', '--format=zip', '--prefix=dsh-composer-predictions-' + pkg.version + '/', '--output=' + source, 'HEAD'], { cwd: root })
for (const file of ['tests/browser-fixture.jsx', 'tests/browser.html']) git(['ls-files', '--error-unmatch', file])
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const checksums = { [path.basename(tarball)]: sha256(tarball), [sourceName]: sha256(source) }
const manifest = {
  package: pkg.name, version: pkg.version, tag, commit,
  sourceFiles: git(['ls-files', '-z']).split('\0').filter(Boolean).length,
  sha256: checksums,
  npmIntegrity: 'sha512-' + createHash('sha512').update(fs.readFileSync(tarball)).digest('base64'),
}
const manifestFile = path.join(directory, 'release-manifest.json')
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
checksums['release-manifest.json'] = sha256(manifestFile)
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), Object.entries(checksums).map(([name, hash]) => hash + '  ' + name + '\n').join(''))
const notes = `## dsh-composer-predictions ${tag}

首次公开版本：下一条用户消息建议，Tab 插入草稿、Esc 忽略本轮，支持会话缓存、重新生成及失败原因展示。

本版修复输入法期间的键盘接管、初始化补取漏触发、冲突误判和前后端超时不一致。

### 安装

下载本 Release 的 \`${path.basename(tarball)}\`，在 DSH 桌面的 Plugins → Add plugin 中选择安装包，启用后按提示重启。独立 Web profile 可执行：

\`\`\`sh
dsh plugin --profile web add ./${path.basename(tarball)}
\`\`\`

npm 安装使用 \`${pkg.name}@${pkg.version}\`；请核对完整包名，避免安装其他作者的同名包。

### 验证与边界

发布作业依赖 Node 22、24 的完整 CI 检查，包括 50 组浏览器布局、输入法状态／超时专项、HTTP 断连、缓存和生产安装检查。未执行新的付费模型调用；真实系统输入法及任意第三方插件组合仍需原生桌面验收。

预测会额外调用所选模型服务，默认继承会话模型和推理强度。更多信息见仓库的安装、隐私及支持边界文档。

安装包、完整源码包和校验文件来自提交 \`${commit}\`。源码包包含测试夹具；\`release-manifest.json\` 记录提交、包名和 npm 完整性值。
`
fs.writeFileSync(path.join(directory, 'RELEASE_NOTES.md'), notes)
console.log('release assets: checked tarball, tracked source, checksums and notes prepared for ' + tag)
