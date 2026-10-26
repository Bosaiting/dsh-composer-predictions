# 通过 Discover 安装 / Install through Discover

本项目的索引源地址：

```text
https://raw.githubusercontent.com/Bosaiting/dsh-composer-predictions/main/market/index.json
```

这是 Bosaiting 维护的独立社区索引，当前收录正式 npm 包 `@bosaiting/dsh-composer-predictions@0.4.3`。DSH 不自带索引源；添加此地址后，当前 profile 的 Discover 才会显示本项目。它不表示官方推荐或已被其他社区市场收录。

## 桌面操作

1. 打开 **插件**，在实验性插件中启用 **自定义插件市场 / Custom plugin indexes**。
2. 进入 **发现 / Discover**，点击当前市场名称，选择 **管理索引源…**。在 **索引 URL** 输入框粘贴上面的完整地址，点击 **添加**。
3. 选择 **Bosaiting 的 DSH 插件**，搜索“下一条消息建议”或 `Composer Predictions`。
4. 点击插件卡片或安装入口，核对完整包名、版本 `0.4.3` 和 npm 注册表 `https://registry.npmjs.org/`。
5. 确认安装、启用，并按提示重启。已安装时，卡片会显示已安装，打开后可查看现有插件。

从本项目旧本地副本升级的用户，先按[迁移说明](INSTALL.md)停用并卸载旧副本，避免重复建议。安装后会自动预测，并可能产生额外模型费用，见[隐私与费用](PRIVACY.md)。

索引源按 profile 保存。其他用户或其他 profile 需要各自添加；不会替换原有索引源。

## English

Enable **Custom plugin indexes** under **Plugins → Experimental plugins**, open **Discover**, and click the current index name. Choose **Manage index sources…**, paste the HTTPS index URL above and select **Add**. Select **Bosaiting DSH plugins**, then find **Composer Predictions**. Before installing, verify the full scoped package name, version and npm registry. Install, enable and restart when requested. An already installed version opens its installed plugin page.

This is a separate community index maintained by Bosaiting. DSH does not ship an index source; publishing this catalog does not add it automatically to other users' profiles or unrelated community catalogs.

## 索引内容与维护

- 格式为 DSH `format: 1`，通过 GitHub Raw 的 HTTPS 地址直接提供 JSON。
- 图标为本项目的原创 SVG，作为小于 32 KiB 的内联图像放入索引，不依赖额外图标请求。
- 版本号、发布时间、DSH 兼容范围来自公开 npm 注册表；安装目标固定为完整的 `包名@版本`。
- 更新器只收录已公开、未弃用且声明 `dsh.bundle` 的版本，不会把本地主分支的未发布版本加入索引。

发布新 npm 版本并确认注册表可查询后运行：

```sh
npm run market:update
npm run check:market
node scripts/market-index.mjs --verify-registry
```

提交 `market/index.json` 与图标变更后，索引 URL 保持不变。维护者更新索引标题或介绍时修改生成脚本，再运行更新器。离线检查包含包名、来源、图标和必要字段；DSH 自身负责完整格式解析及版本兼容判断。

加载失败时，从索引源菜单打开管理页面查看错误，检查是否能访问 GitHub Raw。刷新该索引后重试。`--verify-registry` 需要联网；普通 CI 的 `check:market` 为离线检查。

格式与界面依据：[DSH 插件索引文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)。
