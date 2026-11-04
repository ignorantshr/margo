// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    Note,
    Category,
    NoteStatus,
    FilterState,
    CATEGORY_CONFIG,
    STATUS_CONFIG,
    matchesFilter,
} from './utils';
import { NoteStorage } from './noteStorage';

async function askExportFilter(): Promise<FilterState | undefined> {
    const useFilter = await vscode.window.showQuickPick(
        [
            { label: '$(file) Export All Notes', filter: false },
            { label: '$(filter) Export with Filter…', filter: true },
        ],
        { placeHolder: 'What to export?' }
    );

    if (!useFilter) return undefined;
    if (!useFilter.filter) return {};

    const filter: FilterState = {};

    const visibleCategories: Category[] = ['todo', 'bug', 'note'];
    const catItems = visibleCategories.map(cat => ({
        label: `${CATEGORY_CONFIG[cat].icon} ${CATEGORY_CONFIG[cat].label}`,
        picked: true,
        category: cat,
    }));
    const pickedCats = await vscode.window.showQuickPick(catItems, {
        placeHolder: 'Select categories to include',
        canPickMany: true,
    });
    if (!pickedCats) return undefined;
    if (pickedCats.length < catItems.length) {
        filter.categories = pickedCats.map(p => p.category);
    }

    const statusItems = (['open', 'resolved'] as NoteStatus[]).map(s => ({
        label: `${STATUS_CONFIG[s].icon} ${STATUS_CONFIG[s].label}`,
        picked: true,
        status: s,
    }));
    const pickedStatuses = await vscode.window.showQuickPick(statusItems, {
        placeHolder: 'Select statuses to include',
        canPickMany: true,
    });
    if (!pickedStatuses) return undefined;
    if (pickedStatuses.length < statusItems.length) {
        filter.statuses = pickedStatuses.map(p => p.status);
    }

    return filter;
}

function getFilteredNotes(storage: NoteStorage, filter: FilterState): Map<string, Note[]> {
    const allNotes = storage.getAllNotes();
    const result = new Map<string, Note[]>();

    for (const [filePath, notes] of allNotes.entries()) {
        const filtered = notes.filter(n => matchesFilter(n, filter));
        if (filtered.length > 0) {
            result.set(filePath, filtered);
        }
    }
    return result;
}

function countNotes(notesMap: Map<string, Note[]>) {
    let total = 0;
    const categories: Record<Category, number> = { todo: 0, bug: 0, note: 0 };
    const statuses: Record<NoteStatus, number> = { open: 0, resolved: 0 };

    for (const notes of notesMap.values()) {
        for (const note of notes) {
            total++;
            categories[note.category]++;
            statuses[note.status]++;
        }
    }
    return { total, categories, statuses };
}

export async function exportToMarkdown(storage: NoteStorage): Promise<void> {
    const filter = await askExportFilter();
    if (filter === undefined) return;

    const notesMap = getFilteredNotes(storage, filter);
    if (notesMap.size === 0) {
        vscode.window.showWarningMessage('No notes match the selected filters');
        return;
    }

    const workspaceRoot = storage.getWorkspaceRoot();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(workspaceRoot, `margo-${timestamp}.md`)),
        filters: { 'Markdown': ['md'] }
    });
    if (!saveUri) return;

    const { total, categories, statuses } = countNotes(notesMap);

    let md = `# Margo Report\n\n`;
    md += `Generated: ${new Date().toLocaleString()}\n\n`;
    md += `Total Notes: ${total}\n\n---\n\n`;

    md += `## Summary\n\n`;

    md += `| Category | Count |\n|----------|-------|\n`;
    for (const [cat, cfg] of Object.entries(CATEGORY_CONFIG)) {
        md += `| ${cfg.icon} ${cfg.label} | ${categories[cat as Category]} |\n`;
    }
    md += `\n`;

    md += `| Status | Count |\n|--------|-------|\n`;
    md += `| ${STATUS_CONFIG.open.icon} Open | ${statuses.open} |\n`;
    md += `| ${STATUS_CONFIG.resolved.icon} Resolved | ${statuses.resolved} |\n\n`;

    md += `---\n\n## Notes by File\n\n`;

    const sortedFiles = Array.from(notesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [filePath, notes] of sortedFiles) {
        md += `### ${filePath}\n\n`;
        const sorted = [...notes].sort((a, b) => a.line - b.line);
        for (const note of sorted) {
            const cat = CATEGORY_CONFIG[note.category];
            const status = note.status === 'resolved' ? ' ✓' : '';
            const date = new Date(note.timestamp).toLocaleString();
            md += `#### Line ${note.line + 1} — ${cat.icon} ${cat.label}${status}\n\n`;
            md += `${[note.title, note.text].filter(Boolean).join('\n\n')}\n\n`;
            md += `> *${note.author} · ${date}*\n\n`;
        }
        md += `---\n\n`;
    }

    await fs.promises.writeFile(saveUri.fsPath, md, 'utf-8');
    const doc = await vscode.workspace.openTextDocument(saveUri);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Exported ${total} notes to Markdown`);
}

export async function exportToHtml(storage: NoteStorage): Promise<void> {
    const filter = await askExportFilter();
    if (filter === undefined) return;

    const notesMap = getFilteredNotes(storage, filter);
    if (notesMap.size === 0) {
        vscode.window.showWarningMessage('No notes match the selected filters');
        return;
    }

    const workspaceRoot = storage.getWorkspaceRoot();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(workspaceRoot, `margo-${timestamp}.html`)),
        filters: { 'HTML': ['html'] }
    });
    if (!saveUri) return;

    const { total, statuses } = countNotes(notesMap);

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Margo Report</title>
    <style>
        :root {
            --bg: #1e1e2e; --text: #cdd6f4; --card: #313244; --border: #45475a;
            --high: #f38ba8; --medium: #fab387; --low: #a6e3a1; --resolved: #a6adc8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem;
        }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { color: #cba6f7; margin-bottom: 0.5rem; font-size: 2rem; }
        .meta { color: #a6adc8; margin-bottom: 2rem; font-size: 0.9rem; }
        .summary {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 1rem; margin-bottom: 2rem;
        }
        .summary-card {
            background: var(--card); padding: 1rem; border-radius: 8px; text-align: center;
        }
        .summary-card .count { font-size: 2rem; font-weight: bold; }
        .summary-card.resolved .count { color: var(--resolved); }
        .file-section { background: var(--card); border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
        .file-header { background: #45475a; padding: 0.75rem 1rem; font-family: monospace; font-size: 0.9rem; }
        .note { padding: 1rem; border-bottom: 1px solid var(--border); }
        .note:last-child { border-bottom: none; }
        .note.resolved { opacity: 0.65; }
        .note-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
        .note-meta { display: flex; gap: 0.5rem; align-items: center; }
        .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
        .badge.resolved-badge { background: #585b70; color: #cdd6f4; }
        .note-text { background: #1e1e2e; padding: 1rem; border-radius: 4px; white-space: pre-wrap; }
        .note-footer { margin-top: 0.5rem; font-size: 0.8rem; color: #a6adc8; }
        .line-badge { background: #89b4fa; color: #1e1e2e; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-family: monospace; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Margo Report</h1>
        <p class="meta">Generated: ${new Date().toLocaleString()} · ${total} notes · ${statuses.open} open · ${statuses.resolved} resolved</p>
        <div class="summary">
            <div class="summary-card resolved"><div class="count">${statuses.resolved}</div><div>✓ Resolved</div></div>
        </div>
`;

    const sortedFiles = Array.from(notesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [filePath, notes] of sortedFiles) {
        html += `        <div class="file-section">\n            <div class="file-header">📁 ${escapeHtml(filePath)}</div>\n`;
        const sorted = [...notes].sort((a, b) => a.line - b.line);
        for (const note of sorted) {
            const cat = CATEGORY_CONFIG[note.category];
            const date = new Date(note.timestamp).toLocaleString();
            const resolvedClass = note.status === 'resolved' ? ' resolved' : '';
            const resolvedBadge = note.status === 'resolved' ? ' <span class="badge resolved-badge">✓ Resolved</span>' : '';

            html += `            <div class="note${resolvedClass}">
                <div class="note-header">
                    <div class="note-meta">
                        <span>${cat.icon} ${cat.label}</span>
                        <span class="line-badge">Line ${note.line + 1}</span>${resolvedBadge}
                    </div>
                </div>
                <div class="note-text">${escapeHtml([note.title, note.text].filter(Boolean).join('\n\n'))}</div>
                <div class="note-footer">${escapeHtml(note.author)} · ${date}</div>
            </div>\n`;
        }
        html += `        </div>\n`;
    }

    html += `    </div>\n</body>\n</html>`;

    await fs.promises.writeFile(saveUri.fsPath, html, 'utf-8');
    await vscode.env.openExternal(saveUri);
    vscode.window.showInformationMessage(`Exported ${total} notes to HTML`);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function copyAsAiPrompt(storage: NoteStorage): Promise<void> {
    const filter = await askExportFilter();
    if (filter === undefined) return;

    const notesMap = getFilteredNotes(storage, filter);
    if (notesMap.size === 0) {
        vscode.window.showWarningMessage('No notes match the selected filters');
        return;
    }

    let prompt = `I have reviewed the following code and have these notes. Please make the requested changes:\n\n---\n\n`;

    const sortedFiles = Array.from(notesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [filePath, notes] of sortedFiles) {
        prompt += `## ${filePath}\n\n`;
        const sorted = [...notes].sort((a, b) => a.line - b.line);
        for (const note of sorted) {
            const cat = CATEGORY_CONFIG[note.category];
            prompt += `**Line ${note.line + 1}** — ${cat.icon} ${cat.label}\n`;
            prompt += `${[note.title, note.text].filter(Boolean).join('\n\n')}\n\n`;
        }
    }

    prompt += `---\n\nPlease address each note.`;

    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage('AI prompt copied to clipboard — paste it into Claude, Copilot, or any AI tool.');
}

export function registerExportCommands(context: vscode.ExtensionContext, storage: NoteStorage): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('margo.exportMarkdown', () => exportToMarkdown(storage)),
        vscode.commands.registerCommand('margo.exportHtml', () => exportToHtml(storage)),
        vscode.commands.registerCommand('margo.copyAsAiPrompt', () => copyAsAiPrompt(storage)),
    );
}
