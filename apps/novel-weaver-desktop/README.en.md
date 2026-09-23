# Novel Weaver (Desktop)

[简体中文](README.md) | [English](README.en.md)

> Note: the linked detail documents are Chinese-only for now.

Novel Weaver is a **local-first**, AI-coauthoring desktop app for novelists (macOS Apple Silicon / Windows x64), built for long-form work: worldbuilding, outlining, scene-by-scene drafting, review, and publishing. What sets it apart from other AI writing tools is **author sovereignty** — everything the AI produces is merely *candidate content*; nothing becomes canonical until you explicitly accept it, and only accepted content is treated as established fact by later drafting.

## Core principles

- **The author has the final say**: generate candidates → adjudicate → accept into canon. Four approval gates guard prose, settings, planning, and publishing; the AI never silently rewrites your work.
- **Fact-base-driven consistency**: story facts, character knowledge, strict state (levels / ownership / resources), and story time are modeled explicitly, and the review stage runs deterministic checks instead of asking a model to "remember" the story so far.
- **Local-first**: projects live on your own disk (SQLite + asset folders). The desktop shell talks to a Node/TypeScript core over a local RPC bridge — no cloud service involved. Models are bring-your-own-key (BYOK).

## Feature tour

### Writing desk

Prose is organized by chapters and scenes: a scene tree on the left, the canonical page on the right. Each scene carries its task and narrative purpose, with version history, "continue from this baseline", blank drafts, focus mode, and autosave.

### AI assistant

The assistant is bound to the currently open scene, offering candidate generation, discussion, and prose checks. Quick prompts (continue from cursor, raise tension, three directions…) are one click away, and the context carried into a generation is visible before you commit.

### Candidate adjudication (dual-pane review)

AI candidates never overwrite your prose directly. A three-pane view — *my text / AI candidates / final draft preview* — lets you accept replacement sentence by sentence, or take the whole thing as a new draft. Until you confirm, everything is discardable.

### Planning workspace

Chapter outlines (master summary → volume → chapter → scene), foreshadowing tracking, a timeline, and pacing ranges at a glance. Every AI-planned change arrives as a *pending proposal* and only takes effect once you approve it.

### World settings & relationship graph

The world workspace manages rules, characters, settings, and relationships. Settings are the nails of your world: once established they resist casual change, and revisions go through a proper flow. The relationship graph slices by story time and knowledge scope, showing both objective relationships and directional character attitudes — each with evidence links back to the canonical scenes that support it.

### Review inbox

Consistency checks come in three severities (blocking / warning / advisory), plus AI-flavor detection, narrative-contribution and story-logic findings. Everything awaiting your decision — scene candidates, planning changes, setting revisions, style-distillation proposals — lands in one review inbox.

Selecting an entry shows handling advice and impact notes, or jumps to the owning workspace:

### Publishing

Release check → release edition → confirm final → export (TXT / MD / HTML / EPUB). Publishing creates immutable snapshots; later revisions never rewrite published history. A serial board tracks each chapter's update schedule.

### Style references & style traits

Import a reference novel (TXT) and it is chunked automatically; local statistics plus chapter-by-chapter AI analysis distill style traits and pacing templates. Results arrive as proposals in the review inbox; once accepted they steer generation as style guidance. Reference text is used for analysis only and can never leak into your prose (double safeguard).

### Model access (BYOK)

Protocol-based access, vendor-agnostic: OpenAI Chat Completions / Anthropic Messages / OpenAI Responses, with built-in templates for DeepSeek, Qwen, Kimi, Zhipu GLM, Volcano Ark / Doubao, SiliconFlow, OpenAI, Anthropic, Ollama, and custom relay stations. API keys are stored only in the system keychain; connection tests and usage tracking are built in.

### Optional semantic retrieval

A local extension, off by default: once Ollama is connected (runtime and embedding model can be auto-installed), you can search the book's prose in natural language — e.g. "the scene where someone hands the protagonist a key". Falls back to SQLite keyword search when disabled or stale. See the [semantic retrieval notes](docs/semantic-extension.md) (Chinese).

## Installation

Installers will be provided through GitHub Releases after build verification. No installer has been published for this source snapshot.

## Development

This repository publishes the desktop shell only. The required core implementation is private and is not included. Maintainers must attach the matching private core before installing dependencies or building; see the [repository overview](../../README.md).

```sh
node scripts/attach-private-core.mjs /path/to/private/novel-weaver-core
pnpm install --frozen-lockfile                                          # repo root
pnpm --filter novel-weaver-desktop tauri dev          # desktop dev mode
```

No build step is required for the local core: Tauri launches `local-core/cli.ts` directly through Node's TypeScript support. Set `NOVEL_WEAVER_NODE` to override the Node binary and `NOVEL_WEAVER_CORE_SCRIPT` to override the core entry path.

Common commands:

```sh
pnpm --filter novel-weaver-desktop build              # typecheck + frontend build
pnpm --filter novel-weaver-desktop test:e2e           # end-to-end tests on a real core process
pnpm --filter novel-weaver-desktop test:ui:static     # Tailwind class-name static gate
pnpm --filter novel-weaver-desktop icons:generate     # sync native icons after editing public/app-icon.svg
```

Architectural constraint: the desktop shell never reads SQLite directly — all read models are exposed via the local RPC, provided by `packages/novel-weaver-core` (the Codex plugin is not included).

## More docs (Chinese)

- [BYOK model access](docs/byok.md)
- [Semantic retrieval & distribution](docs/semantic-extension.md)
- [UI testing](docs/ui-testing.md)
