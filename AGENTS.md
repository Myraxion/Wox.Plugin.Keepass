# AGENTS.md

Read `CONTEXT.md` for domain vocabulary. Read `docs/adr/` for architectural decisions.

## Issue tracker

GitHub issues via `gh`. See `docs/agents/issue-tracker.md`.

## Triage labels

Default five-role triage labels. See `docs/agents/triage-labels.md`.

## Build & test

- `make install` — install dependencies
- `make build` — lint, format, bundle via ncc+babel to `dist/`
- `make test` — run Jest test suite
- `make package` — produce `wox.plugin.keepass.wox` artifact

## Security invariant

Master passwords and decrypted database objects exist only in process memory. Never write credentials, derived keys, or decoded icon binaries to disk or logs.
