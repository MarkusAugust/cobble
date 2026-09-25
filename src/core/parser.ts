import type * as ast from "./ast"
import type { Diagnostic } from "./diagnostics-codes"
import { lex, type Token } from "./lexer"
import { binaryOperators, closesTag, tagByName } from "./spec"

export interface ParseResult {
  ast: ast.Template
  diagnostics: Diagnostic[]
  tokens: Token[]
}

export interface ParseOptions {
  /** Tag names that should not produce E002. */
  customTags?: Iterable<string>
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly token: Token,
  ) {
    super(message)
  }
}

const BINARY = new Map(binaryOperators.map((o) => [o.name, o]))
const UNARY = new Set(["not", "+", "-"])
const CONSTANTS: Record<string, number | boolean | null> = {
  true: true,
  TRUE: true,
  false: false,
  FALSE: false,
  null: null,
  NULL: null,
  none: null,
  NONE: null,
}

const range = (start: number, end: number): ast.Range => ({ start, end })
const tokenRange = (t: Token): ast.Range => range(t.start, t.end)
const span = (a: ast.Range, b: ast.Range): ast.Range =>
  range(Math.min(a.start, b.start), Math.max(a.end, b.end))

interface BodyResult {
  nodes: ast.Node[]
  /** Name of the end/intermediate tag that stopped the body, when not consumed. */
  stopped?: string
}

/** Recursive-descent parser over lexer tokens. Never throws on user input. */
class Parser {
  private i = 0
  readonly diagnostics: Diagnostic[]
  private readonly customTags: Set<string>

  constructor(
    private readonly text: string,
    private readonly tokens: Token[],
    lexDiagnostics: Diagnostic[],
    options: ParseOptions,
  ) {
    this.diagnostics = [...lexDiagnostics]
    this.customTags = new Set(options.customTags ?? [])
  }

  // ----- token helpers -----

  private get current(): Token {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1]
  }

  private peek(offset = 1): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]
  }

  private advance(): Token {
    const t = this.current
    if (this.i < this.tokens.length - 1) this.i++
    return t
  }

  private is(kind: Token["kind"], value?: string, token: Token = this.current): boolean {
    return token.kind === kind && (value === undefined || token.value === value)
  }

  private isCloseOrEof(t: Token = this.current): boolean {
    return t.kind === "executeClose" || t.kind === "printClose" || t.kind === "eof"
  }

  private error(
    code: Diagnostic["code"],
    message: string,
    r: ast.Range,
    severity: Diagnostic["severity"] = "error",
  ) {
    this.diagnostics.push({ code, message, start: r.start, end: r.end, severity })
  }

  private fail(message: string, token: Token = this.current): never {
    throw new ParseError(message, token)
  }

  private expectName(what: string): ast.Identifier {
    if (!this.is("name")) this.fail(`Expected ${what}`)
    const t = this.advance()
    return { name: t.value, range: tokenRange(t) }
  }

  private expectPunctuation(value: string) {
    if (!this.is("punctuation", value)) this.fail(`Expected '${value}'`)
    return this.advance()
  }

  // ----- template & bodies -----

  parseTemplate(): ast.Template {
    const body = this.parseBody([], []).nodes
    return { type: "Template", range: range(0, this.text.length), body }
  }

  /**
   * Parses nodes until eof or until an end/intermediate tag listed in `stops` (left unconsumed).
   * `openStack` lists the enclosing block tags, innermost last, for error recovery.
   */
  private parseBody(stops: string[], openStack: string[]): BodyResult {
    const nodes: ast.Node[] = []
    for (;;) {
      const t = this.current
      switch (t.kind) {
        case "eof":
          return { nodes }
        case "text":
          this.advance()
          nodes.push({ type: "Text", range: tokenRange(t), value: t.value })
          break
        case "commentOpen": {
          this.advance()
          let end = t.end
          while (this.is("commentText") || this.is("commentClose")) end = this.advance().end
          nodes.push({ type: "Comment", range: range(t.start, end) })
          break
        }
        case "printOpen":
          nodes.push(this.parsePrint())
          break
        case "executeOpen": {
          const nameToken = this.peek()
          const name = nameToken.kind === "name" ? nameToken.value : ""
          if (stops.includes(name)) return { nodes, stopped: name }
          const closes = closesTag.get(name)
          if (closes) {
            const innermost = openStack[openStack.length - 1]
            const closesOuter = openStack.slice(0, -1).some((open) => closes.includes(open))
            if (innermost !== undefined && closes.includes(innermost)) {
              // e.g. a second {% else %} in the same if: report and skip
              this.error("E003", `Unexpected '{% ${name} %}'`, tokenRange(nameToken))
              nodes.push(this.parseUnknownStatement(false))
            } else if (closesOuter) {
              return { nodes, stopped: name }
            } else {
              this.error(
                "E003",
                `Unexpected '{% ${name} %}' without a matching open tag`,
                tokenRange(nameToken),
              )
              nodes.push(this.parseUnknownStatement(false))
            }
            break
          }
          nodes.push(this.parseStatement(openStack))
          break
        }
        default:
          // Stray tokens (should not happen); skip defensively.
          this.advance()
      }
    }
  }

  private parsePrint(): ast.PrintNode {
    const open = this.advance()
    let expr: ast.Expr | null = null
    try {
      if (this.isCloseOrEof()) {
        this.error("E006", "Expected an expression", tokenRange(open))
      } else {
        expr = this.parseExpression()
        if (!this.isCloseOrEof()) this.fail("Unexpected token")
      }
    } catch (e) {
      expr = this.recover(e, expr)
    }
    const end = this.skipToClose("printClose")
    return { type: "Print", range: range(open.start, end), expr }
  }

  /** Reports a ParseError as E006 and returns an Error expression covering the bad token. */
  private recover(e: unknown, expr: ast.Expr | null): ast.Expr {
    if (!(e instanceof ParseError)) throw e
    const r = this.isCloseOrEof(e.token)
      ? range(e.token.start, e.token.start + 1)
      : tokenRange(e.token)
    this.error("E006", e.message, r)
    return expr ?? { type: "Error", range: r }
  }

  /** Consumes tokens up to and including the closing delimiter; returns the end offset. */
  private skipToClose(kind: "printClose" | "executeClose"): number {
    while (!this.isCloseOrEof()) this.advance()
    const t = this.current
    if (t.kind === kind) {
      this.advance()
      return t.end
    }
    // eof (unclosed, already reported by the lexer) or a mismatched close
    if (t.kind !== "eof") this.advance()
    return t.end
  }

  // ----- statements -----

  private parseStatement(openStack: string[]): ast.Statement {
    const open = this.current
    const nameToken = this.peek()
    if (nameToken.kind !== "name") {
      this.advance()
      if (this.isCloseOrEof()) this.error("E006", "Expected a tag name", tokenRange(open))
      else this.error("E006", "Expected a tag name", tokenRange(this.current))
      const end = this.skipToClose("executeClose")
      const r = range(open.start, end)
      return {
        type: "Unknown",
        tag: "",
        range: r,
        openRange: r,
        tagRange: range(open.end, open.end),
      }
    }
    const tag = nameToken.value
    switch (tag) {
      case "if":
        return this.parseIf(openStack)
      case "for":
        return this.parseFor(openStack)
      case "block":
        return this.parseBlock(openStack)
      case "extends":
        return this.parseTemplateRef("Extends") as ast.ExtendsStatement
      case "include":
        return this.parseTemplateRef("Include") as ast.IncludeStatement
      case "import":
        return this.parseTemplateRef("Import") as ast.ImportStatement
      case "from":
        return this.parseFrom()
      case "embed":
        return this.parseEmbed(openStack)
      case "macro":
        return this.parseMacro(openStack)
      case "set":
        return this.parseSet()
      case "filter":
        return this.parseFilterBlock(openStack)
      case "autoescape":
        return this.parseAutoescape(openStack)
      case "verbatim":
        return this.parseVerbatim()
      case "cache":
        return this.parseCache(openStack)
      case "parallel":
        return this.parseSimpleBlock("Parallel", "parallel", openStack) as ast.ParallelStatement
      case "flush":
        return this.parseFlush()
      default:
        if (!tagByName.has(tag) && !this.customTags.has(tag)) {
          this.error("E002", `Unknown tag '${tag}'`, tokenRange(nameToken))
        }
        return this.parseUnknownStatement(true)
    }
  }

  /** Consumes `{% name … %}` and its tokens: used for unknown and stray tags. */
  private parseUnknownStatement(_known: boolean): ast.UnknownStatement {
    const open = this.advance()
    const nameToken = this.advance()
    const end = this.skipToClose("executeClose")
    const r = range(open.start, end)
    return {
      type: "Unknown",
      tag: nameToken.value,
      range: r,
      openRange: r,
      tagRange: tokenRange(nameToken),
    }
  }

  /** Consumes `{%` and the tag name; returns the shared statement fields (openRange filled later). */
  private startStatement(): { open: Token; tag: ast.Identifier } {
    const open = this.advance()
    const t = this.advance()
    return { open, tag: { name: t.value, range: tokenRange(t) } }
  }

  /** Finishes a statement header: verifies nothing is left before `%}` and consumes it. */
  private finishHeader(open: Token, parse: () => void): ast.Range {
    try {
      parse()
      if (!this.isCloseOrEof()) this.fail("Unexpected token")
    } catch (e) {
      this.recover(e, null)
    }
    const end = this.skipToClose("executeClose")
    return range(open.start, end)
  }

  private optionalExpression(): ast.Expr | null {
    return this.isCloseOrEof() ? null : this.parseExpression()
  }

  private requiredExpression(what: string): ast.Expr {
    if (this.isCloseOrEof()) this.fail(`Expected ${what}`)
    return this.parseExpression()
  }

  /** Parses a block body and its end tag. Reports E005 when the end tag is missing. */
  private parseBlockBody(
    tag: string,
    stops: string[],
    openStack: string[],
    openRange: ast.Range,
  ): BodyResult & { closeRange?: ast.Range; endTagToken?: Token } {
    const result = this.parseBody(stops, [...openStack, tag])
    if (result.stopped !== undefined && stops.includes(result.stopped)) {
      return result
    }
    const spec = tagByName.get(tag)
    this.error(
      "E005",
      `Unclosed '{% ${tag} %}': expected '{% ${spec?.endTag ?? `end${tag}`} %}'`,
      openRange,
    )
    return result
  }

  /** Consumes an end tag `{% endX [tokens] %}` and returns its range plus the name token. */
  private consumeEndTag(): { closeRange: ast.Range; nameToken: Token; open: Token } {
    const open = this.advance()
    const nameToken = this.advance()
    return { open, nameToken, closeRange: range(open.start, nameToken.end) }
  }

  private parseIf(openStack: string[]): ast.IfStatement {
    const { open, tag } = this.startStatement()
    const branches: ast.IfBranch[] = []
    let condition: ast.Expr | null = null
    let headerRange = this.finishHeader(open, () => {
      condition = this.requiredExpression("a condition")
    })
    const openRange = headerRange
    let keyword: ast.IfBranch["keyword"] = "if"
    let keywordRange = tag.range
    let closeRange: ast.Range | undefined
    let end = headerRange.end
    for (;;) {
      const stops = keyword === "else" ? ["endif"] : ["elseif", "else", "endif"]
      const body = this.parseBlockBody("if", stops, openStack, openRange)
      const bodyEnd =
        body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : headerRange.end
      branches.push({
        keyword,
        range: range(headerRange.start, bodyEnd),
        tagRange: keywordRange,
        condition,
        body: body.nodes,
      })
      end = bodyEnd
      if (!body.stopped || !stops.includes(body.stopped)) break
      const { open: eOpen, nameToken } = this.consumeEndTag()
      if (nameToken.value === "endif") {
        end = this.skipToClose("executeClose")
        closeRange = range(eOpen.start, end)
        break
      }
      keyword = nameToken.value as "elseif" | "else"
      keywordRange = tokenRange(nameToken)
      condition = null
      headerRange = this.finishHeader(eOpen, () => {
        if (keyword === "elseif") condition = this.requiredExpression("a condition")
      })
      end = headerRange.end
    }
    return {
      type: "If",
      tag: "if",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      branches,
    }
  }

  private parseFor(openStack: string[]): ast.ForStatement {
    const { open, tag } = this.startStatement()
    let variable: ast.Identifier | null = null
    let iterable: ast.Expr | null = null
    const openRange = this.finishHeader(open, () => {
      variable = this.expectName("a loop variable")
      if (!this.is("name", "in")) this.fail("Expected 'in'")
      this.advance()
      iterable = this.requiredExpression("an iterable")
    })
    const body = this.parseBlockBody("for", ["else", "endfor"], openStack, openRange)
    let elseBody: ast.Node[] | undefined
    let elseRange: ast.Range | undefined
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "else") {
      const { open: eOpen } = this.consumeEndTag()
      elseRange = range(eOpen.start, this.skipToClose("executeClose"))
      const elseResult = this.parseBlockBody("for", ["endfor"], openStack, openRange)
      elseBody = elseResult.nodes
      end = elseBody.length > 0 ? elseBody[elseBody.length - 1].range.end : elseRange.end
      if (elseResult.stopped === "endfor") {
        const { open: cOpen } = this.consumeEndTag()
        end = this.skipToClose("executeClose")
        closeRange = range(cOpen.start, end)
      }
    } else if (body.stopped === "endfor") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "For",
      tag: "for",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      variable,
      iterable,
      body: body.nodes,
      elseBody,
      elseRange,
    }
  }

  private parseBlock(openStack: string[]): ast.BlockStatement {
    const { open, tag } = this.startStatement()
    let name: ast.Identifier | null = null
    const openRange = this.finishHeader(open, () => {
      if (this.is("name")) name = this.expectName("a block name")
      else if (this.is("string")) {
        const t = this.advance()
        name = { name: t.value, range: tokenRange(t) }
      } else this.fail("Expected a block name")
    })
    const body = this.parseBlockBody("block", ["endblock"], openStack, openRange)
    let closeRange: ast.Range | undefined
    let endName: ast.Identifier | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endblock") {
      const { open: cOpen } = this.consumeEndTag()
      if (this.is("name") || this.is("string")) {
        const t = this.advance()
        endName = { name: t.value, range: tokenRange(t) }
        if (name && endName.name !== (name as ast.Identifier).name) {
          this.error("E004", `Expected 'endblock ${(name as ast.Identifier).name}'`, endName.range)
        }
      }
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Block",
      tag: "block",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      name,
      body: body.nodes,
      endName,
    }
  }

  private parseTemplateRef(type: "Extends" | "Include" | "Import"): ast.Statement {
    const { open, tag } = this.startStatement()
    let template: ast.Expr | null = null
    let withExpr: ast.Expr | undefined
    let alias: ast.Identifier | undefined
    const openRange = this.finishHeader(open, () => {
      template = this.requiredExpression("a template name")
      if (type === "Include" && this.is("name", "with")) {
        this.advance()
        withExpr = this.requiredExpression("a map of variables")
      } else if (type === "Import" && this.is("name", "as")) {
        this.advance()
        alias = this.expectName("an alias")
      }
    })
    const base = { tag: tag.name, range: openRange, openRange, tagRange: tag.range, template }
    if (type === "Extends") return { type, ...base }
    if (type === "Include") return { type, ...base, with: withExpr }
    return { type, ...base, alias }
  }

  private parseFrom(): ast.FromStatement {
    const { open, tag } = this.startStatement()
    let template: ast.Expr | null = null
    const names: ast.FromStatement["names"] = []
    const openRange = this.finishHeader(open, () => {
      template = this.requiredExpression("a template name")
      if (!this.is("name", "import")) this.fail("Expected 'import'")
      this.advance()
      for (;;) {
        const name = this.expectName("a macro name")
        let alias: ast.Identifier | undefined
        if (this.is("name", "as")) {
          this.advance()
          alias = this.expectName("an alias")
        }
        names.push({ name, alias })
        if (!this.is("punctuation", ",")) break
        this.advance()
      }
    })
    return {
      type: "From",
      tag: "from",
      range: openRange,
      openRange,
      tagRange: tag.range,
      template,
      names,
    }
  }

  private parseEmbed(openStack: string[]): ast.EmbedStatement {
    const { open, tag } = this.startStatement()
    let template: ast.Expr | null = null
    let withExpr: ast.Expr | undefined
    const openRange = this.finishHeader(open, () => {
      template = this.requiredExpression("a template name")
      if (this.is("name", "with")) {
        this.advance()
        withExpr = this.requiredExpression("a map of variables")
      }
    })
    const body = this.parseBlockBody("embed", ["endembed"], openStack, openRange)
    for (const node of body.nodes) {
      const ok =
        node.type === "Block" ||
        node.type === "Comment" ||
        (node.type === "Text" && node.value.trim() === "")
      if (!ok) this.error("E007", "An embed body may only contain block tags", node.range)
    }
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endembed") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Embed",
      tag: "embed",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      template,
      with: withExpr,
      body: body.nodes,
    }
  }

  private parseMacro(openStack: string[]): ast.MacroStatement {
    const { open, tag } = this.startStatement()
    let name: ast.Identifier | null = null
    const params: ast.MacroParam[] = []
    const openRange = this.finishHeader(open, () => {
      name = this.expectName("a macro name")
      this.expectPunctuation("(")
      while (!this.is("punctuation", ")")) {
        if (this.isCloseOrEof()) this.fail("Expected ')'")
        const paramName = this.expectName("a parameter name")
        let def: ast.Expr | undefined
        if (this.is("punctuation", "=")) {
          this.advance()
          def = this.requiredExpression("a default value")
        }
        params.push({ name: paramName, default: def })
        if (this.is("punctuation", ",")) this.advance()
        else if (!this.is("punctuation", ")")) this.fail("Expected ',' or ')'")
      }
      this.advance()
    })
    const body = this.parseBlockBody("macro", ["endmacro"], openStack, openRange)
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endmacro") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Macro",
      tag: "macro",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      name,
      params,
      body: body.nodes,
    }
  }

  private parseSet(): ast.SetStatement {
    const { open, tag } = this.startStatement()
    let name: ast.Identifier | null = null
    let value: ast.Expr | null = null
    const openRange = this.finishHeader(open, () => {
      name = this.expectName("a variable name")
      this.expectPunctuation("=")
      value = this.requiredExpression("a value")
    })
    return {
      type: "Set",
      tag: "set",
      range: openRange,
      openRange,
      tagRange: tag.range,
      name,
      value,
    }
  }

  private parseFilterBlock(openStack: string[]): ast.FilterStatement {
    const { open, tag } = this.startStatement()
    const filters: ast.FilterCall[] = []
    const openRange = this.finishHeader(open, () => {
      for (;;) {
        const name = this.expectName("a filter name")
        const parsed = this.is("punctuation", "(") ? this.parseArguments() : undefined
        filters.push({ name, args: parsed?.args ?? [], argsRange: parsed?.range })
        if (!this.is("operator", "|")) break
        this.advance()
      }
    })
    const body = this.parseBlockBody("filter", ["endfilter"], openStack, openRange)
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endfilter") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "FilterBlock",
      tag: "filter",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      filters,
      body: body.nodes,
    }
  }

  private parseAutoescape(openStack: string[]): ast.AutoescapeStatement {
    const { open, tag } = this.startStatement()
    let strategy: ast.Expr | null = null
    const openRange = this.finishHeader(open, () => {
      strategy = this.optionalExpression()
    })
    const body = this.parseBlockBody("autoescape", ["endautoescape"], openStack, openRange)
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endautoescape") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Autoescape",
      tag: "autoescape",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      strategy,
      body: body.nodes,
    }
  }

  private parseCache(openStack: string[]): ast.CacheStatement {
    const { open, tag } = this.startStatement()
    let key: ast.Expr | null = null
    const openRange = this.finishHeader(open, () => {
      key = this.requiredExpression("a cache key")
    })
    const body = this.parseBlockBody("cache", ["endcache"], openStack, openRange)
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === "endcache") {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Cache",
      tag: "cache",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      key,
      body: body.nodes,
    }
  }

  private parseSimpleBlock(type: "Parallel", tag: string, openStack: string[]): ast.Statement {
    const { open, tag: tagId } = this.startStatement()
    const openRange = this.finishHeader(open, () => {})
    const body = this.parseBlockBody(tag, [`end${tag}`], openStack, openRange)
    let closeRange: ast.Range | undefined
    let end = body.nodes.length > 0 ? body.nodes[body.nodes.length - 1].range.end : openRange.end
    if (body.stopped === `end${tag}`) {
      const { open: cOpen } = this.consumeEndTag()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type,
      tag,
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tagId.range,
      body: body.nodes,
    }
  }

  private parseVerbatim(): ast.VerbatimStatement {
    const { open, tag } = this.startStatement()
    const openRange = this.finishHeader(open, () => {})
    let text = ""
    let textRange = range(openRange.end, openRange.end)
    if (this.is("verbatimText")) {
      const t = this.advance()
      text = t.value
      textRange = tokenRange(t)
    }
    let closeRange: ast.Range | undefined
    let end = textRange.end
    if (this.is("executeOpen") && this.is("name", "endverbatim", this.peek())) {
      const cOpen = this.advance()
      this.advance()
      end = this.skipToClose("executeClose")
      closeRange = range(cOpen.start, end)
    }
    return {
      type: "Verbatim",
      tag: "verbatim",
      range: range(open.start, end),
      openRange,
      closeRange,
      tagRange: tag.range,
      text,
      textRange,
    }
  }

  private parseFlush(): ast.FlushStatement {
    const { open, tag } = this.startStatement()
    const openRange = this.finishHeader(open, () => {})
    return { type: "Flush", tag: "flush", range: openRange, openRange, tagRange: tag.range }
  }

  // ----- expressions -----

  parseExpression(): ast.Expr {
    const condition = this.parseBinary(0)
    if (!this.is("punctuation", "?")) return condition
    this.advance()
    const then = this.parseExpression()
    this.expectPunctuation(":")
    const otherwise = this.parseExpression()
    return {
      type: "Ternary",
      range: span(condition.range, otherwise.range),
      condition,
      then,
      else: otherwise,
    }
  }

  private parseBinary(minPrecedence: number): ast.Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.current
      if (t.kind !== "operator") break
      const op = BINARY.get(t.value)
      if (!op || op.precedence < minPrecedence) break
      this.advance()
      if (op.type === "filter") {
        const name = this.expectName("a filter name")
        const parsed = this.is("punctuation", "(") ? this.parseArguments() : undefined
        left = {
          type: "Filter",
          range: range(left.range.start, parsed ? parsed.range.end : name.range.end),
          expr: left,
          name,
          args: parsed?.args ?? [],
          argsRange: parsed?.range,
        }
        continue
      }
      if (op.type === "test") {
        const name = this.expectName("a test name")
        const parsed = this.is("punctuation", "(") ? this.parseArguments() : undefined
        left = {
          type: "Test",
          range: range(left.range.start, parsed ? parsed.range.end : name.range.end),
          expr: left,
          name,
          negated: op.name === "is not",
          args: parsed?.args ?? [],
          argsRange: parsed?.range,
        }
        continue
      }
      const right = this.parseBinary(op.precedence + 1)
      left = {
        type: "Binary",
        range: span(left.range, right.range),
        operator: op.name,
        left,
        right,
      }
    }
    return left
  }

  private parseUnary(): ast.Expr {
    const t = this.current
    if (t.kind === "operator" && UNARY.has(t.value)) {
      this.advance()
      const operand = this.parseUnary()
      return { type: "Unary", range: range(t.start, operand.range.end), operator: t.value, operand }
    }
    return this.parsePostfix(this.parsePrimary())
  }

  private parsePostfix(base: ast.Expr): ast.Expr {
    let expr = base
    for (;;) {
      if (this.is("punctuation", ".")) {
        this.advance()
        const property = this.expectName("a property name")
        const member: ast.MemberExpr = {
          type: "Member",
          range: range(expr.range.start, property.range.end),
          object: expr,
          property,
        }
        if (this.is("punctuation", "(")) {
          const parsed = this.parseArguments()
          expr = {
            type: "Call",
            range: range(expr.range.start, parsed.range.end),
            callee: member,
            args: parsed.args,
            argsRange: parsed.range,
          }
        } else expr = member
        continue
      }
      if (this.is("punctuation", "[")) {
        this.advance()
        const index = this.parseExpression()
        const close = this.expectPunctuation("]")
        expr = { type: "Subscript", range: range(expr.range.start, close.end), object: expr, index }
        continue
      }
      if (this.is("punctuation", "(") && expr.type === "Variable") {
        const parsed = this.parseArguments()
        expr = {
          type: "Call",
          range: range(expr.range.start, parsed.range.end),
          callee: expr,
          args: parsed.args,
          argsRange: parsed.range,
        }
        continue
      }
      return expr
    }
  }

  private parseArguments(): { args: ast.Argument[]; range: ast.Range } {
    const open = this.expectPunctuation("(")
    const args: ast.Argument[] = []
    let sawNamed = false
    while (!this.is("punctuation", ")")) {
      if (this.isCloseOrEof()) this.fail("Expected ')'")
      let name: ast.Identifier | undefined
      if (this.is("name") && this.is("punctuation", "=", this.peek())) {
        name = this.expectName("an argument name")
        this.advance()
        sawNamed = true
      } else if (sawNamed) {
        this.error(
          "E006",
          "Positional arguments must come before named arguments",
          tokenRange(this.current),
        )
      }
      const value = this.parseExpression()
      args.push({
        name,
        value,
        range: range(name ? name.range.start : value.range.start, value.range.end),
      })
      if (this.is("punctuation", ",")) this.advance()
      else if (!this.is("punctuation", ")")) this.fail("Expected ',' or ')'")
    }
    const close = this.advance()
    return { args, range: range(open.start, close.end) }
  }

  private parsePrimary(): ast.Expr {
    const t = this.current
    switch (t.kind) {
      case "string": {
        this.advance()
        return this.stringLiteral(t)
      }
      case "number": {
        this.advance()
        const raw = t.value
        return {
          type: "Literal",
          range: tokenRange(t),
          value: Number.parseFloat(raw.replace(/L$/, "")),
          raw,
        }
      }
      case "name": {
        this.advance()
        if (t.value in CONSTANTS)
          return { type: "Literal", range: tokenRange(t), value: CONSTANTS[t.value], raw: t.value }
        return { type: "Variable", range: tokenRange(t), name: t.value }
      }
      case "punctuation":
        if (t.value === "(") {
          this.advance()
          const inner = this.parseExpression()
          const close = this.expectPunctuation(")")
          return { ...inner, range: range(t.start, close.end) }
        }
        if (t.value === "[") return this.parseList()
        if (t.value === "{") return this.parseMap()
        break
      default:
        break
    }
    if (this.isCloseOrEof(t)) this.fail("Expected an expression", t)
    this.fail(`Unexpected token '${t.value}'`, t)
  }

  private stringLiteral(t: Token): ast.StringLiteral {
    const literal: ast.StringLiteral = {
      type: "String",
      range: tokenRange(t),
      value: t.value,
      quote: t.quote ?? '"',
    }
    if (t.parts) {
      literal.parts = t.parts.map((p) => {
        if (p.kind === "text") return { kind: "text", value: p.value, range: range(p.start, p.end) }
        const sub = new Parser(
          this.text,
          [...p.tokens, { kind: "eof", value: "", start: p.end, end: p.end }],
          [],
          {},
        )
        let expr: ast.Expr
        try {
          expr =
            p.tokens.length === 0
              ? sub.fail("Expected an expression", sub.current)
              : sub.parseExpression()
          if (!sub.is("eof")) sub.fail("Unexpected token")
        } catch (e) {
          expr = sub.recover(e, null)
        }
        this.diagnostics.push(...sub.diagnostics)
        return { kind: "expr", expr, range: range(p.start, p.end) }
      })
    }
    return literal
  }

  private parseList(): ast.ListLiteral {
    const open = this.expectPunctuation("[")
    const items: ast.Expr[] = []
    while (!this.is("punctuation", "]")) {
      if (this.isCloseOrEof()) this.fail("Expected ']'")
      items.push(this.parseExpression())
      if (this.is("punctuation", ",")) this.advance()
      else if (!this.is("punctuation", "]")) this.fail("Expected ',' or ']'")
    }
    const close = this.advance()
    return { type: "List", range: range(open.start, close.end), items }
  }

  private parseMap(): ast.MapLiteral {
    const open = this.expectPunctuation("{")
    const entries: ast.MapLiteral["entries"] = []
    while (!this.is("punctuation", "}")) {
      if (this.isCloseOrEof()) this.fail("Expected '}'")
      const key = this.parseExpression()
      this.expectPunctuation(":")
      const value = this.parseExpression()
      entries.push({ key, value })
      if (this.is("punctuation", ",")) this.advance()
      else if (!this.is("punctuation", "}")) this.fail("Expected ',' or '}'")
    }
    const close = this.advance()
    return { type: "Map", range: range(open.start, close.end), entries }
  }
}

/** Lexes and parses a template. Never throws on user input. */
export function parse(text: string, options: ParseOptions = {}): ParseResult {
  const lexed = lex(text)
  const parser = new Parser(text, lexed.tokens, lexed.diagnostics, options)
  const ast = parser.parseTemplate()
  return { ast, diagnostics: parser.diagnostics, tokens: lexed.tokens }
}
