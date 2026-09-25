import * as assert from "node:assert/strict"
import * as vscode from "vscode"
import { after, completionsAt, label, open, ours, waitFor } from "../helpers"

describe("datastar side by side", () => {
  it("enables datastar for pebble files through the command", async () => {
    await open("pages/datastar.peb")
    assert.ok(
      vscode.extensions.getExtension("starfederation.datastar-vscode"),
      "datastar extension should be installed in the test instance",
    )
    await vscode.commands.executeCommand("pebble.enableDatastarSupport")
    const languages = await waitFor(
      () => vscode.workspace.getConfiguration("datastar").get<string[]>("enabledLanguages") ?? [],
      (l) => l.includes("pebble"),
    )
    assert.ok(languages.includes("pebble"))
    assert.ok(languages.includes("html"), "existing entries must be kept")
  })

  it("datastar completes signals in .peb files while pebble stays quiet there", async () => {
    const doc = await open("pages/datastar.peb")
    const position = after(doc, 'data-on:click="$')
    // Datastar labels signals with the dollar prefix; give its server a moment to pick up the setting.
    let labels: string[] = []
    for (let i = 0; i < 40 && !labels.includes("$count"); i++) {
      labels = (await completionsAt(doc, position)).map(label)
      if (!labels.includes("$count")) await new Promise((r) => setTimeout(r, 250))
    }
    assert.ok(
      labels.includes("$count"),
      `datastar should suggest $count in a .peb file, got ${labels.join(",")}`,
    )
    assert.deepEqual(ours(await completionsAt(doc, position)).map(label), [])
  })

  it("pebble completes inside {{ }} in a datastar attribute value", async () => {
    const doc = await open("pages/datastar.peb")
    const labels = ours(await completionsAt(doc, after(doc, "{count: {{ "))).map(label)
    assert.ok(labels.includes("max"), "pebble functions should be offered inside {{ }}")
  })
})
