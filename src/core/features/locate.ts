import type * as ast from "../ast"
import { nodeExpressions, walk, walkExpr } from "../ast"

export interface Located {
  /** Innermost statement or print node containing the offset. */
  node?: ast.Node
  /** Enclosing statements, outermost first. */
  parents: ast.Statement[]
  /** Innermost expression containing the offset. */
  expr?: ast.Expr
  /** Chain of expressions from outermost to innermost. */
  exprChain: ast.Expr[]
}

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end

/** Finds the innermost node and expression at an offset. */
export function locate(template: ast.Template, offset: number): Located {
  const result: Located = { parents: [], exprChain: [] }
  walk(template.body, (node, parents) => {
    if (!contains(node.range, offset)) return
    if (node.type === "Text" || node.type === "Comment") return
    result.node = node
    result.parents = parents
  })
  if (result.node) {
    for (const e of nodeExpressions(result.node)) {
      if (!contains(e.range, offset)) continue
      walkExpr(e, (x) => {
        if (contains(x.range, offset)) result.exprChain.push(x)
      })
    }
    result.expr = result.exprChain[result.exprChain.length - 1]
  }
  return result
}
