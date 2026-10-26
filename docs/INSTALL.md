# 安装、升级和卸载

对应版本 **0.4.3**。来源：[公开仓库](https://github.com/Bosaiting/dsh-composer-predictions)、[GitHub Release](https://github.com/Bosaiting/dsh-composer-predictions/releases/tag/v0.4.3) 和 [npm](https://www.npmjs.com/package/@bosaiting/dsh-composer-predictions)。请核对完整作用域名称。

## 来源与要求

核对完整包名 **`@bosaiting/dsh-composer-predictions`**。无作用域的同名 npm 包属于其他作者，不是本项目。有发布者提供的 SHA-256 时，先比对下载文件。需要 DSH `>=0.2.1-rc.2 <0.3.0`；原生接口基线是 `0.2.1-rc.2`，并未逐版本验证整个范围。

普通用户无需 React、Playwright 或构建工具。安装器仍需解析生产依赖，首次安装通常需要网络。插件需要会话、模型、设置和 Web 客户端服务；裸 headless 环境不会显示建议。

## npm 安装与旧本地副本迁移

可以在 Plugins → Add plugin 输入 `@bosaiting/dsh-composer-predictions@0.4.3`，独立环境可执行：

```sh
dsh plugin --profile web add @bosaiting/dsh-composer-predictions@0.4.3 --save-exact
```

本项目旧的本地副本曾使用无作用域名称 `dsh-composer-predictions`，与注册表中另一作者的包同名。升级本项目旧副本时，先停用并卸载旧本地包，再安装新作用域包；不要从注册表下载无作用域包作为升级。新的配置条目 ID 为 `bosaiting-composer-predictions`，状态计数、客户端模块、样式和路由也使用独立命名空间。旧开关、统计和人工配置不会自动迁移；如有需要，按新配置示例重新设置。发布不会自动替换其他使用者的旧副本；需在目标环境完成迁移。

## 桌面应用：优先使用应用内安装

1. 下载可信的 `bosaiting-dsh-composer-predictions-0.4.3.tgz`。
2. 打开 **Plugins → Add plugin（插件 → 添加插件）**，输入安装包的绝对路径。不要把 shell 引号当作路径一部分。
3. 核对安装预览的包名、版本和来源，安装并启用。不同发行版按钮名称可能不同。
4. 按提示完全退出并重新启动；仅刷新页面可能无法重载 Host。
5. 检查设置 → 通用 → **Predict next message**。

安装并启用后可能自动发起预测。先体验界面时使用独立测试环境和 `stubText`。额外调用、数据范围见 [隐私说明](PRIVACY.md)。旧版不支持该安装来源时，使用该版支持的插件入口或升级，不要手工覆盖桌面 node_modules、锁文件或 bundles。

## 桌面附带 CLI：仅适用于支持它的发行版

官方当前文档支持附带 CLI 管理已初始化的桌面 profile。旧版独立 CLI 可能报 `profile desktop is managed exclusively by the Electron application`，这不是插件故障。

先启动一次桌面应用；在其 **Manage dsh Command…** 注册附带 CLI，新开终端核对 `dsh --version`。**完全退出应用**，再在安装包目录执行：

```sh
dsh plugin --profile desktop add ./bosaiting-dsh-composer-predictions-0.4.3.tgz
dsh plugin --profile desktop list
```

随后重新打开应用。已验证的桌面附带 CLI 支持安装、卸载和列出依赖，但 `--profile desktop --dump-config` 仍会拒绝受管 profile；应在应用插件详情中核对版本、来源和组件运行状态。若安装本身被受管 profile 检查拒绝，回到应用内安装，不要绕过所有权检查。PATH 上的独立 CLI 版本不一定与桌面一致。

## Web／已有独立 profile

停止目标 profile 的进程，在安装包目录执行：

```sh
dsh --version
dsh plugin --profile web add ./bosaiting-dsh-composer-predictions-0.4.3.tgz
dsh plugin --profile web list
dsh --profile web --dump-config
```

把 `web` 替换成实际目标。核对配置中有插件层，使用原来的启动命令重启。

## 从源码创建隔离体验环境

先获取公开源码并生成安装包：

```sh
git clone --branch v0.4.3 --depth 1 https://github.com/Bosaiting/dsh-composer-predictions.git
cd dsh-composer-predictions
npm pack
```

首次打包只检查运行文件，无需安装开发依赖或 Chromium。在单独终端创建新的 DSH 数据目录，避免继承现有登录、会话和配置。以下为 macOS/Linux shell 示例：

```sh
export DSH_HOME="$(mktemp -d)"
dsh --profile predictions-demo --from-default-profile web --dump-config
dsh plugin --profile predictions-demo add ./bosaiting-dsh-composer-predictions-0.4.3.tgz
dsh --profile predictions-demo --port 49321 --no-open
```

真实预测需要在这个新环境配置模型。只检查界面可设置 `stubText`，见 [配置说明](CONFIGURATION.md)。端口占用时换用空闲端口。结束时停止服务、退出此终端，按需删除刚创建的临时目录。

## 升级与回退

通过同一入口安装新版本 `.tgz`，再重启。独立环境可再次用 `dsh plugin --profile web add ./新版本文件.tgz`。保留已验证旧包以便回退；遇到运行中禁止替换提示，先关闭对应应用或服务。不要复制别人整个 profile 来安装单个插件。

## 关闭与卸载

临时关闭设置开关会隐藏建议、取消请求并停止自动预测。桌面卸载从 Plugins 中找到完整包名并卸载，按提示重启。使用兼容的桌面 CLI 时先完全退出应用，再执行：

```sh
dsh plugin --profile desktop remove @bosaiting/dsh-composer-predictions
```

独立环境执行：

```sh
dsh plugin --profile web remove @bosaiting/dsh-composer-predictions
```

卸载不会删除会话。使用计数可在卸载前点击设置行的重置。若人工配置过插件专属覆盖项，卸载后检查并移除该项，保留其他设置；不要清空全部本地存储、缓存或登录数据。

## 安装后验证

在无敏感内容的测试会话里完成一轮回复，保持输入框空白。Tab 应只插入草稿、可撤销且不发送；检查 Esc、清空后的恢复、开关及切换会话。无建议时查看最近状态，检查轮次、附件、菜单、模型、冲突和页面可见性。见 [已知问题](KNOWN_ISSUES.md)。

2026-10-26 已完成本机正式 npm 包安装、重启和手工检查；作者确认没有问题。环境、自动检查及覆盖边界见[验收记录](VALIDATION.md)，实际安装页面见[演示与截图](DEMO.md)。

## 官方依据

- [打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [桌面附带 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)
- [插件管理界面](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.md)

上游链接会更新；安装能力以实际发行版文档为准。
