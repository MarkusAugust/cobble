# Cobble – Pebble Templates for VS Code

*"What is best in template coding? To crush your syntax errors, see them driven before you, and to hear the lamentations of the improperly closed Pebble tags!"*

Language support for [Pebble Templates](https://pebbletemplates.io) 4.x in Visual Studio Code, in
`.html` files and in `.peb`/`.pebble` files. Built to coexist with the
[Datastar](https://data-star.dev) extension and with HTMX attributes.

<!-- screenshot placeholder: docs/screenshot.png -->

## Features

- **Syntax highlighting** for the complete Pebble 4.1 syntax, including string interpolation,
  whitespace control, `verbatim`, list and map literals and every built-in tag, filter, function
  and test. Pebble inside attribute values is highlighted correctly, also inside Datastar
  expressions such as `data-signals="{count: {{ initial }}}"` and HTMX attributes such as
  `hx-get="/api/{{ id }}"`.
- **IntelliSense**: tags (with the matching end tag first), filters, functions, tests, operators,
  loop variables, variables in scope, macros (local and imported), block names, template names
  and named arguments. Snippets for every tag.
- **Hover documentation** and **signature help** for all built-in tags, filters, functions and tests.
- **Diagnostics**: unclosed delimiters and tags, mismatched end tags, syntax errors in expressions,
  unknown filters and tests, missing templates. Custom extensions are declared in settings.
- **Go to definition** for `extends`, `include`, `import`, `from` and `embed`, for block names
  (following the `extends` chain), `parent()`, macros and variables. Template names are also
  clickable links.
- **Find references and rename** for blocks (across the whole `extends` hierarchy), macros
  (definition and every importing template) and variables.
- **CodeLens**: which templates extend this one, which block is overridden where, and how often a
  macro is used. **Inlay hints** show the block name after a bare `{% endblock %}`.
- **Auto-closing tags**: typing `{% if x %}` inserts `{% endif %}`; block and endblock names are
  edited together.
- **Quick fixes**: insert a missing end tag, fix an `endblock` name, create a missing template,
  declare an unknown filter/function/test/tag in settings.
- **Java and Kotlin awareness** (see below): typed completion for model attributes and bean
  properties, hover with types, jump from a template variable into the controller that provides
  it, and filters/functions/tests discovered in your extension classes.
- **Semantic highlighting** distinguishes defined variables, macro parameters, macros and built-in
  versus custom filters and functions.
- **Outline** (blocks, macros, variables), **workspace symbols** and **folding**.
- **HTML tooling in `.peb` files**: tag and attribute completion, hover, folding and symbols from
  the HTML language service, outside Pebble syntax.
- A language server does the work, so everything above stays responsive in large templates.

## File types

| Where | How |
|---|---|
| `.html` files | Pebble syntax is injected into the built-in HTML language. IntelliSense and diagnostics only apply inside `{{ }}`, `{% %}` and `{# #}`. HTML tooling, Datastar and HTMX extensions keep working exactly as before. |
| `.peb` and `.pebble` files | A dedicated `pebble` language built on top of HTML (`.peb` is Pebble's default suffix). |

## Datastar and HTMX

The extension never offers completions or diagnostics outside Pebble syntax, so attribute
completion from the Datastar extension and any HTMX tooling are untouched.

| | `.html` | `.peb` / `.pebble` |
|---|---|---|
| Datastar highlighting of `data-*` attributes | yes | yes (a copy of the Datastar grammar ships with this extension for `.peb` files) |
| Datastar completion, hover, diagnostics, signal navigation | yes | yes, after enabling it (below) |
| Pebble highlighting, IntelliSense, diagnostics | yes | yes |

To enable the Datastar language server in `.peb` files, run **Pebble: Enable Datastar support for
Pebble files** from the command palette. It adds `pebble` to `datastar.enabledLanguages` in the
settings scope where that setting lives. The extension offers to do this once when a Pebble file is
opened with Datastar installed.

Tip for Emmet in `.peb` files:

```json
"emmet.includeLanguages": { "pebble": "html" }
```

## Java and Kotlin awareness

With `pebble.java.enabled` (default on), the extension reads the sources under
`pebble.java.sourceRoots` (`src/main/java`, `src/main/kotlin`) and learns:

- **Which code renders which template**, and what it puts in the model:
  - Spring MVC in Java or Kotlin: `@GetMapping` handlers returning a view name, `ModelAndView`,
    `model.addAttribute("user", user)`, `model["user"] = user`, `@ModelAttribute` methods and
    parameters, `@ControllerAdvice`.
  - Ktor: `call.respond(PebbleContent("x.peb", mapOf("user" to user)))` and `call.respondTemplate(...)`.
  - Javalin: `ctx.render("x.peb", Map.of("user", user))`.
  - Plain Pebble: `engine.getTemplate("x")` followed by `template.evaluate(writer, context)`.
- **Types**: getters, record components, Lombok `@Data` fields, Kotlin properties and data
  classes, including collections (`List<Order>` gives the loop variable type `Order`).
- **Extensions**: classes implementing `Filter`, `Function` or `Test`, their `getArgumentNames()`,
  and registrations in `getFilters()` / `getFunctions()` / `getTests()`.

In a template rendered by such code, `{{ ` offers the model attributes with their types,
`{{ user.` offers the bean's properties, hover shows the Java type and where the attribute was
added, and Go to Definition jumps into the Java or Kotlin source. Type inference is heuristic
(no compiler involved) and silently gives up when it cannot follow an expression.

## Snippets

Type a prefix and pick the snippet from the completion list. Every tag has a snippet named after
it (`if`, `for`, `block`, `macro`, …) plus a `pebble-` prefixed alias (`pebble-if`). In `.html`
files Emmet lists its own suggestion first; pick the snippet entry, or set
`"editor.snippetSuggestions": "top"`. Pebble files already sort snippets first.

Extra snippets: `ifelse`, `forelse`, `includewith`, `parent`, `expr`, `stmt`, `comment`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `pebble.templateRoots` | `src/main/resources/templates`, `src/main/resources`, `templates`, `resources/templates` | Directories (relative to each workspace folder) that template names are resolved against. The current file's directory is always tried first. |
| `pebble.templateSuffixes` | `.peb`, `.pebble`, `.html` | Suffixes tried when a template name has no extension. |
| `pebble.customFilters` / `customFunctions` / `customTests` | `[]` | Your own extensions: `{ "name": "money", "params": ["currency"], "description": "…" }`. They get completion, hover and signature help, and are not reported as unknown. |
| `pebble.customTags` | `[]` | Tag names from your own extensions. |
| `pebble.spring.enabled` | `true` | Include the Spring extension's functions (`message`, `href`, `hasErrors`, …) and context variables. |
| `pebble.diagnostics.enabled` | `true` | Report problems. |
| `pebble.diagnostics.unknownFilter` | `warning` | `error`, `warning`, `information` or `off`. |
| `pebble.diagnostics.unknownFunction` | `off` | As above. Off by default because functions often come from custom extensions. |
| `pebble.diagnostics.unknownTest` | `warning` | As above. |
| `pebble.diagnostics.missingTemplate` | `warning` | As above. |
| `pebble.html.enabled` | `true` | Pebble IntelliSense and diagnostics inside Pebble syntax in `.html` files (reload after changing). |
| `pebble.html.delegate` | `true` | HTML completion, hover, folding and symbols in `.peb` files. |
| `pebble.autoClosingTags` | `true` | Insert the matching end tag after typing an opening block tag. |
| `pebble.codeLens.enabled` | `true` | CodeLens for extends/overrides/usages. |
| `pebble.inlayHints.enabled` | `true` | Block name after a bare `{% endblock %}`. |
| `pebble.java.enabled` | `true` | Read Java/Kotlin sources for typed completion and discovered extensions. |
| `pebble.java.sourceRoots` | `src/main/java`, `src/main/kotlin` | Source directories to scan. |

Example for a Spring Boot project with custom filters:

```json
{
  "pebble.templateRoots": ["src/main/resources/templates"],
  "pebble.customFilters": [
    { "name": "money", "params": ["currency"], "description": "Formats an amount as currency." }
  ],
  "pebble.customTests": [{ "name": "adult" }]
}
```

## Diagnostics reference

| Code | Meaning |
|---|---|
| E001 | A `{{`, `{%` or `{#` delimiter is never closed. |
| E002 | Unknown tag. Declare custom tags in `pebble.customTags`. |
| E003 | An end tag or `else`/`elseif` without a matching open tag. |
| E004 | The name after `endblock` does not match the opening `block`. |
| E005 | A block tag (`if`, `for`, `block`, …) is never closed. |
| E006 | The expression or statement could not be parsed. |
| E007 | An `embed` body may only contain `block` tags. |
| W001 | Unknown filter. |
| W002 | Unknown test. |
| W003 | Unknown function (off by default). |
| W004 | `loop` used outside a `for` loop. |
| W006 | The referenced template was not found in any template root. |
| W007 | `parent()` outside a `block`. |

## Commands

- **Pebble: Enable Datastar support for Pebble files**
- **Pebble: Restart Language Server**

## Development

Requires [bun](https://bun.sh) and VS Code 1.91 or later.

```
bun install                   # install dependencies
bun run build                 # bundle client and server into dist/
bun run watch                 # rebuild on change
bun run check                 # lint, typecheck, grammar sync, unit tests, grammar tests
bun run test:e2e              # integration tests in a real VS Code instance
bun run test:e2e:datastar     # same, with the Datastar extension installed alongside
bun run test:grammar:update   # regenerate grammar snapshots after a grammar change
bun run generate:grammar      # sync built-in name lists from src/core/spec into the grammar
bun run update:datastar-grammar   # refresh the vendored Datastar grammar used for .peb files
bun run package               # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded. Use
"Developer: Inspect Editor Tokens and Scopes" to check highlighting.

Layout: `src/core` is editor-independent (lexer, parser, model, features), `src/server` is the
language server, `src/client` is the VS Code glue, `syntaxes` holds the TextMate grammars.

## Releasing

Releases are published by the `Release` workflow when a `v*` tag is pushed. The tag must match
`package.json`'s version, and the repository needs a `VSCE_PAT` secret (an Azure DevOps personal
access token with the *Marketplace › Manage* scope).

```
bun run version:minor   # or version:patch / version:major
git push && git push --tags
```

## History

Versions up to 0.3.3 were developed at [MarkusAugust/pebble-vscode](https://github.com/MarkusAugust/pebble-vscode).
Version 1.0 is a ground-up rewrite.

## License

BSD-3-Clause
