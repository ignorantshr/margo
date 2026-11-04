# Margo

**AI-Ready Code Notes & Annotations for VS Code.**

Margo lets you attach local notes to any line of code — for review, learning, or future todos — without modifying the source file. Notes are stored as plain JSON in your workspace and structured for easy handoff to AI assistants.

The name comes from the Latin _margo_ ("margin"): notes scholars wrote in the margins of books, for the same three reasons we add them to code today.

## Features

- **Always-visible end-of-line notes** displayed as `[✎] title — body`, without changing source files
- A distinct blue-purple, non-italic label separates notes from source comments; light, dark, and high-contrast themes are supported. Customize the color with `margo.inlineNoteForeground` in `workbench.colorCustomizations`.
- **Editable, resolvable comment threads** opened from the notes tree
- No editor gutter “+”; add notes using the context menu or shortcut
- **Categories**: TODO, BUG, NOTE
- **Private storage only** in `.margo/local.notes.json`
- **Tree view** with grouping (by file, category, status) and filtering
- **Export** to Markdown or HTML
- **Copy as AI Prompt** — structured handoff to Claude, Copilot, or any LLM
- **Line tracking** — notes follow their lines as you edit
- **Hover previews** on any annotated line

## Quick start

1. Install from the Marketplace: `aikaisi.margo`
2. Open a file, right-click a line → _Add Note_ (or <kbd>Ctrl+Shift+N</kbd> / <kbd>⌘⇧N</kbd>)
3. Type your note. First line is the title, following lines are the body. Markdown is supported.
4. Open the **Margo** explorer in the activity bar to browse, filter, and export.

## Annotation color

The `[✎]` icon and note text share the `margo.inlineNoteForeground` theme color.
To customize it, merge this entry into VS Code's `settings.json` (keep any existing color overrides):

```json
{
  "workbench.colorCustomizations": {
    "margo.inlineNoteForeground": "#9B8ADB"
  }
}
```

Changes apply without reinstalling the extension. Remove the override to restore the light/dark/high-contrast theme defaults. Choose a color with sufficient contrast against your editor background.

## Storage

| File/Folder | Purpose | Gitignored? |
| --- | --- | --- |
| `.margo/local.notes.json` | Local vault — private, never committed | Yes (auto) |

The `.margo/.gitignore` file contains `*`, ignoring all directory contents, including itself. It is created or repaired when existing local notes load or notes are saved. Already tracked files remain tracked by Git.

Legacy `.notes.json` files are left untouched and are no longer loaded. Existing priority fields remain compatible in stored data but are not exposed in the UI or exports. Multiline notes appear on one line; multiple notes on the same line are separated by ` | `. Long annotations can extend beyond the visible editor width.

## License

Margo is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for the full text.

**Commercial / non-AGPL licensing is available.** For companies that cannot comply with AGPL terms, or for embedding in proprietary products, contact **alkaisiabbas@gmail.com**.

## Links

- **Repository**: https://github.com/aikaisi/margo
- **Issues**: https://github.com/aikaisi/margo/issues
- **VS Code Marketplace**: https://marketplace.visualstudio.com/items?itemName=aikaisi.margo
- **Open VSX**: https://open-vsx.org/extension/aikaisi/margo

---

_© 2026 Abbas Al-Kaisi_
