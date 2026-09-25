import { type Analysis, analyze, buildSpec, type Spec } from "../../../src/core"

export const spec: Spec = buildSpec()

/** Splits a source with a `§` cursor marker into text and offset. */
export function cursor(source: string): { text: string; offset: number; analysis: Analysis } {
  const offset = source.indexOf("§")
  if (offset === -1) throw new Error("missing § cursor marker")
  const text = source.slice(0, offset) + source.slice(offset + 1)
  return { text, offset, analysis: analyze(text) }
}
