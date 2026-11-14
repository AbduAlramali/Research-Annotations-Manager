# Contributing to Research Annotations

Thanks for helping improve Research Annotations. This guide covers local setup,
the codebase, testing, and the pull-request process.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report bugs with a clear reproduction and, when possible, a sanitized note
  that shows the annotation format.
- Suggest features that fit the plugin's local-first, Markdown-only design.
- Improve documentation, templates, and fixtures.
- Submit fixes or new features with tests.

For large changes, open an issue first so the approach can be discussed before
you spend time implementing it. Small fixes and documentation corrections can go
straight to a pull request.

## Development setup

### Requirements

- **Node.js 22.6 or newer** (the test command uses
  `--experimental-strip-types`).
- npm.
- Obsidian, if you want to manually test the sidebar and navigation.

### Install

```bash
git clone git@github.com:AbduAlramali/Research-Annotations-Manager.git
cd Research-Annotations-Manager
npm install
```

### Build into a test vault

The development build watches for changes and writes `dist/main.js` by default.
To write directly into an Obsidian vault, point `OBSIDIAN_PLUGIN_DIR` at the
plugin folder:

```bash
OBSIDIAN_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/research-annotations" npm run build
```

Keep the build running while you work. Then reload the plugin in Obsidian
(**Settings → Community plugins → Research Annotations → Reload**).

For a one-off, minified build without the watcher:

```bash
npm run build:prod
```

`main.js` in the repository root is a generated artifact and is intentionally
ignored. Do not commit it.

## Checks

Run these before opening a pull request:

```bash
npm test
npm run typecheck
npm run build:prod
```

The test suite uses Node's built-in test runner and does not need a running
Obsidian instance. If you change parsing, indexing, metadata extraction, or
querying, add or update tests under `tests/`.

GitHub Actions runs the same checks on every push to `main` and every pull
request.

## Project structure

```text
src/
  main.ts                 Plugin lifecycle and wiring
  parser/                 Markdown annotation parsing, types, color inference
  index/                  In-memory annotation index and note metadata
  query/                  Filtering, sorting, grouping, and facets
  renderer/               Annotation cards and math rendering helpers
  navigation/             Source-note and Zotero URI navigation
  settings/               Settings model and settings tab
  views/                  Sidebar annotation explorer view
tests/                    Node test-runner tests
fixtures/                 Sanitized Markdown notes used by tests
templates/                Zotero Integration template
```

The data flow is:

```text
Markdown notes → parser → annotation index → query → renderer → navigation
```

Keep these layers separate. For example, query code should not depend on
Obsidian UI classes, and renderer code should not re-parse Markdown.

### Parser compatibility

There are two supported annotation formats:

- **Legacy:** annotations inside a Zotero Integration persist block, segmented
  by page links.
- **Explicit:** annotations wrapped in `%% ra:begin … %%` and `%% ra:end %%`.

The explicit format is authoritative when present. The legacy format must remain
supported because the bundled Zotero template still emits it. Parser changes
should be tolerant of malformed notes: return warnings and partial results
instead of throwing.

When adding a parser case, add a sanitized fixture and a focused test. Do not
include real personal notes, vault paths, names, or private research content in
the repository.

## Coding guidelines

- TypeScript is strict. Avoid `any` and unnecessary type assertions.
- Keep modules small and single-purpose. Prefer clear data flow over hidden
  coupling.
- Do not add runtime dependencies without discussing the need first.
- Never hardcode a vault path, username, or machine-specific directory. Use
  `OBSIDIAN_PLUGIN_DIR` or a relative path.
- Use Obsidian's CSS variables and existing `hltr-*` classes for UI work. Keep
  light and dark themes working.
- Preserve keyboard access and readable labels for interactive controls.
- Keep changes focused. Avoid unrelated refactors in a bug-fix pull request.
- Match the existing formatting. An `.editorconfig` is included.

## Manual testing

Automated tests cover parsing and querying, but UI changes need a quick manual
pass in a test vault:

1. Build into the vault and reload the plugin.
2. Open the explorer from the ribbon and each command.
3. Check search, filters, sorting, grouping, project views, and paper views.
4. Open an annotation in its source note and verify the correct line is centered.
5. Check Zotero buttons when the note contains `zotero://` links.
6. Repeat in both light and dark themes, and at a narrow sidebar width.

Include before/after screenshots in the pull request for visible UI changes.

## Pull requests

- Describe the problem and the approach, not just the files changed.
- Reference the related issue when one exists.
- Include tests for behavior changes and note any manual testing performed.
- Update `README.md` or the Zotero template when user-facing behavior changes.
- Keep the pull request reviewable. Split unrelated work into separate PRs.

The pull-request template includes a short checklist. Maintainers may ask for
changes before merging.

## Reporting bugs

Use the bug-report issue template. Include:

- Obsidian version, plugin version, and operating system.
- Steps to reproduce, expected behavior, and actual behavior.
- Console errors, if any.
- A **sanitized** snippet of the note's frontmatter and annotation block when
  the parser is involved.

Remove private notes, vault paths, names, and research content before posting.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
