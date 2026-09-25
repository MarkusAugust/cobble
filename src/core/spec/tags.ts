import type { TagSpec } from "./types"

const url = (name: string) => `https://pebbletemplates.io/wiki/tag/${name}/`

const tag = (
  name: string,
  signature: string,
  doc: string,
  extra: Partial<TagSpec> = {},
): TagSpec => ({
  name,
  kind: "tag",
  signature,
  params: [],
  doc,
  docUrl: url(name),
  source: "core",
  block: false,
  ...extra,
})

/** Every tag Pebble 4.1 ships with. End tags and `else`/`elseif` are listed as their own entries. */
export const tags: TagSpec[] = [
  tag(
    "autoescape",
    '{% autoescape "js" %} … {% endautoescape %}',
    'Changes the escaping strategy for the body, or disables autoescaping with `false`. Strategies: `html` (default), `js`, `css`, `url_param`, `json`.\n\n```\n{% autoescape "js" %}var x = "{{ value }}";{% endautoescape %}\n```',
    {
      block: true,
      endTag: "endautoescape",
      snippet: 'autoescape "${1|html,js,css,url_param,json,false|}" %}\n\t$0\n{% endautoescape',
    },
  ),
  tag("endautoescape", "{% endautoescape %}", "Closes an `autoescape` block."),
  tag(
    "block",
    "{% block name %} … {% endblock %}",
    "Defines a named block that child templates can override. Inside a block, `{{ parent() }}` renders the parent template's version.\n\n```\n{% block content %}<p>Default</p>{% endblock %}\n```",
    { block: true, endTag: "endblock", snippet: "block ${1:name} %}\n\t$0\n{% endblock ${1:name}" },
  ),
  tag(
    "endblock",
    "{% endblock [name] %}",
    "Closes a `block`. The optional name must match the opening block.",
  ),
  tag(
    "cache",
    '{% cache "key" %} … {% endcache %}',
    'Caches the rendered body under the given key (requires a configured cache).\n\n```\n{% cache "menu" %}{% include "menu.peb" %}{% endcache %}\n```',
    { block: true, endTag: "endcache", snippet: 'cache "${1:key}" %}\n\t$0\n{% endcache' },
  ),
  tag("endcache", "{% endcache %}", "Closes a `cache` block."),
  tag(
    "embed",
    '{% embed "template" [with {…}] %} … {% endembed %}',
    'Includes a template while overriding its blocks, like `include` and `extends` combined. The body may only contain `block` tags.\n\n```\n{% embed "card.peb" with {"title": "Hi"} %}\n  {% block body %}…{% endblock %}\n{% endembed %}\n```',
    {
      block: true,
      endTag: "endembed",
      snippet:
        'embed "${1:template.peb}" %}\n\t{% block ${2:name} %}\n\t\t$0\n\t{% endblock %}\n{% endembed',
    },
  ),
  tag("endembed", "{% endembed %}", "Closes an `embed` block."),
  tag(
    "extends",
    '{% extends "template" %}',
    'Declares the parent template. Only `block` contents of this template are rendered; everything else is ignored. The argument is an expression, so `{% extends ajax ? "ajax.peb" : "base.peb" %}` works.',
    { snippet: 'extends "${1:base.peb}"' },
  ),
  tag(
    "filter",
    "{% filter name [| name …] %} … {% endfilter %}",
    "Applies one or more filters to the rendered body.\n\n```\n{% filter upper | escape %}text{% endfilter %}\n```",
    { block: true, endTag: "endfilter", snippet: "filter ${1:upper} %}\n\t$0\n{% endfilter" },
  ),
  tag("endfilter", "{% endfilter %}", "Closes a `filter` block."),
  tag(
    "flush",
    "{% flush %}",
    "Flushes the underlying writer, sending output produced so far to the client.",
  ),
  tag(
    "for",
    "{% for item in iterable %} … [{% else %} …] {% endfor %}",
    "Iterates over a list, array, map (as entries with `key`/`value`) or range. The optional `else` body renders when the iterable is empty. Inside the loop, `loop.index`, `loop.length`, `loop.first`, `loop.last` and `loop.revindex` are available.\n\n```\n{% for user in users %}{{ loop.index }}: {{ user.name }}{% else %}No users{% endfor %}\n```",
    {
      block: true,
      endTag: "endfor",
      intermediate: ["else"],
      snippet: "for ${1:item} in ${2:items} %}\n\t$0\n{% endfor",
    },
  ),
  tag("endfor", "{% endfor %}", "Closes a `for` loop."),
  tag(
    "from",
    '{% from "template" import macro [as alias], … %}',
    'Imports specific macros from another template, optionally renamed.\n\n```\n{% from "forms.peb" import input as field, textarea %}\n```',
    { snippet: 'from "${1:macros.peb}" import ${2:name}' },
  ),
  tag(
    "if",
    "{% if condition %} … [{% elseif … %} …] [{% else %} …] {% endif %}",
    "Conditional rendering. Values are truthy unless they are `null`, `false`, `0`, an empty string or an empty collection.\n\n```\n{% if users is empty %}None{% elseif users | length == 1 %}One{% else %}Many{% endif %}\n```",
    {
      block: true,
      endTag: "endif",
      intermediate: ["elseif", "else"],
      snippet: "if ${1:condition} %}\n\t$0\n{% endif",
    },
  ),
  tag("elseif", "{% elseif condition %}", "Adds another branch to an `if`. Written as one word.", {
    snippet: "elseif ${1:condition}",
  }),
  tag(
    "else",
    "{% else %}",
    "The fallback branch of an `if`, or the body rendered by a `for` when the iterable is empty.",
  ),
  tag("endif", "{% endif %}", "Closes an `if`."),
  tag(
    "import",
    '{% import "template" [as alias] %}',
    'Makes the macros of another template available, either directly or under an alias (`alias.macroName(…)`).\n\n```\n{% import "forms.peb" as forms %}{{ forms.input("text", "name") }}\n```',
    { snippet: 'import "${1:macros.peb}"' },
  ),
  tag(
    "include",
    '{% include "template" [with {…}] %}',
    'Renders another template in place, sharing the current context. `with` adds variables. The argument is an expression.\n\n```\n{% include "footer.peb" with {"year": 2026} %}\n```',
    { snippet: 'include "${1:template.peb}"' },
  ),
  tag(
    "macro",
    '{% macro name(param, param="default") %} … {% endmacro %}',
    'Defines a reusable fragment called like a function: `{{ name(…) }}`. Parameters can have defaults. A parameter named `_context` receives the caller\'s context.\n\n```\n{% macro input(type="text", name) %}<input type="{{ type }}" name="{{ name }}">{% endmacro %}\n```',
    {
      block: true,
      endTag: "endmacro",
      snippet: "macro ${1:name}(${2:args}) %}\n\t$0\n{% endmacro",
    },
  ),
  tag("endmacro", "{% endmacro %}", "Closes a `macro`."),
  tag(
    "parallel",
    "{% parallel %} … {% endparallel %}",
    "Renders the body in a separate thread (requires an executor service on the engine).",
    { block: true, endTag: "endparallel", snippet: "parallel %}\n\t$0\n{% endparallel" },
  ),
  tag("endparallel", "{% endparallel %}", "Closes a `parallel` block."),
  tag(
    "set",
    "{% set name = expression %}",
    'Assigns a variable in the current scope.\n\n```\n{% set title = "Home" %}\n```',
    { snippet: "set ${1:name} = ${2:value}" },
  ),
  tag(
    "verbatim",
    "{% verbatim %} … {% endverbatim %}",
    "Outputs the body without interpreting any Pebble syntax.",
    { block: true, endTag: "endverbatim", snippet: "verbatim %}\n\t$0\n{% endverbatim" },
  ),
  tag("endverbatim", "{% endverbatim %}", "Closes a `verbatim` block."),
]

export const tagByName = new Map(tags.map((t) => [t.name, t]))

/** Maps an end or intermediate tag to the block tag(s) it belongs to. */
export const closesTag = new Map<string, string[]>([
  ["else", ["if", "for"]],
  ["elseif", ["if"]],
  ...tags
    .filter((t) => t.block && t.endTag)
    .map((t) => [t.endTag as string, [t.name]] as [string, string[]]),
])
