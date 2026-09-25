import type { Analysis } from "../analysis"
import { walk } from "../ast"
import type { FoldingRange } from "./types"

/** Folding ranges (as offsets) for closed block statements and multi-line comments. */
export function foldingRanges(analysis: Analysis): FoldingRange[] {
  const ranges: FoldingRange[] = []
  walk(analysis.ast.body, (node) => {
    if (node.type === "Comment") {
      ranges.push({ start: node.range.start, end: node.range.end, kind: "comment" })
      return
    }
    if (node.type === "Text" || node.type === "Print") return
    if (node.closeRange) ranges.push({ start: node.openRange.start, end: node.closeRange.end })
    if (node.type === "If") {
      for (const b of node.branches) ranges.push({ start: b.range.start, end: b.range.end })
    }
  })
  return ranges
}
