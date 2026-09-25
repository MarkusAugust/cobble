import { describe, expect, test } from "bun:test"
import { parse } from "../../../src/core/parser"

describe("performance", () => {
  test("a 2000-line template lexes and parses well under budget", () => {
    const lines: string[] = ['{% extends "base.peb" %}', "{% block content %}"]
    for (let i = 0; i < 2000; i++) {
      lines.push(
        `<li class="{{ item.cls | default('x') }}" data-signals="{n: {{ i }}}">{% if item.ok and i is even %}{{ item.name | upper | abbreviate(${i}) }}{% else %}{{ "n/a #{i}" }}{% endif %}</li>`,
      )
    }
    lines.push("{% endblock %}")
    const text = lines.join("\n")
    const started = performance.now()
    const result = parse(text)
    const elapsed = performance.now() - started
    expect(result.diagnostics).toEqual([])
    expect(elapsed).toBeLessThan(200)
  })
})
