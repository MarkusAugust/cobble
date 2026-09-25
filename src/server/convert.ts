import {
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  type CompletionItem as LspCompletionItem,
  type Diagnostic as LspDiagnostic,
  type DocumentSymbol as LspDocumentSymbol,
  type Range as LspRange,
  MarkupKind,
  SymbolKind,
  TextEdit,
} from "vscode-languageserver/node"
import type { TextDocument } from "vscode-languageserver-textdocument"
import type { CompletionItem, Diagnostic, DocumentSymbol } from "../core"
import type { Range } from "../core/ast"

export const toLspRange = (doc: TextDocument, r: Range): LspRange => ({
  start: doc.positionAt(r.start),
  end: doc.positionAt(r.end),
})

const completionKinds: Record<CompletionItem["kind"], CompletionItemKind> = {
  keyword: CompletionItemKind.Keyword,
  filter: CompletionItemKind.Function,
  function: CompletionItemKind.Function,
  test: CompletionItemKind.TypeParameter,
  variable: CompletionItemKind.Variable,
  property: CompletionItemKind.Property,
  file: CompletionItemKind.File,
  constant: CompletionItemKind.Constant,
  operator: CompletionItemKind.Operator,
  macro: CompletionItemKind.Method,
  block: CompletionItemKind.Module,
  parameter: CompletionItemKind.Property,
  value: CompletionItemKind.EnumMember,
}

export function toLspCompletion(doc: TextDocument, item: CompletionItem): LspCompletionItem {
  const out: LspCompletionItem = {
    label: item.label,
    kind: completionKinds[item.kind],
    detail: item.detail,
    documentation: item.documentation
      ? { kind: MarkupKind.Markdown, value: item.documentation }
      : undefined,
    sortText: item.sortText,
    insertTextFormat: item.isSnippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
  }
  const text = item.insertText ?? item.label
  if (item.replaceRange) out.textEdit = TextEdit.replace(toLspRange(doc, item.replaceRange), text)
  else out.insertText = text
  return out
}

const severities: Record<Diagnostic["severity"], DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  information: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
}

export function toLspDiagnostic(doc: TextDocument, d: Diagnostic): LspDiagnostic {
  return {
    range: toLspRange(doc, { start: d.start, end: Math.max(d.end, d.start + 1) }),
    message: d.message,
    severity: severities[d.severity],
    code: d.code,
    source: "pebble",
  }
}

const symbolKinds: Record<DocumentSymbol["kind"], SymbolKind> = {
  block: SymbolKind.Namespace,
  macro: SymbolKind.Function,
  variable: SymbolKind.Variable,
}

export function toLspSymbol(doc: TextDocument, s: DocumentSymbol): LspDocumentSymbol {
  return {
    name: s.name,
    kind: symbolKinds[s.kind],
    detail: s.detail,
    range: toLspRange(doc, s.range),
    selectionRange: toLspRange(doc, s.selectionRange),
    children: s.children.map((c) => toLspSymbol(doc, c)),
  }
}
