import * as assert from "node:assert/strict"
import { diagnosticsFor, open, pebbleDiagnostics, sleep } from "./helpers"

describe("diagnostics", () => {
  it("reports unclosed tags, unknown filters and missing templates", async () => {
    const doc = await open("templates/broken.peb")
    const diags = await diagnosticsFor(doc.uri, 3)
    const codes = diags.map((d) => String(d.code)).sort()
    assert.deepEqual(codes, ["E005", "W001", "W006"])
  })

  it("reports nothing for valid templates and plain html", async () => {
    const child = await open("templates/child.peb")
    await sleep(800)
    assert.deepEqual(pebbleDiagnostics(child.uri), [])
    const plain = await open("pages/plain.html")
    await sleep(800)
    assert.deepEqual(pebbleDiagnostics(plain.uri), [])
  })
})
