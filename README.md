# opencode-context-limit

An OpenCode V2 plugin that sets a working context budget and a max output-token
budget per model. Lower the context budget to make compaction fire earlier than
the catalog window, for cost tiers or when a provider serves less than the
catalog claims. Lower the output budget to cap a single reply. A budget never
raises the value.

## OpenCode

This plugin runs on OpenCode. New accounts through my referral link get $5 in
usage credits, and I get $5 too:

https://opencode.ai/go?ref=N9H3ZEP22A

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-context-limit/main/context-limit.ts \
  -o ~/.config/opencode/plugins/context-limit.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode v2.0.3.

To pin a release, replace `main` in the URL with a tag such as `v0.2.0`.

## Use

| Command                            | Effect                                   |
| ---------------------------------- | ---------------------------------------- |
| `/context-limit`                   | Show the context budget for the current model |
| `/context-limit 128K`              | Set it for the current model             |
| `/context-limit 50%`               | Set half the catalog window              |
| `/context-limit opencode-go/* 128K`| Set a context pattern                    |
| `/context-limit <target> 0`        | Clear a context target                   |
| `/output-limit`                    | Show the output budget for the current model |
| `/output-limit 16K`                | Set it for the current model             |
| `/output-limit * 16K`              | Cap output for every model               |
| `/output-limit <target> 0`         | Clear an output target                   |

Values accept plain tokens (`128000`), `128K`, `1M`, and `50%`. Every value is
clamped to the catalog value for that field, so it can only lower the budget,
never raise it.

Patterns match `provider/model`. `opencode-go/*` matches one provider, `*`
matches everything. The longest matching pattern wins.

## How it works

The plugin registers a catalog transform that lowers the matched models'
`limit.context` and/or `limit.output`. Compaction's default threshold follows
the model's usable input budget, so a lower window makes compaction fire
earlier. A change calls `ctx.catalog.reload()` and applies at once. Nothing is
written to `opencode.json`.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's `/context-limit`. See `NOTICE`.

## License

MIT
