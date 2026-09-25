import { describe, expect, test } from "bun:test"
import {
  buildSpec,
  completionContext,
  completions,
  definition,
  diagnostics,
  documentSymbols,
  foldingRanges,
  hover,
  signatureHelp,
} from "../../../src/core"
import { cursor, spec } from "./helpers"

const ctx = (src: string) => completionContext(cursor(src).analysis, cursor(src).offset)
const labels = (src: string, options = {}) => {
  const c = cursor(src)
  return completions(c.analysis, c.offset, spec, options).map((i) => i.label)
}

describe("completion context", () => {
  test("outside pebble", () => {
    expect(ctx("<div class='§'>").kind).toBe("outside")
    expect(ctx("§{{ a }}").kind).toBe("outside")
    expect(ctx("{{ a }}§").kind).toBe("outside")
    expect(ctx("{# §#}").kind).toBe("outside")
    expect(ctx("{% verbatim %}{{ § }}{% endverbatim %}").kind).toBe("outside")
    expect(ctx('<div data-text="$§">').kind).toBe("outside")
  })

  test("tag names", () => {
    expect(ctx("{% §")).toMatchObject({ kind: "tagName", prefix: "" })
    expect(ctx("{% en§")).toMatchObject({ kind: "tagName", prefix: "en" })
    expect(ctx("{%- if§ x %}")).toMatchObject({ kind: "tagName", prefix: "if" })
  })

  test("filters and tests", () => {
    expect(ctx("{{ x | §")).toMatchObject({ kind: "filterName" })
    expect(ctx("{{ x | up§ }}")).toMatchObject({ kind: "filterName", prefix: "up" })
    expect(ctx("{{ x is §")).toMatchObject({ kind: "testName" })
    expect(ctx("{{ x is not e§ }}")).toMatchObject({ kind: "testName", prefix: "e" })
    expect(ctx("{% filter §")).toMatchObject({ kind: "filterName" })
  })

  test("members", () => {
    expect(ctx("{{ loop.§")).toMatchObject({ kind: "member", base: ["loop"] })
    expect(ctx("{{ user.address.§")).toMatchObject({ kind: "member", base: ["user", "address"] })
    expect(ctx("{{ forms.in§ }}")).toMatchObject({ kind: "member", base: ["forms"], prefix: "in" })
  })

  test("strings and template names", () => {
    expect(ctx('{% extends "§" %}')).toMatchObject({
      kind: "templateName",
      tag: "extends",
      prefix: "",
    })
    expect(ctx("{% include 'lay§' %}")).toMatchObject({ kind: "templateName", prefix: "lay" })
    expect(ctx('{% import "m.peb" as x %}{{ "§" }}').kind).toBe("none")
    expect(ctx('{% autoescape "§" %}').kind).toBe("escapeStrategy")
    expect(ctx('{{ x | escape("§") }}').kind).toBe("escapeStrategy")
    expect(ctx('{{ x | default("§") }}').kind).toBe("none")
  })

  test("statement-specific positions", () => {
    expect(ctx("{% block §")).toMatchObject({ kind: "blockName", isEnd: false })
    expect(ctx("{% block content %}{% endblock §")).toMatchObject({
      kind: "blockName",
      isEnd: true,
    })
    expect(ctx("{% for §").kind).toBe("none")
    expect(ctx("{% for x §").kind).toBe("none")
    expect(ctx("{% for x in §")).toMatchObject({ kind: "expression", tag: "for" })
    expect(ctx("{% set §").kind).toBe("none")
    expect(ctx("{% set x = §")).toMatchObject({ kind: "expression" })
    expect(ctx("{% macro a(§").kind).toBe("none")
    expect(ctx("{% from 'm.peb' import §")).toMatchObject({ kind: "macroName", template: "m.peb" })
    expect(ctx("{% from 'm.peb' import a, §")).toMatchObject({ kind: "macroName" })
    expect(ctx("{% from 'm.peb' import a as §").kind).toBe("none")
    expect(ctx("{% if §")).toMatchObject({ kind: "expression", tag: "if" })
  })

  test("argument positions", () => {
    expect(ctx("{{ d | date(§")).toMatchObject({
      kind: "expression",
      callee: "date",
      calleeKind: "filter",
      argIndex: 0,
    })
    expect(ctx('{{ d | date("y", §')).toMatchObject({ callee: "date", argIndex: 1 })
    expect(ctx("{{ max(a, §")).toMatchObject({ callee: "max", calleeKind: "function", argIndex: 1 })
    expect(ctx("{{ max(a §")).toMatchObject({ callee: "max", argIndex: undefined })
    expect(ctx("{{ f(g(1), §")).toMatchObject({ callee: "f", argIndex: 1 })
  })

  test("interpolation", () => {
    expect(ctx('{{ "Hi #{user.§}" }}')).toMatchObject({ kind: "member", base: ["user"] })
    expect(ctx('{{ "Hi #{x | §}" }}')).toMatchObject({ kind: "filterName" })
  })
})

describe("completions", () => {
  test("end tags of open blocks sort first", () => {
    const c = cursor("{% if a %}{% for x in y %}{% §")
    const items = completions(c.analysis, c.offset, spec)
    const sorted = [...items].sort((a, b) => (a.sortText ?? "").localeCompare(b.sortText ?? ""))
    expect(
      sorted
        .slice(0, 2)
        .map((i) => i.label)
        .sort(),
    ).toEqual(["else", "endfor"])
    expect(items.find((i) => i.label === "endif")?.sortText).toMatch(/^1_/)
    expect(items.find((i) => i.label === "elseif")?.sortText).toMatch(/^1_/)
    expect(items.find((i) => i.label === "endblock")?.sortText).toMatch(/^3_/)
  })

  test("endblock inserts the block name", () => {
    const c = cursor("{% block content %}{% §")
    const item = completions(c.analysis, c.offset, spec).find((i) => i.label === "endblock")
    expect(item?.insertText).toBe("endblock content")
  })

  test("filters include snippets for parameters", () => {
    const c = cursor("{{ x | §")
    const items = completions(c.analysis, c.offset, spec)
    expect(items.map((i) => i.label)).toContain("abbreviate")
    expect(items.find((i) => i.label === "abbreviate")?.insertText).toBe("abbreviate(${1:length})")
    expect(items.find((i) => i.label === "upper")?.insertText).toBeUndefined()
    expect(items.find((i) => i.label === "date")?.insertText).toBe("date(${1:format})")
  })

  test("variables in scope", () => {
    const l = labels("{% set title = 1 %}{% for item in items %}{{ §")
    expect(l).toContain("title")
    expect(l).toContain("item")
    expect(l).toContain("loop")
    expect(l).not.toContain("_context")
    expect(labels("{% for item in items %}{% endfor %}{{ §")).not.toContain("item")
    expect(labels("{% macro m(a, b) %}{{ §")).toEqual(
      expect.arrayContaining(["a", "b", "_context"]),
    )
    expect(labels("{{ § }}{% set later = 1 %}")).not.toContain("later")
  })

  test("functions, macros, imports and keywords", () => {
    const l = labels(
      '{% import "f.peb" as forms %}{% from "g.peb" import input as field %}{% macro local(x) %}{% endmacro %}{{ §',
    )
    expect(l).toEqual(
      expect.arrayContaining([
        "max",
        "range",
        "i18n",
        "message",
        "forms",
        "field",
        "local",
        "true",
        "null",
        "and",
        "contains",
      ]),
    )
    expect(l).not.toContain("parent")
    expect(labels("{% block b %}{{ §")).toContain("parent")
    expect(labels("{% for x in §")).toContain("in")
    expect(labels("{% include 'x' §")).toContain("with")
  })

  test("loop members and imported macros", () => {
    expect(labels("{% for x in y %}{{ loop.§")).toEqual([
      "index",
      "length",
      "first",
      "last",
      "revindex",
    ])
    expect(labels("{{ loop.§")).toEqual([])
    const l = labels('{% import "f.peb" as forms %}{{ forms.§', {
      importedMacros: () => ["input", "textarea"],
    })
    expect(l).toEqual(["input", "textarea"])
    expect(labels("{% from 'm.peb' import §", { importedMacros: () => ["a"] })).toEqual(["a"])
  })

  test("named arguments", () => {
    const l = labels('{{ d | date("y", §')
    expect(l.slice(0, 3)).toEqual(["format=", "existingFormat=", "timeZone="])
    expect(labels("{{ max(§")).not.toContain("values=")
  })

  test("template names and escape strategies", () => {
    expect(labels('{% extends "§', { templateNames: ["base.peb", "layouts/x.peb"] })).toEqual([
      "base.peb",
      "layouts/x.peb",
    ])
    expect(labels('{% extends "lay§', { templateNames: ["base.peb", "layouts/x.peb"] })).toEqual([
      "layouts/x.peb",
    ])
    expect(labels('{% autoescape "§')).toEqual(["html", "js", "css", "url_param", "json"])
  })

  test("nothing outside pebble", () => {
    expect(labels('<div data-signals="{a: §}">')).toEqual([])
    expect(labels("<p>§</p>")).toEqual([])
  })

  test("custom filters and spring toggle", () => {
    const custom = buildSpec({
      customFilters: [{ name: "money", params: ["currency"] }],
      spring: false,
    })
    const c = cursor("{{ x | §")
    const items = completions(c.analysis, c.offset, custom)
    expect(items.find((i) => i.label === "money")?.insertText).toBe("money(${1:currency})")
    const fns = cursor("{{ §")
    expect(completions(fns.analysis, fns.offset, custom).map((i) => i.label)).not.toContain(
      "message",
    )
  })
})

describe("hover", () => {
  const h = (src: string) => {
    const c = cursor(src)
    return hover(c.analysis, c.offset, spec)?.markdown
  }
  test("tags, filters, tests, functions, loop", () => {
    expect(h("{% i§f x %}{% endif %}")).toContain("Conditional rendering")
    expect(h("{% if x %}{% end§if %}")).toContain("Closes an `if`")
    expect(h("{% if x %}{% else§ %}{% endif %}")).toContain("fallback")
    expect(h("{{ x | ab§breviate(3) }}")).toContain("abbreviate(length)")
    expect(h("{{ x is em§pty }}")).toContain("is empty")
    expect(h("{{ ma§x(1, 2) }}")).toContain("Largest")
    expect(h("{% for i in x %}{{ loop.rev§index }}{% endfor %}")).toContain("remaining")
    expect(h("{% filter up§per %}x{% endfilter %}")).toContain("Upper-cases")
    expect(h("{{ x | cust§om }}")).toContain("not built in")
  })
  test("variables and templates", () => {
    expect(h("{% set title = 1 %}\n{{ ti§tle }}")).toContain("line 1")
    expect(h("{% for u in users %}{{ u§ }}{% endfor %}")).toContain("Loop variable")
    expect(h("{% macro m(a) %}{{ a§ }}{% endmacro %}")).toContain("Macro parameter")
    expect(h('{% extends "ba§se.peb" %}')).toContain("Template `base.peb`")
    expect(h("{{ unkn§own }}")).toBeUndefined()
    expect(h("<p>§</p>")).toBeUndefined()
    const c = cursor('{% include "x§.peb" %}')
    expect(
      hover(c.analysis, c.offset, spec, { resolveTemplate: () => "/t/x.peb" })?.markdown,
    ).toContain("/t/x.peb")
    expect(hover(c.analysis, c.offset, spec, { resolveTemplate: () => null })?.markdown).toContain(
      "Not found",
    )
  })
})

describe("signature help", () => {
  const sig = (src: string) => {
    const c = cursor(src)
    return signatureHelp(c.analysis, c.offset, spec)
  }
  test("filters and functions with active parameter", () => {
    expect(sig("{{ d | date(§) }}")).toMatchObject({
      label: "date(format, existingFormat?, timeZone?)",
      activeParameter: 0,
    })
    expect(sig('{{ d | date("y", §) }}')).toMatchObject({ activeParameter: 1 })
    expect(sig('{{ d | date("y", timeZone="U§TC") }}')).toMatchObject({ activeParameter: 2 })
    expect(sig("{{ range(1, 2, §) }}")).toMatchObject({ activeParameter: 2 })
    expect(sig("{{ max(1, 2, 3, §) }}")).toMatchObject({ activeParameter: 0 })
    expect(sig("{{ i18n('b', 'k', 1, 2§) }}")).toMatchObject({ activeParameter: 2 })
    expect(sig("{{ d | date(1) + §x }}")).toBeNull()
    expect(sig("{% macro m(a, b) %}{% endmacro %}{{ m(1, §) }}")).toMatchObject({
      label: "m(a, b)",
      activeParameter: 1,
    })
    expect(sig("{% filter date(§) %}x{% endfilter %}")).toMatchObject({ activeParameter: 0 })
  })
  test("works while the call is still being typed", () => {
    expect(sig('{{ d | date("y", §')).toMatchObject({
      label: "date(format, existingFormat?, timeZone?)",
      activeParameter: 1,
    })
    expect(sig("{{ max(1, §")).toMatchObject({ activeParameter: 0 })
    expect(sig('{{ d | date("y", timeZone=§')).toMatchObject({ activeParameter: 2 })
    expect(sig("{% macro m(a, b) %}{% endmacro %}{{ m(1, §")).toMatchObject({
      label: "m(a, b)",
      activeParameter: 1,
    })
    expect(sig("{{ nope(§")).toBeNull()
    expect(sig("{{ a + §")).toBeNull()
    expect(sig("<p>(§")).toBeNull()
  })
})

describe("symbols and folding", () => {
  test("outline", () => {
    const text =
      "{% block a %}{% set v = 1 %}{% macro m(x) %}{% block inner %}{% endblock %}{% endmacro %}{% endblock %}{% if t %}{% set w = 2 %}{% endif %}"
    const syms = documentSymbols(cursor(`${text}§`).analysis)
    expect(syms.map((s) => `${s.kind}:${s.name}`)).toEqual(["block:a", "variable:w"])
    expect(syms[0].children.map((s) => `${s.kind}:${s.name}`)).toEqual(["variable:v", "macro:m"])
    expect(syms[0].children[1].children[0].name).toBe("inner")
  })
  test("folding covers closed blocks, branches and comments", () => {
    const text = "{% if a %}\nx\n{% else %}\ny\n{% endif %}\n{# c\n d #}\n{% for i in x %}"
    const f = foldingRanges(cursor(`${text}§`).analysis)
    expect(f.map((r) => text.slice(r.start, r.end))).toEqual([
      "{% if a %}\nx\n{% else %}\ny\n{% endif %}",
      "{% if a %}\nx\n",
      "{% else %}\ny\n",
      "{# c\n d #}",
    ])
  })
})

describe("definition", () => {
  const def = (src: string) => {
    const c = cursor(src)
    return definition(c.analysis, c.offset)
  }
  test("templates, blocks, macros, variables", () => {
    expect(def('{% extends "ba§se.peb" %}')).toMatchObject({ kind: "template", name: "base.peb" })
    expect(def('{% include x ? "a" : "b§" %}')).toBeNull()
    expect(def("{% block con§tent %}{% endblock %}")).toMatchObject({
      kind: "block",
      name: "content",
      parentOnly: true,
    })
    expect(def("{% block content %}{% endblock con§tent %}")).toMatchObject({
      kind: "block",
      parentOnly: false,
    })
    expect(def("{% block c %}{{ par§ent() }}{% endblock %}")).toMatchObject({
      kind: "block",
      name: "c",
      parentOnly: true,
    })
    expect(def("{{ par§ent() }}")).toBeNull()
    expect(def('{% block s %}{% endblock %}{{ block("s§") }}')).toMatchObject({
      kind: "block",
      name: "s",
      parentOnly: false,
      localSelectionRange: { start: 9, end: 10 },
    })
    expect(def("{% macro m(a) %}{% endmacro %}{{ m§(1) }}")).toMatchObject({
      kind: "macro",
      name: "m",
      localSelectionRange: { start: 9, end: 10 },
    })
    expect(def('{% from "f.peb" import input as fi %}{{ f§i() }}')).toMatchObject({
      kind: "macro",
      name: "input",
      template: "f.peb",
    })
    expect(def('{% from "f.peb" import inp§ut %}')).toMatchObject({
      kind: "macro",
      name: "input",
      template: "f.peb",
    })
    expect(def('{% import "f.peb" as forms %}{{ forms.inp§ut() }}')).toMatchObject({
      kind: "macro",
      name: "input",
      template: "f.peb",
    })
    expect(def("{% set x = 1 %}{{ x§ }}")).toMatchObject({
      kind: "variable",
      localSelectionRange: { start: 7, end: 8 },
    })
    expect(def("{% for u in users %}{{ u§ }}{% endfor %}")).toMatchObject({
      kind: "variable",
      name: "u",
    })
    expect(def("{{ y§ }}")).toBeNull()
  })
})

describe("diagnostics", () => {
  const codes = (src: string, options = {}) =>
    diagnostics(cursor(`${src}§`).analysis, spec, options).map((d) => d.code)
  test("semantic checks", () => {
    expect(codes("{{ x | nope }}")).toEqual(["W001"])
    expect(codes("{% filter nope %}x{% endfilter %}")).toEqual(["W001"])
    expect(codes("{{ x is nope }}")).toEqual(["W002"])
    expect(codes("{{ nope() }}")).toEqual([])
    expect(codes("{{ nope() }}", { settings: { unknownFunction: "warning" } })).toEqual(["W003"])
    expect(
      codes("{% macro m() %}{% endmacro %}{{ m() }}", { settings: { unknownFunction: "warning" } }),
    ).toEqual([])
    expect(
      codes("{% from 'x' import a as b %}{{ b() }}", { settings: { unknownFunction: "warning" } }),
    ).toEqual([])
    expect(codes("{{ loop.index }}")).toEqual(["W004"])
    expect(codes("{% for i in x %}{{ loop.index }}{% endfor %}")).toEqual([])
    expect(codes("{{ parent() }}")).toEqual(["W007"])
    expect(codes("{% block b %}{{ parent() }}{% endblock %}")).toEqual([])
    expect(codes("{{ x | nope }}", { settings: { unknownFilter: "off" } })).toEqual([])
    expect(
      diagnostics(cursor("{{ x | nope }}§").analysis, spec, {
        settings: { unknownFilter: "error" },
      })[0].severity,
    ).toBe("error")
  })
  test("missing templates", () => {
    expect(
      codes('{% extends "a.peb" %}{% include "b.peb" %}', {
        templateExists: (n: string) => n === "a.peb",
      }),
    ).toEqual(["W006"])
    expect(codes('{% extends "a.peb" %}', { templateExists: () => undefined })).toEqual([])
    expect(codes('{% extends a ? "x" : "y" %}', { templateExists: () => false })).toEqual([])
  })
  test("syntax diagnostics are included", () => {
    expect(codes("{% if x %}")).toEqual(["E005"])
  })
})
