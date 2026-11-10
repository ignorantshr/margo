# Changelog

Changes to Margo Inline are documented here. Entries before 0.2.0 describe the upstream Margo project.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-11-10

- Add text-level notes for selected characters, identifiers, and multiline ranges while preserving line-level notes for empty selections.
- Underline annotated ranges and show note content only when hovering the matching text.
- Track text anchors as surrounding code is inserted, replaced, joined, or deleted; fall back to a visible line note when an entire anchor is removed.
- Select the annotated range when navigating from the notes tree and persist anchors in private note storage with validation.

## [0.2.1] — 2026-11-05

- Register Add Note before workspace initialization and initialize on demand when a project is opened later, fixing `command 'margoInline.addNote' not found`.
- Fall back to an open workspace folder when the active editor is untitled or outside the project; show a clear message when adding notes without a workspace file.
- Add activation regression coverage for new projects with untitled editors and projects opened after empty-window startup.
- Focus the note input after adding; collapse the note editor after a successful save and return focus to code.
- Ignore comment-input editors when detecting workspace changes, preventing storage reloads and lost edits on focus changes.
- Preserve comment object handles across refresh/save so queued VS Code actions still address the active note.
- Wait for disk writes before leaving editing mode, keep drafts open on failure, and refresh inline text immediately.
- Keep comment thread identity stable when saving to prevent duplicate threads during editor refresh.
- Preserve editing drafts across focus/configuration refreshes and restore saved content on cancel.
- Edit original note text without injecting preview Markdown; ignore repeated create submissions and stale save actions.

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
