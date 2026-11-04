# Changelog

Changes to Margo Inline are documented here. Entries before 0.2.0 describe the upstream Margo project.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-11-04

First independent Margo Inline release, maintained by ignorantshr.

- New extension identity, repository links, icon, and command/settings namespace.
- Always-visible `[✎]` annotations with a customizable theme color.
- Private-only storage with a self-ignoring `.margo` directory.
- Removed priority and team controls and the editor gutter add button.
- Fixed hover previews to include both note titles and bodies.
- Added regression coverage for rendering, storage, and hover previews.
- Preserved upstream attribution, AGPL license, and existing private note storage.

## [0.1.0] — 2026-04-21

Initial release. Margo is a fresh codebase; its lineage traces back to the author's earlier `review-notes` extension, which has been frozen at 0.3.0 and is no longer maintained.

### Added

- Inline comment threads on any line (add, edit, delete, resolve, reopen).
- Categories (TODO, BUG, NOTE) and priorities (High, Medium, Low).
- Local and Team vaults with move-between-vaults commands.
- Tree view explorer with grouping (by file, category, priority, status, vault) and filters.
- Export to Markdown and HTML.
- Copy as AI Prompt — structured handoff to AI assistants.
- Line tracking so notes follow their lines on edit.
- Hover previews for annotated lines.
- Status bar indicator.

### License

- Licensed under AGPL-3.0. The upstream author offered separate commercial licensing for upstream code.
