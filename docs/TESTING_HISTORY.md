# Historical model samples

These samples concern earlier prompt versions and are not acceptance results for the current release. Current automated checks mock model transport.

# Dogfood log — DSH 0.2.1-rc.2 / DeepSeek-V4.1-Flash

Tested in an isolated `predict-dogfood` profile so prediction calls never
write to the user's Session logs. The profile loaded the local plugin and used
the real provider/model.

## Sessions created for dogfood

These are disposable sessions created by the test driver:

1. `Write a minimal Python function add(a, b) with a docstring. Do not add tests yet.`
2. `用三句话解释为什么 JavaScript 的 sort 比较函数必须返回数字。`
3. `Create a tiny README for a CLI called dsh-demo, with install and usage. Keep it under 20 lines.`

## v1 prompt (promptVersion 1, maxOutputTokens 160)

| case | result |
|---|---|
| Python | `Now add a few tests for it.` |
| JavaScript | `finish-max-tokens` — no usable JSON |
| README | ``It has one command: `dsh-demo run <file>` with a `--watch` flag. Swap those in and drop the placeholders.`` |

Findings:

- 160 output tokens is too small for DeepSeek-V4.1-Flash on some prompts; the
  JSON object is cut before it closes.
- Suggestions are usable but generic ("add a few tests") and sometimes assume
  placeholder text without naming the concrete edit.

## v2 prompt (promptVersion 2; capture still inherited the 160 bundle cap)

The prompt now asks for the next concrete edit/check/decision, forbids
restating or generic offers, and gives one compact example.

| case | result |
|---|---|
| Python | ``Now add a few tests for `add`, including negative numbers and zero.`` |
| JavaScript | ``给一个 `(a,b)=>a<b` 导致顺序错乱的具体数组例子。`` |
| README | raw: ``Actually write the file now and confirm with `wc -l README.md`.`` — model omitted JSON; v2 parser initially abstained |

Findings:

- The v2 prompt itself fit in 160 tokens for all three cases, but 160 is
  still too tight as a default; the bundle default is now 400.
- Suggestions became more concrete and stayed in the user's language.
- The JSON wrapper is not reliable; the parser now accepts a short plain-text
  message while rejecting analysis/fences/malformed JSON. With that fallback
  all three v2 replies are accepted.

## Persisted-session edge

The dogfood profile could open older sessions from storage, but the Host
plugin's `ctx.sessions.get()` only sees **live** sessions. Those older tabs
returned `no-session`. Sessions created in the running profile were live and
predicted normally. This is a test-profile artifact; the desktop app's active
tab is live. Keep it in mind when testing with a second profile.

## Reproduce

```bash
dsh --profile predict-dogfood --from-default-profile web --dump-config
dsh plugin --profile predict-dogfood add file:/path/to/dsh-composer-predictions
dsh --profile predict-dogfood --port 49325 --no-open
```

Then open a completed session and check the ghost. For deterministic UI tests
use `stubText`; for prompt work use the real model with `debug: true`.