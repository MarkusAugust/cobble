import { describe, expect, test } from "bun:test"
import { TextDocument } from "vscode-languageserver-textdocument"
import { analyze } from "../../../src/core"
import { HtmlDelegate } from "../../../src/server/html"

const doc = (text: string) => TextDocument.create("file:///t.peb", "pebble", 1, text)

describe("html delegation", () => {
  test("completes html tags outside pebble regions and stays quiet inside", () => {
    const text = '<div class="{{ cls }}"><sp</div>{{ x }}'
    const d = doc(text)
    const { regions } = analyze(text)
    const offset = text.indexOf("<sp") + 3
    expect(HtmlDelegate.insidePebble(regions, offset)).toBe(false)
    const list = new HtmlDelegate().complete(d, d.positionAt(offset), regions)
    expect(list.items.map((i) => i.label)).toContain("span")
    expect(HtmlDelegate.insidePebble(regions, text.indexOf("cls"))).toBe(true)
  })
  test("hover on an html tag with pebble in attributes", () => {
    const text = '<div class="{{ cls }}">x</div>'
    const d = doc(text)
    const { regions } = analyze(text)
    const h = new HtmlDelegate().hover(d, d.positionAt(2), regions)
    expect(JSON.stringify(h?.contents)).toContain("div")
  })
  test("folding and symbols come from the masked document", () => {
    const text = "<div>\n{{ a }}\n<p>{% if x %}{% endif %}</p>\n</div>"
    const d = doc(text)
    const { regions } = analyze(text)
    const delegate = new HtmlDelegate()
    expect(delegate.foldingRanges(d, regions)).toEqual([{ startLine: 0, endLine: 2 }])
    expect(delegate.symbols(d, regions).map((s) => s.name)).toEqual(["div"])
  })
})
