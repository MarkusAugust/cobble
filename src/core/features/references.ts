import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { nodeExpressions, walk, walkExpr } from "../ast"
import { scopeAt } from "../model"
import { locate } from "./locate"

export type Symbol =
  | { kind: "block"; name: string; range: ast.Range }
  | {
      kind: "macro"
      name: string
      range: ast.Range /** template the macro is imported from, when not local */
      template?: string /** the local alias used for an imported macro */
      alias?: string
    }
  | { kind: "variable"; name: string; range: ast.Range; definition: ast.Range }

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end

/** The renameable/referenceable symbol at the offset, or null. */
export function symbolAt(analysis: Analysis, offset: number): Symbol | null {
  const { model } = analysis
  const located = locate(analysis.ast, offset)
  const node = located.node
  if (node?.type === "Block") {
    if (node.name && contains(node.name.range, offset))
      return { kind: "block", name: node.name.name, range: node.name.range }
    if (node.endName && contains(node.endName.range, offset))
      return { kind: "block", name: node.endName.name, range: node.endName.range }
  }
  if (node?.type === "Macro" && node.name && contains(node.name.range, offset)) {
    return { kind: "macro", name: node.name.name, range: node.name.range }
  }
  if (node?.type === "Macro") {
    for (const p of node.params) {
      if (contains(p.name.range, offset))
        return {
          kind: "variable",
          name: p.name.name,
          range: p.name.range,
          definition: p.name.range,
        }
    }
  }
  if (node?.type === "For" && node.variable && contains(node.variable.range, offset)) {
    return {
      kind: "variable",
      name: node.variable.name,
      range: node.variable.range,
      definition: node.variable.range,
    }
  }
  if (node?.type === "Set" && node.name && contains(node.name.range, offset)) {
    return {
      kind: "variable",
      name: node.name.name,
      range: node.name.range,
      definition: node.name.range,
    }
  }
  if (node?.type === "From") {
    for (const n of node.names) {
      if (contains(n.name.range, offset) && node.template?.type === "String")
        return {
          kind: "macro",
          name: n.name.name,
          range: n.name.range,
          template: node.template.value,
          alias: (n.alias ?? n.name).name,
        }
      if (n.alias && contains(n.alias.range, offset))
        return {
          kind: "variable",
          name: n.alias.name,
          range: n.alias.range,
          definition: n.alias.range,
        }
    }
  }
  const chain = located.exprChain
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i]
    const parent = i > 0 ? chain[i - 1] : undefined
    const call =
      e.type === "Call" ? e : parent?.type === "Call" && parent.callee === e ? parent : undefined
    if (call && call.callee.type === "Variable" && contains(call.callee.range, offset)) {
      const name = call.callee.name
      if (name === "block" && call.args[0]?.value.type === "String") break
      if (model.macros.some((m) => m.name === name))
        return { kind: "macro", name, range: call.callee.range }
      for (const imp of model.imports) {
        const n = imp.names?.find((x) => (x.alias ?? x.name).name === name)
        if (n && imp.ref.literalName)
          return {
            kind: "macro",
            name: n.name.name,
            range: call.callee.range,
            template: imp.ref.literalName,
            alias: name,
          }
      }
      return null
    }
    if (
      e.type === "String" &&
      parent?.type === "Call" &&
      parent.callee.type === "Variable" &&
      parent.callee.name === "block" &&
      parent.args[0]?.value === e
    ) {
      return {
        kind: "block",
        name: e.value,
        range: { start: e.range.start + 1, end: e.range.end - 1 },
      }
    }
    if (
      call &&
      call.callee.type === "Member" &&
      contains(call.callee.property.range, offset) &&
      call.callee.object.type === "Variable"
    ) {
      const objectName = call.callee.object.name
      const alias = model.imports.find(
        (imp) => imp.kind === "import" && imp.alias?.name === objectName,
      )
      if (alias?.ref.literalName)
        return {
          kind: "macro",
          name: call.callee.property.name,
          range: call.callee.property.range,
          template: alias.ref.literalName,
          alias: objectName,
        }
    }
    if (e.type === "Variable" && contains(e.range, offset)) {
      const v = scopeAt(analysis.ast, model, offset).variables.find((x) => x.name === e.name)
      if (v?.range && v.kind !== "loop" && v.kind !== "context" && v.kind !== "global")
        return { kind: "variable", name: e.name, range: e.range, definition: v.range }
      return null
    }
  }
  return null
}

/**
 * All ranges in this file that refer to the symbol (including its definition when local).
 * With `forRename`, calls through a `from … import x as alias` alias are left out, since
 * renaming the macro must not touch the alias.
 */
export function localReferences(
  analysis: Analysis,
  symbol: Symbol,
  forRename = false,
): ast.Range[] {
  const out: ast.Range[] = []
  const { model } = analysis
  if (symbol.kind === "block") {
    for (const b of model.blocks) {
      if (b.name !== symbol.name) continue
      out.push(b.nameRange)
      if (b.node.endName) out.push(b.node.endName.range)
    }
    forEachExpr(analysis, (e) => {
      if (
        e.type === "Call" &&
        e.callee.type === "Variable" &&
        e.callee.name === "block" &&
        e.args[0]?.value.type === "String" &&
        e.args[0].value.value === symbol.name
      ) {
        const s = e.args[0].value
        out.push({ start: s.range.start + 1, end: s.range.end - 1 })
      }
    })
    return out.sort((a, b) => a.start - b.start)
  }
  if (symbol.kind === "macro") {
    if (!symbol.template) {
      for (const m of model.macros) if (m.name === symbol.name) out.push(m.nameRange)
      forEachExpr(analysis, (e) => {
        if (e.type === "Call" && e.callee.type === "Variable" && e.callee.name === symbol.name)
          out.push(e.callee.range)
      })
      return out
    }
    // Imported macro: the from-import name and every call through alias or namespace.
    const callNames = new Set<string>()
    const namespaces = new Set<string>()
    for (const imp of model.imports) {
      if (imp.ref.literalName !== symbol.template) continue
      if (imp.kind === "from") {
        for (const n of imp.names ?? []) {
          if (n.name.name !== symbol.name) continue
          out.push(n.name.range)
          if (!forRename || !n.alias) callNames.add((n.alias ?? n.name).name)
        }
      } else if (imp.alias) namespaces.add(imp.alias.name)
    }
    forEachExpr(analysis, (e) => {
      if (e.type !== "Call") return
      if (e.callee.type === "Variable" && callNames.has(e.callee.name)) out.push(e.callee.range)
      if (
        e.callee.type === "Member" &&
        e.callee.object.type === "Variable" &&
        namespaces.has(e.callee.object.name) &&
        e.callee.property.name === symbol.name
      ) {
        out.push(e.callee.property.range)
      }
    })
    return out
  }
  out.push(symbol.definition)
  forEachExpr(analysis, (e, offset) => {
    if (e.type !== "Variable" || e.name !== symbol.name) return
    const v = scopeAt(analysis.ast, model, offset).variables.find((x) => x.name === e.name)
    if (v?.range && v.range.start === symbol.definition.start) out.push(e.range)
  })
  return out.sort((a, b) => a.start - b.start)
}

function forEachExpr(analysis: Analysis, visit: (e: ast.Expr, offset: number) => void) {
  walk(analysis.ast.body, (node) => {
    for (const expr of nodeExpressions(node)) walkExpr(expr, (e) => visit(e, e.range.start))
  })
}
