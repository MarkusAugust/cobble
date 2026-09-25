import type { Analysis } from "../analysis"
import type { Range } from "../ast"
import { walk } from "../ast"

export type LensAnchor =
  | { kind: "block"; name: string; range: Range }
  | { kind: "macro"; name: string; range: Range }
  | { kind: "extends"; template: string; range: Range }

/** Places where a CodeLens may be shown; the server fills in counts from the template graph. */
export function lensAnchors(analysis: Analysis): LensAnchor[] {
  const out: LensAnchor[] = []
  if (analysis.model.extends?.literalName) {
    const e = analysis.model.extends
    out.push({ kind: "extends", template: e.literalName as string, range: e.statement.openRange })
  }
  for (const b of analysis.model.blocks)
    out.push({ kind: "block", name: b.name, range: b.node.openRange })
  for (const m of analysis.model.macros)
    out.push({ kind: "macro", name: m.name, range: m.node.openRange })
  return out
}

export interface InlayHint {
  offset: number
  label: string
}

/** Shows the block name after a bare `{% endblock %}` (and the loop variable after `{% endfor %}` when nested). */
export function inlayHints(analysis: Analysis, start: number, end: number): InlayHint[] {
  const out: InlayHint[] = []
  walk(analysis.ast.body, (node) => {
    if (node.type !== "Block" || !node.closeRange || node.endName || !node.name) return
    if (node.closeRange.end < start || node.closeRange.start > end) return
    const close = analysis.text.slice(node.closeRange.start, node.closeRange.end)
    const at = node.closeRange.start + close.indexOf("endblock") + "endblock".length
    out.push({ offset: at, label: ` ${node.name.name}` })
  })
  return out
}

export interface DocumentLink {
  range: Range
  templateName: string
}

/** Template names written as string literals, so they can be underlined and clicked. */
export function documentLinks(analysis: Analysis): DocumentLink[] {
  return analysis.model.references
    .filter((r) => r.literalName)
    .map((r) => ({
      range: { start: r.range.start + 1, end: r.range.end - 1 },
      templateName: r.literalName as string,
    }))
}
