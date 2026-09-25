import * as assert from "node:assert/strict"
import * as vscode from "vscode"
import { after, definitionAt, foldingOf, open, symbolsOf } from "./helpers"

const endsWith = (uri: vscode.Uri, suffix: string) => uri.path.endsWith(suffix)

describe("navigation", () => {
  it("goes to extended, imported and parent-block definitions", async () => {
    const doc = await open("templates/child.peb")
    const ext = await definitionAt(doc, after(doc, '{% extends "ba'))
    assert.ok(
      ext[0] && endsWith(ext[0].targetUri, "templates/base.peb"),
      "extends should resolve to base.peb",
    )

    const block = await definitionAt(doc, after(doc, "{% block cont"))
    assert.ok(block[0] && endsWith(block[0].targetUri, "templates/base.peb"))
    assert.equal(block[0].targetSelectionRange?.start.line, 4)

    const parent = await definitionAt(doc, after(doc, "{{ par"))
    assert.ok(parent[0] && endsWith(parent[0].targetUri, "templates/base.peb"))

    const aliasMacro = await definitionAt(doc, after(doc, "forms.inp"))
    assert.ok(aliasMacro[0] && endsWith(aliasMacro[0].targetUri, "templates/macros.peb"))
    assert.equal(aliasMacro[0].targetSelectionRange?.start.line, 0)

    const fromMacro = await definitionAt(doc, after(doc, "{{ fie"))
    assert.ok(fromMacro[0] && endsWith(fromMacro[0].targetUri, "templates/macros.peb"))

    const loopVar = await definitionAt(doc, after(doc, "{{ item.na", -3))
    assert.ok(loopVar[0] && endsWith(loopVar[0].targetUri, "templates/child.peb"))
    assert.equal(loopVar[0].targetSelectionRange?.start.line, 5)
  })

  it("lists blocks in the outline and folds blocks and loops", async () => {
    const doc = await open("templates/child.peb")
    const symbols = await symbolsOf(doc)
    const blocks = symbols.filter((s) => s.kind === vscode.SymbolKind.Namespace).map((s) => s.name)
    assert.deepEqual(blocks, ["title", "content"])
    const folds = await foldingOf(doc)
    assert.ok(
      folds.some((f) => f.start === 4 && f.end === 11),
      "content block should fold",
    )
    assert.ok(
      folds.some((f) => f.start === 5 && f.end === 7),
      "for loop should fold",
    )
  })
})
