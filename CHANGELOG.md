# Changelog

All notable changes to the Pebble Template Support extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Dedicated `pebble` language for `.peb` and `.pebble` files, built on the HTML grammar.
- Language server skeleton (`vscode-languageserver`) started by the extension.
- Complete TextMate grammar for Pebble 4.1 (all tags, filters, functions, tests, operators, literals, interpolation, verbatim, whitespace control), with distinct scopes for template names, block names, macro parameters and built-in versus custom filters.
- Grammar snapshot and assertion tests that load the real HTML grammar and the Datastar injection grammar, proving Pebble inside `data-*` and `hx-*` attribute values highlights correctly.

### Changed
- Ground-up rewrite. The project now lives at https://github.com/MarkusAugust/cobble.
- Build with esbuild; bun is used for scripts and unit tests.
- Minimum VS Code version is 1.91.

### Removed
- The previous in-process completion provider. IntelliSense returns via the language server.

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