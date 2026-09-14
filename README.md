# opencode-context-limit

An OpenCode V2 plugin that sets a working context budget per model. Lower it to
make compaction fire earlier than the catalog window, for cost tiers or when a
provider serves less than the catalog claims. The budget never raises the
window.

## OpenCode

This plugin runs on OpenCode. Install it with my referral link:

https://opencode.ai/go?ref=N9H3ZEP22A

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-context-limit/main/context-limit.ts \
  -o ~/.config/opencode/plugins/context-limit.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode v2.0.3.

To pin a release, replace `main` in the URL with a tag such as `v0.1.0`.

## Use

| Command                            | Effect                                   |
| ---------------------------------- | ---------------------------------------- |
| `/context-limit`                   | Show the budget for the current model    |
| `/context-limit 128K`              | Set it for the current model             |
| `/context-limit 50%`               | Set half the catalog window              |
| `/context-limit opencode-go/* 128K`| Set a pattern                            |
| `/context-limit <target> 0`        | Clear a target                           |

Values accept plain tokens (`128000`), `128K`, `1M`, and `50%`. Every value is
clamped to the catalog window, so it can only lower the budget, never raise it.

Patterns match `provider/model`. `opencode-go/*` matches one provider, `*`
matches everything. The longest matching pattern wins.

## How it works

The plugin registers a catalog transform that lowers the matched models'
`limit.context`. Compaction's default threshold follows the model's usable input
budget, so compaction fires earlier. A change calls `ctx.catalog.reload()` and
applies at once. Nothing is written to `opencode.json`.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's `/context-limit`. See `NOTICE`.

## License

MIT
