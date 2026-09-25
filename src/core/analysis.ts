import type * as ast from "./ast"
import type { Diagnostic } from "./diagnostics-codes"
import type { Token } from "./lexer"
import { buildModel, type TemplateModel } from "./model"
import { parse } from "./parser"
import { findPebbleRegions, type Region } from "./regions"

export interface Analysis {
  text: string
  tokens: Token[]
  ast: ast.Template
  model: TemplateModel
  regions: Region[]
  /** Lexer and parser diagnostics (syntax). Semantic ones are added by `features/diagnostics`. */
  syntaxDiagnostics: Diagnostic[]
}

export interface AnalyzeOptions {
  customTags?: Iterable<string>
}

/** Runs the whole pipeline once; every feature works from this. */
export function analyze(text: string, options: AnalyzeOptions = {}): Analysis {
  const parsed = parse(text, { customTags: options.customTags })
  return {
    text,
    tokens: parsed.tokens,
    ast: parsed.ast,
    model: buildModel(parsed.ast),
    regions: findPebbleRegions(text, parsed.tokens),
    syntaxDiagnostics: parsed.diagnostics,
  }
}
