# 配置

日常开关在设置 → 通用。高级选项放在目标 profile 的 `cordis.patch.yml`。覆盖已有条目时使用同一 ID，无需插入第二个实例：

```yaml
- id: bosaiting-composer-predictions
  config:
    enabled: true
    provider: ''
    model: ''
    reasoningEffort: ''
    contextMode: clean
    maxContextMessages: 12
    maxMessageChars: 4000
    maxTotalChars: 16000
    maxPrefixChars: 24000
    maxSuggestionChars: 300
    maxOutputTokens: 400
    temperature: -1
    maxConcurrent: 2
    timeoutMs: 8000
    stubText: ''
    debug: false
```

DSH 的后续补丁层按条目覆盖整个 config，不做字段深合并；缺项由 schema/defaults 补齐。高级项修改后按应用提示重载或重启。

| 字段 | 含义 |
| --- | --- |
| `enabled` | 自动预测开关，唯一 volatile 字段 |
| `provider`／`model` | 空值继承会话；覆盖必须使用部署中有效路由／模型 |
| `reasoningEffort` | 空值继承；覆盖值须被所选模型支持 |
| `contextMode` | `clean` 为预算内文字；`cache`／`prefix` 尝试原始消息前缀 |
| `maxContextMessages` | 精简模式消息数，2–40 |
| `maxMessageChars` | 每条精简消息字符预算，200–20000 |
| `maxTotalChars` | 精简模式总字符预算，2000–200000 |
| `maxPrefixChars` | 原始前缀文字预算，2000–200000；超出回退精简 |
| `maxSuggestionChars` | 建议正文上限，80–1000；最多预览三行 |
| `maxOutputTokens` | 输出上限，32–4096，不是总费用上限 |
| `temperature` | `-1` 不传该字段，使用适配器默认 |
| `maxConcurrent` | Host 并发上限，1–8 |
| `timeoutMs` | Host 允许 1000–60000ms；客户端使用 Host 响应头中的有效预算另加 5000ms 传输余量 |
| `stubText` | 非空直接返回测试文字，不调用模型 |
| `debug` | 原始回复可能进入日志／响应，不适合私人会话 |

在独立测试环境将 stubText 改成 `请补充一个边界情况的例子。` 可检查界面。体验后清空，否则每次都返回固定文字。数据与费用见 [PRIVACY.md](PRIVACY.md)，限制见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。

Host 在等待模型前通过 `x-bscp-timeout-ms` 响应头发布归一化预算。前端从请求开始计时；尚未收到或缺少有效响应头时，使用最大 60000ms 加 5000ms 的安全上限。此截止时间同时覆盖响应正文等待，不只覆盖 fetch 返回响应头。
