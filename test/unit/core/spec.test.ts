import { describe, expect, test } from "bun:test"
import { buildSpec, closesTag, tags } from "../../../src/core/spec"

// The reference lists from Pebble 4.1.2 (CoreExtension.java, EscaperExtension, I18nExtension, SpringExtension).
const REFERENCE = {
  tags: "autoescape endautoescape block endblock cache endcache embed endembed extends filter endfilter flush for endfor from if elseif else endif import include macro endmacro parallel endparallel set verbatim endverbatim",
  filters:
    "abbreviate abs base64decode base64encode capitalize date default escape first format join last length lower merge nl2br numberformat raw replace reverse rsort sha256 slice sort split title trim upper urlencode",
  functions: "block parent max min range i18n",
  spring:
    "message href hasErrors hasGlobalErrors hasFieldErrors getAllErrors getGlobalErrors getFieldErrors",
  tests: "empty even odd null map iterable defined",
}
const list = (s: string) => s.split(" ").sort()

describe("spec completeness", () => {
  test("matches the Pebble 4.1.2 reference lists exactly", () => {
    const s = buildSpec({ spring: true })
    expect([...s.tags.keys()].sort()).toEqual(list(REFERENCE.tags))
    expect([...s.filters.keys()].sort()).toEqual(list(REFERENCE.filters))
    expect([...s.functions.keys()].sort()).toEqual(
      list(`${REFERENCE.functions} ${REFERENCE.spring}`),
    )
    expect([...buildSpec({ spring: false }).functions.keys()].sort()).toEqual(
      list(REFERENCE.functions),
    )
    expect([...s.tests.keys()].sort()).toEqual(list(REFERENCE.tests))
  })

  test("every entry has a signature, docs and a doc link", () => {
    const s = buildSpec()
    for (const e of [
      ...s.tags.values(),
      ...s.filters.values(),
      ...s.functions.values(),
      ...s.tests.values(),
    ]) {
      expect(e.signature.length).toBeGreaterThan(0)
      expect(e.doc.length).toBeGreaterThan(10)
      expect(e.docUrl).toMatch(/^https:\/\/pebbletemplates\.io\//)
    }
  })

  test("block tags have end tags and closesTag maps back", () => {
    for (const t of tags) {
      if (!t.block) continue
      expect(t.endTag).toBeDefined()
      expect(closesTag.get(t.endTag as string)).toContain(t.name)
    }
    expect(closesTag.get("else")).toEqual(["if", "for"])
    expect(closesTag.get("elseif")).toEqual(["if"])
  })

  test("custom entries are merged", () => {
    const s = buildSpec({
      customFilters: [{ name: "money", params: ["currency"], description: "Formats money" }],
      customTests: [{ name: "adult" }],
      customTags: ["mytag"],
    })
    expect(s.filters.get("money")?.signature).toBe("money(currency)")
    expect(s.filters.get("money")?.doc).toBe("Formats money")
    expect(s.tests.get("adult")?.source).toBe("custom")
    expect(s.customTags.has("mytag")).toBe(true)
  })
})
