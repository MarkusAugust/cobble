import { describe, expect, test } from "bun:test"
import type * as ast from "../../../src/core/ast"
import { parse } from "../../../src/core/parser"

const codes = (text: string) => parse(text).diagnostics.map((d) => d.code)
const first = <T extends ast.Node>(text: string) => parse(text).ast.body[0] as T
const expr = (text: string) => first<ast.PrintNode>(`{{ ${text} }}`).expr as ast.Expr

/** Compact s-expression rendering of an expression for precedence tests. */
function show(e: ast.Expr | null): string {
  if (!e) return "∅"
  switch (e.type) {
    case "Literal":
      return e.raw
    case "String":
      return e.parts
        ? `"${e.parts.map((p) => (p.kind === "text" ? p.value : `#{${show(p.expr)}}`)).join("")}"`
        : JSON.stringify(e.value)
    case "List":
      return `[${e.items.map(show).join(",")}]`
    case "Map":
      return `{${e.entries.map((en) => `${show(en.key)}:${show(en.value)}`).join(",")}}`
    case "Variable":
      return e.name
    case "Member":
      return `${show(e.object)}.${e.property.name}`
    case "Subscript":
      return `${show(e.object)}[${show(e.index)}]`
    case "Call":
      return `${show(e.callee)}(${e.args.map((a) => (a.name ? `${a.name.name}=${show(a.value)}` : show(a.value))).join(",")})`
    case "Filter":
      return `(${show(e.expr)} | ${e.name.name}${e.args.length ? `(${e.args.map((a) => show(a.value)).join(",")})` : ""})`
    case "Test":
      return `(${show(e.expr)} is${e.negated ? " not" : ""} ${e.name.name})`
    case "Unary":
      return `(${e.operator} ${show(e.operand)})`
    case "Binary":
      return `(${show(e.left)} ${e.operator} ${show(e.right)})`
    case "Ternary":
      return `(${show(e.condition)} ? ${show(e.then)} : ${show(e.else)})`
    case "Error":
      return "<error>"
  }
}

describe("expressions", () => {
  test("precedence follows CoreExtension", () => {
    expect(show(expr("1 + 2 * 3"))).toBe("(1 + (2 * 3))")
    expect(show(expr("a or b and c"))).toBe("(a or (b and c))")
    expect(show(expr("a == b and not c"))).toBe("((a == b) and (not c))")
    expect(show(expr("x | upper | abbreviate(3) ~ '!'"))).toBe(
      '(((x | upper) | abbreviate(3)) ~ "!")',
    )
    expect(show(expr("1..5 | join(', ')"))).toBe('((1 .. 5) | join(", "))')
    expect(show(expr("a is not empty and b is odd"))).toBe("((a is not empty) and (b is odd))")
    expect(show(expr("list contains 'x' or a equals b"))).toBe(
      '((list contains "x") or (a equals b))',
    )
    expect(show(expr("-a * 2"))).toBe("((- a) * 2)")
    expect(show(expr("a ? b : c ? d : e"))).toBe("(a ? b : (c ? d : e))")
    expect(show(expr("(a + b) * c"))).toBe("((a + b) * c)")
  })

  test("postfix chains and calls", () => {
    expect(show(expr("user.address.street"))).toBe("user.address.street")
    expect(show(expr("items[0].name"))).toBe("items[0].name")
    expect(show(expr('map["key"]'))).toBe('map["key"]')
    expect(show(expr("user.getName()"))).toBe("user.getName()")
    expect(show(expr("max(a, 1)"))).toBe("max(a,1)")
    expect(show(expr('date("yyyy", timeZone="UTC")'))).toBe('date("yyyy",timeZone="UTC")')
    expect(show(expr("forms.input('text', name=x)"))).toBe('forms.input("text",name=x)')
  })

  test("literals", () => {
    expect(show(expr("[1, 'a', true]"))).toBe('[1,"a",true]')
    expect(show(expr('{"k": v, "n": {"m": 1}}'))).toBe('{"k":v,"n":{"m":1}}')
    expect(show(expr("null"))).toBe("null")
    expect(show(expr("NONE"))).toBe("NONE")
    expect((expr("100L") as ast.Literal).value).toBe(100)
    expect(show(expr('"Hi #{user.name | upper}!"'))).toBe('"Hi #{(user.name | upper)}!"')
  })

  test("errors are recovered per block", () => {
    expect(codes("{{ a + }}")).toEqual(["E006"])
    expect(codes("{{ }}")).toEqual(["E006"])
    expect(codes("{{ a b }}")).toEqual(["E006"])
    expect(codes("{{ f(1 }}")).toEqual(["E006"])
    expect(codes('{{ {"a": {"b": 1}} }}')).toEqual([])
    expect(codes('{{ {"a": 1}}}')).toEqual([])
    expect(codes("{{ (a }}")).toEqual(["E006"])
    expect(codes("{{ (a }} {{ b }}")).toEqual(["E006"])
    expect(codes("{% set m = {'a': 1 %} {{ b }}")).toEqual(["E006"])
    expect(codes("{{ a) }}")).toEqual(["E006", "E006"])
    expect(codes("{{ 'x' | }}")).toEqual(["E006"])
    expect(codes("{{ x is }}")).toEqual(["E006"])
    expect(codes('{{ "#{ }" }}')).toEqual(["E006"])
    const r = parse("{{ a + }} {{ b }}")
    expect(r.ast.body).toHaveLength(3)
    expect((r.ast.body[2] as ast.PrintNode).expr?.type).toBe("Variable")
    expect(codes("{{ f(a=1, 2) }}")).toEqual(["E006"])
  })
})

describe("statements", () => {
  test("if with elseif and else", () => {
    const s = first<ast.IfStatement>("{% if a %}1{% elseif b %}2{% else %}3{% endif %}")
    expect(s.type).toBe("If")
    expect(s.branches.map((b) => b.keyword)).toEqual(["if", "elseif", "else"])
    expect(s.branches.map((b) => show(b.condition))).toEqual(["a", "b", "∅"])
    expect(s.closeRange).toBeDefined()
    expect(codes("{% if a %}1{% elseif b %}2{% else %}3{% endif %}")).toEqual([])
  })

  test("if error cases", () => {
    expect(codes("{% if %}{% endif %}")).toEqual(["E006"])
    expect(codes("{% if a %}")).toEqual(["E005"])
    expect(codes("{% if a %}{% else %}{% else %}{% endif %}")).toEqual(["E003"])
    expect(codes("{% if a %}{% else %}{% elseif b %}{% endif %}")).toEqual(["E003"])
    expect(codes("{% endif %}")).toEqual(["E003"])
    expect(codes("{% else %}")).toEqual(["E003"])
  })

  test("for with else and loop body", () => {
    const s = first<ast.ForStatement>(
      "{% for u in users | sort %}{{ u }}{% else %}none{% endfor %}",
    )
    expect(s.variable?.name).toBe("u")
    expect(show(s.iterable)).toBe("(users | sort)")
    expect(s.body).toHaveLength(1)
    expect(s.elseBody).toHaveLength(1)
    expect(codes("{% for u in users %}{% endfor %}")).toEqual([])
    expect(codes("{% for u users %}{% endfor %}")).toEqual(["E006"])
    expect(codes("{% for in users %}{% endfor %}")).toEqual(["E006"])
    expect(codes("{% for u in users %}")).toEqual(["E005"])
  })

  test("nested unclosed tags are reported once each and outer end tags still match", () => {
    const r = parse("{% for u in users %}{% if u %}{% endfor %}")
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E005"])
    const forStmt = r.ast.body[0] as ast.ForStatement
    expect(forStmt.closeRange).toBeDefined()
    expect((forStmt.body[0] as ast.IfStatement).closeRange).toBeUndefined()
  })

  test("block with matching and mismatching end names", () => {
    const ok = first<ast.BlockStatement>("{% block content %}x{% endblock content %}")
    expect(ok.name?.name).toBe("content")
    expect(ok.endName?.name).toBe("content")
    expect(codes('{% block "q" %}{% endblock %}')).toEqual([])
    expect(codes("{% block a %}{% endblock b %}")).toEqual(["E004"])
    expect(codes("{% block %}{% endblock %}")).toEqual(["E006"])
  })

  test("template references", () => {
    expect(show(first<ast.ExtendsStatement>('{% extends "base.peb" %}').template)).toBe(
      '"base.peb"',
    )
    expect(show(first<ast.ExtendsStatement>("{% extends a ? 'x' : 'y' %}").template)).toBe(
      '(a ? "x" : "y")',
    )
    const inc = first<ast.IncludeStatement>('{% include "f.peb" with {"a": 1} %}')
    expect(show(inc.with ?? null)).toBe('{"a":1}')
    const imp = first<ast.ImportStatement>('{% import "forms.peb" as forms %}')
    expect(imp.alias?.name).toBe("forms")
    const from = first<ast.FromStatement>("{% from 'forms.peb' import input as field, textarea %}")
    expect(from.names.map((n) => `${n.name.name}${n.alias ? `->${n.alias.name}` : ""}`)).toEqual([
      "input->field",
      "textarea",
    ])
    expect(codes("{% extends %}")).toEqual(["E006"])
    expect(codes("{% from 'x' import %}")).toEqual(["E006"])
    expect(codes("{% include 'x' with %}")).toEqual(["E006"])
  })

  test("embed only allows blocks", () => {
    expect(codes('{% embed "c.peb" %}{% block a %}{% endblock %}{% endembed %}')).toEqual([])
    expect(codes('{% embed "c.peb" %}\n  {% block a %}{% endblock %}\n{% endembed %}')).toEqual([])
    expect(codes('{% embed "c.peb" %}text{% endembed %}')).toEqual(["E007"])
    expect(codes('{% embed "c.peb" with {"t": 1} %}{{ x }}{% endembed %}')).toEqual(["E007"])
  })

  test("macro", () => {
    const m = first<ast.MacroStatement>(
      '{% macro input(type="text", name, value) %}x{% endmacro %}',
    )
    expect(m.name?.name).toBe("input")
    expect(m.params.map((p) => `${p.name.name}${p.default ? `=${show(p.default)}` : ""}`)).toEqual([
      'type="text"',
      "name",
      "value",
    ])
    expect(codes("{% macro %}{% endmacro %}")).toEqual(["E006"])
    expect(codes("{% macro a %}{% endmacro %}")).toEqual(["E006"])
    expect(codes("{% macro a( %}{% endmacro %}")).toEqual(["E006"])
    expect(codes("{% macro a(b c) %}{% endmacro %}")).toEqual(["E006"])
  })

  test("set, filter, autoescape, cache, parallel, flush, verbatim", () => {
    const s = first<ast.SetStatement>("{% set total = price * 2 %}")
    expect(s.name?.name).toBe("total")
    expect(show(s.value)).toBe("(price * 2)")
    expect(codes("{% set x %}")).toEqual(["E006"])
    expect(codes("{% set = 1 %}")).toEqual(["E006"])

    const f = first<ast.FilterStatement>('{% filter upper | escape("js") %}x{% endfilter %}')
    expect(f.filters.map((x) => x.name.name)).toEqual(["upper", "escape"])
    expect(f.filters[1].args).toHaveLength(1)
    expect(codes("{% filter %}{% endfilter %}")).toEqual(["E006"])

    expect(
      first<ast.AutoescapeStatement>("{% autoescape %}{% endautoescape %}").strategy,
    ).toBeNull()
    expect(
      show(first<ast.AutoescapeStatement>('{% autoescape "js" %}{% endautoescape %}').strategy),
    ).toBe('"js"')
    expect(show(first<ast.CacheStatement>('{% cache "k" %}{% endcache %}').key)).toBe('"k"')
    expect(codes("{% cache %}{% endcache %}")).toEqual(["E006"])
    expect(first<ast.ParallelStatement>("{% parallel %}x{% endparallel %}").body).toHaveLength(1)
    expect(first<ast.FlushStatement>("{% flush %}").type).toBe("Flush")
    expect(codes("{% flush now %}")).toEqual(["E006"])

    const v = first<ast.VerbatimStatement>("{% verbatim %}{{ x }}{% endverbatim %}")
    expect(v.text).toBe("{{ x }}")
    expect(v.closeRange).toBeDefined()
    expect(codes("{% verbatim %}x")).toEqual(["E001"])
    expect(codes("{% endverbatim %}")).toEqual(["E003"])
  })

  test("unknown tags", () => {
    expect(codes("{% custom 1 %}")).toEqual(["E002"])
    expect(parse("{% custom 1 %}", { customTags: ["custom"] }).diagnostics).toEqual([])
    expect(first<ast.UnknownStatement>("{% custom 1 %}").tag).toBe("custom")
    expect(codes("{% %}")).toEqual(["E006"])
    expect(codes("{% 1 %}")).toEqual(["E006"])
  })

  test("ranges cover the right text", () => {
    const text = "a {% if x %}{{ y }}{% endif %} b"
    const s = parse(text).ast.body[1] as ast.IfStatement
    expect(text.slice(s.range.start, s.range.end)).toBe("{% if x %}{{ y }}{% endif %}")
    expect(text.slice(s.openRange.start, s.openRange.end)).toBe("{% if x %}")
    expect(text.slice(s.closeRange!.start, s.closeRange!.end)).toBe("{% endif %}")
    expect(text.slice(s.tagRange.start, s.tagRange.end)).toBe("if")
    const p = s.branches[0].body[0] as ast.PrintNode
    expect(text.slice(p.range.start, p.range.end)).toBe("{{ y }}")
  })

  test("spec example parses without diagnostics", async () => {
    const text = await Bun.file(`${import.meta.dir}/../../grammar/fixtures/spec-example.peb`).text()
    expect(parse(text).diagnostics).toEqual([])
  })

  test("html around pebble is plain text", () => {
    const r = parse("<div>{{ a }}</div>")
    expect(r.ast.body.map((n) => n.type)).toEqual(["Text", "Print", "Text"])
  })
})
