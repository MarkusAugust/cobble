import type { Diagnostic } from "./diagnostics-codes"

export type TokenKind =
  | "text"
  | "commentOpen"
  | "commentText"
  | "commentClose"
  | "printOpen"
  | "printClose"
  | "executeOpen"
  | "executeClose"
  | "name"
  | "number"
  | "string"
  | "punctuation"
  | "operator"
  | "verbatimText"
  | "unknown"
  | "eof"

export interface StringTextPart {
  kind: "text"
  value: string
  start: number
  end: number
}

export interface StringExprPart {
  kind: "expr"
  tokens: Token[]
  start: number
  end: number
}

export type StringPart = StringTextPart | StringExprPart

export interface Token {
  kind: TokenKind
  /** Raw text for most tokens; the unquoted content for strings. */
  value: string
  start: number
  end: number
  /** Whitespace-control `-` present on a delimiter. */
  trim?: boolean
  quote?: '"' | "'"
  /** Present for double-quoted strings containing `#{ }` interpolation. */
  parts?: StringPart[]
  unterminated?: boolean
}

export interface LexResult {
  tokens: Token[]
  diagnostics: Diagnostic[]
}

const START_DELIMITER = /\{\{|\{%|\{#/g
const VERBATIM_START = /^\{%(-)?\s*verbatim\s*(-)?%\}/
const VERBATIM_END = /\{%(-)?\s*endverbatim\s*(-)?%\}/g
const NAME = /^[\p{L}_][\p{L}\p{N}_]*/u
const LONG = /^[0-9]+L/
const NUMBER = /^[0-9]+(?:\.[0-9]+)?/
const WHITESPACE = /^\s+/
const PUNCTUATION = "()[]{}?:.,|="
const WORD_OPERATORS = ["is not", "contains", "equals", "not", "and", "or", "is"]
const SYMBOL_OPERATORS = ["==", "!=", "<=", ">=", "..", "~", "+", "-", "*", "/", "%", "<", ">", "|"]
const WORD_OPERATOR_RE = new RegExp(
  `^(?:${WORD_OPERATORS.map((o) => o.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}_])`,
  "u",
)
const SYMBOL_OPERATOR_RE = new RegExp(
  `^(?:${SYMBOL_OPERATORS.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
)

type State = "print" | "execute" | "interpolation"

class Lexer {
  private pos = 0
  readonly tokens: Token[] = []
  readonly diagnostics: Diagnostic[] = []

  constructor(private readonly text: string) {}

  run(): LexResult {
    while (this.pos < this.text.length) {
      if (!this.lexData()) break
    }
    this.push("eof", "", this.text.length, this.text.length)
    return { tokens: this.tokens, diagnostics: this.diagnostics }
  }

  private push(
    kind: TokenKind,
    value: string,
    start: number,
    end: number,
    extra: Partial<Token> = {},
  ): Token {
    const token: Token = { kind, value, start, end, ...extra }
    this.tokens.push(token)
    return token
  }

  private error(code: Diagnostic["code"], message: string, start: number, end: number) {
    this.diagnostics.push({ code, message, start, end, severity: "error" })
  }

  /** Lexes plain text up to and including the next delimiter block. Returns false at end of input. */
  private lexData(): boolean {
    START_DELIMITER.lastIndex = this.pos
    const match = START_DELIMITER.exec(this.text)
    if (!match) {
      this.push("text", this.text.slice(this.pos), this.pos, this.text.length)
      this.pos = this.text.length
      return false
    }
    if (match.index > this.pos) {
      this.push("text", this.text.slice(this.pos, match.index), this.pos, match.index)
    }
    this.pos = match.index
    switch (match[0]) {
      case "{#":
        this.lexComment()
        break
      case "{%":
        if (!this.lexVerbatim()) this.lexBlock("execute")
        break
      default:
        this.lexBlock("print")
    }
    return true
  }

  private lexComment() {
    const start = this.pos
    this.push("commentOpen", "{#", start, start + 2)
    const close = this.text.indexOf("#}", start + 2)
    if (close === -1) {
      if (this.text.length > start + 2) {
        this.push("commentText", this.text.slice(start + 2), start + 2, this.text.length)
      }
      this.error("E001", "Unclosed comment: expected '#}'", start, start + 2)
      this.pos = this.text.length
      return
    }
    if (close > start + 2)
      this.push("commentText", this.text.slice(start + 2, close), start + 2, close)
    this.push("commentClose", "#}", close, close + 2)
    this.pos = close + 2
  }

  private lexVerbatim(): boolean {
    const rest = this.text.slice(this.pos)
    const open = VERBATIM_START.exec(rest)
    if (!open) return false
    const start = this.pos
    this.pushDelimiterTag(start, open[0], "verbatim", open[1] === "-", open[2] === "-")
    this.pos = start + open[0].length
    VERBATIM_END.lastIndex = this.pos
    const close = VERBATIM_END.exec(this.text)
    if (!close) {
      if (this.pos < this.text.length) {
        this.push("verbatimText", this.text.slice(this.pos), this.pos, this.text.length)
      }
      this.error(
        "E001",
        "Unclosed verbatim: expected '{% endverbatim %}'",
        start,
        start + open[0].length,
      )
      this.pos = this.text.length
      return true
    }
    if (close.index > this.pos) {
      this.push("verbatimText", this.text.slice(this.pos, close.index), this.pos, close.index)
    }
    this.pushDelimiterTag(close.index, close[0], "endverbatim", close[1] === "-", close[2] === "-")
    this.pos = close.index + close[0].length
    return true
  }

  /** Emits `{%[-] name [-]%}` as three tokens with correct offsets. */
  private pushDelimiterTag(
    start: number,
    raw: string,
    name: string,
    trimStart: boolean,
    trimEnd: boolean,
  ) {
    const openLen = trimStart ? 3 : 2
    this.push("executeOpen", raw.slice(0, openLen), start, start + openLen, { trim: trimStart })
    const nameOffset = raw.indexOf(name)
    this.push("name", name, start + nameOffset, start + nameOffset + name.length)
    const closeLen = trimEnd ? 3 : 2
    this.push(
      "executeClose",
      raw.slice(raw.length - closeLen),
      start + raw.length - closeLen,
      start + raw.length,
      {
        trim: trimEnd,
      },
    )
  }

  private lexBlock(state: "print" | "execute") {
    const start = this.pos
    const openKind = state === "print" ? "printOpen" : "executeOpen"
    const trim = this.text[start + 2] === "-"
    const openLen = trim ? 3 : 2
    this.push(openKind, this.text.slice(start, start + openLen), start, start + openLen, { trim })
    this.pos = start + openLen
    const closed = this.lexExpressionTokens(state, this.tokens)
    if (!closed) {
      this.error(
        "E001",
        state === "print"
          ? "Unclosed expression: expected '}}'"
          : "Unclosed statement: expected '%}'",
        start,
        start + openLen,
      )
    }
  }

  /**
   * Lexes expression tokens into `out` until the closing delimiter (or the closing `}` of an
   * interpolation). Returns true when the close was found.
   */
  private lexExpressionTokens(state: State, out: Token[]): boolean {
    const closeRe = state === "print" ? /^(-)?\}\}/ : state === "execute" ? /^(-)?%\}/ : null
    // Pebble only recognises the closing delimiter outside brackets. We track curly braces
    // separately so that an unclosed `(` or `[` (a common typo) still lets `}}` end the block,
    // and `%}` always ends a statement, which keeps error recovery local to one block.
    let parenDepth = 0
    let curlyDepth = 0
    while (this.pos < this.text.length) {
      const rest = this.text.slice(this.pos)
      const ws = WHITESPACE.exec(rest)
      if (ws) {
        this.pos += ws[0].length
        continue
      }
      if (this.pos >= this.text.length) break
      const current = this.text.slice(this.pos)
      if (closeRe && (state === "execute" || curlyDepth === 0)) {
        const close = closeRe.exec(current)
        if (close) {
          const kind = state === "print" ? "printClose" : "executeClose"
          out.push({
            kind,
            value: close[0],
            start: this.pos,
            end: this.pos + close[0].length,
            trim: close[1] === "-",
          })
          this.pos += close[0].length
          return true
        }
      } else if (!closeRe && current[0] === "}" && curlyDepth === 0) {
        return true
      }
      const ch = current[0]
      let m = WORD_OPERATOR_RE.exec(current)
      if (m) {
        const value = m[0].replace(/\s+/g, " ")
        out.push({ kind: "operator", value, start: this.pos, end: this.pos + m[0].length })
        this.pos += m[0].length
        continue
      }
      m = SYMBOL_OPERATOR_RE.exec(current)
      if (m) {
        out.push({ kind: "operator", value: m[0], start: this.pos, end: this.pos + m[0].length })
        this.pos += m[0].length
        continue
      }
      m = NAME.exec(current)
      if (m) {
        out.push({ kind: "name", value: m[0], start: this.pos, end: this.pos + m[0].length })
        this.pos += m[0].length
        continue
      }
      m = LONG.exec(current) ?? NUMBER.exec(current)
      if (m) {
        out.push({ kind: "number", value: m[0], start: this.pos, end: this.pos + m[0].length })
        this.pos += m[0].length
        continue
      }
      if (PUNCTUATION.includes(ch)) {
        if (ch === "(" || ch === "[") parenDepth++
        else if (ch === "{") curlyDepth++
        else if (ch === ")" || ch === "]") {
          if (parenDepth === 0) this.error("E006", `Unexpected '${ch}'`, this.pos, this.pos + 1)
          else parenDepth--
        } else if (ch === "}") {
          if (curlyDepth === 0) this.error("E006", `Unexpected '${ch}'`, this.pos, this.pos + 1)
          else curlyDepth--
        }
        out.push({ kind: "punctuation", value: ch, start: this.pos, end: this.pos + 1 })
        this.pos += 1
        continue
      }
      if (ch === "'" || ch === '"') {
        out.push(this.lexString(ch))
        continue
      }
      out.push({ kind: "unknown", value: ch, start: this.pos, end: this.pos + 1 })
      this.error("E006", `Unexpected character '${ch}'`, this.pos, this.pos + 1)
      this.pos += 1
    }
    return false
  }

  private lexString(quote: '"' | "'"): Token {
    const start = this.pos
    this.pos += 1
    const parts: StringPart[] = []
    let textStart = this.pos
    let raw = ""
    const flushText = () => {
      if (this.pos > textStart) {
        parts.push({
          kind: "text",
          value: this.text.slice(textStart, this.pos),
          start: textStart,
          end: this.pos,
        })
      }
    }
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]
      if (ch === "\\" && this.pos + 1 < this.text.length) {
        raw += this.text[this.pos + 1]
        this.pos += 2
        continue
      }
      if (ch === quote) {
        flushText()
        this.pos += 1
        const hasInterpolation = parts.some((p) => p.kind === "expr")
        return {
          kind: "string",
          value: raw,
          start,
          end: this.pos,
          quote,
          ...(hasInterpolation ? { parts } : {}),
        }
      }
      if (quote === '"' && ch === "#" && this.text[this.pos + 1] === "{") {
        flushText()
        const exprStart = this.pos
        this.pos += 2
        const tokens: Token[] = []
        const closed = this.lexExpressionTokens("interpolation", tokens)
        if (closed) this.pos += 1
        else this.error("E001", "Unclosed interpolation: expected '}'", exprStart, exprStart + 2)
        parts.push({ kind: "expr", tokens, start: exprStart, end: this.pos })
        textStart = this.pos
        raw += this.text.slice(exprStart, this.pos)
        continue
      }
      raw += ch
      this.pos += 1
    }
    flushText()
    this.error("E001", `Unterminated string: expected ${quote}`, start, start + 1)
    return {
      kind: "string",
      value: raw,
      start,
      end: this.pos,
      quote,
      unterminated: true,
      ...(parts.some((p) => p.kind === "expr") ? { parts } : {}),
    }
  }
}

export function lex(text: string): LexResult {
  return new Lexer(text).run()
}
