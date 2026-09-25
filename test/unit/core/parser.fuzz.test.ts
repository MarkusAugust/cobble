import { describe, expect, test } from "bun:test"
import { parse } from "../../../src/core/parser"

const pieces = [
  "{{",
  "}}",
  "{%",
  "%}",
  "{#",
  "#}",
  "-",
  " ",
  "\n",
  "if",
  "endif",
  "for",
  "in",
  "endfor",
  "else",
  "block",
  "endblock",
  "macro",
  "endmacro",
  "verbatim",
  "endverbatim",
  "set",
  "=",
  "|",
  "upper",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ":",
  "?",
  '"',
  "'",
  "#{",
  "is",
  "not",
  "and",
  "..",
  "a",
  "b",
  "1",
  "2.5",
  "3L",
  "<div>",
  "</div>",
  "$",
  "@",
  "\\",
]

function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe("parser fuzz", () => {
  test("never throws and terminates quickly on random delimiter soup", () => {
    const rnd = random(42)
    for (let i = 0; i < 2000; i++) {
      const len = 1 + Math.floor(rnd() * 40)
      let text = ""
      for (let j = 0; j < len; j++) text += pieces[Math.floor(rnd() * pieces.length)]
      const started = performance.now()
      const result = parse(text)
      const elapsed = performance.now() - started
      expect(result.ast.type).toBe("Template")
      expect(elapsed).toBeLessThan(50)
      for (const d of result.diagnostics) {
        expect(d.start).toBeLessThanOrEqual(d.end)
        expect(d.end).toBeLessThanOrEqual(text.length + 1)
      }
    }
  })
})
