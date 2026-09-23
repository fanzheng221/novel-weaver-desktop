# Desktop source layout

`src/` is organized by responsibility rather than by the history of individual
screens:

- `app/`: bootstrap and shell composition. This is the only layer that mounts
  feature modules into the author-facing application.
- `features/`: author capabilities. Each directory owns the UI, state and
  presentation logic for one capability (`writing`, `planning`, `world`,
  `review`, `publishing`, or `settings`).
- `shared/`: reusable UI primitives, local-RPC adapter, and workspace context
  used by more than one feature. It must not import from `app/` or `features/`.
- `test-fixtures/`: browser-only fixture entries. Their matching HTML files
  remain in `ui-fixtures/` so Playwright URLs stay stable.

All source directories and TypeScript/TSX filenames use lowercase kebab-case.
React export names remain PascalCase, and local variables/functions remain
camelCase. This keeps file paths portable on case-sensitive CI and
case-insensitive developer machines without making TypeScript identifiers less
idiomatic.

Dependencies flow from `app` to `features` and `shared`; features may use
`shared` and their own files. Cross-feature coordination belongs in a focused
shared module only when multiple features genuinely need it.

## Private core boundary

The shell currently imports types and selected runtime functions from `novel-weaver-core`. Its implementation is deliberately absent from the public repository. Maintainer builds attach it to the ignored `packages/novel-weaver-core` workspace directory, verify the pinned source fingerprint and then bundle the local RPC entry with its private dependencies. Public source export uses an explicit allowlist and never includes that directory or generated Tauri resources.
