// OpenCode V2 context-limit plugin.
//
// Sets a working context budget per model by lowering the model's
// `limit.context` through a model transform. Compaction's default threshold
// follows the model's usable input budget, so a lower window makes compaction
// fire earlier. A budget can only lower a window, never raise it.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

const VERSION = "0.1.3"

type Unit = "tokens" | "percent"

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

function budgetFor(rule: Rule, catalogContext: number): number {
  const raw = rule.unit === "percent" ? Math.floor((catalogContext * rule.value) / 100) : rule.value
  return Math.max(1, Math.min(raw, catalogContext))
}

function resolveBudget(rules: Rule[], key: string, catalogContext: number): number | undefined {
  const rule = longestMatch(rules, key)
  return rule ? budgetFor(rule, catalogContext) : undefined
}

// The model transform body. `editor` is a model editor: it exposes
// list() and update(providerID, modelID, change).
function applyBudget(editor: any, rules: Rule[]): void {
  if (rules.length === 0) return
  for (const model of editor.list()) {
    const key = `${model.providerID}/${model.id}`
    const budget = resolveBudget(rules, key, model.limit.context)
    if (budget === undefined) continue
    editor.update(model.providerID, model.id, (entry: any) => {
      entry.limit = { ...entry.limit, context: budget }
    })
  }
}

async function loadRules(ctx: any): Promise<Rule[]> {
  const stored = await ctx.storage.get("context-limit")
  return Array.isArray(stored) ? (stored as Rule[]) : []
}

async function saveRules(ctx: any, rules: Rule[]): Promise<void> {
  await ctx.storage.set("context-limit", rules)
}

async function modelContext(ctx: any, key: string): Promise<number | undefined> {
  const result = await ctx.model.list()
  const data: any[] = Array.isArray(result) ? result : (result?.data ?? [])
  const found = data.find((model) => `${model.providerID}/${model.id}` === key)
  return found?.limit?.context
}

function describeRules(rules: Rule[]): string {
  if (rules.length === 0) return "No rules."
  return rules
    .map((rule) => `${rule.pattern} -> ${rule.unit === "percent" ? `${rule.value}%` : rule.value}`)
    .join("\n")
}

const plugin = {
  id: "context-limit",
  async setup(ctx: any) {
    let rules = await loadRules(ctx)

    await ctx.model.transform((editor: any) => applyBudget(editor, rules))

    await ctx.command.transform((editor: any) => {
      editor.add({
        name: "context-limit",
        description: "Show or set a working context budget per model",
        execute: async ({ sessionID, prompt }: any) => {
          const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""

          if (!text) {
            const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
            const model = info?.model ?? info?.data?.model
            const key = model ? `${model.providerID}/${model.id}` : undefined
            const context = key ? await modelContext(ctx, key) : undefined
            const rule = key ? longestMatch(rules, key) : undefined
            const budget = rule
              ? rule.unit === "percent"
                ? `${rule.value}%`
                : String(Math.min(rule.value, context ?? rule.value))
              : "none"
            throw new Error(
              [
                key ? `Model: ${key}` : "Model: unknown",
                `Effective window: ${context ?? "unknown"}`,
                `Budget: ${budget}`,
                "",
                describeRules(rules),
                `context-limit ${VERSION}`,
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
            rules = rules.filter((rule) => rule.pattern !== pattern)
            await saveRules(ctx, rules)
            await ctx.model.reload()
            return
          }
          if (!parsed || (parsed.unit === "tokens" && parsed.value <= 0)) {
            throw new Error(`bad value "${valueText}"; use 128000, 128K, 1M, or 50% (0 clears)`)
          }
          rules = rules.filter((rule) => rule.pattern !== pattern)
          rules.push({ pattern, value: parsed.value, unit: parsed.unit })
          await saveRules(ctx, rules)
          await ctx.model.reload()
        },
      })
    })
  },
}

export { applyBudget, budgetFor, longestMatch, matchPattern, parseBudget, resolveBudget, VERSION }
export default plugin
