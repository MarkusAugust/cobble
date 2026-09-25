import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { nodeExpressions, walk, walkExpr } from "../ast"
import { scopeAt } from "../model"
import type { Spec } from "../spec"

export const semanticTokenTypes = [
  "variable",
  "parameter",
  "function",
  "macro",
  "property",
  "keyword",
] as const
export const semanticTokenModifiers = ["declaration", "defaultLibrary", "readonly"] as const

export type SemanticTokenType = (typeof semanticTokenTypes)[number]
export type SemanticTokenModifier = (typeof semanticTokenModifiers)[number]

export interface SemanticToken {
  start: number
  length: number
  type: SemanticTokenType
  modifiers: SemanticTokenModifier[]
}

export interface SemanticOptions {
  /** Names of variables known from outside the template (for example from Java controllers). */
  externalVariables?: Set<string>
}

/**
 * Tokens that TextMate cannot know about: which variables are defined, macro parameters, macro
 * names, and built-in versus custom filters, functions and tests. Sorted by offset.
 */
export function semanticTokens(
  analysis: Analysis,
  spec: Spec,
  options: SemanticOptions = {},
): SemanticToken[] {
  const out: SemanticToken[] = []
  const push = (
    range: ast.Range,
    type: SemanticTokenType,
    modifiers: SemanticTokenModifier[] = [],
  ) => {
    if (range.end > range.start)
      out.push({ start: range.start, length: range.end - range.start, type, modifiers })
  }
  const localMacros = new Set(analysis.model.macros.map((m) => m.name))
  const importedMacros = new Set<string>()
  for (const imp of analysis.model.imports)
    for (const n of imp.names ?? []) importedMacros.add((n.alias ?? n.name).name)

  walk(analysis.ast.body, (node) => {
    if (node.type === "Macro") {
      if (node.name) push(node.name.range, "macro", ["declaration"])
      for (const p of node.params) push(p.name.range, "parameter", ["declaration"])
    } else if (node.type === "For" && node.variable)
      push(node.variable.range, "variable", ["declaration"])
    else if (node.type === "Set" && node.name) push(node.name.range, "variable", ["declaration"])
    else if (node.type === "From") {
      for (const n of node.names) {
        push(n.name.range, "macro")
        if (n.alias) push(n.alias.range, "macro", ["declaration"])
      }
    } else if (node.type === "Import" && node.alias)
      push(node.alias.range, "variable", ["declaration", "readonly"])
    else if (node.type === "FilterBlock") {
      for (const f of node.filters)
        push(
          f.name.range,
          "function",
          spec.filters.get(f.name.name)?.source === "custom"
            ? []
            : spec.filters.has(f.name.name)
              ? ["defaultLibrary"]
              : [],
        )
    }
    for (const expr of nodeExpressions(node)) {
      walkExpr(expr, (e, parent) => {
        switch (e.type) {
          case "Filter":
            push(
              e.name.range,
              "function",
              spec.filters.get(e.name.name)?.source === "custom"
                ? []
                : spec.filters.has(e.name.name)
                  ? ["defaultLibrary"]
                  : [],
            )
            break
          case "Test":
            push(
              e.name.range,
              "function",
              spec.tests.get(e.name.name)?.source === "custom"
                ? []
                : spec.tests.has(e.name.name)
                  ? ["defaultLibrary"]
                  : [],
            )
            break
          case "Call":
            if (e.callee.type === "Variable") {
              const name = e.callee.name
              if (localMacros.has(name) || importedMacros.has(name)) push(e.callee.range, "macro")
              else if (spec.functions.has(name))
                push(
                  e.callee.range,
                  "function",
                  spec.functions.get(name)?.source === "custom" ? [] : ["defaultLibrary"],
                )
            } else if (e.callee.type === "Member" && e.callee.object.type === "Variable") {
              const objectName = e.callee.object.name
              const alias = analysis.model.imports.find(
                (i) => i.kind === "import" && i.alias?.name === objectName,
              )
              if (alias) push(e.callee.property.range, "macro")
            }
            break
          case "Variable": {
            if (parent?.type === "Call" && parent.callee === e) break
            const scope = scopeAt(analysis.ast, analysis.model, e.range.start)
            const v = scope.variables.find((x) => x.name === e.name)
            if (v) {
              const type: SemanticTokenType =
                v.kind === "macro-parameter" ? "parameter" : "variable"
              push(
                e.range,
                type,
                v.kind === "loop" || v.kind === "context" || v.kind === "import-alias"
                  ? ["readonly"]
                  : [],
              )
            } else if (
              spec.globalVariables.includes(e.name) ||
              options.externalVariables?.has(e.name)
            ) {
              push(e.range, "variable", ["readonly"])
            }
            break
          }
          case "Member":
            if (e.object.type === "Variable" && e.object.name === "loop")
              push(e.property.range, "property", ["readonly"])
            break
          default:
            break
        }
      })
    }
  })
  return out.sort((a, b) => a.start - b.start)
}
