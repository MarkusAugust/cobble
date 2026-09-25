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
