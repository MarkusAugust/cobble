export type DiagnosticSeverity = "error" | "warning" | "information" | "hint"

export interface Diagnostic {
  code: DiagnosticCode
  message: string
  start: number
  end: number
  severity: DiagnosticSeverity
}

/** Stable codes; documented in README under "Diagnostics". */
export type DiagnosticCode =
  | "E001" // unclosed delimiter
  | "E002" // unknown tag
  | "E003" // unexpected end/intermediate tag
  | "E004" // mismatched endblock name
  | "E005" // unclosed block tag
  | "E006" // syntax error in expression/statement
  | "E007" // invalid content in embed body
  | "W001" // unknown filter
  | "W002" // unknown test
  | "W003" // unknown function
  | "W004" // loop outside for
  | "W006" // template not found
  | "W007" // parent() outside block

export const diagnosticDocs: Record<DiagnosticCode, string> = {
  E001: "A `{{`, `{%` or `{#` delimiter is never closed.",
  E002: "The tag name is not a Pebble tag. Custom tags can be declared in `pebble.customTags`.",
  E003: "An end tag or `else`/`elseif` appears without a matching open tag.",
  E004: "The name after `endblock` does not match the opening `block`.",
  E005: "A block tag (`if`, `for`, `block`, …) is never closed.",
  E006: "The expression or statement could not be parsed.",
  E007: "An `embed` body may only contain `block` tags.",
  W001: "The filter is not built in. Declare custom filters in `pebble.customFilters`.",
  W002: "The test is not built in. Declare custom tests in `pebble.customTests`.",
  W003: "The function is not built in. Declare custom functions in `pebble.customFunctions`.",
  W004: "`loop` is only defined inside a `for` loop.",
  W006: "The referenced template could not be found in any template root.",
  W007: "`parent()` is only valid inside a `block`.",
}
