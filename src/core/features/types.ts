import type { Range } from "../ast"

export type CompletionKind =
  | "keyword"
  | "filter"
  | "function"
  | "test"
  | "variable"
  | "property"
  | "file"
  | "constant"
  | "operator"
  | "macro"
  | "block"
  | "parameter"
  | "value"

export interface CompletionItem {
  label: string
  kind: CompletionKind
  detail?: string
  /** Markdown. */
  documentation?: string
  insertText?: string
  isSnippet?: boolean
  sortText?: string
  /** Range of the word being completed; the server converts it to a text edit. */
  replaceRange?: Range
}

export interface Hover {
  markdown: string
  range: Range
}

export interface SignatureInfo {
  label: string
  documentation?: string
  parameters: { label: string; documentation?: string }[]
  activeParameter: number
}

export type SymbolKind = "block" | "macro" | "variable"

export interface DocumentSymbol {
  name: string
  kind: SymbolKind
  detail?: string
  range: Range
  selectionRange: Range
  children: DocumentSymbol[]
}

export interface FoldingRange {
  start: number
  end: number
  kind?: "comment"
}

export type Definition =
  | { kind: "template"; name: string; originRange: Range }
  | {
      kind: "block"
      name: string
      originRange: Range /** true for parent(): skip the current template */
      parentOnly: boolean
      localRange?: Range
      localSelectionRange?: Range
    }
  | {
      kind: "macro"
      name: string
      originRange: Range
      template?: string
      localRange?: Range
      localSelectionRange?: Range
    }
  | {
      kind: "variable"
      name: string
      originRange: Range
      localRange: Range
      localSelectionRange: Range
    }
  | {
      kind: "external"
      name: string
      originRange: Range
      /** Absolute path of the Java/Kotlin source file. */
      filePath: string
      offset: number
    }
