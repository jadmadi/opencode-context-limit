---
feature: context-limit
status: in-progress
updated: 2026-09-12
branch: feat/context-limit
commits:
---

# Context Limit

## Report

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
- A spike task decides where the budget can take effect: a catalog transform on
  the model limit, or the config compaction threshold. The chosen path is
  recorded in the spec before the command is built.

## [S3] Out of Scope

- Measuring a provider's real cap automatically.
- Per-agent budgets.
- A TUI settings screen.

## Tasks

- [ ] T0: spike where a budget takes effect - acceptance: the spec records the
      working mechanism and the exact config or transform field, or states that
      neither works and proposes a fallback (covers: S2)
- [ ] T1: resolve and store patterns, with percent and unit parsing - acceptance:
      tests cover `128K`, `50%`, wildcard precedence, and clamping (covers: S2;
      depends: T0)
- [ ] T2: the /context-limit command - acceptance: print, set, and clear each
      round-trip in a test (covers: S2; depends: T1)
- [ ] T3: apply the budget to compaction - acceptance: a test confirms the
      resolved budget reaches the chosen mechanism (covers: S2; depends: T1)
- [ ] T4: README and NOTICE - acceptance: both files exist and name the MiMoCode
      context-limit feature (covers: S2; depends: T3)
