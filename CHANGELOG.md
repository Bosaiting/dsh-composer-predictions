# Changelog

## 0.4.3 — 2026-10-26

- Publish as `@bosaiting/dsh-composer-predictions`; isolate module, configuration, styling and transport identifiers from the unrelated unscoped npm package.
- Add a tag-triggered GitHub Release job that depends on both CI versions and verifies archive/commit identity.
- Scope IME state to the owning composer, synchronously check native composition markers and preserve DSH's 10 ms handoff guard for keyboard and button acceptance.
- Retain catch-up intent until a request actually starts; resume after temporary guards clear without retrying a completed failure automatically.
- Let explicit peer ghost priority override slot-name fallback; stop treating generic hint/completion/predict/suggest UI names as conflicts. Coalesce registry and DOM updates.
- Publish the Host's effective timeout before model completion; the client allows that budget plus 5 seconds, with a 65-second fallback while headers are unavailable.
- Add focused browser and real HTTP regressions for these behaviors. Keep model routing and context budgets unchanged.

## 0.4.2 — Public-release preparation (not published)

- Prepare portable source and installation archives; Host/Client runtime behavior unchanged.
- Move compatibility metadata to top-level `engines.dsh`; declare Node range and MIT license.
- Replace personal screenshots and local paths with mocked previews and portable instructions.
- Document model costs, data flow, known issues and validation boundaries.
- Keep full checks in CI and `prepublishOnly`; make `prepack` dependency-free.
- Add production package installation checks and preserve third-party CSS notices.

## 0.4.1

- Select recent eligible messages before truncating and stop at context budgets.
- Incremental conflict discovery; pause fallback observation while disabled/hidden.
- Memoize native turn stamps and coalesce resize work.
- Defer hidden-page predictions and validate the latest turn on return.

## 0.4.0

- Temporary hiding versus Escape dismissal; session offer cache.
- Sanitized failure reasons, explicit retry and head/tail context truncation.
- Coexistence checks and automated release validation.

## Earlier versions

Initial host/client prediction, settings, context modes, cancellation, undoable insertion and layout hardening. [Historical model samples](docs/TESTING_HISTORY.md) concern older versions and are not current acceptance results.
