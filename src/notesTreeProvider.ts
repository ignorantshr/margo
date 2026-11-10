// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import * as path from 'path';
import {
    Note,
    Category,
    NoteStatus,
    GroupMode,
    FilterState,
    CATEGORY_CONFIG,
    STATUS_CONFIG,
    matchesFilter,
    getAbsolutePath,
    formatTimeCompact,
} from './utils';
import { NoteStorage } from './noteStorage';
import { getConfig } from './config';

class GroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly groupKey: string,
        label: string,
        public readonly noteEntries: { note: Note; filePath: string }[],
        public readonly workspaceRoot: string,
        icon: vscode.Uri | vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${noteEntries.length}`;
        this.iconPath = icon;
        this.contextValue = 'noteGroup';
    }
}

class FileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        public readonly notes: Note[],
        public readonly workspaceRoot: string
    ) {
        super(path.basename(filePath), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${notes.length}`;
        this.tooltip = filePath;
        this.contextValue = 'noteFile';
        this.resourceUri = vscode.Uri.file(getAbsolutePath(filePath, workspaceRoot));
    }
}

class NoteTreeItem extends vscode.TreeItem {
    constructor(
        public readonly note: Note,
        public readonly filePath: string,
        public readonly workspaceRoot: string,
        showFilePath: boolean,
        extensionUri: vscode.Uri
    ) {
        const categoryConfig = CATEGORY_CONFIG[note.category];

        const raw = (note.title || note.text.split(/\r?\n/)[0]).replace(/^[#*\->\s]+/, '').trim();
        const displayText = raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;

        const resolvedPrefix = note.status === 'resolved' ? '✓ ' : '';
        super(`${resolvedPrefix}${displayText}`, vscode.TreeItemCollapsibleState.None);

        if (showFilePath) {
            this.description = `${path.basename(filePath)}:${note.line + 1}`;
        } else {
            this.description = `L${note.line + 1}`;
        }

        const bodyPart = note.text ? `\n\n${note.text}` : '';
        this.tooltip = new vscode.MarkdownString(
            `**${categoryConfig.icon} ${categoryConfig.label}** · ${STATUS_CONFIG[note.status].label}\n\n**${note.title}**${bodyPart}\n\n*${note.author} · ${formatTimeCompact(note.timestamp)} (${new Date(note.timestamp).toLocaleString()})*`
        );
        this.contextValue = note.status === 'resolved' ? 'noteResolved' : 'note';

        this.command = {
            command: 'margoInline.goToNote',
            title: 'Go to Note',
            arguments: [this.note, this.filePath, this.workspaceRoot]
        };

        this.iconPath = getCategoryIcon(note.category, note.status, extensionUri);
    }
}

function getCategoryIcon(
    category: Category,
    status: NoteStatus,
    extensionUri: vscode.Uri
): vscode.Uri | vscode.ThemeIcon {
    if (status === 'resolved') {
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    const fileMap: Record<Category, string> = {
        todo: 'todo.svg',
        bug: 'bug.svg',
        note: 'note.svg',
    };
    return vscode.Uri.joinPath(extensionUri, 'images', fileMap[category]);
}

type TreeItem = GroupTreeItem | FileTreeItem | NoteTreeItem;

export class NotesTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private storage: NoteStorage;
    private groupMode: GroupMode;
    private filter: FilterState = {};
    private changeDisposable: vscode.Disposable;
    private readonly extensionUri: vscode.Uri;

    constructor(storage: NoteStorage, extensionUri: vscode.Uri) {
        this.storage = storage;
        this.extensionUri = extensionUri;
        this.groupMode = getConfig().treeGroupBy;
        this.changeDisposable = this.storage.onDidChange(() => this.refresh());
    }

    public updateStorage(newStorage: NoteStorage): void {
        this.changeDisposable.dispose();
        this.storage = newStorage;
        this.changeDisposable = this.storage.onDidChange(() => this.refresh());
        this.refresh();
    }

    public setGroupMode(mode: GroupMode): void {
        this.groupMode = mode;
        this.refresh();
    }

    public getGroupMode(): GroupMode {
        return this.groupMode;
    }

    public setFilter(filter: FilterState): void {
        this.filter = filter;
        this.refresh();
    }

    public getFilter(): FilterState {
        return this.filter;
    }

    public clearFilter(): void {
        this.filter = {};
        this.refresh();
    }

    public hasActiveFilter(): boolean {
        return !!(
            (this.filter.categories && this.filter.categories.length > 0) ||
            (this.filter.statuses && this.filter.statuses.length > 0) ||
            this.filter.textSearch
        );
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }
        if (element instanceof GroupTreeItem) {
            return Promise.resolve(this.getGroupChildren(element));
        }
        if (element instanceof FileTreeItem) {
            return Promise.resolve(this.getFileChildren(element));
        }
        return Promise.resolve([]);
    }

    private getAllFilteredNotes(): { note: Note; filePath: string }[] {
        const allNotes = this.storage.getAllNotes();
        const config = getConfig();
        const entries: { note: Note; filePath: string }[] = [];

        for (const [filePath, notes] of allNotes.entries()) {
            for (const note of notes) {
                if (!config.showResolvedNotes && note.status === 'resolved') continue;
                if (this.hasActiveFilter() && !matchesFilter(note, this.filter)) continue;
                entries.push({ note, filePath });
            }
        }

        return entries;
    }

    private getRootItems(): TreeItem[] {
        switch (this.groupMode) {
            case 'file': return this.getFileGroupedItems();
            case 'category': return this.getCategoryGroupedItems();
            case 'status': return this.getStatusGroupedItems();
            default: return this.getFileGroupedItems();
        }
    }

    private getFileGroupedItems(): FileTreeItem[] {
        const allNotes = this.storage.getAllNotes();
        const config = getConfig();
        const items: FileTreeItem[] = [];

        for (const [filePath, notes] of allNotes.entries()) {
            const filtered = notes.filter(n => {
                if (!config.showResolvedNotes && n.status === 'resolved') return false;
                if (this.hasActiveFilter() && !matchesFilter(n, this.filter)) return false;
                return true;
            });
            if (filtered.length > 0) {
                items.push(new FileTreeItem(filePath, filtered, this.storage.getWorkspaceRoot()));
            }
        }

        items.sort((a, b) => a.filePath.localeCompare(b.filePath));
        return items;
    }

    private getCategoryGroupedItems(): GroupTreeItem[] {
        const entries = this.getAllFilteredNotes();
        const groups = new Map<Category, { note: Note; filePath: string }[]>();

        for (const entry of entries) {
            const list = groups.get(entry.note.category) || [];
            list.push(entry);
            groups.set(entry.note.category, list);
        }

        const order: Category[] = ['todo', 'bug', 'note'];
        const items: GroupTreeItem[] = [];
        for (const cat of order) {
            const list = groups.get(cat);
            if (list && list.length > 0) {
                const cfg = CATEGORY_CONFIG[cat];
                items.push(new GroupTreeItem(
                    cat,
                    cfg.label,
                    list,
                    this.storage.getWorkspaceRoot(),
                    getCategoryIcon(cat, 'open', this.extensionUri)
                ));
            }
        }
        return items;
    }

    private getStatusGroupedItems(): GroupTreeItem[] {
        const entries = this.getAllFilteredNotes();
        const groups = new Map<NoteStatus, { note: Note; filePath: string }[]>();

        for (const entry of entries) {
            const list = groups.get(entry.note.status) || [];
            list.push(entry);
            groups.set(entry.note.status, list);
        }

        const order: NoteStatus[] = ['open', 'resolved'];
        const items: GroupTreeItem[] = [];
        for (const status of order) {
            const list = groups.get(status);
            if (list && list.length > 0) {
                const cfg = STATUS_CONFIG[status];
                const icon = status === 'resolved'
                    ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
                    : new vscode.ThemeIcon('circle-outline');
                items.push(new GroupTreeItem(
                    status,
                    `${cfg.icon} ${cfg.label}`,
                    list,
                    this.storage.getWorkspaceRoot(),
                    icon
                ));
            }
        }
        return items;
    }

    private getGroupChildren(group: GroupTreeItem): NoteTreeItem[] {
        return group.noteEntries
            .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.note.line - b.note.line)
            .map(e => new NoteTreeItem(e.note, e.filePath, group.workspaceRoot, true, this.extensionUri));
    }

    private getFileChildren(fileItem: FileTreeItem): NoteTreeItem[] {
        return fileItem.notes
            .sort((a, b) => a.line - b.line)
            .map(note => new NoteTreeItem(note, fileItem.filePath, fileItem.workspaceRoot, false, this.extensionUri));
    }

    public dispose(): void {
        this.changeDisposable.dispose();
        this._onDidChangeTreeData.dispose();
    }
}

export function registerTreeViewCommands(
    context: vscode.ExtensionContext,
    storage: NoteStorage,
    provider: { expandThreadForNote: (uri: vscode.Uri, noteId: string) => void },
    treeProvider: NotesTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'margoInline.goToNote',
            async (note: Note, filePath: string, workspaceRoot: string) => {
                const absolutePath = getAbsolutePath(filePath, workspaceRoot);
                const uri = vscode.Uri.file(absolutePath);
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    const editor = await vscode.window.showTextDocument(document);
                    const current = storage.getNoteById(note.id)?.note ?? note;
                    const range = document.validateRange(new vscode.Range(current.line, current.anchor?.character ?? 0,
                        current.anchor?.endLine ?? current.line, current.anchor?.endCharacter ?? 0));
                    editor.selection = new vscode.Selection(range.start, range.end);
                    editor.revealRange(
                        range,
                        vscode.TextEditorRevealType.InCenter
                    );
                    provider.expandThreadForNote(uri, note.id);
                } catch {
                    vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
                }
            }
        ),

        vscode.commands.registerCommand(
            'margoInline.deleteNoteFromTree',
            async (treeItem: NoteTreeItem) => {
                const config = getConfig();
                if (config.confirmDelete) {
                    const answer = await vscode.window.showWarningMessage(
                        'Delete this note?', { modal: true }, 'Delete', 'Cancel'
                    );
                    if (answer !== 'Delete') return;
                }
                const uri = vscode.Uri.file(getAbsolutePath(treeItem.filePath, treeItem.workspaceRoot));
                storage.deleteNote(uri, treeItem.note.id);
            }
        ),

        vscode.commands.registerCommand(
            'margoInline.resolveNoteFromTree',
            (treeItem: NoteTreeItem) => {
                storage.updateNoteStatus(treeItem.note.id, 'resolved');
            }
        ),

        vscode.commands.registerCommand(
            'margoInline.unresolveNoteFromTree',
            (treeItem: NoteTreeItem) => {
                storage.updateNoteStatus(treeItem.note.id, 'open');
            }
        ),

        vscode.commands.registerCommand('margoInline.groupByFile', () => {
            treeProvider.setGroupMode('file');
        }),
        vscode.commands.registerCommand('margoInline.groupByCategory', () => {
            treeProvider.setGroupMode('category');
        }),
        vscode.commands.registerCommand('margoInline.groupByStatus', () => {
            treeProvider.setGroupMode('status');
        }),

        vscode.commands.registerCommand('margoInline.switchGroupBy', async () => {
            const current = treeProvider.getGroupMode();
            interface GroupOption extends vscode.QuickPickItem { mode: GroupMode }
            const options: GroupOption[] = [
                { label: '$(file) By File', description: current === 'file' ? '$(check) Active' : '', mode: 'file' },
                { label: '$(tag) By Category', description: current === 'category' ? '$(check) Active' : '', mode: 'category' },
                { label: '$(filter) By Status', description: current === 'status' ? '$(check) Active' : '', mode: 'status' },
            ];
            const picked = await vscode.window.showQuickPick(options, {
                placeHolder: 'Group notes by…',
            });
            if (picked) {
                treeProvider.setGroupMode(picked.mode);
            }
        }),

        vscode.commands.registerCommand('margoInline.filterNotes', async () => {
            interface FilterTypeOption extends vscode.QuickPickItem { filterType: string }
            const filterType = await vscode.window.showQuickPick<FilterTypeOption>([
                { label: '$(tag) By Category', filterType: 'category' },
                { label: '$(filter) By Status', filterType: 'status' },
                { label: '$(search) By Text', filterType: 'text' },
            ], { placeHolder: 'Filter notes by…' });

            if (!filterType) return;

            const current = treeProvider.getFilter();

            if (filterType.filterType === 'text') {
                const text = await vscode.window.showInputBox({
                    placeHolder: 'Search text…',
                    value: current.textSearch || '',
                });
                if (text !== undefined) {
                    treeProvider.setFilter({ ...current, textSearch: text || undefined });
                }
                return;
            }

            if (filterType.filterType === 'category') {
                const visibleCategories: Category[] = ['todo', 'bug', 'note'];
                const items = visibleCategories.map(cat => ({
                    label: `${CATEGORY_CONFIG[cat].icon} ${CATEGORY_CONFIG[cat].label}`,
                    picked: current.categories ? current.categories.includes(cat) : false,
                    category: cat,
                }));
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select categories to show',
                    canPickMany: true,
                });
                if (picked) {
                    treeProvider.setFilter({
                        ...current,
                        categories: picked.length > 0 ? picked.map(p => p.category) : undefined,
                    });
                }
            }



            if (filterType.filterType === 'status') {
                const items = (['open', 'resolved'] as NoteStatus[]).map(s => ({
                    label: `${STATUS_CONFIG[s].icon} ${STATUS_CONFIG[s].label}`,
                    picked: current.statuses ? current.statuses.includes(s) : false,
                    status: s,
                }));
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select statuses to show',
                    canPickMany: true,
                });
                if (picked) {
                    treeProvider.setFilter({
                        ...current,
                        statuses: picked.length > 0 ? picked.map(p => p.status) : undefined,
                    });
                }
            }


        }),

        vscode.commands.registerCommand('margoInline.clearFilter', () => {
            treeProvider.clearFilter();
            vscode.window.showInformationMessage('Margo Inline: Filters cleared');
        }),
    );
}
