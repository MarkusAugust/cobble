# Changelog

All notable changes to the Pebble Template Support extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-25

Ground-up rewrite as a language server. The project now lives at https://github.com/MarkusAugust/cobble.

### Added
- Dedicated `pebble` language for `.peb` and `.pebble` files, built on the HTML grammar, with HTML
  tag and attribute completion, hover, folding and symbols delegated to the HTML language service.
- Complete TextMate grammar for Pebble 4.1: every tag, filter, function (including the Spring
  extension) and test, all operators, literals, string interpolation, whitespace control and
  `verbatim`, with distinct scopes for template names, block names, macro parameters and custom
  versus built-in filters.
- Language server with completion (tags with the matching end tag first, filters, functions,
  tests, operators, loop variables, variables in scope, local and imported macros, block names,
  template names, named arguments, escape strategies), hover documentation, signature help,
  diagnostics, document symbols, folding and go to definition (templates, blocks through the
  `extends` chain, `parent()`, macros, variables).
- Diagnostics for unclosed delimiters and tags, mismatched `endblock` names, stray end tags,
  expression syntax errors, invalid `embed` bodies, unknown filters/tests/functions, `loop`
  outside `for`, `parent()` outside `block` and missing templates.
- Settings for template roots and suffixes, custom filters/functions/tests/tags, the Spring
  extension, diagnostic severities and HTML behaviour.
- Command **Pebble: Enable Datastar support for Pebble files** and a one-time prompt that adds
  `pebble` to `datastar.enabledLanguages`.
- Snippets for every tag, plus `ifelse`, `forelse`, `includewith` and `parent`.
- Auto-closing tags, linked editing of block names, quick fixes (insert end tag, fix `endblock`
  name, create missing template, declare custom entries), find references and rename for blocks,
  macros and variables, CodeLens (extends, overrides, usages), inlay hints, document links,
  workspace symbols and semantic highlighting.
- Java and Kotlin awareness: typed model attributes and bean properties from Spring MVC (Java and
  Kotlin), Ktor, Javalin and plain Pebble code; hover with types; go to definition into the
  sources; filters, functions and tests discovered from extension classes.
- Datastar attribute highlighting in `.peb` files via a vendored copy of the Datastar grammar.
- Grammar snapshot and assertion tests that load the real HTML grammar and the Datastar injection
  grammar, unit tests for the core, and integration tests in a real VS Code instance, including a
  suite that runs with the Datastar extension installed.

### Changed
- Build with esbuild; bun runs scripts and unit tests. Minimum VS Code version is 1.91.
- Snippet prefixes no longer include `{{` or `{#` (they conflicted with auto-closing pairs).

### Removed
- The previous in-process completion provider; IntelliSense now comes from the language server.

## Earlier versions

Versions up to 0.3.3 were developed at https://github.com/MarkusAugust/pebble-vscode.

## [0.3.3] - 2025-11-26

### Fixed
- Replaced deprecated `substr` method with `substring`

### Added
- Filter completion tests to ensure quality
- Snippets category in package.json

## [0.3.2] - 2025-11-26

### Added
- Semantic versioning workflow with git tags
- Version scripts for patch, minor, and major releases
- Proper changelog documentation

### Changed
- Improved development workflow with structured versioning

## [0.3.1] - 2025-11-26

### Added
- Comprehensive test suite for completion provider
- Critical test for expression operator completion
- Tests now run before publishing (prepublish script)

### Fixed
- Operator completion now works in `{{ }}` expressions (major fix!)
- Fixed snippet auto-closing conflicts by updating prefixes

### Changed
- Updated README with accurate snippet documentation
- Improved Usage section with clearer instructions
- Enhanced IntelliSense description

## [0.3.0] - Previous

### Added
- Enhanced completion provider with operators and functions
- Improved syntax highlighting
- Better snippet support

## [0.2.x] - Earlier versions

### Added
- Initial Pebble template support
- Basic syntax highlighting
- Core snippet functionality