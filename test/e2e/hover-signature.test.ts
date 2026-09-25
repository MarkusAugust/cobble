import * as assert from "node:assert/strict"
import { after, hoverAt, open, openUntitled, signatureAt } from "./helpers"

describe("hover and signature help", () => {
  it("documents filters, tags and templates", async () => {
    const doc = await open("templates/child.peb")
    assert.match(await hoverAt(doc, after(doc, "| up")), /Upper-cases/)
    assert.match(await hoverAt(doc, after(doc, "{% fo")), /Iterates/)
    const template = await hoverAt(doc, after(doc, '{% extends "ba'))
    assert.match(template, /Template `base\.peb`/)
    assert.match(template, /Resolves to .*base\.peb/)
  })

  it("delegates html hover in .peb files", async () => {
    const doc = await open("templates/child.peb")
    assert.match(await hoverAt(doc, after(doc, "<l")), /li/)
  })

  it("shows signatures for filters with the active parameter", async () => {
    const doc = await openUntitled("pebble", '{{ d | date("y", ')
    const help = await signatureAt(doc, after(doc, '"y", '))
    assert.ok(help, "no signature help")
    assert.match(help.signatures[0].label, /^date\(/)
    assert.equal(help.activeParameter, 1)
  })
})
