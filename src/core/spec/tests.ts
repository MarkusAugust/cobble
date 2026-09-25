import type { SpecEntry } from "./types"

const test = (name: string, doc: string): SpecEntry => ({
  name,
  kind: "test",
  signature: `is ${name}`,
  params: [],
  doc,
  docUrl: `https://pebbletemplates.io/wiki/test/${name}/`,
  source: "core",
})

export const tests: SpecEntry[] = [
  test(
    "empty",
    "True for null, empty strings, empty collections and empty maps.\n\n```\n{% if users is empty %}\n```",
  ),
  test("even", "True for even numbers."),
  test("odd", "True for odd numbers."),
  test("null", "True when the value is null."),
  test("map", "True when the value is a `java.util.Map`."),
  test("iterable", "True when the value can be iterated (collections, arrays, maps)."),
  test(
    "defined",
    "True when the variable exists in the context. Mostly useful with strict variables enabled.",
  ),
]

export const testByName = new Map(tests.map((t) => [t.name, t]))
