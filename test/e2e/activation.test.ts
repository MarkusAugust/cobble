import * as assert from "node:assert/strict"
import * as vscode from "vscode"
import { EXTENSION_ID, open } from "./helpers"

describe("activation", () => {
  it("activates on a .peb file and assigns the pebble language", async () => {
    const doc = await open("templates/child.peb")
    assert.equal(doc.languageId, "pebble")
    assert.equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true)
  })
})
