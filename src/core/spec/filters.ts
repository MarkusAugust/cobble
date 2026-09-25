import type { SpecEntry, SpecParam } from "./types"

const url = (name: string) => `https://pebbletemplates.io/wiki/filter/${name}/`
const p = (name: string, optional = false, doc?: string): SpecParam => ({ name, optional, doc })

const filter = (
  name: string,
  params: SpecParam[],
  doc: string,
  extra: Partial<SpecEntry> = {},
): SpecEntry => ({
  name,
  kind: "filter",
  signature:
    params.length === 0
      ? name
      : `${name}(${params.map((x) => (x.optional ? `${x.name}?` : x.name)).join(", ")})`,
  params,
  doc,
  docUrl: url(name),
  source: "core",
  ...extra,
})

export const filters: SpecEntry[] = [
  filter(
    "abbreviate",
    [p("length")],
    'Shortens a string to `length` characters, ending with an ellipsis.\n\n```\n{{ "this is a long sentence." | abbreviate(7) }}  → this...\n```',
  ),
  filter("abs", [], "Absolute value of a number."),
  filter("base64decode", [], "Decodes a Base64 string.", { since: "3.1" }),
  filter("base64encode", [], "Encodes a string as Base64.", { since: "3.1" }),
  filter("capitalize", [], "Upper-cases the first letter of the string."),
  filter(
    "date",
    [
      p("format"),
      p("existingFormat", true, "Pattern used to parse a string input"),
      p("timeZone", true),
    ],
    'Formats a date, `java.time` temporal or string with a `DateTimeFormatter`/`SimpleDateFormat` pattern. String inputs are parsed with `existingFormat` (default `yyyy-MM-dd\'T\'HH:mm:ssZ`).\n\n```\n{{ user.birthday | date("yyyy-MM-dd") }}\n{{ "July 24, 2001" | date("yyyy-MM-dd", existingFormat="MMMM dd, yyyy") }}\n```',
  ),
  filter(
    "default",
    [p("default")],
    'Returns the argument when the value is null or empty.\n\n```\n{{ user.phone | default("No phone") }}\n```',
  ),
  filter(
    "escape",
    [p("strategy", true, "html (default), js, css, url_param or json")],
    'Escapes the value with the given strategy. Only needed when autoescaping is off or a different strategy is required.\n\n```\n{{ text | escape("js") }}\n```',
    { source: "escaper" },
  ),
  filter("first", [], "First element of a collection or first character of a string."),
  filter(
    "format",
    [
      p("args", false, "Values for the format specifiers"),
      { name: "…", optional: true, variadic: true },
    ],
    "Formats the string with `String.format`.\n\n```\n{{ 'Hello %s!' | format('World') }}\n```",
    { since: "4.1.2" },
  ),
  filter(
    "join",
    [p("separator")],
    'Joins the elements of a collection into a string.\n\n```\n{{ names | join(", ") }}\n```',
  ),
  filter("last", [], "Last element of a collection or last character of a string."),
  filter("length", [], "Number of elements, characters or map entries."),
  filter("lower", [], "Lower-cases the string."),
  filter(
    "merge",
    [p("items")],
    "Merges two lists, arrays or maps into a new one.\n\n```\n{{ list | merge(otherList) }}\n```",
  ),
  filter("nl2br", [], "Replaces line breaks with `<br />`.", { since: "4.0.0" }),
  filter(
    "numberformat",
    [p("format")],
    'Formats a number with a `DecimalFormat` pattern.\n\n```\n{{ 3.14159 | numberformat("#.##") }}\n```',
  ),
  filter("raw", [], "Marks the value as safe so it is not autoescaped.", { source: "escaper" }),
  filter(
    "replace",
    [p("replace_pairs")],
    "Replaces every key of the map with its value.\n\n```\n{{ \"I like %this%\" | replace({'%this%': foo}) }}\n```",
  ),
  filter("reverse", [], "Reverses a list or string."),
  filter("rsort", [], "Sorts a list in descending order."),
  filter("sha256", [], "SHA-256 hex digest of the string.", { since: "3.1" }),
  filter(
    "slice",
    [p("fromIndex"), p("toIndex")],
    "Sub-list or substring from `fromIndex` (inclusive) to `toIndex` (exclusive).\n\n```\n{{ ['a', 'b', 'c', 'd'] | slice(1, 3) }}\n```",
  ),
  filter("sort", [], "Sorts a list in ascending order."),
  filter(
    "split",
    [p("delimiter"), p("limit", true)],
    'Splits the string on a regular expression, like `String.split`.\n\n```\n{{ "a,b,c" | split(",") }}\n```',
  ),
  filter("title", [], "Capitalizes every word."),
  filter("trim", [], "Removes leading and trailing whitespace."),
  filter("upper", [], "Upper-cases the string."),
  filter("urlencode", [], "URL-encodes the string (UTF-8)."),
]

export const filterByName = new Map(filters.map((f) => [f.name, f]))
