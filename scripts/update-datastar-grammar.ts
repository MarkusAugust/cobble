/**
 * Refreshes the vendored copy of the Datastar grammar that we inject into `text.html.pebble`,
 * so `.peb` files get Datastar attribute highlighting. The Datastar extension itself only
 * injects into a fixed list of scopes that does not include Pebble.
 */
import { writeFileSync } from "node:fs"

const SOURCE =
  "https://raw.githubusercontent.com/starfederation/datastar-vscode-extension/main/src/html.injection.tmLanguage.json"
const TARGET = "syntaxes/datastar-injection.tmLanguage.json"

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`download failed: ${response.status}`)
const grammar = await response.json()
grammar.scopeName = "source.datastar.html.injection.pebble"
grammar.name = "Datastar attributes (vendored for Pebble files)"
grammar.comment = `Vendored from ${SOURCE} (MIT). Regenerate with: bun scripts/update-datastar-grammar.ts`
writeFileSync(TARGET, `${JSON.stringify(grammar, null, 2)}\n`)
console.log(`updated ${TARGET}`)
