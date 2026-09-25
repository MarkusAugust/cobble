import type { Analysis } from "../analysis"
import type * as ast from "../ast"
import { scopeAt } from "../model"
import { loopVariables, type Spec, type SpecEntry } from "../spec"
import { locate } from "./locate"
import type { Hover } from "./types"

const contains = (r: ast.Range, offset: number) => offset >= r.start && offset <= r.end
const fence = (code: string) => `\`\`\`pebble\n${code}\n\`\`\``
const entryHover = (e: SpecEntry, range: ast.Range): Hover => ({
  markdown: `${fence(e.signature)}\n\n${e.doc}${e.docUrl ? `\n\n[Pebble documentation](${e.docUrl})` : ""}`,
  range,
})

export interface HoverOptions {
  /** Resolved path for a template reference: string = found, null = not found, undefined = unknown. */
  resolveTemplate?: (name: string) => string | null | undefined
}

const VARIABLE_ORIGIN: Record<string, string> = {
  set: "Variable set with `{% set %}`",
  loop: "Loop metadata of the enclosing `for`",
  "loop-variable": "Loop variable of the enclosing `for`",
  "macro-parameter": "Macro parameter",
  context: "The caller's context (`_context`)",
  "import-alias": "Macro namespace from `{% import %}`",
  global: "Global variable",
}

/** Hover information for the symbol at the offset, or null. */
export function hover(
  analysis: Analysis,
  offset: number,
  spec: Spec,
  options: HoverOptions = {},
): Hover | null {
  const located = locate(analysis.ast, offset)
  const node = located.node
  if (!node) return null

  const statementHover =
    node.type === "Print" || node.type === "Text" || node.type === "Comment"
      ? null
      : hoverStatement(node, offset, spec)
  if (statementHover) return statementHover

  for (const ref of analysis.model.references) {
    if (ref.literalName && contains(ref.range, offset)) {
      const resolved = options.resolveTemplate?.(ref.literalName)
      const where = resolved
        ? `\n\nResolves to \`${resolved}\``
        : resolved === null
          ? "\n\n_Not found in any template root_"
          : ""
      return { markdown: `Template \`${ref.literalName}\`${where}`, range: ref.range }
    }
  }

  const chain = located.exprChain
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i]
    const parent = i > 0 ? chain[i - 1] : undefined
    const call =
      e.type === "Call" ? e : parent?.type === "Call" && parent.callee === e ? parent : undefined
    if (call && call.callee.type === "Variable" && contains(call.callee.range, offset)) {
      return callHover(call.callee.name, call.callee.range, analysis, spec)
    }
    if (e.type === "Filter" && contains(e.name.range, offset)) {
      const s = spec.filters.get(e.name.name)
      return s
        ? entryHover(s, e.name.range)
        : { markdown: `Filter \`${e.name.name}\` (not built in)`, range: e.name.range }
    }
    if (e.type === "Test" && contains(e.name.range, offset)) {
      const s = spec.tests.get(e.name.name)
      return s
        ? entryHover(s, e.name.range)
        : { markdown: `Test \`${e.name.name}\` (not built in)`, range: e.name.range }
    }
    if (
      e.type === "Member" &&
      contains(e.property.range, offset) &&
      e.object.type === "Variable" &&
      e.object.name === "loop"
    ) {
      const v = loopVariables.find((l) => l.name === e.property.name)
      if (v) return { markdown: `\`loop.${v.name}\`\n\n${v.doc}`, range: e.property.range }
    }
    if (e.type === "Variable" && contains(e.range, offset)) {
      const scope = scopeAt(analysis.ast, analysis.model, offset)
      const v = scope.variables.find((x) => x.name === e.name)
      if (v) {
        const line = v.range ? lineOf(analysis.text, v.range.start) : undefined
        const origin = VARIABLE_ORIGIN[v.kind] ?? "Variable"
        return {
          markdown: `\`${e.name}\`\n\n${origin}${line !== undefined ? ` (line ${line})` : ""}${v.detail ? `\n\n${v.detail}` : ""}`,
          range: e.range,
        }
      }
      if (spec.globalVariables.includes(e.name))
        return { markdown: `\`${e.name}\`\n\nProvided by the Spring extension.`, range: e.range }
      if (e.name === "loop")
        return { markdown: "`loop` is only defined inside a `for` loop.", range: e.range }
      return null
    }
    if (
      e.type === "Literal" &&
      contains(e.range, offset) &&
      /^(true|false|null|none)$/i.test(e.raw)
    ) {
      return { markdown: `Constant \`${e.raw}\``, range: e.range }
    }
  }
  return null
}

function hoverStatement(node: ast.Statement, offset: number, spec: Spec): Hover | null {
  if (contains(node.tagRange, offset)) {
    const t = spec.tags.get(node.tag)
    if (t) return entryHover(t, node.tagRange)
  }
  if (node.type === "If") {
    for (const b of node.branches) {
      if (contains(b.tagRange, offset)) {
        const t = spec.tags.get(b.keyword)
        if (t) return entryHover(t, b.tagRange)
      }
    }
  }
  if (node.closeRange && contains(node.closeRange, offset)) {
    const endTag = spec.tags.get(node.tag)?.endTag
    const t = endTag ? spec.tags.get(endTag) : undefined
    if (t) return entryHover(t, node.closeRange)
  }
  if (node.type === "For" && node.elseRange && contains(node.elseRange, offset)) {
    const t = spec.tags.get("else")
    if (t) return entryHover(t, node.elseRange)
  }
  if (node.type === "FilterBlock") {
    for (const f of node.filters) {
      if (contains(f.name.range, offset)) {
        const e = spec.filters.get(f.name.name)
        return e
          ? entryHover(e, f.name.range)
          : { markdown: `Filter \`${f.name.name}\` (not built in)`, range: f.name.range }
      }
    }
  }
  return null
}

function callHover(name: string, range: ast.Range, analysis: Analysis, spec: Spec): Hover {
  const s = spec.functions.get(name)
  if (s) return entryHover(s, range)
  const macro = analysis.model.macros.find((m) => m.name === name)
  if (macro)
    return {
      markdown: `${fence(`macro ${macro.name}(${macro.params.join(", ")})`)}\n\nDefined in this template.`,
      range,
    }
  for (const imp of analysis.model.imports) {
    const n = imp.names?.find((x) => (x.alias ?? x.name).name === name)
    if (n)
      return {
        markdown: `Macro \`${n.name.name}\` imported from \`${imp.ref.literalName ?? "template"}\``,
        range,
      }
  }
  return { markdown: `Function \`${name}\` (not built in)`, range }
}

function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++
  return line
}
