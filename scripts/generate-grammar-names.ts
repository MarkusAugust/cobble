/**
 * Writes the built-in name lists from src/core/spec into the TextMate grammar so that
 * highlighting and the language server never disagree. Run with --check to only verify.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { buildSpec } from "../src/core/spec"

const GRAMMAR = "syntaxes/pebble-injection.tmLanguage.json"
const spec = buildSpec({ spring: true })
const alt = (names: Iterable<string>) => `(${[...names].join("|")})`
const tags = alt(spec.tags.keys())
const filters = alt(spec.filters.keys())
const functions = alt(spec.functions.keys())
const tests = alt(spec.tests.keys())

type Rule = { comment?: string; match?: string; begin?: string }
const grammar = JSON.parse(readFileSync(GRAMMAR, "utf8"))
const repo = grammar.repository

const targets: { rule: Rule; key: "match" | "begin"; value: string }[] = [
  {
    rule: repo["pebble-statement-filter"].patterns[0],
    key: "match",
    value: `\\G\\s*${filters}\\b`,
  },
  { rule: repo["pebble-statement-known"], key: "begin", value: `(\\{%)(-)?\\s*${tags}\\b` },
  {
    rule: repo.expression.patterns.find((p: Rule) => p.match?.startsWith("\\b(is)")),
    key: "match",
    value: `\\b(is)(?:\\s+(not))?\\s+${tests}\\b`,
  },
  {
    rule: repo.expression.patterns.find((p: Rule) => p.match?.startsWith("(\\|)\\s*(")),
    key: "match",
    value: `(\\|)\\s*${filters}\\b`,
  },
  {
    rule: repo.expression.patterns.find((p: Rule) => p.match?.endsWith("(?=\\s*\\()") && p.comment),
    key: "match",
    value: `\\b${functions}(?=\\s*\\()`,
  },
]

let changed = false
for (const t of targets) {
  if (!t.rule) throw new Error("grammar rule not found; the grammar structure changed")
  if (!t.rule.comment?.startsWith("GENERATED"))
    throw new Error(`rule for ${t.key} is not marked GENERATED`)
  if (t.rule[t.key] !== t.value) {
    t.rule[t.key] = t.value
    changed = true
  }
}

if (process.argv.includes("--check")) {
  if (changed) {
    console.error(
      `${GRAMMAR} is out of sync with src/core/spec. Run: bun scripts/generate-grammar-names.ts`,
    )
    process.exit(1)
  }
  console.log("grammar name lists are in sync")
} else if (changed) {
  writeFileSync(GRAMMAR, `${JSON.stringify(grammar, null, 2)}\n`)
  console.log(`updated ${GRAMMAR}`)
} else {
  console.log("grammar already up to date")
}
