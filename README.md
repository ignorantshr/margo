# Margo Inline

![Margo Inline — 页边线与铅笔图标](images/margo-inline.png)

**Private, always-visible code annotations for VS Code — maintained by [ignorantshr](https://github.com/ignorantshr).**

Margo Inline lets you attach local notes to selected text or any line of code — for review, learning, or future todos — without modifying the source file. Notes are stored as plain JSON in your workspace and structured for easy handoff to AI assistants.

An independently maintained fork of [Margo by Abbas Al-Kaisi](https://github.com/aikaisi/margo). This fork focuses on private storage, end-of-line annotations, and a simpler interface. It is not the upstream release.

## Features

- **Always-visible end-of-line notes** displayed as `[✎] title — body`, without changing source files
- A distinct lavender (`#BCAED0`), non-italic label separates notes from source comments; light, dark, and high-contrast themes are supported. Customize the color with `margoInline.inlineNoteForeground` in `workbench.colorCustomizations`.
- **Text-level notes**: select a character, variable, or text range, then Add Note. The selection is underlined; hover over it to read the note. Tree navigation selects the annotated text.
- **Editable, resolvable comment threads** opened from the notes tree
- No editor gutter “+”; add notes using the context menu or shortcut
- **Categories**: TODO, BUG, NOTE
- **Private storage only** in `.margo/local.notes.json`
- **Tree view** with grouping (by file, category, status) and filtering
- **Export** to Markdown or HTML
- **Copy as AI Prompt** — structured handoff to Claude, Copilot, or any LLM
- **Position tracking** — notes follow edits to lines and selected text. If the entire selection is deleted, its note becomes a line note so it remains visible.
- **Hover previews** on any annotated line

## Quick start

1. Build a VSIX with `npm ci`, then `npm run package`. In VS Code, use **Extensions → Install from VSIX…** and select `margo-inline-0.3.0.vsix`.
2. Open a file, select text for a text-level note (or leave the selection empty for a line note), then right-click → _Add Note_ (or <kbd>Ctrl+Shift+N</kbd> / <kbd>⇧⌘A</kbd>)
3. The note input receives focus automatically. Type your note: the first line is the title and following lines are the body. Markdown is supported. Click **Save** or press **⌘Enter** (Windows/Linux: **Ctrl+Enter**); after a successful save, the input collapses and focus returns to code. If saving fails, the draft stays open for retry.
4. Open the **Margo Inline** explorer in the activity bar to browse, filter, and export.

## 备注文字颜色 / Annotation color

行尾显示样式为 `[✎] 备注内容`。小铅笔图标与备注文字使用同一颜色，深色和浅色主题的默认颜色均为 **`#BCAED0`**，不使用斜体。高对比度主题保留专用配色。

在 VS Code 命令面板中运行 **Preferences: Open User Settings (JSON)**，将下面的配置合并到 `settings.json` 中；修改颜色值即可自定义：

```json
{
  "workbench.colorCustomizations": {
    "margoInline.inlineNoteForeground": "#BCAED0"
  }
}
```

如果已有 `workbench.colorCustomizations`，只需在其中添加或更新这一项，不要覆盖其他配置。颜色修改即时生效，无需重新安装插件。

已有自定义颜色会覆盖新版默认值；要恢复默认颜色，请删除对应覆盖项。旧版配置键 `margo.inlineNoteForeground` 需要改成 `margoInline.inlineNoteForeground`。

## Storage

| File/Folder | Purpose | Gitignored? |
| --- | --- | --- |
| `.margo/local.notes.json` | Local vault — private, never committed | Yes (auto) |

The `.margo/.gitignore` file contains `*`, ignoring all directory contents, including itself. It is created or repaired when existing local notes load or notes are saved. Already tracked files remain tracked by Git.

Legacy `.notes.json` files are left untouched and are no longer loaded. Existing priority fields remain compatible in stored data but are not exposed in the UI or exports. Multiline notes appear on one line; multiple notes on the same line are separated by ` | `. Long annotations can extend beyond the visible editor width.

## License

Margo Inline is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for the full text.

The original copyright notices and AGPL-3.0-only license are preserved. Fork changes are maintained by ignorantshr. This fork does not offer the upstream author's separate commercial license.

## Fork identity and compatibility

- Extension ID: `ignorantshr.margo-inline`; publishing under this ID requires a publisher account controlled by the maintainer. No Marketplace or Open VSX publication is claimed.
- Commands, views, and settings use the `margoInline` namespace. Update previous `margo.*` settings and keybindings to `margoInline.*` (for example, `margoInline.inlineNoteForeground`).
- Existing notes remain in `.margo/local.notes.json` so upgrading does not move or discard them. Disable the original Margo extension and earlier custom builds to avoid duplicate shortcuts and concurrent writes to this shared data path.
- Upstream history and attribution are retained; fork changes begin at version 0.2.0 on 2026-11-04.

## Links

- **Repository**: https://github.com/ignorantshr/margo
- **Issues**: https://github.com/ignorantshr/margo/issues
- **Upstream source and attribution**: https://github.com/aikaisi/margo

---

Original work © 2026 Abbas Al-Kaisi. Fork modifications © 2026 ignorantshr. Licensed under AGPL-3.0-only.
