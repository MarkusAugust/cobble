# Cobble – Pebble Templates for VS Code

*"What is best in template coding? To crush your syntax errors, see them driven before you, and to hear the lamentations of the improperly closed Pebble tags!"*

Language support for [Pebble Templates](https://pebbletemplates.io) 4.x in Visual Studio Code:
syntax highlighting, IntelliSense, diagnostics and navigation, in `.html` files and in `.peb`/`.pebble`
files. Built to coexist with the [Datastar](https://data-star.dev) extension and with HTMX attributes.

Published on the Marketplace as **Pebble Template Support** (`MarkusAugust.pebble-support`).
This repository is a ground-up rewrite; history before 1.0.0 lives in
[MarkusAugust/pebble-vscode](https://github.com/MarkusAugust/pebble-vscode).

## Status

Under construction: the 1.0 rewrite is in progress and is not published yet. See CHANGELOG.md.

## File types

| Where | How |
|---|---|
| `.html` files | Pebble syntax is injected into the built-in HTML language. HTML tooling, Datastar and HTMX extensions keep working as before. |
| `.peb` and `.pebble` files | A dedicated `pebble` language built on top of HTML. |

## Supported syntax

The grammar follows Pebble 4.1: `{{ }}`, `{% %}`, `{# #}`, whitespace control (`{{-` / `-}}`),
string interpolation (`"Hello #{name}"`), all built-in tags (`if`/`elseif`/`else`, `for`/`else`,
`block`, `extends`, `include`, `import`, `from`, `embed`, `macro`, `set`, `filter`, `autoescape`,
`verbatim`, `cache`, `parallel`, `flush`), all built-in filters, functions and tests (including the
Spring extension functions), every operator with its precedence, list and map literals, ranges and
the ternary operator. Unknown tags, filters, functions and tests are highlighted as such rather than
flagged as errors, so custom extensions look fine.

Pebble inside attribute values is highlighted correctly, also inside Datastar expressions such as
`data-signals="{count: {{ initial }}}"` and HTMX attributes such as `hx-get="/api/{{ id }}"`, with
the Datastar and HTMX highlighting left intact.

## Development

Requires [bun](https://bun.sh) and VS Code 1.91 or later.

```
bun install          # install dependencies
bun run build        # bundle client and server into dist/
bun run watch        # rebuild on change
bun run check        # lint, typecheck, unit tests and grammar snapshot tests
bun run test:grammar:update   # regenerate grammar snapshots after a grammar change
bun run package      # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.
Use “Developer: Inspect Editor Tokens and Scopes” to check highlighting.

## License

BSD-3-Clause
