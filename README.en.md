# dsh-composer-predictions

[Repository](https://github.com/Bosaiting/dsh-composer-predictions) · [Issues](https://github.com/Bosaiting/dsh-composer-predictions/issues) · [中文](README.md) · [Installation](docs/INSTALL.md) · [Privacy](docs/PRIVACY.md) · [Known issues](docs/KNOWN_ISSUES.md) · [Demo](docs/DEMO.md) · [Discover](docs/DISCOVER.md)

Predict the next user message in the empty [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) composer. **Tab** inserts an editable draft; **Esc** dismisses the offer for that turn. Acceptance never submits a message.

An independently maintained community plugin, unaffiliated with DeepSeek or OpenAI. The npm package is **`@bosaiting/dsh-composer-predictions`**. The unscoped package belongs to another author.

![Typing hides, clearing restores, Tab inserts a draft, and Esc dismisses](docs/images/demo.gif)

The animation uses the actual plugin component with mocked replies and no model calls. See the [static preview and native desktop installation screenshot](docs/DEMO.md) for asset provenance.

## Features and status

One suggestion per completed turn, regeneration, temporary hiding versus dismissal, session cache, failure diagnostics and retry, bounded context, undoable insertion, and coexistence checks. No new prediction calls while the page is hidden or the feature is disabled.

**Current version: 0.4.3, published on GitHub Releases and npm.** See [GitHub Release](https://github.com/Bosaiting/dsh-composer-predictions/releases/tag/v0.4.3) and the [npm package](https://www.npmjs.com/package/@bosaiting/dsh-composer-predictions) for published assets. Version 0.4.3 fixes native IME guards, deferred initial catch-up, coexistence false positives and the client/host deadline mismatch. The declared DSH range is `>=0.2.1-rc.2 <0.3.0`; the native API/CSS baseline is `0.2.1-rc.2`, not a claim of testing every release. Development needs Node `^22.19.0 || >=24.0.0` and Chromium for browser tests.

On 2026-10-26 the author installed the published npm package, restarted DSH and reported no issues in a manual desktop check on macOS 26.4, DSH 0.2.1-rc.2 and a locally customized Claude-style 0.19.1 theme. Both Node 22/24 tag CI jobs passed. Registry and Release tarballs are byte-identical; a clean DSH registry install/removal also passed. See [known issues](docs/KNOWN_ISSUES.md) and the [validation record](docs/VALIDATION.md) for coverage limits. Detailed maintenance documents are currently in Chinese.

## Install and remove

Desktop: open **Plugins → Add plugin**, enter the package below, verify its name, install and enable, then restart when requested:

```text
@bosaiting/dsh-composer-predictions@0.4.3
```

Web / standalone profiles can install from npm:

```sh
dsh plugin --profile web add @bosaiting/dsh-composer-predictions@0.4.3 --save-exact
```

Disable and remove this project's old local package before installing the scoped package. Configuration IDs and CSS/DOM identifiers are now namespaced to avoid collisions with the unrelated unscoped npm project.

Alternatively, download the [Release tarball](https://github.com/Bosaiting/dsh-composer-predictions/releases/tag/v0.4.3) or build from the release tag:

```sh
git clone --branch v0.4.3 --depth 1 https://github.com/Bosaiting/dsh-composer-predictions.git
cd dsh-composer-predictions
npm pack
```

Desktop: open **Plugins → Add plugin**, enter the absolute path to a trusted release tarball, verify the package name, install and enable. Restart when requested. Disable through General settings; remove through Plugins.

Web, from the directory containing the tarball:

```sh
dsh plugin --profile web add ./bosaiting-dsh-composer-predictions-0.4.3.tgz
# Stop and restart the Web host if needed.
# To uninstall:
dsh plugin --profile web remove @bosaiting/dsh-composer-predictions
```

Replace `web` with the intended profile. Older CLIs reject the managed Desktop profile; compatible Desktop-bundled CLIs can manage it after the app fully quits. Do not edit the desktop dependency graph by hand. See [installation](docs/INSTALL.md).

## Discover

Enable **Custom plugin indexes**, open **Discover**, and add this index source:

```text
https://raw.githubusercontent.com/Bosaiting/dsh-composer-predictions/main/market/index.json
```

Select **Bosaiting DSH plugins** to view this plugin and install a published npm version. The source is saved for the current profile. See [Discover setup](docs/DISCOVER.md).

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
