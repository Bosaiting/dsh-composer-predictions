# 维护者发布流程

当前公开仓库为 [Bosaiting/dsh-composer-predictions](https://github.com/Bosaiting/dsh-composer-predictions)。当前版本为 **0.4.3**，npm 包名为 `@bosaiting/dsh-composer-predictions`。版本资产与发布状态以 [Release](https://github.com/Bosaiting/dsh-composer-predictions/releases) 和 npm 注册表为准。[Actions](https://github.com/Bosaiting/dsh-composer-predictions/actions) 展示远程 CI 的实际状态；本地与原生验收边界见 [VALIDATION.md](VALIDATION.md)。

## 公开内容

源码包含运行文件、补丁、MIT 与第三方声明、中英文 README、文档、模拟预览、测试、锁文件和检查脚本。不要上传整个 DSH 数据目录、profile、node_modules、私密备份或本地报告。

安装包由 files 白名单控制，包含运行文件、轻量检查脚本、许可证和文档，不含测试及私人截图。源码包保留测试以便复现；files 不能替代 Git 源码清理。

## 元数据与版本

核对 name/version/license/author 和顶层 engines。作者使用已确认的 GitHub 账号 Bosaiting；repository/homepage/bugs 指向当前公开仓库。发布后同步两份 README 的状态和安装入口。

版本变更同步 package-lock 根项、CHANGELOG 和安装示例。npm 已发布版本不能覆盖。保留兼容范围和实际测试范围的区别；[已知问题](KNOWN_ISSUES.md) 必须继续可见。

## 生成候选包

```sh
npm ci
npx playwright install chromium
npm run check
npm pack
```

npm 发布使用 `@bosaiting/dsh-composer-predictions`，无作用域包名已被其他作者占用。发布的安装包必须与 Release 资产的校验值一致。

prepublishOnly 执行完整检查；prepack 仅用 Node 内置模块验证运行文件，不下载浏览器、不调用模型、不依赖开发包。用 `npm pack --dry-run --json` 核对最终清单，并人工检查源码、图片和版权。

macOS/Linux 可用 `shasum -a 256 文件名.tgz`；Windows PowerShell 可用 `Get-FileHash 文件名.tgz -Algorithm SHA256`。对实际准备上传的文件计算校验值。

## 干净安装

test:package 验证生产依赖和入口解析。另按 [INSTALL.md](INSTALL.md) 完成隔离 DSH 中的启用、重启、关闭、升级/回退和卸载，记录 DSH/OS/输入法/主题/补全插件、stub 或真实模型、时间及未通过事项。

npm 生产安装或浏览器夹具通过，都不等于原生桌面验收。

## GitHub 与 Release

检查将提交的列表，保留第三方声明。当前仓库已建立，后续在 main 分支维护源码。可以添加官方建议的 `dsh-plugin` topic，发布 Release 前确认对应提交的 CI 实际成功。

对通过验证的提交创建并推送 `v0.4.3` 标签。工作流先运行 Node 22／24 的完整检查；全部通过后，发布作业使用当次 CI 的安装包创建 GitHub Release，并附上完整源码、校验文件和 release-manifest.json。只有发布作业拥有本仓库临时写权限，不需要上传长期 GitHub token。标签、包和源码版本一致。Git 源码安装应固定经过验证的提交；创建 v0.4.3 标签后，也可以固定该标签。

## 发布后的文档修订

已发布的 tag、安装包、源码包和校验文件保持对应关系。后续验收记录与演示可以更新到 main，不移动既有标签或覆盖原有资产。npm 页面 README 随版本发布，下次发版时同步；当前 GitHub 文档可能比 v0.4.3 安装包内的文档更新。当前验收与素材来源见 [VALIDATION.md](VALIDATION.md) 和 [DEMO.md](DEMO.md)。

## npm 和 Discover（可选）

GitHub 开源和 tgz 分发无需 npm。选择 npm 时先确认包名归属及账户，补全仓库元数据，使用 npm 当前支持的认证方式；可选受信任发布和来源证明，不把 token 写入仓库。主分支和 PR 的 CI 只检查与保留 artifact；版本标签在检查通过后自动发布 GitHub Release。npm 仍由维护者登录后发布，不在本仓库存放 npm 凭据。

下载该 Release 的安装包与校验文件，核对 SHA-256 后发布同一文件：

```sh
npm whoami --registry=https://registry.npmjs.org
npm publish ./bosaiting-dsh-composer-predictions-0.4.3.tgz --access public --registry=https://registry.npmjs.org
npm view @bosaiting/dsh-composer-predictions@0.4.3 dist.integrity --registry=https://registry.npmjs.org
```

最后一个值应与 Release 中 `release-manifest.json` 的 `npmIntegrity` 一致。不要在这一步重新打包；发布的是已经通过 CI 的同一份文件。

本项目已提供独立的格式 1 Discover 索引，地址和使用方式见 [DISCOVER.md](DISCOVER.md)。npm 新版本公开可查后运行 `npm run market:update` 和 `node scripts/market-index.mjs --verify-registry`，再提交索引。更新器从注册表读取发布时间与兼容范围，仅收录已发布 bundle；不从本地主分支推测可安装版本。GitHub/npm 发布本身不会自动添加索引源，也不会自动进入其他社区索引。

## 参考

- [DSH 打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [DSH 索引](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)
- [npm 元数据](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
- [npm 生命周期](https://docs.npmjs.com/cli/v11/using-npm/scripts/)
