import type { Analysis } from "../analysis"
import { walk } from "../ast"
import { tagByName } from "../spec"

/**
 * When `offset` is right after the `%}` of an unclosed block tag, returns the end tag to insert
 * (for example `{% endif %}`), otherwise null.
 */
export function autoCloseTag(analysis: Analysis, offset: number): string | null {
  let result: string | null = null
  walk(analysis.ast.body, (node) => {
    if (result || node.type === "Text" || node.type === "Comment" || node.type === "Print") return
    if (node.openRange.end !== offset || node.closeRange) return
    const spec = tagByName.get(node.tag)
    if (!spec?.block || !spec.endTag) return
    if (node.type === "Verbatim") return
    const open = analysis.text.slice(node.openRange.start, node.openRange.end)
    const trimStart = open.startsWith("{%-") ? "-" : ""
    const trimEnd = open.endsWith("-%}") ? "-" : ""
    result = `{%${trimStart} ${spec.endTag} ${trimEnd}%}`
  })
  return result
}

/** Ranges that should be edited together: the names of `{% block x %}` and `{% endblock x %}`. */
export function linkedEditingRanges(
  analysis: Analysis,
  offset: number,
): { start: number; end: number }[] | null {
  let result: { start: number; end: number }[] | null = null
  walk(analysis.ast.body, (node) => {
    if (result || node.type !== "Block" || !node.name || !node.endName) return
    const inName = offset >= node.name.range.start && offset <= node.name.range.end
    const inEnd = offset >= node.endName.range.start && offset <= node.endName.range.end
    if (inName || inEnd) result = [node.name.range, node.endName.range]
  })
  return result
}
