// OpenCode V2 context-limit / output-limit plugin.
//
// Sets a working context budget AND a max output-token budget per model by
// lowering the model's `limit.context` / `limit.output` through a catalog
// transform. Compaction's default threshold follows the model's usable input
// budget, so a lower context window makes compaction fire earlier. A budget
// only ever lowers a value, never raises it.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

const VERSION = "0.2.0"

type Unit = "tokens" | "percent"
type LimitKind = "context" | "output"

interface Rule {
  pattern: string
  value: number
  unit: Unit
}

function parseBudget(text: string): { value: number; unit: Unit } | undefined {
  const trimmed = text.trim()
  const percent = /^(\d+)%$/.exec(trimmed)
  if (percent) {
    const value = Number(percent[1])
    return value > 0 && value <= 100 ? { value, unit: "percent" } : undefined
  }
  const scaled = /^(\d+)([kKmM])$/.exec(trimmed)
  if (scaled) {
    const unit = scaled[2].toLowerCase() === "k" ? 1000 : 1_000_000
    return { value: Number(scaled[1]) * unit, unit: "tokens" }
  }
  const plain = /^(\d+)$/.exec(trimmed)
  if (plain) return { value: Number(plain[1]), unit: "tokens" }
  return undefined
}

function matchPattern(pattern: string, key: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("/*")) return key.startsWith(pattern.slice(0, -1))
  return pattern === key
}

function longestMatch(rules: Rule[], key: string): Rule | undefined {
  let best: Rule | undefined
  for (const rule of rules) {
    if (!matchPattern(rule.pattern, key)) continue
    if (!best || rule.pattern.length > best.pattern.length) best = rule
  }
  return best
}

function budgetFor(rule: Rule, catalogCeiling: number): number {
  const raw = rule.unit === "percent" ? Math.floor((catalogCeiling * rule.value) / 100) : rule.value
  return Math.max(1, Math.min(raw, catalogCeiling))
}

function resolveBudget(rules: Rule[], key: string, catalogCeiling: number): number | undefined {
  const rule = longestMatch(rules, key)
  return rule ? budgetFor(rule, catalogCeiling) : undefined
}

// The catalog transform body. `catalog` is a catalog editor: it exposes
// provider.list() and model.update(providerID, modelID, change). `kind` picks
// which `limit` field is lowered (context vs output).
function applyBudget(catalog: any, rules: Rule[], kind: LimitKind = "context"): void {
  if (rules.length === 0) return
  for (const record of catalog.provider.list()) {
    for (const model of record.models.values()) {
      const ceiling = model.limit?.[kind]
      if (typeof ceiling !== "number") continue
      const key = `${model.providerID}/${model.id}`
      const budget = resolveBudget(rules, key, ceiling)
      if (budget === undefined) continue
      catalog.model.update(model.providerID, model.id, (entry: any) => {
        entry.limit = { ...entry.limit, [kind]: budget }
      })
    }
  }
}

async function loadRules(ctx: any, storageKey: string): Promise<Rule[]> {
  const stored = await ctx.storage.get(storageKey)
  return Array.isArray(stored) ? (stored as Rule[]) : []
}

async function saveRules(ctx: any, storageKey: string, rules: Rule[]): Promise<void> {
  await ctx.storage.set(storageKey, rules)
}

async function modelLimit(ctx: any, key: string, kind: LimitKind): Promise<number | undefined> {
  const result = await ctx.catalog.model.list()
  const data: any[] = Array.isArray(result) ? result : (result?.data ?? [])
  const found = data.find((model) => `${model.providerID}/${model.id}` === key)
  return found?.limit?.[kind]
}

function describeRules(rules: Rule[]): string {
  if (rules.length === 0) return "No rules."
  return rules
    .map((rule) => `${rule.pattern} -> ${rule.unit === "percent" ? `${rule.value}%` : rule.value}`)
    .join("\n")
}

interface CommandOptions {
  kind: LimitKind
  name: string
  storageKey: string
  fieldLabel: "window" | "output"
  description: string
}

// Builds a `/context-limit` or `/output-limit` command. `state` is shared with
// the catalog transform so rule edits apply on the next `catalog.reload()`.
function makeCommand(ctx: any, state: { context: Rule[]; output: Rule[] }, opts: CommandOptions) {
  const { kind, name, storageKey, fieldLabel, description } = opts
  return {
    name,
    description,
    execute: async ({ sessionID, prompt }: any) => {
      const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""

      if (!text) {
        const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
        const model = info?.model ?? info?.data?.model
        const key = model ? `${model.providerID}/${model.id}` : undefined
        const current = key ? await modelLimit(ctx, key, kind) : undefined
        const rule = key ? longestMatch(state[kind], key) : undefined
        const budget = rule
          ? rule.unit === "percent"
            ? `${rule.value}%`
            : String(Math.min(rule.value, current ?? rule.value))
          : "none"
        throw new Error(
          [
            key ? `Model: ${key}` : "Model: unknown",
            `${fieldLabel === "window" ? "Effective window" : "Effective output"}: ${current ?? "unknown"}`,
            `Budget: ${budget}`,
            "",
            describeRules(state[kind]),
            `${name} ${VERSION}`,
          ].join("\n"),
        )
      }

      const parts = text.split(/\s+/)
      let pattern: string
      let valueText: string
      if (parts.length === 1) {
        const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
        const model = info?.model ?? info?.data?.model
        if (!model) throw new Error("could not resolve the current model")
        pattern = `${model.providerID}/${model.id}`
        valueText = parts[0]
      } else {
        const target = parts[0]
        valueText = parts.slice(1).join(" ")
        if (target === "current") {
          const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
          const model = info?.model ?? info?.data?.model
          if (!model) throw new Error("could not resolve the current model")
          pattern = `${model.providerID}/${model.id}`
        } else {
          pattern = target
        }
      }

      const parsed = parseBudget(valueText)
      const clears = valueText === "0" || (parsed?.unit === "tokens" && parsed.value === 0)
      if (clears) {
        state[kind] = state[kind].filter((rule) => rule.pattern !== pattern)
        await saveRules(ctx, storageKey, state[kind])
        await ctx.catalog.reload()
        return
      }
      if (!parsed || (parsed.unit === "tokens" && parsed.value <= 0)) {
        throw new Error(`bad value "${valueText}"; use 128000, 128K, 1M, or 50% (0 clears)`)
      }
      state[kind] = state[kind].filter((rule) => rule.pattern !== pattern)
      state[kind].push({ pattern, value: parsed.value, unit: parsed.unit })
      await saveRules(ctx, storageKey, state[kind])
      await ctx.catalog.reload()
    },
  }
}

const plugin = {
  id: "context-limit",
  async setup(ctx: any) {
    const state = {
      context: await loadRules(ctx, "context-limit"),
      output: await loadRules(ctx, "output-limit"),
    }

    await ctx.catalog.transform((catalog: any) => {
      applyBudget(catalog, state.context, "context")
      applyBudget(catalog, state.output, "output")
    })

    await ctx.command.transform((editor: any) => {
      editor.add(
        makeCommand(ctx, state, {
          kind: "context",
          name: "context-limit",
          storageKey: "context-limit",
          fieldLabel: "window",
          description: "Show or set a working context budget per model",
        }),
      )
      editor.add(
        makeCommand(ctx, state, {
          kind: "output",
          name: "output-limit",
          storageKey: "output-limit",
          fieldLabel: "output",
          description: "Show or set a max output token budget per model",
        }),
      )
    })
  },
}

export { applyBudget, budgetFor, longestMatch, matchPattern, parseBudget, resolveBudget, VERSION }
export default plugin