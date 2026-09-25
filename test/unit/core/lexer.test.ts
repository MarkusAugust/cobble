import { describe, expect, test } from "bun:test"
import { lex } from "../../../src/core/lexer"

const kinds = (text: string) => lex(text).tokens.map((t) => `${t.kind}:${t.value}`)

describe("lexer", () => {
  test("plain text only", () => {
    expect(kinds("hello")).toEqual(["text:hello", "eof:"])
  })

  test("print block with variable and filter", () => {
    expect(kinds("a {{ user.name | upper }} b")).toEqual([
      "text:a ",
      "printOpen:{{",
      "name:user",
      "punctuation:.",
      "name:name",
      "operator:|",
      "name:upper",
      "printClose:}}",
      "text: b",
      "eof:",
    ])
  })

  test("whitespace control flags", () => {
    const { tokens } = lex("{{- x -}}{%- if y -%}")
    expect(tokens[0]).toMatchObject({ kind: "printOpen", value: "{{-", trim: true })
    expect(tokens[2]).toMatchObject({ kind: "printClose", value: "-}}", trim: true })
    expect(tokens[3]).toMatchObject({ kind: "executeOpen", trim: true })
    expect(tokens[6]).toMatchObject({ kind: "executeClose", trim: true })
    expect(lex("{{ x }}").tokens[0].trim).toBe(false)
  })

  test("minus before close is trim, not subtraction", () => {
    expect(kinds("{{ a - b -}}")).toEqual([
      "printOpen:{{",
      "name:a",
      "operator:-",
      "name:b",
      "printClose:-}}",
      "eof:",
    ])
  })

  test("comments", () => {
    expect(kinds("{# hi {{ x }} #}")).toEqual([
      "commentOpen:{#",
      "commentText: hi {{ x }} ",
      "commentClose:#}",
      "eof:",
    ])
    const r = lex("{# open")
    expect(r.diagnostics[0].code).toBe("E001")
  })

  test("operators, longest match first and word boundaries", () => {
    expect(kinds("{{ a is not b }}").slice(1, -2)).toEqual(["name:a", "operator:is not", "name:b"])
    expect(kinds("{{ a is  not b }}")[2]).toBe("operator:is not")
    expect(kinds("{{ island or orders }}").slice(1, -2)).toEqual([
      "name:island",
      "operator:or",
      "name:orders",
    ])
    expect(
      kinds("{{ a <= b >= c == d != e .. f ~ g }}").filter((k) => k.startsWith("operator")),
    ).toEqual([
      "operator:<=",
      "operator:>=",
      "operator:==",
      "operator:!=",
      "operator:..",
      "operator:~",
    ])
    expect(
      kinds("{{ not x and y contains z equals w }}").filter((k) => k.startsWith("operator")),
    ).toEqual(["operator:not", "operator:and", "operator:contains", "operator:equals"])
  })

  test("numbers and longs", () => {
    expect(kinds("{{ 42 3.14 100L }}").slice(1, -2)).toEqual([
      "number:42",
      "number:3.14",
      "number:100L",
    ])
  })

  test("unicode identifiers", () => {
    expect(kinds("{{ blåbær_1 }}")[1]).toBe("name:blåbær_1")
  })

  test("punctuation", () => {
    expect(
      kinds("{{ f(a, b)[0].c ? {k: 1} : [] }}")
        .filter((k) => k.startsWith("punctuation"))
        .map((k) => k.slice(12)),
    ).toEqual(["(", ",", ")", "[", "]", ".", "?", "{", ":", "}", ":", "[", "]"])
  })

  test("closing delimiter is only recognised outside brackets, like Pebble", () => {
    const r = lex('{{ {"a": {"b": 1}}}}')
    expect(r.tokens.map((t) => t.kind)).toContain("printClose")
    expect(r.diagnostics).toEqual([])
    expect(lex("{{ a) }}").diagnostics[0].code).toBe("E006")
  })

  test("single-quoted strings are plain, double-quoted support interpolation", () => {
    const single = lex("{{ 'a #{b} \\' c' }}").tokens[1]
    expect(single).toMatchObject({ kind: "string", quote: "'", value: "a #{b} ' c" })
    expect(single.parts).toBeUndefined()

    const double = lex('{{ "Hi #{user.name}, #{n | abs}!" }}').tokens[1]
    expect(double.kind).toBe("string")
    expect(double.parts?.map((p) => p.kind)).toEqual(["text", "expr", "text", "expr", "text"])
    const expr = double.parts?.[1]
    expect(expr?.kind === "expr" && expr.tokens.map((t) => t.value)).toEqual(["user", ".", "name"])
  })

  test("escapes inside strings", () => {
    expect(lex('{{ "a\\"b\\\\c" }}').tokens[1].value).toBe('a"b\\c')
  })

  test("closing braces inside strings do not close the block", () => {
    expect(kinds('{{ "a}}b" }}')).toEqual(["printOpen:{{", "string:a}}b", "printClose:}}", "eof:"])
  })

  test("interpolation with nested braces", () => {
    const t = lex('{{ "#{ {"k": v}.k }" }}').tokens[1]
    expect(t.parts?.[0].kind).toBe("expr")
    expect(lex('{{ "#{ {"k": v}.k }" }}').diagnostics).toEqual([])
  })

  test("unterminated string and block", () => {
    const r = lex('{{ "abc')
    expect(r.tokens[1]).toMatchObject({ kind: "string", unterminated: true })
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E001", "E001"])
    expect(lex("{% if x").diagnostics[0].message).toContain("%}")
  })

  test("verbatim is raw text", () => {
    expect(kinds("{% verbatim %}{{ x }} {% y %}{% endverbatim %}z")).toEqual([
      "executeOpen:{%",
      "name:verbatim",
      "executeClose:%}",
      "verbatimText:{{ x }} {% y %}",
      "executeOpen:{%",
      "name:endverbatim",
      "executeClose:%}",
      "text:z",
      "eof:",
    ])
    const trimmed = lex("{%- verbatim -%}x{%- endverbatim -%}").tokens
    expect(trimmed[0]).toMatchObject({ value: "{%-", trim: true })
    expect(trimmed[2]).toMatchObject({ value: "-%}", trim: true })
    expect(trimmed[3]).toMatchObject({ kind: "verbatimText", value: "x", start: 16, end: 17 })
    expect(lex("{% verbatim %}never closed").diagnostics[0].code).toBe("E001")
  })

  test("unexpected characters become unknown tokens with a diagnostic", () => {
    const r = lex("{{ a $ b }}")
    expect(r.tokens.map((t) => t.kind)).toContain("unknown")
    expect(r.diagnostics[0].code).toBe("E006")
    expect(r.tokens.at(-2)?.kind).toBe("printClose")
  })

  test("offsets are exact", () => {
    const text = 'x{{ "s" }}y'
    for (const t of lex(text).tokens) {
      if (t.kind === "string") expect(text.slice(t.start, t.end)).toBe('"s"')
      else if (t.kind !== "eof") expect(text.slice(t.start, t.end)).toBe(t.value)
    }
  })
})
