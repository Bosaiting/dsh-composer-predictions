# dsh-composer-predictions

[Repository](https://github.com/Bosaiting/dsh-composer-predictions) · [Issues](https://github.com/Bosaiting/dsh-composer-predictions/issues) · [中文](README.md) · [Installation](docs/INSTALL.md) · [Privacy](docs/PRIVACY.md) · [Known issues](docs/KNOWN_ISSUES.md)

Predict the next user message in the empty [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) composer. **Tab** inserts an editable draft; **Esc** dismisses the offer for that turn. Acceptance never submits a message.

An independently maintained community plugin, unaffiliated with DeepSeek or OpenAI. Verify the plural package name, **dsh-composer-predictions**.

![Actual component rendered in an isolated mocked fixture](docs/images/preview.png)

This uses the real client component and mocked replies, without personal workspaces, sessions or accounts. It is not a full native desktop screenshot.

## Features and status

One suggestion per completed turn, regeneration, temporary hiding versus dismissal, session cache, failure diagnostics and retry, bounded context, undoable insertion, and coexistence checks. No new prediction calls while the page is hidden or the feature is disabled.

**0.4.3 source candidate; not published to npm or as a GitHub Release.** Version 0.4.3 fixes native IME guards, deferred initial catch-up, coexistence false positives and the client/host deadline mismatch. The declared DSH range is `>=0.2.1-rc.2 <0.3.0`; the native API/CSS baseline is `0.2.1-rc.2`, not a claim of testing every release. Development needs Node `^22.19.0 || >=24.0.0` and Chromium for browser tests.

Read [known issues](docs/KNOWN_ISSUES.md), including remaining validation and interoperability limits, and the [validation record](docs/VALIDATION.md). Fixture tests do not establish native desktop acceptance. Detailed maintenance documents are currently in Chinese.

## Install and remove

Build a tarball from source:

```sh
git clone https://github.com/Bosaiting/dsh-composer-predictions.git
cd dsh-composer-predictions
npm pack
```

Desktop: open **Plugins → Add plugin**, enter the absolute path to a trusted release tarball, verify the package name, install and enable. Restart when requested. Disable through General settings; remove through Plugins.

Web, from the directory containing the tarball:

```sh
dsh plugin --profile web add ./dsh-composer-predictions-0.4.3.tgz
# Stop and restart the Web host if needed.
# To uninstall:
dsh plugin --profile web remove dsh-composer-predictions
```

Replace `web` with the intended profile. Older CLIs reject the managed Desktop profile; compatible Desktop-bundled CLIs can manage it after the app fully quits. Do not edit the desktop dependency graph by hand. See [installation](docs/INSTALL.md).

## Model calls and privacy

Enabling automatically makes **additional model calls**, inheriting the session provider, model and reasoning effort unless overridden. It does not automatically choose a cheaper model. The selected provider receives prediction context; there is no separate plugin telemetry service.

Prediction calls are not written to session events or their token-usage ledger, but providers may charge or consume subscription quota. Offers and diagnostics are in memory; only aggregate usage counts persist in localStorage. Debug mode can expose raw model output in logs and responses. See [privacy](docs/PRIVACY.md).

## Develop

```sh
npm ci
npx playwright install chromium
npm run check
npm pack
```

`check` runs the full suite; `pack` performs lightweight runtime-file validation without browsers or development dependencies. Production dependency installation may need network access. See [configuration](docs/CONFIGURATION.md), [development](docs/DEVELOPMENT.md), [release instructions](docs/RELEASING.md) and [contributing](CONTRIBUTING.md).

[MIT](LICENSE). Fixture CSS provenance and dependency licenses: [third-party notices](THIRD_PARTY_NOTICES.md).
