# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`context-limit.ts`) that sets a per-model working context
budget and a max output-token budget by lowering the model's `limit.context` /
`limit.output` through a catalog transform. No build step, no dependencies, MIT.

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

A catalog transform can lower a model's context window at runtime. A probe set
`deepseek/deepseek-flash` from 1,000,000 to 123,456 through
`ctx.catalog.transform`, and a re-read showed 123,456. Compaction's default
threshold follows the model's usable input budget, so this is the mechanism. No
config edit is needed.

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free.
- Plugin `console` output is not visible to users. A command surfaces messages
  only by throwing.
- Never post a synthetic message for a notice; it starts a model turn.

## API notes

- `ctx.catalog.transform((catalog) => catalog.model.update(providerID, modelID, (model) => { model.limit = { ...model.limit, [field]: n } }))`
  lowers a window. Call `ctx.catalog.reload()` after changing the rules.
- Model entries from `ctx.catalog.model.list()` carry `providerID`, `id`, and
  `limit.context` / `limit.output`.
- Rules live in `ctx.storage` under `context-limit` and `output-limit`.

## Layout

- `parseBudget` - parses tokens, `128K`, `1M`, and `50%`, with clamping.
- `matchPattern`, `longestMatch`, `resolveBudget` - rule matching.
- `applyBudget` - the catalog transform body (`kind` selects `context` vs
  `output`), exported for tests.
- `makeCommand` - builds `/context-limit` and `/output-limit` from one template.
- `setup` - registers both commands and the transform.
- `context-limit.test.ts` - tests with a fake catalog and ctx.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.
