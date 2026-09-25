import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { nodeExpressions, walk, walkExpr } from "../ast"
import type { Diagnostic, DiagnosticSeverity } from "../diagnostics-codes"
import type { Spec } from "../spec"

export type Level = "error" | "warning" | "information" | "off"

export interface DiagnosticSettings {
  unknownFilter: Level
  unknownFunction: Level
  unknownTest: Level
  missingTemplate: Level
}

export const defaultDiagnosticSettings: DiagnosticSettings = {
  unknownFilter: "warning",
  unknownFunction: "off",
  unknownTest: "warning",
  missingTemplate: "warning",
}

export interface DiagnosticOptions {
  settings?: Partial<DiagnosticSettings>
  /** `true` = found, `false` = not found, `undefined` = unknown/not checked. */
  templateExists?: (name: string) => boolean | undefined
}

const severity = (level: Level): DiagnosticSeverity => (level === "off" ? "hint" : level)

/** Syntax diagnostics plus semantic checks against the spec. */
export function diagnostics(
  analysis: Analysis,
  spec: Spec,
  options: DiagnosticOptions = {},
): Diagnostic[] {
  const settings = { ...defaultDiagnosticSettings, ...options.settings }
  const out: Diagnostic[] = [...analysis.syntaxDiagnostics]
  const push = (code: Diagnostic["code"], message: string, range: ast.Range, level: Level) => {
    if (level === "off") return
    out.push({ code, message, start: range.start, end: range.end, severity: severity(level) })
  }
  const localMacros = new Set(analysis.model.macros.map((m) => m.name))
  for (const imp of analysis.model.imports)
    for (const n of imp.names ?? []) localMacros.add((n.alias ?? n.name).name)

  walk(analysis.ast.body, (node, parents) => {
    const inFor = parents.some((p) => p.type === "For")
    const inBlock = parents.some((p) => p.type === "Block")
    const macroParams = new Set(
      parents
        .filter((p): p is ast.MacroStatement => p.type === "Macro")
        .flatMap((m) => m.params.map((p) => p.name.name)),
    )
    if (node.type === "FilterBlock") {
      for (const f of node.filters) {
        if (!spec.filters.has(f.name.name))
          push("W001", `Unknown filter '${f.name.name}'`, f.name.range, settings.unknownFilter)
      }
    }
    for (const expr of nodeExpressions(node)) {
      walkExpr(expr, (e) => {
        if (e.type === "Filter" && !spec.filters.has(e.name.name))
          push("W001", `Unknown filter '${e.name.name}'`, e.name.range, settings.unknownFilter)
        if (e.type === "Test" && !spec.tests.has(e.name.name))
          push("W002", `Unknown test '${e.name.name}'`, e.name.range, settings.unknownTest)
        if (e.type === "Call" && e.callee.type === "Variable") {
          const name = e.callee.name
          if (name === "parent" && !inBlock)
            push("W007", "parent() is only valid inside a block", e.callee.range, "warning")
          else if (!spec.functions.has(name) && !localMacros.has(name) && !macroParams.has(name)) {
            push("W003", `Unknown function '${name}'`, e.callee.range, settings.unknownFunction)
          }
        }
        if (e.type === "Variable" && e.name === "loop" && !inFor)
          push("W004", "'loop' is only defined inside a for loop", e.range, "warning")
      })
    }
  })
  if (options.templateExists) {
    for (const ref of analysis.model.references) {
      if (ref.literalName && options.templateExists(ref.literalName) === false) {
        push("W006", `Template '${ref.literalName}' not found`, ref.range, settings.missingTemplate)
      }
    }
  }
  return out
}
