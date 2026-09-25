import { describe, expect, test } from "bun:test"
import { defaultSettings, mergeSettings } from "../../../src/server/settings"

describe("settings", () => {
  test("defaults when nothing is configured", () => {
    expect(mergeSettings(undefined)).toEqual(defaultSettings)
    expect(mergeSettings(null)).toEqual(defaultSettings)
  })
  test("deep merge keeps unspecified nested values", () => {
    const s = mergeSettings({
      diagnostics: { unknownFilter: "error" },
      spring: { enabled: false },
      templateRoots: ["views"],
    })
    expect(s.diagnostics.unknownFilter).toBe("error")
    expect(s.diagnostics.unknownTest).toBe("warning")
    expect(s.spring.enabled).toBe(false)
    expect(s.templateRoots).toEqual(["views"])
    expect(s.html.delegate).toBe(true)
  })
  test("invalid array values fall back", () => {
    expect(mergeSettings({ customFilters: "nope", templateSuffixes: 3 })).toMatchObject({
      customFilters: [],
      templateSuffixes: [".peb", ".pebble", ".html"],
    })
  })
})
