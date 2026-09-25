import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { childBodies } from "../ast"
import type { DocumentSymbol } from "./types"

function symbolsOf(body: ast.Node[]): DocumentSymbol[] {
  const out: DocumentSymbol[] = []
  for (const node of body) {
    if (node.type === "Block" && node.name) {
      out.push({
        name: node.name.name,
        kind: "block",
        range: node.range,
        selectionRange: node.name.range,
        children: childBodies(node).flatMap(symbolsOf),
      })
    } else if (node.type === "Macro" && node.name) {
      out.push({
        name: node.name.name,
        kind: "macro",
        detail: `(${node.params.map((p) => p.name.name).join(", ")})`,
        range: node.range,
        selectionRange: node.name.range,
        children: childBodies(node).flatMap(symbolsOf),
      })
    } else if (node.type === "Set" && node.name) {
      out.push({
        name: node.name.name,
        kind: "variable",
        range: node.range,
        selectionRange: node.name.range,
        children: [],
      })
    } else if (node.type !== "Text" && node.type !== "Comment" && node.type !== "Print") {
      out.push(...childBodies(node).flatMap(symbolsOf))
    }
  }
  return out
}

/** Outline: blocks, macros and set variables, nested by body. */
export function documentSymbols(analysis: Analysis): DocumentSymbol[] {
  return symbolsOf(analysis.ast.body)
}
