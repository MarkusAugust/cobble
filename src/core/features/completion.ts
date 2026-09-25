import type { Analysis } from "../analysis"
import { scopeAt } from "../model"
import {
  closesTag,
  constants,
  escapeStrategies,
  loopVariables,
  type Spec,
  type SpecEntry,
  wordOperators,
} from "../spec"
import { type CompletionContext, completionContext } from "./context"
import type { CompletionItem } from "./types"

export interface CompletionOptions {
  /** Template names available for `extends`/`include` completion (relative to a root). */
  templateNames?: string[]
  /** Macro names of an imported template, when known. */
  importedMacros?: (templateName: string) => string[] | undefined
}

const docOf = (e: SpecEntry) =>
  `**${e.signature}**\n\n${e.doc}${e.docUrl ? `\n\n[Documentation](${e.docUrl})` : ""}`

function entryItem(
  e: SpecEntry,
  kind: CompletionItem["kind"],
  replaceRange: CompletionItem["replaceRange"],
): CompletionItem {
  const params = e.params.filter((p) => !p.optional && !p.variadic)
  const snippet =
    params.length > 0
      ? `${e.name}(${params.map((p, i) => `\${${i + 1}:${p.name}}`).join(", ")})`
      : undefined
  return {
    label: e.name,
    kind,
    detail: e.signature,
    documentation: docOf(e),
    insertText:
      snippet ?? (e.params.length > 0 && kind === "function" ? `${e.name}($1)` : undefined),
    isSnippet: snippet !== undefined || (e.params.length > 0 && kind === "function"),
    replaceRange,
  }
}

/** Completion items for the given position, or an empty list outside Pebble syntax. */
export function completions(
  analysis: Analysis,
  offset: number,
  spec: Spec,
  options: CompletionOptions = {},
): CompletionItem[] {
  const ctx = completionContext(analysis, offset)
  return completionsFor(ctx, analysis, offset, spec, options)
}

export function completionsFor(
  ctx: CompletionContext,
  analysis: Analysis,
  offset: number,
  spec: Spec,
  options: CompletionOptions,
): CompletionItem[] {
  switch (ctx.kind) {
    case "outside":
    case "none":
      return []
    case "tagName":
      return tagCompletions(analysis, offset, spec, ctx.replaceRange)
    case "filterName":
      return [...spec.filters.values()].map((f) => entryItem(f, "filter", ctx.replaceRange))
    case "testName":
      return [...spec.tests.values()].map((t) => ({
        label: t.name,
        kind: "test",
        detail: t.signature,
        documentation: docOf(t),
        replaceRange: ctx.replaceRange,
      }))
    case "member":
      return memberCompletions(ctx.base, analysis, offset, options, ctx.replaceRange)
    case "templateName":
      return (options.templateNames ?? [])
        .filter((n) => n.startsWith(ctx.prefix) || ctx.prefix === "")
        .map((n) => ({ label: n, kind: "file", replaceRange: ctx.replaceRange }))
    case "blockName":
      return blockNameCompletions(analysis, offset, ctx.isEnd, ctx.replaceRange)
    case "macroName": {
      const names = ctx.template ? (options.importedMacros?.(ctx.template) ?? []) : []
      return names.map((n) => ({ label: n, kind: "macro", replaceRange: ctx.replaceRange }))
    }
    case "escapeStrategy":
      return escapeStrategies.map((s) => ({
        label: s,
        kind: "value",
        replaceRange: ctx.replaceRange,
      }))
    case "expression":
      return expressionCompletions(ctx, analysis, offset, spec, ctx.replaceRange)
  }
}

function tagCompletions(
  analysis: Analysis,
  offset: number,
  spec: Spec,
  replaceRange: CompletionItem["replaceRange"],
): CompletionItem[] {
  const scope = scopeAt(analysis.ast, analysis.model, offset)
  const open = scope.enclosing.filter((s) => "closeRange" in s && !s.closeRange).map((s) => s.tag)
  const innermost = open[open.length - 1]
  const items: CompletionItem[] = []
  for (const tag of spec.tags.values()) {
    const closes = closesTag.get(tag.name)
    const isEndLike = closes !== undefined
    let sortText = `2_${tag.name}`
    if (isEndLike) {
      if (innermost && closes.includes(innermost)) sortText = `0_${tag.name}`
      else if (open.some((o) => closes.includes(o))) sortText = `1_${tag.name}`
      else sortText = `3_${tag.name}`
    }
    let insertText = tag.snippet ?? tag.name
    let isSnippet = tag.snippet !== undefined
    if (tag.name === "endblock" && innermost === "block") {
      const block = [...scope.enclosing].reverse().find((s) => s.type === "Block")
      if (block?.type === "Block" && block.name) {
        insertText = `endblock ${block.name.name}`
        isSnippet = false
      }
    }
    items.push({
      label: tag.name,
      kind: "keyword",
      detail: tag.signature,
      documentation: docOf(tag),
      insertText,
      isSnippet,
      sortText,
      replaceRange,
    })
  }
  for (const name of spec.customTags)
    items.push({
      label: name,
      kind: "keyword",
      detail: "custom tag",
      sortText: `2_${name}`,
      replaceRange,
    })
  return items
}

function memberCompletions(
  base: string[],
  analysis: Analysis,
  offset: number,
  options: CompletionOptions,
  replaceRange: CompletionItem["replaceRange"],
): CompletionItem[] {
  if (base.length !== 1) return []
  const scope = scopeAt(analysis.ast, analysis.model, offset)
  if (base[0] === "loop" && scope.inFor) {
    return loopVariables.map((v) => ({
      label: v.name,
      kind: "property",
      detail: `loop.${v.name}`,
      documentation: v.doc,
      replaceRange,
    }))
  }
  const alias = analysis.model.imports.find((i) => i.kind === "import" && i.alias?.name === base[0])
  if (alias?.ref.literalName) {
    const names = options.importedMacros?.(alias.ref.literalName) ?? []
    return names.map((n) => ({
      label: n,
      kind: "macro",
      detail: `macro from ${alias.ref.literalName}`,
      insertText: `${n}($1)`,
      isSnippet: true,
      replaceRange,
    }))
  }
  return []
}

function blockNameCompletions(
  analysis: Analysis,
  offset: number,
  isEnd: boolean,
  replaceRange: CompletionItem["replaceRange"],
): CompletionItem[] {
  const scope = scopeAt(analysis.ast, analysis.model, offset)
  if (isEnd) {
    const block = [...scope.enclosing].reverse().find((s) => s.type === "Block")
    return block?.type === "Block" && block.name
      ? [{ label: block.name.name, kind: "block", replaceRange }]
      : []
  }
  // Names of blocks already defined in this template (typically overriding a parent).
  return analysis.model.blocks
    .filter((b) => b.nameRange.start !== replaceRange?.start)
    .map((b) => ({ label: b.name, kind: "block", replaceRange }))
}

function expressionCompletions(
  ctx: Extract<CompletionContext, { kind: "expression" }>,
  analysis: Analysis,
  offset: number,
  spec: Spec,
  replaceRange: CompletionItem["replaceRange"],
): CompletionItem[] {
  const items: CompletionItem[] = []
  if (ctx.callee && ctx.argIndex !== undefined) {
    const entry =
      ctx.calleeKind === "filter" ? spec.filters.get(ctx.callee) : spec.functions.get(ctx.callee)
    for (const p of entry?.params ?? []) {
      if (p.variadic) continue
      items.push({
        label: `${p.name}=`,
        kind: "parameter",
        detail: `named argument of ${entry?.name}`,
        documentation: p.doc,
        insertText: `${p.name}=`,
        sortText: `0_${p.name}`,
        replaceRange,
      })
    }
  }
  const scope = scopeAt(analysis.ast, analysis.model, offset)
  for (const v of scope.variables) {
    items.push({
      label: v.name,
      kind: "variable",
      detail: v.detail ?? v.kind.replace("-", " "),
      sortText: `1_${v.name}`,
      replaceRange,
    })
  }
  for (const g of spec.globalVariables)
    items.push({
      label: g,
      kind: "variable",
      detail: "Spring context variable",
      sortText: `4_${g}`,
      replaceRange,
    })
  for (const m of analysis.model.macros) {
    items.push({
      label: m.name,
      kind: "macro",
      detail: `macro(${m.params.join(", ")})`,
      insertText: `${m.name}(${m.params.map((p, i) => `\${${i + 1}:${p}}`).join(", ")})`,
      isSnippet: true,
      sortText: `1_${m.name}`,
      replaceRange,
    })
  }
  for (const imp of analysis.model.imports) {
    if (imp.kind === "from")
      for (const n of imp.names ?? [])
        items.push({
          label: (n.alias ?? n.name).name,
          kind: "macro",
          detail: `macro from ${imp.ref.literalName ?? "template"}`,
          insertText: `${(n.alias ?? n.name).name}($1)`,
          isSnippet: true,
          sortText: `1_${n.name.name}`,
          replaceRange,
        })
  }
  for (const f of spec.functions.values()) {
    if ((f.name === "parent" && !scope.inBlock) || (f.name === "block" && false)) continue
    items.push({ ...entryItem(f, "function", replaceRange), sortText: `2_${f.name}` })
  }
  for (const c of constants)
    items.push({ label: c, kind: "constant", sortText: `3_${c}`, replaceRange })
  for (const op of wordOperators)
    items.push({ label: op, kind: "operator", sortText: `5_${op}`, replaceRange })
  if (ctx.tag === "for")
    items.push({ label: "in", kind: "keyword", sortText: `0_in`, replaceRange })
  if (ctx.tag === "include" || ctx.tag === "embed")
    items.push({ label: "with", kind: "keyword", sortText: `5_with`, replaceRange })
  if (ctx.tag === "import")
    items.push({ label: "as", kind: "keyword", sortText: `5_as`, replaceRange })
  return items
}
