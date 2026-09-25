import * as assert from "node:assert/strict"
import * as vscode from "vscode"
import {
  after,
  completionsAt,
  diagnosticsFor,
  hoverAt,
  label,
  open,
  openUntitled,
  ours,
  waitFor,
} from "./helpers"

describe("auto close", () => {
  it("inserts the end tag after typing an opening block tag", async () => {
    const doc = await openUntitled("pebble", "{% if x %")
    const editor = vscode.window.activeTextEditor
    assert.ok(editor && editor.document === doc)
    const end = doc.positionAt(doc.getText().length)
    editor.selection = new vscode.Selection(end, end)
    await editor.edit((b) => b.insert(end, "}"))
    const text = await waitFor(
      () => doc.getText(),
      (t) => t.includes("{% endif %}"),
      5000,
    )
    assert.equal(text, "{% if x %}{% endif %}")
  })
})

describe("quick fixes", () => {
  it("offers to insert the end tag, create the template and declare the filter", async () => {
    const doc = await open("templates/broken.peb")
    const diags = await diagnosticsFor(doc.uri, 3)
    const titles: string[] = []
    for (const d of diags) {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        doc.uri,
        d.range,
      )
      titles.push(...(actions ?? []).map((a) => a.title))
    }
    assert.ok(titles.includes("Insert {% endif %}"), titles.join(" | "))
    assert.ok(titles.includes("Create template 'missing.peb'"), titles.join(" | "))
    assert.ok(titles.includes("Declare 'nope' as a custom filter in settings"), titles.join(" | "))
  })
})

describe("workspace-aware navigation", () => {
  it("completes inherited block names", async () => {
    const doc = await openUntitled("pebble", '{% extends "base.peb" %}\n{% block ')
    const labels = ours(await completionsAt(doc, after(doc, "{% block "))).map(label)
    assert.deepEqual(labels.sort(), ["content", "footer", "title"])
  })

  it("finds references across the extends chain and renames variables", async () => {
    const child = await open("templates/child.peb")
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      child.uri,
      after(child, "{% block cont"),
    )
    const files = new Set((refs ?? []).map((r) => r.uri.path.split("/").pop()))
    assert.ok(files.has("child.peb") && files.has("base.peb"), [...files].join(","))

    const doc = await openUntitled(
      "pebble",
      "{% set total = 1 %}{{ total }}{% for total in xs %}{{ total }}{% endfor %}",
    )
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      "vscode.executeDocumentRenameProvider",
      doc.uri,
      after(doc, "{% set tot"),
      "sum",
    )
    assert.equal(edit?.get(doc.uri).length, 2)
  })

  it("shows code lenses, inlay hints and document links", async () => {
    const child = await open("templates/child.peb")
    const lenses = await waitFor(
      () =>
        vscode.commands.executeCommand<vscode.CodeLens[]>(
          "vscode.executeCodeLensProvider",
          child.uri,
          20,
        ),
      () => true,
    )
    const titles = (await lenses)?.map((l) => l.command?.title ?? "") ?? []
    assert.ok(titles.includes("extends base.peb"), titles.join(" | "))
    assert.ok(titles.includes("overrides block in base.peb"), titles.join(" | "))

    const base = await open("templates/base.peb")
    const baseLenses =
      (await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider",
        base.uri,
        20,
      )) ?? []
    const baseTitles = baseLenses.map((l) => l.command?.title ?? "")
    assert.ok(baseTitles.includes("1 template extends this template"), baseTitles.join(" | "))
    assert.ok(baseTitles.includes("overridden in 1 template"), baseTitles.join(" | "))

    const hints =
      (await vscode.commands.executeCommand<vscode.InlayHint[]>(
        "vscode.executeInlayHintProvider",
        child.uri,
        new vscode.Range(0, 0, 20, 0),
      )) ?? []
    assert.ok(
      hints.some((h) => h.label === " title"),
      JSON.stringify(hints.map((h) => h.label)),
    )

    const links =
      (await vscode.commands.executeCommand<vscode.DocumentLink[]>(
        "vscode.executeLinkProvider",
        child.uri,
      )) ?? []
    assert.ok(
      links.some((l) => l.target?.path.endsWith("templates/base.peb")),
      "link to base.peb expected",
    )
  })

  it("lists workspace symbols and shows template contents on hover", async () => {
    const child = await open("templates/child.peb")
    const symbols =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        "footer",
      )) ?? []
    assert.ok(
      symbols.some((s) => s.name === "footer" && s.location.uri.path.endsWith("base.peb")),
      symbols.map((s) => s.name).join(","),
    )
    const hover = await hoverAt(child, after(child, '{% extends "ba'))
    assert.match(hover, /Blocks: `title`, `content`, `footer`/)
  })
})
