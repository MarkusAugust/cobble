import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tags } from "../../src/core/spec"

const snippets: Record<string, { prefix: string[]; body: string[]; description: string }> =
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "snippets", "pebble.json"), "utf8"))

describe("snippets", () => {
  test("every non-end tag has a snippet that starts with the tag", () => {
    const bodies = Object.values(snippets).map((s) => s.body.join("\n"))
    for (const tag of tags) {
      if (tag.name.startsWith("end")) continue
      expect(
        bodies.some((b) => b.startsWith(`{% ${tag.name}`)),
        `missing snippet for ${tag.name}`,
      ).toBe(true)
    }
  })

  test("block snippets close themselves and place the cursor inside", () => {
    for (const tag of tags) {
      if (!tag.block) continue
      const snippet = Object.values(snippets).find((s) => s.prefix.includes(tag.name))
      expect(snippet, `no snippet with prefix ${tag.name}`).toBeDefined()
      const body = snippet?.body.join("\n") ?? ""
      expect(body).toContain(`{% ${tag.endTag}`)
      expect(body).toContain("$0")
    }
  })

  test("prefixes are unique and never start with a delimiter", () => {
    const seen = new Set<string>()
    for (const s of Object.values(snippets)) {
      for (const p of s.prefix) {
        expect(seen.has(p), `duplicate prefix ${p}`).toBe(false)
        seen.add(p)
        expect(p).toMatch(/^[a-z-]+$/)
      }
    }
  })
})
