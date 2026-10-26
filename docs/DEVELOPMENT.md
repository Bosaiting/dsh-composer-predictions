# 开发与验证

需要 Node `^22.19.0 || >=24.0.0` 和 npm；普通桌面用户使用 DSH 自带运行环境。

```sh
npm ci
npx playwright install chromium
npm run check
```

GitHub CI 使用与 Playwright 版本匹配、固定摘要的[官方预装镜像](https://playwright.dev/docs/docker)，镜像包含浏览器与系统依赖；升级 Playwright 时同步更新工作流镜像。普通 Linux 环境可使用 `npx playwright install --with-deps chromium`。锁文件使用公共 HTTPS 包源，不依赖作者本机目录。

在 Intel、Rosetta 与 Apple Silicon Node 之间切换时，不要复用另一架构的 node_modules。出现 esbuild 平台不匹配时，在独立副本中用目标 Node 重新 `npm ci`；不要把该环境问题当作插件运行错误。

| 命令 | 用途 |
| --- | --- |
| `npm run test:syntax` | Host／Client 语法 |
| `npm run test:unit` | 纯逻辑、模拟模型、缓存、HTTP 取消和绑定 |
| `npm run test:browser` | React 实际组件布局、接受、缓存和错误界面 |
| `npm run test:compatibility` | 原生输入法标记、10ms 保护、初始化补取、冲突优先级和超时契约 |
| `npm run test:performance` | 增量冲突观察、可见性、轮次和尺寸观察 |
| `npm run check:release` | 元数据、许可证、文档链接、锁文件与 npm 文件清单 |
| `npm run test:release` | Release 安装包与提交匹配、源码归档、校验值和错误标签拒绝 |
| `npm run test:package` | 打包后生产安装及入口解析 |
| `npm run preview` | 隔离夹具生成静态预览与六步操作 GIF，需要 FFmpeg，无模型请求 |
| `npm run check` | 上述完整检查，不重复生成预览 |
| `npm pack` | 轻量 prepack 后生成 tgz |

自动检查使用模拟模型，不需登录，不读取现有 DSH profile，不产生付费调用。生产安装测试使用系统临时目录，读取 npm 缓存或下载公开依赖，结束后清理。

## 布局

host.js 提供 Config、会话、提示词、LLM、缓存和路由；client.js 可直接交给 DSH ModuleLoader；cordis.patch.yml 插入 bundle 条目。没有 TypeScript 编译，也没有安装期 prepare/postinstall。

tests/browser.html 带原生与主题样式快照；tests/browser-fixture.jsx 模拟会话、设置和模型。见 [第三方声明](../THIRD_PARTY_NOTICES.md)。夹具不是完整 DSH。

## 图片与报告

`npm run preview` 截取夹具内实际组件，生成 `docs/images/preview.png` 和 `docs/images/demo.gif`，并检查隐藏／恢复、Tab 插入与 Esc 忽略的实际组件状态。生成动图还需要 PATH 上的 `ffmpeg`；它不参与安装或 `npm run check`。演示过程不会发送消息或访问现有 DSH 数据。

原生安装截图单独手工采集：进入正式插件详情，收起会话侧栏，确认画面只含公开包名、版本、来源和运行状态后保存。不要公开个人会话、账户、路径、密钥或诊断原文。素材来源与复现说明见 [DEMO.md](DEMO.md)。

`DSHCP_TEST_REPORT` 可输出浏览器指标，`DSHCP_TEST_CLIENT` 可指定对比源码，`DSHCP_PERF_ONLY` 可运行局部布局性能检查；不要提交含个人路径的报告。

## 原生验收

隔离数据目录与合成会话中，检查开关、Tab 插入/撤销、Esc、真实输入法、附件、菜单、会话切换、可见性、主题、其他补全和卸载恢复。stubText 应标记为 UI 验证；真实模型另记路由、模型、推理强度及费用，不把模拟请求耗时当模型延迟。

[历史模型样例](TESTING_HISTORY.md) 不代表当前版本验收，当前限制见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。
