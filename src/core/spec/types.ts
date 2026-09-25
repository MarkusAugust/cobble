export type SpecKind = "tag" | "filter" | "function" | "test"
export type SpecSource = "core" | "escaper" | "i18n" | "spring" | "parser" | "custom"

export interface SpecParam {
  name: string
  optional?: boolean
  variadic?: boolean
  doc?: string
}

export interface SpecEntry {
  name: string
  kind: SpecKind
  /** Human readable signature, e.g. `date(format, existingFormat?, timeZone?)` */
  signature: string
  params: SpecParam[]
  /** Markdown documentation, one to three sentences plus an example. */
  doc: string
  docUrl?: string
  source: SpecSource
  since?: string
}

export interface TagSpec extends SpecEntry {
  kind: "tag"
  /** True when the tag opens a body that must be closed with `endTag`. */
  block: boolean
  endTag?: string
  /** Tags that may appear inside the body at the same level, e.g. `else`. */
  intermediate?: string[]
  /** Snippet inserted on completion (VS Code snippet syntax), without the delimiters. */
  snippet?: string
}

export interface OperatorSpec {
  name: string
  precedence: number
  type: "binary" | "unary" | "test" | "filter"
  doc: string
}
