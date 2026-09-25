import type { SpecEntry, SpecParam } from "./types"

const p = (name: string, optional = false, variadic = false): SpecParam => ({
  name,
  optional,
  variadic,
})

const fn = (
  name: string,
  params: SpecParam[],
  doc: string,
  extra: Partial<SpecEntry> = {},
): SpecEntry => ({
  name,
  kind: "function",
  signature: `${name}(${params.map((x) => (x.variadic ? `${x.name}…` : x.optional ? `${x.name}?` : x.name)).join(", ")})`,
  params,
  doc,
  docUrl:
    extra.source === "spring"
      ? "https://pebbletemplates.io/wiki/guide/spring-boot-integration/"
      : `https://pebbletemplates.io/wiki/function/${name === "block" ? "blockFunction" : name}/`,
  source: "core",
  ...extra,
})

export const coreFunctions: SpecEntry[] = [
  fn(
    "block",
    [p("name")],
    'Renders the block with the given name.\n\n```\n{{ block("sidebar") }}\n```',
    { source: "parser" },
  ),
  fn("parent", [], "Inside a `block`, renders the parent template's version of that block.", {
    source: "parser",
  }),
  fn(
    "max",
    [p("values", false, true)],
    "Largest of the arguments.\n\n```\n{{ max(user.age, 80) }}\n```",
  ),
  fn("min", [p("values", false, true)], "Smallest of the arguments."),
  fn(
    "range",
    [p("start"), p("end"), p("increment", true)],
    "List of numbers (or characters) from `start` to `end` inclusive. The `..` operator is shorthand for the default increment.\n\n```\n{% for i in range(0, 10, 2) %}{{ i }}{% endfor %}\n```",
  ),
  fn(
    "i18n",
    [p("bundle"), p("key"), p("params", true, true)],
    'Looks up a key in a resource bundle for the current locale, formatting with `MessageFormat`.\n\n```\n{{ i18n("messages", "greeting", user.name) }}\n```',
    { source: "i18n" },
  ),
]

export const springFunctions: SpecEntry[] = [
  fn(
    "message",
    [p("key"), p("args", true, true)],
    "Resolves a message from Spring's `MessageSource` for the current locale.",
    { source: "spring" },
  ),
  fn("href", [p("path")], "Prefixes a path with the servlet context path.", { source: "spring" }),
  fn("hasErrors", [p("formName")], "True when the form's `BindingResult` has any error.", {
    source: "spring",
  }),
  fn("hasGlobalErrors", [p("formName")], "True when the form has global (non-field) errors.", {
    source: "spring",
  }),
  fn("hasFieldErrors", [p("formName"), p("field")], "True when the given field has errors.", {
    source: "spring",
  }),
  fn("getAllErrors", [p("formName")], "All error messages of the form.", { source: "spring" }),
  fn("getGlobalErrors", [p("formName")], "Global error messages of the form.", {
    source: "spring",
  }),
  fn("getFieldErrors", [p("formName"), p("field")], "Error messages of the given field.", {
    source: "spring",
  }),
]

/** Variables the Spring extension puts into every template context. */
export const springVariables = ["beans", "request", "response", "session"]
