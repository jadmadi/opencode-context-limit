import { describe, expect, test } from "bun:test"
import plugin, { applyBudget, longestMatch, matchPattern, parseBudget, resolveBudget, VERSION } from "./context-limit.ts"

function makeCatalog(models: Array<{ providerID: string; id: string; context: number }>) {
  const entries = models.map((model) => ({
    providerID: model.providerID,
    id: model.id,
    limit: { context: model.context, output: 1000 },
  }))
  const providers = new Map<string, { providerID: string; models: Map<string, any> }>()
  for (const entry of entries) {
    if (!providers.has(entry.providerID)) providers.set(entry.providerID, { providerID: entry.providerID, models: new Map() })
    providers.get(entry.providerID)!.models.set(entry.id, entry)
  }
  const catalog: any = {
    provider: { list: () => [...providers.values()] },
    model: {
      update: (providerID: string, modelID: string, change: (model: any) => void) => {
        const model = providers.get(providerID)?.models.get(modelID)
        if (model) change(model)
      },
    },
    entries,
  }
  return catalog
}

function makeCtx(options: { model?: any; models?: any[] } = {}) {
  const store = new Map<string, unknown>()
  const commands: any[] = []
  const transforms: any[] = []
  let reloads = 0
  const baseModels = (
    options.models ?? [
      { providerID: "opencode-go", id: "deepseek-v4.1-flash", limit: { context: 1_000_000, output: 1000 } },
    ]
  ).map((model) => structuredClone(model))

  // Rebuild the catalog from the registered transforms on every read, the way
  // the runtime replays transforms onto a fresh value.
  const rebuild = () => {
    const entries = structuredClone(baseModels)
    const providers = new Map<string, { providerID: string; models: Map<string, any> }>()
    for (const entry of entries) {
      if (!providers.has(entry.providerID)) providers.set(entry.providerID, { providerID: entry.providerID, models: new Map() })
      providers.get(entry.providerID)!.models.set(entry.id, entry)
    }
    const editor = {
      provider: { list: () => [...providers.values()] },
      model: {
        update: (providerID: string, modelID: string, change: (model: any) => void) => {
          const model = providers.get(providerID)?.models.get(modelID)
          if (model) change(model)
        },
      },
    }
    for (const transform of transforms) transform(editor)
    return entries
  }

  const ctx: any = {
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
    },
    session: {
      get: async () => ({ model: options.model ?? { providerID: "opencode-go", id: "deepseek-v4.1-flash" } }),
    },
    catalog: {
      transform: async (callback: any) => void transforms.push(callback),
      reload: async () => void (reloads += 1),
      model: { list: async () => ({ data: rebuild() }) },
    },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
  }
  return { ctx, store, commands, transforms, reloads: () => reloads }
}

describe("parseBudget", () => {
  test("parses scaled, plain, and percent values", () => {
    expect(parseBudget("128K")).toEqual({ value: 128_000, unit: "tokens" })
    expect(parseBudget("1M")).toEqual({ value: 1_000_000, unit: "tokens" })
    expect(parseBudget("128000")).toEqual({ value: 128_000, unit: "tokens" })
    expect(parseBudget("50%")).toEqual({ value: 50, unit: "percent" })
  })

  test("rejects bad values", () => {
    expect(parseBudget("")).toBeUndefined()
    expect(parseBudget("abc")).toBeUndefined()
    expect(parseBudget("0%")).toBeUndefined()
    expect(parseBudget("101%")).toBeUndefined()
  })
})

describe("matchPattern", () => {
  test("matches exact, prefix, and star", () => {
    expect(matchPattern("a/b", "a/b")).toBe(true)
    expect(matchPattern("opencode-go/*", "opencode-go/x")).toBe(true)
    expect(matchPattern("opencode-go/*", "opencode-go-x/y")).toBe(false)
    expect(matchPattern("*", "anything/at-all")).toBe(true)
    expect(matchPattern("a/b", "a/b/c")).toBe(false)
  })
})

describe("longestMatch and resolveBudget", () => {
  const rules = [
    { pattern: "*", value: 500_000, unit: "tokens" as const },
    { pattern: "opencode-go/*", value: 50, unit: "percent" as const },
    { pattern: "opencode-go/deepseek-v4.1-flash", value: 128_000, unit: "tokens" as const },
  ]

  test("prefers the longest pattern", () => {
    expect(longestMatch(rules, "opencode-go/deepseek-v4.1-flash")?.pattern).toBe("opencode-go/deepseek-v4.1-flash")
    expect(longestMatch(rules, "opencode-go/other")?.pattern).toBe("opencode-go/*")
    expect(longestMatch(rules, "deepseek/x")?.pattern).toBe("*")
    expect(longestMatch(rules, "nope/nope/nope")?.pattern).toBe("*")
    expect(longestMatch([{ pattern: "a/b", value: 1, unit: "tokens" }], "c/d")).toBeUndefined()
  })

  test("resolves a percent against the given window and clamps", () => {
    expect(resolveBudget(rules, "opencode-go/other", 1_000_000)).toBe(500_000)
    expect(resolveBudget(rules, "opencode-go/deepseek-v4.1-flash", 1_000_000)).toBe(128_000)
    expect(resolveBudget(rules, "deepseek/x", 1_000_000)).toBe(500_000)
    expect(resolveBudget([{ pattern: "*", value: 2_000_000, unit: "tokens" }], "a/b", 1_000_000)).toBe(1_000_000)
    expect(resolveBudget([{ pattern: "a/b", value: 1, unit: "tokens" }], "c/d", 1_000_000)).toBeUndefined()
  })
})

describe("applyBudget", () => {
  test("lowers only matched models", () => {
    const catalog = makeCatalog([
      { providerID: "opencode-go", id: "x", context: 1_000_000 },
      { providerID: "deepseek", id: "y", context: 1_000_000 },
    ])
    applyBudget(catalog, [{ pattern: "opencode-go/*", value: 128_000, unit: "tokens" }])
    const byKey = Object.fromEntries(catalog.entries.map((entry: any) => [`${entry.providerID}/${entry.id}`, entry.limit.context]))
    expect(byKey["opencode-go/x"]).toBe(128_000)
    expect(byKey["deepseek/y"]).toBe(1_000_000)
  })

  test("does nothing without rules", () => {
    const catalog = makeCatalog([{ providerID: "a", id: "b", context: 1000 }])
    applyBudget(catalog, [])
    expect(catalog.entries[0].limit.context).toBe(1000)
  })
})

describe("applyBudget output", () => {
  test("lowers only the output limit for matched models", () => {
    const catalog = makeCatalog([
      { providerID: "opencode-go", id: "x", context: 1_000_000 },
      { providerID: "deepseek", id: "y", context: 1_000_000 },
    ])
    applyBudget(catalog, [{ pattern: "opencode-go/*", value: 512, unit: "tokens" }], "output")
    const byKey = Object.fromEntries(
      catalog.entries.map((entry: any) => [`${entry.providerID}/${entry.id}`, entry.limit.output]),
    )
    expect(byKey["opencode-go/x"]).toBe(512)
    expect(byKey["deepseek/y"]).toBe(1000)
  })

  test("clamps an output rule to the catalog output ceiling", () => {
    const catalog = makeCatalog([{ providerID: "a", id: "b", context: 1_000_000 }])
    applyBudget(catalog, [{ pattern: "*", value: 999_999, unit: "tokens" }], "output")
    expect(catalog.entries[0].limit.output).toBe(1000)
  })
})

describe("command", () => {
  const run = (commands: any[], text: string) => commands[0].execute({ sessionID: "ses_1", prompt: { text } })

  test("sets a budget for the current model", async () => {
    const { ctx, store, commands, reloads } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "128K")
    expect(store.get("context-limit")).toEqual([{ pattern: "opencode-go/deepseek-v4.1-flash", value: 128_000, unit: "tokens" }])
    expect(reloads()).toBe(1)
  })

  test("sets a pattern and percent, then clears it", async () => {
    const { ctx, store, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "opencode-go/* 50%")
    expect(store.get("context-limit")).toEqual([{ pattern: "opencode-go/*", value: 50, unit: "percent" }])
    await run(commands, "opencode-go/* 0")
    expect(store.get("context-limit")).toEqual([])
    await run(commands, "opencode-go/* 50%")
    await run(commands, "opencode-go/* 0K")
    expect(store.get("context-limit")).toEqual([])
  })

  test("shows the current model and the rules", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "128K")
    await expect(run(commands, "")).rejects.toThrow(/Effective window: 128000/)
    await expect(run(commands, "")).rejects.toThrow(/Budget: 128000/)
    await expect(run(commands, "")).rejects.toThrow(/opencode-go\/deepseek-v4.1-flash/)
  })

  test("reports a percent rule without applying it twice", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "50%")
    await expect(run(commands, "")).rejects.toThrow(/Effective window: 500000/)
    await expect(run(commands, "")).rejects.toThrow(/Budget: 50%/)
  })

  test("clamps a token rule in the display", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "2M")
    await expect(run(commands, "")).rejects.toThrow(/Effective window: 1000000/)
    await expect(run(commands, "")).rejects.toThrow(/Budget: 1000000/)
  })

  test("rejects a bad value", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await expect(run(commands, "not a value")).rejects.toThrow(/bad value/)
  })
})

describe("output-limit command", () => {
  const run = (commands: any[], text: string) => {
    const command = commands.find((entry: any) => entry.name === "output-limit")
    return command.execute({ sessionID: "ses_1", prompt: { text } })
  }

  test("sets an output budget for the current model", async () => {
    const { ctx, store, commands, reloads } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "16K")
    expect(store.get("output-limit")).toEqual([
      { pattern: "opencode-go/deepseek-v4.1-flash", value: 16_000, unit: "tokens" },
    ])
    expect(reloads()).toBe(1)
  })

  test("keeps output rules separate from context rules", async () => {
    const { ctx, store, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "16K")
    expect(store.get("context-limit")).toBeUndefined()
  })

  test("shows the current model and effective output", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "512")
    await expect(run(commands, "")).rejects.toThrow(/Effective output: 512/)
  })
})

describe("setup", () => {
  test("registers the command and a transform that uses stored rules", async () => {
    const { ctx, store, commands, transforms } = makeCtx()
    await store.set("context-limit", [{ pattern: "opencode-go/*", value: 128_000, unit: "tokens" }])
    await (plugin as any).setup(ctx)
    expect(commands.map((entry) => entry.name)).toEqual(["context-limit", "output-limit"])
    expect(transforms).toHaveLength(1)

    const catalog = makeCatalog([{ providerID: "opencode-go", id: "x", context: 1_000_000 }])
    transforms[0](catalog)
    expect(catalog.entries[0].limit.context).toBe(128_000)
  })
})

describe("version", () => {
  test("VERSION matches package.json", async () => {
    const pkg = (await Bun.file(new URL("./package.json", import.meta.url)).json()) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })
})
