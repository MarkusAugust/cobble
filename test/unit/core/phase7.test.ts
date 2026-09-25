import { describe, expect, test } from "bun:test"
import {
  analyze,
  autoCloseTag,
  codeActions,
  completions,
  diagnostics,
  linkedEditingRanges,
  TemplateGraph,
} from "../../../src/core"
import { cursor, spec } from "./helpers"

describe("auto close", () => {
  const close = (src: string) => {
    const c = cursor(src)
    return autoCloseTag(c.analysis, c.offset)
  }
  test("returns the end tag right after an unclosed block tag", () => {
    expect(close("{% if x %}§")).toBe("{% endif %}")
    expect(close("{%- for i in x -%}§")).toBe("{%- endfor -%}")
    expect(close("{% block a %}§")).toBe("{% endblock %}")
    expect(close("{% macro m() %}§\n")).toBe("{% endmacro %}")
  })
  test("stays quiet when closed, not a block, or elsewhere", () => {
    expect(close("{% if x %}§{% endif %}")).toBeNull()
    expect(close("{% set a = 1 %}§")).toBeNull()
    expect(close("{% include 'x' %}§")).toBeNull()
    expect(close("{% if x %} §")).toBeNull()
    expect(close("{% verbatim %}§")).toBeNull()
    expect(close("{% else %}§")).toBeNull()
  })
  test("linked editing pairs block names", () => {
    const c = cursor("{% block con§tent %}x{% endblock content %}")
    expect(linkedEditingRanges(c.analysis, c.offset)).toEqual([
      { start: 9, end: 16 },
      { start: 32, end: 39 },
    ])
    const e = cursor("{% block content %}x{% endblock con§tent %}")
    expect(linkedEditingRanges(e.analysis, e.offset)?.length).toBe(2)
    expect(
      linkedEditingRanges(cursor("{% block content %}x{% endblock %}§").analysis, 10),
    ).toBeNull()
  })
})

describe("code actions", () => {
  const actionsFor = (text: string) => {
    const a = analyze(text)
    return codeActions(a, diagnostics(a, spec, { templateExists: () => false }))
  }
  test("inserts a missing end tag with indentation", () => {
    const text = "<div>\n  {% if x %}\n    hi\n"
    const [action] = actionsFor(text)
    expect(action.kind).toBe("edit")
    if (action.kind !== "edit") return
    expect(action.title).toBe("Insert {% endif %}")
    const edit = action.edits[0]
    const result = text.slice(0, edit.start) + edit.newText + text.slice(edit.end)
    expect(result).toBe("<div>\n  {% if x %}\n    hi\n  {% endif %}\n")
    const inline = actionsFor("x {% for i in x %}{{ i }}")
    expect(inline[0].kind === "edit" && inline[0].edits[0].newText).toBe("{% endfor %}")
  })
  test("fixes endblock names, offers to create templates and declare custom entries", () => {
    const rename = actionsFor("{% block a %}{% endblock b %}")
    expect(rename[0].kind === "edit" && rename[0].edits[0]).toMatchObject({
      start: 25,
      end: 26,
      newText: "a",
    })
    const create = actionsFor('{% include "menu.peb" %}')
    expect(create[0]).toMatchObject({ kind: "createFile", templateName: "menu.peb" })
    const custom = actionsFor("{{ x | money }}{{ y is adult }}{% mytag %}")
    expect(
      custom.map((a) => (a.kind === "addCustom" ? `${a.entryKind}:${a.name}` : a.kind)),
    ).toEqual(["tag:mytag", "filter:money", "test:adult"])
  })
})

describe("template graph", () => {
  const files: Record<string, string> = {
    "/t/base.peb": "{% block title %}{% endblock %}{% block content %}{% endblock %}",
    "/t/layout.peb":
      '{% extends "base.peb" %}{% block content %}{% block inner %}{% endblock %}{% endblock %}',
    "/t/page.peb":
      '{% extends "layout.peb" %}{% import "macros.peb" as m %}{% block inner %}{% endblock %}',
    "/t/other.peb": '{% include "page.peb" %}',
    "/t/macros.peb": "{% macro a() %}{% endmacro %}",
    "/t/loop.peb": '{% extends "loop.peb" %}',
  }
  const graph = new TemplateGraph(
    async (name) => (files[`/t/${name}`] ? `/t/${name}` : null),
    async (p) => (files[p] ? analyze(files[p]) : null),
    async () => Object.keys(files),
  )
  test("parent chain and inherited blocks", async () => {
    const chain = await graph.parentChain("/t/page.peb", analyze(files["/t/page.peb"]))
    expect(chain.map((c) => `${c.depth}:${c.filePath}`)).toEqual([
      "1:/t/layout.peb",
      "2:/t/base.peb",
    ])
    const blocks = await graph.inheritedBlocks("/t/page.peb", analyze(files["/t/page.peb"]))
    expect(blocks.map((b) => `${b.name}<${b.from.filePath}`)).toEqual([
      "content</t/layout.peb",
      "inner</t/layout.peb",
      "title</t/base.peb",
    ])
    expect(await graph.parentChain("/t/loop.peb", analyze(files["/t/loop.peb"]))).toEqual([])
  })
  test("children, descendants and importers", async () => {
    expect((await graph.childrenOf("/t/base.peb")).map((e) => e.filePath)).toEqual([
      "/t/layout.peb",
    ])
    expect((await graph.descendantsOf("/t/base.peb")).map((e) => e.filePath)).toEqual([
      "/t/layout.peb",
      "/t/page.peb",
    ])
    expect((await graph.importersOf("/t/macros.peb")).map((e) => e.filePath)).toEqual([
      "/t/page.peb",
    ])
    expect((await graph.importersOf("/t/page.peb")).map((e) => e.filePath)).toEqual([
      "/t/other.peb",
    ])
  })
  test("inherited blocks feed completion", async () => {
    const c = cursor('{% extends "layout.peb" %}{% block title %}{% endblock %}{% block §')
    const inherited = (await graph.inheritedBlocks("/t/x.peb", c.analysis)).map((b) => ({
      name: b.name,
      from: b.from.filePath,
    }))
    const items = completions(c.analysis, c.offset, spec, { inheritedBlocks: inherited })
    expect(items.map((i) => `${i.label}:${i.sortText}`)).toEqual([
      "content:0_content",
      "inner:0_inner",
      "title:1_title",
    ])
  })
})

describe("references", () => {
  const { documentLinks, inlayHints, lensAnchors, localReferences, symbolAt } =
    require("../../../src/core") as typeof import("../../../src/core")
  const refs = (src: string) => {
    const c = cursor(src)
    const s = symbolAt(c.analysis, c.offset)
    return s
      ? {
          symbol: s,
          ranges: localReferences(c.analysis, s).map(
            (r) => c.text.slice(r.start, r.end) + "@" + r.start,
          ),
        }
      : null
  }
  test("blocks: names, end names and block() calls", () => {
    const r = refs(
      '{% block a %}{% endblock a %}{{ block("a") }}{% block b %}{% endblock %}{% block a§ %}{% endblock %}',
    )
    expect(r?.symbol.kind).toBe("block")
    expect(r?.ranges).toEqual(["a@9", "a@25", "a@39", "a@81"])
  })
  test("macros: local definitions and calls", () => {
    const r = refs("{% macro m(a) %}{{ a }}{% endmacro %}{{ m(1) }}{{ x.m() }}{{ m§(2) }}")
    expect(r?.symbol).toMatchObject({ kind: "macro", name: "m" })
    expect(r?.ranges).toEqual(["m@9", "m@40", "m@61"])
  })
  test("imported macros through from and namespace", () => {
    const src =
      '{% import "f.peb" as forms %}{% from "f.peb" import input as field, other %}{{ forms.input() }}{{ field() }}{{ other() }}{{ forms.inp§ut() }}'
    const r = refs(src)
    expect(r?.symbol).toMatchObject({
      kind: "macro",
      name: "input",
      template: "f.peb",
      alias: "forms",
    })
    expect(r?.ranges?.map((x) => x.split("@")[0])).toEqual(["input", "input", "field", "input"])
    const viaField = refs('{% from "f.peb" import input as field %}{{ fie§ld() }}')
    expect(viaField?.symbol).toMatchObject({
      kind: "macro",
      name: "input",
      template: "f.peb",
      alias: "field",
    })
  })
  test("variables respect scope", () => {
    const r = refs("{% set x = 1 %}{{ x }}{% for x in xs %}{{ x§ }}{% endfor %}{{ x }}")
    expect(r?.symbol).toMatchObject({ kind: "variable", name: "x" })
    expect(r?.ranges).toEqual(["x@29", "x@42"])
    const setVar = refs("{% set x§ = 1 %}{{ x }}{% for x in xs %}{{ x }}{% endfor %}{{ x }}")
    expect(setVar?.ranges).toEqual(["x@7", "x@18", "x@61"])
    expect(refs("{{ loo§p }}")).toBeNull()
    expect(refs("{{ unknown§ }}")).toBeNull()
    const param = refs("{% macro m(a§, b) %}{{ a }}{% endmacro %}")
    expect(param?.ranges).toEqual(["a@11", "a@22"])
  })
  test("lens anchors, inlay hints and document links", () => {
    const text =
      '{% extends "b.peb" %}{% block a %}{% endblock %}{% block c %}{% endblock c %}{% macro m() %}{% endmacro %}{% include "x.peb" %}'
    const a = analyze(text)
    expect(lensAnchors(a).map((l) => l.kind + ":" + ("name" in l ? l.name : l.template))).toEqual([
      "extends:b.peb",
      "block:a",
      "block:c",
      "macro:m",
    ])
    const hints = inlayHints(a, 0, text.length)
    expect(hints).toEqual([
      { offset: text.indexOf("endblock %}") + "endblock".length, label: " a" },
    ])
    expect(documentLinks(a).map((l) => `${l.templateName}@${l.range.start}`)).toEqual([
      "b.peb@12",
      "x.peb@118",
    ])
  })
})

describe("semantic tokens", () => {
  const { semanticTokens } = require("../../../src/core") as typeof import("../../../src/core")
  test("classifies definitions, uses, macros and built-ins", () => {
    const text =
      '{% import "f.peb" as forms %}{% macro m(p) %}{{ p | upper | money }}{% endmacro %}{% for i in items %}{{ i }} {{ loop.index }} {{ unknown }} {{ m(1) }} {{ max(1) }} {{ forms.input() }} {{ request }}{% endfor %}'
    const a = analyze(text)
    const tokens = semanticTokens(a, spec).map(
      (t) =>
        `${text.slice(t.start, t.start + t.length)}:${t.type}${t.modifiers.length ? `[${t.modifiers.join(",")}]` : ""}`,
    )
    expect(tokens).toEqual([
      "forms:variable[declaration,readonly]",
      "m:macro[declaration]",
      "p:parameter[declaration]",
      "p:parameter",
      "upper:function[defaultLibrary]",
      "money:function",
      "i:variable[declaration]",
      "i:variable",
      "loop:variable[readonly]",
      "index:property[readonly]",
      "m:macro",
      "max:function[defaultLibrary]",
      "forms:variable[readonly]",
      "input:macro",
      "request:variable[readonly]",
    ])
  })
})
