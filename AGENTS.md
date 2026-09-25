# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`context-limit.ts`) that sets a per-model working context
budget by lowering the model's `limit.context` through a model transform. No
build step, no dependencies, AGPL-3.0-only.

## Local development

```sh
bun test
cp context-limit.ts ~/.config/opencode/plugins/context-limit.ts
touch ~/.config/opencode/plugins/context-limit.ts
```

Check the server log when something is off:

```sh
grep context-limit ~/.local/share/opencode/log/opencode.log | tail
```

## Spike result (T0)

A model transform can lower a model's context window at runtime. A probe set
`deepseek/deepseek-flash` from 1,000,000 to 123,456 through
`ctx.model.transform`, and a re-read showed 123,456. Compaction's default
threshold follows the model's usable input budget, so this is the mechanism. No
config edit is needed.

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free.
- Plugin `console` output is not visible to users. A command surfaces messages
  only by throwing.
- Never post a synthetic message for a notice; it starts a model turn.

## API notes

- `ctx.model.transform((editor) => editor.update(providerID, modelID, (model) => { model.limit = { ...model.limit, context: n } }))`
  lowers a window. Call `ctx.model.reload()` after changing the rules.
- Model entries from `ctx.model.list()` carry `providerID`, `id`, and
  `limit.context`.
- Rules live in `ctx.storage` under `context-limit`.

## Layout

- `parseBudget` - parses tokens, `128K`, `1M`, and `50%`, with clamping.
- `matchPattern`, `longestMatch`, `resolveBudget` - rule matching.
- `applyBudget` - the model transform body, exported for tests.
- `setup` - registers the command and the transform.
- `context-limit.test.ts` - tests with a fake model editor and ctx.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.
