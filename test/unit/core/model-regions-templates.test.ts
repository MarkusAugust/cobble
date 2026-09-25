import { describe, expect, test } from "bun:test"
import {
  analyze,
  defaultTemplateSettings,
  findPebbleRegions,
  hasPebble,
  isInsideExpression,
  listTemplates,
  maskPebble,
  regionAt,
  resolveTemplate,
  scopeAt,
  type TemplateFileSystem,
  templateCandidates,
} from "../../../src/core"

describe("model", () => {
  test("collects declarations and references", () => {
    const a = analyze(
      '{% extends "base.peb" %}{% import "f.peb" as forms %}{% from "g.peb" import a %}{% include x %}{% embed "c.peb" %}{% endembed %}{% block b %}{% macro m(p) %}{% endmacro %}{% set v = 1 %}{% endblock %}',
    )
    expect(a.model.extends?.literalName).toBe("base.peb")
    expect(a.model.includes.map((r) => r.literalName)).toEqual([undefined, "c.peb"])
    expect(a.model.imports.map((i) => `${i.kind}:${i.ref.literalName}`)).toEqual([
      "import:f.peb",
      "from:g.peb",
    ])
    expect(a.model.blocks.map((b) => b.name)).toEqual(["b"])
    expect(a.model.macros.map((m) => `${m.name}(${m.params})`)).toEqual(["m(p)"])
    expect(a.model.sets.map((s) => s.name)).toEqual(["v"])
    expect(a.model.references).toHaveLength(5)
  })

  test("scope respects position and nesting", () => {
    const text =
      "{% set a = 1 %}{% for i in x %}{% set b = 2 %}{{ HERE }}{% else %}{{ ELSE }}{% endfor %}{% set c = 3 %}"
    const a = analyze(text)
    const here = scopeAt(a.ast, a.model, text.indexOf("HERE"))
    expect(here.variables.map((v) => v.name)).toEqual(["a", "i", "loop", "b"])
    expect(here.inFor).toBe(true)
    const inElse = scopeAt(a.ast, a.model, text.indexOf("ELSE"))
    expect(inElse.variables.map((v) => v.name)).toEqual(["a"])
    const after = scopeAt(a.ast, a.model, text.length)
    expect(after.variables.map((v) => v.name)).toEqual(["a", "c"])
    expect(after.inFor).toBe(false)
  })
})

describe("regions", () => {
  const text =
    '<a href="{{ url }}">{% if x %}{# c #}{% verbatim %}{{ raw }}{% endverbatim %}{{ open'
  test("finds all regions including verbatim and unclosed", () => {
    const r = findPebbleRegions(text)
    expect(r.map((x) => `${x.kind}:${text.slice(x.start, x.end)}`)).toEqual([
      "print:{{ url }}",
      "execute:{% if x %}",
      "comment:{# c #}",
      "verbatim:{% verbatim %}{{ raw }}{% endverbatim %}",
      "print:{{ open",
    ])
    expect(r[4].end).toBe(text.length)
  })
  test("regionAt and isInsideExpression", () => {
    const r = findPebbleRegions(text)
    expect(regionAt(r, text.indexOf("url"))?.kind).toBe("print")
    expect(regionAt(r, 0)).toBeNull()
    expect(regionAt(r, text.indexOf("raw"))?.kind).toBe("verbatim")
    expect(isInsideExpression(r, text.indexOf("raw"))).toBe(false)
    expect(isInsideExpression(r, text.indexOf(" x %}") + 1)).toBe(true)
    expect(isInsideExpression(r, text.indexOf("{{ url") + 2)).toBe(true)
    expect(isInsideExpression(r, text.indexOf("{{ url") + 1)).toBe(false)
  })
  test("mask keeps offsets and newlines", () => {
    const src = "<p>{{ a\nb }}</p>{% if x %}<i>"
    const masked = maskPebble(src, findPebbleRegions(src))
    expect(masked.length).toBe(src.length)
    expect(masked).toBe("<p>    \n    </p>          <i>")
    expect(hasPebble("<p>")).toBe(false)
    expect(hasPebble("{#")).toBe(true)
  })
})

describe("templates", () => {
  const files = new Set([
    "/ws/src/main/resources/templates/base.peb",
    "/ws/src/main/resources/templates/layouts/main.peb",
    "/ws/src/main/resources/templates/pages/home.peb",
    "/ws/templates/legacy.html",
  ])
  const fs: TemplateFileSystem = {
    workspaceFolders: ["/ws"],
    exists: async (p) => files.has(p),
    readDir: async (dir) => {
      const out = new Map<string, boolean>()
      for (const f of files) {
        if (!f.startsWith(`${dir}/`)) continue
        const rest = f.slice(dir.length + 1)
        const head = rest.split("/")[0]
        out.set(head, rest.includes("/"))
      }
      return [...out].map(([name, isDirectory]) => ({ name, isDirectory }))
    },
  }
  test("candidates prefer the current directory, then roots, then suffixes", () => {
    const c = templateCandidates(
      "base",
      "/ws/src/main/resources/templates/pages/home.peb",
      defaultTemplateSettings,
      ["/ws"],
    )
    expect(c.slice(0, 4)).toEqual([
      "/ws/src/main/resources/templates/pages/base",
      "/ws/src/main/resources/templates/pages/base.peb",
      "/ws/src/main/resources/templates/pages/base.pebble",
      "/ws/src/main/resources/templates/pages/base.html",
    ])
    expect(c).toContain("/ws/src/main/resources/templates/base.peb")
    expect(templateCandidates("x.peb", undefined, defaultTemplateSettings, ["/ws"])).not.toContain(
      "/ws/x.peb.peb",
    )
  })
  test("resolve and list", async () => {
    expect(
      await resolveTemplate(
        "base",
        "/ws/src/main/resources/templates/pages/home.peb",
        defaultTemplateSettings,
        fs,
      ),
    ).toBe("/ws/src/main/resources/templates/base.peb")
    expect(await resolveTemplate("layouts/main.peb", undefined, defaultTemplateSettings, fs)).toBe(
      "/ws/src/main/resources/templates/layouts/main.peb",
    )
    expect(await resolveTemplate("legacy", undefined, defaultTemplateSettings, fs)).toBe(
      "/ws/templates/legacy.html",
    )
    expect(await resolveTemplate("nope", undefined, defaultTemplateSettings, fs)).toBeNull()
    const names = (await listTemplates(undefined, defaultTemplateSettings, fs))
      .map((t) => t.name)
      .sort()
    expect(names).toEqual([
      "base.peb",
      "layouts/main.peb",
      "legacy.html",
      "pages/home.peb",
      "templates/base.peb",
      "templates/layouts/main.peb",
      "templates/pages/home.peb",
    ])
  })
})
