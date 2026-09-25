import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const readJson = (relative: string) => JSON.parse(readFileSync(join(root, relative), "utf8"))

describe("package manifest", () => {
  const pkg = readJson("package.json")

  test("registers the pebble language with .peb and .pebble", () => {
    const pebble = pkg.contributes.languages.find((l: { id: string }) => l.id === "pebble")
    expect(pebble.extensions).toEqual([".peb", ".pebble"])
    expect(pebble.extensions).not.toContain(".html")
  })

  test("injects the Pebble grammar into html and pebble scopes only", () => {
    const injection = pkg.contributes.grammars.find(
      (g: { scopeName: string }) => g.scopeName === "injection.html.pebble",
    )
    expect(injection.injectTo).toEqual([
      "text.html.basic",
      "text.html.derivative",
      "text.html.pebble",
    ])
  })

  test("every contributed grammar and snippet file exists and is valid JSON", () => {
    for (const grammar of pkg.contributes.grammars) {
      expect(readJson(grammar.path).scopeName).toBe(grammar.scopeName)
    }
    for (const snippet of pkg.contributes.snippets) {
      expect(typeof readJson(snippet.path)).toBe("object")
    }
  })
})
