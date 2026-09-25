import { filters } from "./filters"
import { coreFunctions, springFunctions, springVariables } from "./functions"
import { tags } from "./tags"
import { tests } from "./tests"
import type { SpecEntry, TagSpec } from "./types"

export * from "./filters"
export * from "./functions"
export * from "./misc"
export * from "./operators"
export * from "./tags"
export * from "./tests"
export * from "./types"

export interface CustomEntry {
  name: string
  description?: string
  params?: string[]
}

export interface SpecOptions {
  spring?: boolean
  customFilters?: CustomEntry[]
  customFunctions?: CustomEntry[]
  customTests?: CustomEntry[]
  customTags?: string[]
}

export interface Spec {
  tags: Map<string, TagSpec>
  filters: Map<string, SpecEntry>
  functions: Map<string, SpecEntry>
  tests: Map<string, SpecEntry>
  customTags: Set<string>
  globalVariables: string[]
}

const custom = (kind: SpecEntry["kind"], entries: CustomEntry[] = []): SpecEntry[] =>
  entries.map((e) => ({
    name: e.name,
    kind,
    signature: e.params && e.params.length > 0 ? `${e.name}(${e.params.join(", ")})` : e.name,
    params: (e.params ?? []).map((name) => ({ name })),
    doc: e.description ?? `Custom ${kind} declared in workspace settings.`,
    source: "custom",
  }))

const toMap = <T extends { name: string }>(items: T[]) => new Map(items.map((i) => [i.name, i]))

/** Builds the lookup tables used by every language feature. */
export function buildSpec(options: SpecOptions = {}): Spec {
  const spring = options.spring ?? true
  return {
    tags: toMap(tags),
    filters: toMap([...filters, ...custom("filter", options.customFilters)]),
    functions: toMap([
      ...coreFunctions,
      ...(spring ? springFunctions : []),
      ...custom("function", options.customFunctions),
    ]),
    tests: toMap([...tests, ...custom("test", options.customTests)]),
    customTags: new Set(options.customTags ?? []),
    globalVariables: spring ? springVariables : [],
  }
}
