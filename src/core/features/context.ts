import type { Analysis } from "../analysis"
import type { Range } from "../ast"
import type { Token } from "../lexer"

export type CompletionContext =
  | { kind: "outside" }
  | { kind: "none" }
  | { kind: "tagName"; prefix: string; replaceRange: Range }
  | { kind: "filterName"; prefix: string; replaceRange: Range }
  | { kind: "testName"; prefix: string; replaceRange: Range }
  | { kind: "member"; base: string[]; prefix: string; replaceRange: Range }
  | {
      kind: "expression"
      prefix: string
      replaceRange: Range
      tag?: string
      callee?: string
      calleeKind?: "filter" | "function"
      argIndex?: number
    }
  | { kind: "templateName"; prefix: string; replaceRange: Range; tag: string }
  | { kind: "blockName"; prefix: string; replaceRange: Range; isEnd: boolean }
  | { kind: "macroName"; prefix: string; replaceRange: Range; template?: string }
  | { kind: "escapeStrategy"; prefix: string; replaceRange: Range }

const TEMPLATE_TAGS = new Set(["extends", "include", "import", "from", "embed"])

interface RegionTokens {
  kind: "print" | "execute"
  open: Token
  /** Tokens between the delimiters (excluding open/close). */
  tokens: Token[]
}

/** Finds the print/execute region containing the offset and its tokens, descending into interpolations. */
export function regionTokensAt(tokens: Token[], offset: number): RegionTokens | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind !== "printOpen" && t.kind !== "executeOpen") continue
    if (t.end > offset) return null
    const closeKind = t.kind === "printOpen" ? "printClose" : "executeClose"
    const inner: Token[] = []
    let j = i + 1
    while (j < tokens.length && tokens[j].kind !== closeKind && tokens[j].kind !== "eof")
      inner.push(tokens[j++])
    const close = tokens[j]
    const closed = close?.kind === closeKind
    // For an unclosed block the region runs to the next region start or the end of text.
    const endLimit = closed ? close.start : Number.POSITIVE_INFINITY
    if (offset > endLimit) {
      i = j
      continue
    }
    // Interpolation inside a double-quoted string?
    for (const s of inner) {
      if (s.kind === "string" && s.parts && offset > s.start && offset < s.end) {
        for (const p of s.parts) {
          if (p.kind === "expr" && offset >= p.start + 2 && offset <= p.end) {
            const nested = regionTokensAt(
              [
                { kind: "printOpen", value: "#{", start: p.start, end: p.start + 2 },
                ...p.tokens,
                { kind: "eof", value: "", start: p.end, end: p.end },
              ],
              offset,
            )
            if (nested) return nested
          }
        }
        return null
      }
    }
    return { kind: t.kind === "printOpen" ? "print" : "execute", open: t, tokens: inner }
  }
  return null
}

/** The identifier fragment ending at the offset, plus the range to replace. */
function currentWord(text: string, offset: number): { prefix: string; replaceRange: Range } {
  let start = offset
  while (start > 0 && /[\p{L}\p{N}_]/u.test(text[start - 1])) start--
  return { prefix: text.slice(start, offset), replaceRange: { start, end: offset } }
}

/** Tokens that end before the current word starts. */
function tokensBefore(tokens: Token[], wordStart: number): Token[] {
  return tokens.filter((t) => t.end <= wordStart)
}

/** Determines what kind of completion applies at the offset. */
export function completionContext(analysis: Analysis, offset: number): CompletionContext {
  const { text, tokens } = analysis
  const region = regionTokensAt(tokens, offset)
  if (!region) return { kind: "outside" }
  const word = currentWord(text, offset)
  const before = tokensBefore(region.tokens, word.replaceRange.start)
  const last = before[before.length - 1]

  // Inside a string literal (not an interpolation): only template names and escape strategies.
  const inString = region.tokens.find(
    (t) =>
      t.kind === "string" &&
      offset > t.start &&
      (offset < t.end || (t.unterminated && offset <= t.end)),
  )
  if (inString) {
    const stringPrefix = text.slice(inString.start + 1, offset)
    const replaceRange = { start: inString.start + 1, end: offset }
    const firstName = region.tokens[0]
    if (region.kind === "execute" && firstName?.kind === "name") {
      if (TEMPLATE_TAGS.has(firstName.value) && region.tokens[1] === inString) {
        return { kind: "templateName", prefix: stringPrefix, replaceRange, tag: firstName.value }
      }
      if (firstName.value === "autoescape" && region.tokens[1] === inString) {
        return { kind: "escapeStrategy", prefix: stringPrefix, replaceRange }
      }
    }
    const idx = region.tokens.indexOf(inString)
    const prev = region.tokens[idx - 1]
    const prevPrev = region.tokens[idx - 2]
    if (
      prev?.kind === "punctuation" &&
      prev.value === "(" &&
      prevPrev?.kind === "name" &&
      prevPrev.value === "escape"
    ) {
      return { kind: "escapeStrategy", prefix: stringPrefix, replaceRange }
    }
    return { kind: "none" }
  }

  if (region.kind === "execute") {
    const first = region.tokens[0]
    if (!first || first.start >= word.replaceRange.start || before.length === 0) {
      return { kind: "tagName", ...word }
    }
    const tag = first.kind === "name" ? first.value : ""
    switch (tag) {
      case "block":
      case "endblock":
        if (before.length === 1) return { kind: "blockName", ...word, isEnd: tag === "endblock" }
        return { kind: "none" }
      case "filter":
        if (before.length === 1) return { kind: "filterName", ...word }
        break
      case "from": {
        const importIdx = before.findIndex((t) => t.kind === "name" && t.value === "import")
        if (importIdx > 0) {
          const template = before[1]?.kind === "string" ? before[1].value : undefined
          if (last.kind === "name" && last.value !== "import" && last.value !== "as")
            return { kind: "none" }
          if (last.kind === "name" && last.value === "as") return { kind: "none" }
          return { kind: "macroName", ...word, template }
        }
        if (before.length === 2) return { kind: "none" } // expecting `import`
        break
      }
      case "import":
        if (before.length === 2 && last.kind === "string") return { kind: "none" }
        if (last.kind === "name" && last.value === "as") return { kind: "none" }
        break
      case "for":
        if (before.length === 1) return { kind: "none" } // loop variable name
        if (before.length === 2) return { kind: "none" } // expecting `in`
        break
      case "set":
        if (before.length === 1) return { kind: "none" }
        if (before.length === 2 && !(last.kind === "punctuation" && last.value === "="))
          return { kind: "none" }
        break
      case "macro":
        return { kind: "none" }
      case "extends":
      case "include":
      case "embed":
        if (before.length === 1) return { kind: "expression", ...word, tag }
        break
      default:
        break
    }
    return expressionContext(analysis, region, before, word, tag)
  }
  return expressionContext(analysis, region, before, word, undefined)
}

function expressionContext(
  _analysis: Analysis,
  _region: RegionTokens,
  before: Token[],
  word: { prefix: string; replaceRange: Range },
  tag: string | undefined,
): CompletionContext {
  const last = before[before.length - 1]
  if (last?.kind === "operator" && last.value === "|") return { kind: "filterName", ...word }
  if (last?.kind === "operator" && (last.value === "is" || last.value === "is not"))
    return { kind: "testName", ...word }
  if (last?.kind === "punctuation" && last.value === ".") {
    const base: string[] = []
    let i = before.length - 2
    while (i >= 0 && before[i].kind === "name") {
      base.unshift(before[i].value)
      if (i - 1 >= 0 && before[i - 1].kind === "punctuation" && before[i - 1].value === ".") i -= 2
      else break
    }
    return { kind: "member", base, ...word }
  }
  // Inside an argument list: find the innermost unclosed `(` and its callee.
  let depth = 0
  for (let i = before.length - 1; i >= 0; i--) {
    const t = before[i]
    if (t.kind !== "punctuation") continue
    if (t.value === ")") depth++
    else if (t.value === "(") {
      if (depth > 0) {
        depth--
        continue
      }
      const callee = before[i - 1]
      if (callee?.kind === "name") {
        const pipe = before[i - 2]
        const calleeKind = pipe?.kind === "operator" && pipe.value === "|" ? "filter" : "function"
        let argIndex = 0
        let d = 0
        for (let j = i + 1; j < before.length; j++) {
          const u = before[j]
          if (u.kind !== "punctuation") continue
          if (u.value === "(" || u.value === "[" || u.value === "{") d++
          else if (u.value === ")" || u.value === "]" || u.value === "}") d--
          else if (u.value === "," && d === 0) argIndex++
        }
        const prev = before[before.length - 1]
        const atArgStart = prev === before[i] || (prev.kind === "punctuation" && prev.value === ",")
        return {
          kind: "expression",
          ...word,
          tag,
          callee: callee.value,
          calleeKind,
          argIndex: atArgStart ? argIndex : undefined,
        }
      }
      break
    }
  }
  return { kind: "expression", ...word, tag }
}

export { currentWord }
