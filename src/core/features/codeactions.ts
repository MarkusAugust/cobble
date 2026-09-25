import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { walk } from "../ast"
import type { Diagnostic } from "../diagnostics-codes"
import { tagByName } from "../spec"

export type CodeAction =
  | {
      kind: "edit"
      title: string
      edits: { start: number; end: number; newText: string }[]
      diagnostic: Diagnostic
    }
  | { kind: "createFile"; title: string; templateName: string; diagnostic: Diagnostic }
  | {
      kind: "addCustom"
      title: string
      entryKind: "filter" | "function" | "test" | "tag"
      name: string
      diagnostic: Diagnostic
    }

const indentOf = (text: string, offset: number): string => {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1
  const m = /^[ \t]*/.exec(text.slice(lineStart, offset))
  return m ? m[0] : ""
}

/** Quick fixes for the given diagnostics (pure; the server converts offsets and executes). */
export function codeActions(analysis: Analysis, diagnostics: Diagnostic[]): CodeAction[] {
  const actions: CodeAction[] = []
  const { text } = analysis
  for (const d of diagnostics) {
    switch (d.code) {
      case "E005": {
        const node = findStatement(
          analysis,
          (n) => n.openRange.start === d.start && n.openRange.end === d.end,
        )
        const spec = node ? tagByName.get(node.tag) : undefined
        if (!node || !spec?.endTag) break
        const at = node.range.end
        const openAtLineStart = /(^|\n)[ \t]*$/.test(text.slice(0, node.openRange.start))
        const endTag = `{% ${spec.endTag} %}`
        const newText = openAtLineStart
          ? `${text[at - 1] === "\n" ? "" : "\n"}${indentOf(text, node.openRange.start)}${endTag}\n`
          : endTag
        actions.push({
          kind: "edit",
          title: `Insert ${endTag}`,
          edits: [{ start: at, end: at, newText }],
          diagnostic: d,
        })
        break
      }
      case "E004": {
        const node = findStatement(
          analysis,
          (n) => n.type === "Block" && !!n.endName && n.endName.range.start === d.start,
        )
        if (node?.type === "Block" && node.name && node.endName) {
          actions.push({
            kind: "edit",
            title: `Rename to 'endblock ${node.name.name}'`,
            edits: [{ ...node.endName.range, newText: node.name.name }],
            diagnostic: d,
          })
        }
        break
      }
      case "W006": {
        const m = /'([^']+)'/.exec(d.message)
        if (m)
          actions.push({
            kind: "createFile",
            title: `Create template '${m[1]}'`,
            templateName: m[1],
            diagnostic: d,
          })
        break
      }
      case "W001":
      case "W002":
      case "W003":
      case "E002": {
        const m = /'([^']+)'/.exec(d.message)
        if (!m) break
        const entryKind =
          d.code === "W001"
            ? "filter"
            : d.code === "W002"
              ? "test"
              : d.code === "W003"
                ? "function"
                : "tag"
        actions.push({
          kind: "addCustom",
          title: `Declare '${m[1]}' as a custom ${entryKind} in settings`,
          entryKind,
          name: m[1],
          diagnostic: d,
        })
        break
      }
      default:
        break
    }
  }
  return actions
}

function findStatement(
  analysis: Analysis,
  predicate: (n: ast.Statement) => boolean,
): ast.Statement | undefined {
  let found: ast.Statement | undefined
  walk(analysis.ast.body, (node) => {
    if (found || node.type === "Text" || node.type === "Comment" || node.type === "Print") return
    if (predicate(node)) found = node
  })
  return found
}
