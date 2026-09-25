import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import type { Spec, SpecEntry } from "../spec"
import { activeCallAt } from "./context"
import { locate } from "./locate"
import type { SignatureInfo } from "./types"

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end

function info(
  entry: SpecEntry,
  args: ast.Argument[],
  argsRange: ast.Range,
  offset: number,
  text: string,
): SignatureInfo {
  let active = args.findIndex((a) => contains(a.range, offset))
  if (active === -1) {
    // Count commas before the offset inside the argument list
    const inner = text.slice(argsRange.start + 1, Math.min(offset, argsRange.end))
    let depth = 0
    active = 0
    for (const ch of inner) {
      if (ch === "(" || ch === "[" || ch === "{") depth++
      else if (ch === ")" || ch === "]" || ch === "}") depth--
      else if (ch === "," && depth === 0) active++
    }
  } else if (args[active].name) {
    const idx = entry.params.findIndex((p) => p.name === args[active].name?.name)
    if (idx >= 0) active = idx
  }
  const variadicIndex = entry.params.findIndex((p) => p.variadic)
  if (variadicIndex >= 0 && active > variadicIndex) active = variadicIndex
  return {
    label: entry.signature,
    documentation: entry.doc,
    parameters: entry.params.map((p) => ({ label: p.name, documentation: p.doc })),
    activeParameter: Math.min(active, Math.max(entry.params.length - 1, 0)),
  }
}

/** Signature help for the innermost filter, function or macro call whose arguments contain the offset. */
export function signatureHelp(
  analysis: Analysis,
  offset: number,
  spec: Spec,
): SignatureInfo | null {
  const located = locate(analysis.ast, offset)
  const chain = located.exprChain
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i]
    if (
      e.type === "Filter" &&
      e.argsRange &&
      offset > e.argsRange.start &&
      offset < e.argsRange.end
    ) {
      const s = spec.filters.get(e.name.name)
      return s ? info(s, e.args, e.argsRange, offset, analysis.text) : null
    }
    if (e.type === "Call" && offset > e.argsRange.start && offset < e.argsRange.end) {
      if (e.callee.type === "Variable") {
        const s = spec.functions.get(e.callee.name)
        if (s) return info(s, e.args, e.argsRange, offset, analysis.text)
        const macro = analysis.model.macros.find(
          (m) => m.name === (e.callee as ast.VariableExpr).name,
        )
        if (macro) {
          const entry: SpecEntry = {
            name: macro.name,
            kind: "function",
            signature: `${macro.name}(${macro.params.join(", ")})`,
            params: macro.params.map((p) => ({ name: p })),
            doc: "Macro defined in this template.",
            source: "custom",
          }
          return info(entry, e.args, e.argsRange, offset, analysis.text)
        }
      }
      return null
    }
  }
  // Filter block: {% filter date( %}
  if (located.node?.type === "FilterBlock") {
    for (const f of located.node.filters) {
      const s = spec.filters.get(f.name.name)
      if (!s || !f.argsRange) continue
      if (offset > f.argsRange.start && offset < f.argsRange.end) {
        return info(s, f.args, f.argsRange, offset, analysis.text)
      }
    }
  }
  return fallback(analysis, offset, spec)
}

/** Used while a call is still being typed and the parser has no complete node for it. */
function fallback(analysis: Analysis, offset: number, spec: Spec): SignatureInfo | null {
  const call = activeCallAt(analysis, offset)
  if (!call) return null
  let entry: SpecEntry | undefined
  if (call.calleeKind === "filter") entry = spec.filters.get(call.callee)
  else {
    entry = spec.functions.get(call.callee)
    if (!entry) {
      const macro = analysis.model.macros.find((m) => m.name === call.callee)
      if (macro) {
        entry = {
          name: macro.name,
          kind: "function",
          signature: `${macro.name}(${macro.params.join(", ")})`,
          params: macro.params.map((p) => ({ name: p })),
          doc: "Macro defined in this template.",
          source: "custom",
        }
      }
    }
  }
  if (!entry) return null
  let active = call.argIndex
  if (call.namedArg) {
    const idx = entry.params.findIndex((p) => p.name === call.namedArg)
    if (idx >= 0) active = idx
  }
  const variadicIndex = entry.params.findIndex((p) => p.variadic)
  if (variadicIndex >= 0 && active > variadicIndex) active = variadicIndex
  return {
    label: entry.signature,
    documentation: entry.doc,
    parameters: entry.params.map((p) => ({ label: p.name, documentation: p.doc })),
    activeParameter: Math.min(active, Math.max(entry.params.length - 1, 0)),
  }
}
