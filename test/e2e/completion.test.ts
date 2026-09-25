import * as assert from "node:assert/strict"
import { after, completionsAt, label, open, openUntitled, ours } from "./helpers"

describe("completion", () => {
  it("offers tags with the matching end tag first", async () => {
    const doc = await openUntitled("pebble", "{% if a %}\n{% ")
    const items = ours(await completionsAt(doc, after(doc, "\n{% ")))
    const labels = items.map(label)
    assert.ok(labels.includes("endif"), `expected endif in ${labels.join(",")}`)
    assert.ok(labels.includes("for"))
    const endif = items.find((i) => label(i) === "endif")
    assert.ok(endif?.sortText?.startsWith("0_"), `endif should sort first, got ${endif?.sortText}`)
  })

  it("offers filters after a pipe, with snippets for parameters", async () => {
    const doc = await openUntitled("pebble", "{{ name | ")
    const items = ours(await completionsAt(doc, after(doc, "| ")))
    const labels = items.map(label)
    assert.ok(labels.includes("upper") && labels.includes("abbreviate"))
    const abbreviate = items.find((i) => label(i) === "abbreviate")
    const insert = abbreviate?.insertText
    assert.ok(
      insert && typeof insert !== "string" && insert.value.includes("${1:length}"),
      "abbreviate should insert a snippet",
    )
  })

  it("offers loop variables and template names", async () => {
    const doc = await openUntitled("pebble", "{% for i in items %}{{ loop.")
    assert.deepEqual(
      (await completionsAt(doc, after(doc, "loop.")))
        .map(label)
        .filter((l) => ["index", "length", "first", "last", "revindex"].includes(l))
        .sort(),
      ["first", "index", "last", "length", "revindex"],
    )
    const ext = await openUntitled("pebble", '{% extends "')
    const names = (await completionsAt(ext, after(ext, '"'))).map(label)
    assert.ok(
      names.includes("base.peb") && names.includes("child.peb"),
      `template names missing in ${names.join(",")}`,
    )
  })

  it("delegates html completion in .peb files outside pebble syntax", async () => {
    const doc = await openUntitled("pebble", "<div>{{ a }}</div><sp")
    const labels = (await completionsAt(doc, after(doc, "<sp"))).map(label)
    assert.ok(
      labels.includes("span"),
      `expected html tag completion, got ${labels.slice(0, 10).join(",")}`,
    )
  })

  it("returns nothing of its own outside pebble syntax in html files", async () => {
    const mixed = await open("pages/mixed.html")
    const inAttribute = ours(await completionsAt(mixed, after(mixed, 'class="')))
    assert.deepEqual(inAttribute.map(label), [])
    const inside = ours(await completionsAt(mixed, after(mixed, "x | ")))
    assert.ok(
      inside.map(label).includes("upper"),
      "pebble completion should work inside {{ }} in html",
    )
    const plain = await open("pages/plain.html")
    assert.deepEqual(ours(await completionsAt(plain, after(plain, "<p>"))).map(label), [])
    assert.deepEqual(ours(await completionsAt(plain, after(plain, "{n: "))).map(label), [])
  })
})
