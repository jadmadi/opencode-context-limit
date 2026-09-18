---
feature: context-limit
status: delivered
updated: 2026-09-12
branch: feat/context-limit
commits: 5e865ff..4647039
---

# Context Limit

## Report

**T0 spike result** - The mechanism is a model transform:

```ts
ctx.model.transform((editor) =>
  editor.update(providerID, modelID, (model) => {
    model.limit = { ...model.limit, context: n }
  }),
)
```

A probe lowered `deepseek/deepseek-flash` from 1,000,000 to 123,456, and a
re-read showed 123,456. Compaction's default threshold follows the model's
usable input budget, so this is the mechanism, and no config edit is needed.

**What was built** - A single-file OpenCode V2 plugin that sets a working
context budget per model. `/context-limit` shows the budget, `/context-limit
128K` or `50%` sets it for the current model, `/context-limit <pattern>
<value>` sets a rule, and `0` clears. Rules live in storage. A model transform
lowers the matched models' `limit.context`, and a change calls
`ctx.model.reload()`. Budgets clamp to the catalog window and never raise it.

**Verification** - `bun test`: 14 pass, 0 fail, 42 assertions. Live: `128K`
lowered the effective window to 128000; `50%` reported window 500000 with
Budget 50%; `0K` cleared and restored 1000000. Two review rounds covered two
blocking items plus a medium and lows; all are resolved.

**Journey log**

1. The spike proved the mechanism: a model transform lowered
   `deepseek/deepseek-flash` from 1,000,000 to 123,456, so no config edit was
   needed.
2. The show path re-resolved a percent rule against the already-lowered window,
   so a 50% rule printed Budget 250000. It now reports the stored rule, and a
   token rule above the window prints the clamped number.
3. The show test used a fixed model list, which hid that bug. The fake now rebuilds
   the list from the registered transforms, the way the runtime replays them.

## [S1] Problem

Model catalog windows are optimistic. A provider can serve less than the catalog
claims, and the request fails once it crosses the real cap. We hit exactly this
with `opencode-go/deepseek-v4-flash`, where a large request returned a bare HTTP
400. Compaction only fires near the advertised window, so it fires too late.
MiMoCode's `/context-limit` sets a smaller working budget per model.

## [S2] Design

A command views and sets a working budget per model, and the budget feeds
compaction.

- `/context-limit` prints the resolved budget for the current model.
  `/context-limit 128K` sets it. `/context-limit 50%` sets half the catalog
  window. `/context-limit 0` clears it.
- Values clamp to the catalog window and never raise it.
- Storage is a map from a model pattern to a budget. Patterns accept a wildcard,
  such as `opencode-go/*` or `*`, and the longest matching pattern wins. The map
  lives in `opencode.json` under `compaction.max_context` when the config
  supports it, otherwise in plugin storage.
- A spike task decides where the budget can take effect: a model transform on
  the model limit, or the config compaction threshold. The chosen path is
  recorded in the spec before the command is built.

## [S3] Out of Scope

- Measuring a provider's real cap automatically.
- Per-agent budgets.
- A TUI settings screen.

## Tasks

- [x] T0: spike where a budget takes effect - acceptance: the spec records the
      working mechanism and the exact config or transform field, or states that
      neither works and proposes a fallback (covers: S2)
- [x] T1: resolve and store patterns, with percent and unit parsing - acceptance:
      tests cover `128K`, `50%`, wildcard precedence, and clamping (covers: S2;
      depends: T0)
- [x] T2: the /context-limit command - acceptance: print, set, and clear each
      round-trip in a test (covers: S2; depends: T1)
- [x] T3: apply the budget to compaction - acceptance: a test confirms the
      resolved budget reaches the chosen mechanism (covers: S2; depends: T1)
- [x] T4: README and NOTICE - acceptance: both files exist and name the MiMoCode
      context-limit feature (covers: S2; depends: T3)
