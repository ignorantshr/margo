// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import {
    Note,
    Category,
    NoteStatus,
    CATEGORY_CONFIG,
    STATUS_CONFIG,
    createNote,
} from './utils';
import { NoteStorage } from './noteStorage';
import { getConfig } from './config';

function getNoteContextValue(note: Pick<Note, 'status'>, armed = false): string {
    const base = note.status === 'resolved' ? 'margoInlineNoteResolved' : 'margoInlineNote';
    const vaultSegment = 'Local';
    return armed ? `${base}${vaultSegment}Armed` : `${base}${vaultSegment}`;
}

function getThreadLabel(note: Note): string {
    const raw = (note.title || note.text.split(/\r?\n/)[0]).replace(/^[#*\->\s]+/, '').trim();
    const preview = raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
    if (!preview) {
        return note.status === 'resolved' ? 'Note ✓' : 'Note';
    }
    return note.status === 'resolved' ? `✓ ${preview}` : preview;
}

const CATEGORY_SVG: Record<string, string> = {
    todo: 'todo.svg',
    bug: 'bug.svg',
    note: 'note.svg',
};

class MargoComment implements vscode.Comment {
    public id: string;
    public body: string | vscode.MarkdownString;
    public mode: vscode.CommentMode;
    public author: vscode.CommentAuthorInformation;
    public contextValue?: string;
    public label?: string;
    public timestamp?: Date;

    constructor(
        public note: Note,
        private extensionUri: vscode.Uri,
        public parent?: vscode.CommentThread
    ) {
        this.id = note.id;
        this.body = MargoComment.buildBody(note);
        (this.body as vscode.MarkdownString).isTrusted = true;
        this.mode = vscode.CommentMode.Preview;
        this.contextValue = getNoteContextValue(note);
        this.author = this.buildAuthor();
        this.label = `by ${note.author}`;
        this.timestamp = new Date(note.timestamp);
    }

    private buildAuthor(): vscode.CommentAuthorInformation {
        const categoryConfig = CATEGORY_CONFIG[this.note.category];
        const statusConfig = STATUS_CONFIG[this.note.status];
        return {
            name: `${categoryConfig.label} · ${statusConfig.label}`,
            iconPath: vscode.Uri.joinPath(this.extensionUri, 'images', CATEGORY_SVG[this.note.category]),
        };
    }

    static buildBody(note: Note): vscode.MarkdownString {
        const md = note.text
            ? new vscode.MarkdownString(`**${note.title}**\n\n${note.text}`)
            : new vscode.MarkdownString(`**${note.title}**`);
        md.isTrusted = true;
        return md;
    }

    public refresh(): void {
        this.body = MargoComment.buildBody(this.note);
        (this.body as vscode.MarkdownString).isTrusted = true;
        this.contextValue = getNoteContextValue(this.note);
        this.author = this.buildAuthor();
        this.label = `by ${this.note.author}`;
        this.timestamp = new Date(this.note.timestamp);
    }
}

export class MargoNotesProvider {
    private commentController: vscode.CommentController;
    private threads: Map<string, vscode.CommentThread[]> = new Map();
    private noteThreadMap: Map<string, vscode.CommentThread> = new Map();
    private readonly deleteArmTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private readonly pendingReloads: Set<string> = new Set();
    private storage: NoteStorage;
    private storageListener: vscode.Disposable;
    private readonly inlineDecoration = vscode.window.createTextEditorDecorationType({
        after: { color: new vscode.ThemeColor('margoInline.inlineNoteForeground'), margin: '0 0 0 3ch', fontStyle: 'normal', fontWeight: 'normal' }
    });
    private readonly extensionUri: vscode.Uri;

    constructor(storage: NoteStorage, context: vscode.ExtensionContext) {
        this.storage = storage;
        this.storageListener = storage.onDidChange(() => this.renderInlineNotes());
        context.subscriptions.push(
            this.inlineDecoration,
            vscode.window.onDidChangeVisibleTextEditors(() => this.renderInlineNotes()),
            vscode.workspace.onDidChangeTextDocument(() => this.renderInlineNotes())
        );
        this.extensionUri = context.extensionUri;

        this.commentController = vscode.comments.createCommentController(
            'margoInline',
            'Margo Inline'
        );

        this.commentController.options = {
            placeHolder: 'Type your note here (supports Markdown)...',
            prompt: 'Add Note',
        };

        this.registerCommands(context);
    }

    public updateStorage(newStorage: NoteStorage): void {
        this.storageListener.dispose();
        this.storage = newStorage;
        this.storageListener = newStorage.onDidChange(() => this.renderInlineNotes());
        this.renderInlineNotes();
    }

    private getNoteIdForThread(thread: vscode.CommentThread): string | undefined {
        for (const [noteId, t] of this.noteThreadMap.entries()) {
            if (t === thread) {
                return noteId;
            }
        }
        return undefined;
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        const commands: vscode.Disposable[] = [
            vscode.commands.registerCommand('margoInline.createNote', (reply: vscode.CommentReply) => {
                this.handleCreateNote(reply);
            }),

            vscode.commands.registerCommand('margoInline.saveNote', (comment: MargoComment) => {
                this.handleSaveNote(comment);
            }),

            vscode.commands.registerCommand('margoInline.cancelNote', (comment: MargoComment) => {
                if (comment.parent) {
                    comment.mode = vscode.CommentMode.Preview;
                    comment.parent.comments = comment.parent.comments.map(c => c);
                }
            }),

            vscode.commands.registerCommand('margoInline.armDeleteNote', (comment: MargoComment) => {
                if (!comment.parent) return;
                const noteId = comment.note.id;
                const existing = this.deleteArmTimers.get(noteId);
                if (existing) clearTimeout(existing);
                comment.contextValue = getNoteContextValue(comment.note, true);
                comment.parent.comments = [...comment.parent.comments];
                const timer = setTimeout(() => {
                    comment.contextValue = getNoteContextValue(comment.note, false);
                    if (comment.parent) comment.parent.comments = [...comment.parent.comments];
                    this.deleteArmTimers.delete(noteId);
                }, 3000);
                this.deleteArmTimers.set(noteId, timer);
            }),

            vscode.commands.registerCommand('margoInline.confirmDeleteNote', (comment: MargoComment) => {
                if (!comment.parent) return;
                const noteId = comment.note.id;
                const timer = this.deleteArmTimers.get(noteId);
                if (timer) { clearTimeout(timer); this.deleteArmTimers.delete(noteId); }
                this.handleDeleteNote(comment.parent, true);
            }),

            vscode.commands.registerCommand('margoInline.deleteNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleDeleteNote(thread, false);
            }),

            vscode.commands.registerCommand('margoInline.discardNote', (reply: vscode.CommentReply) => {
                reply.thread.dispose();
            }),

            vscode.commands.registerCommand('margoInline.editNote', (comment: MargoComment) => {
                if (comment.parent) {
                    comment.mode = vscode.CommentMode.Editing;
                    comment.parent.comments = comment.parent.comments.map(c => c);
                }
            }),

            vscode.commands.registerCommand('margoInline.resolveNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetStatus(thread, 'resolved');
            }),

            vscode.commands.registerCommand('margoInline.unresolveNote', (arg: vscode.CommentThread | MargoComment) => {
                const thread = 'parent' in arg && arg.parent ? arg.parent : arg as vscode.CommentThread;
                this.handleSetStatus(thread, 'open');
            }),

            vscode.commands.registerCommand('margoInline.setCategoryTodo', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'todo')),
            vscode.commands.registerCommand('margoInline.setCategoryBug', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'bug')),
            vscode.commands.registerCommand('margoInline.setCategoryNote', (thread: vscode.CommentThread) =>
                this.handleSetCategory(thread, 'note')),

            vscode.commands.registerCommand('margoInline.editProperties', (comment: MargoComment) =>
                this.handleEditProperties(comment)),

            this.commentController
        ];

        context.subscriptions.push(...commands);
    }

    private reloadThread(uri: vscode.Uri, noteId: string): void {
        this.pendingReloads.add(noteId);
        const existing = this.noteThreadMap.get(noteId);
        if (existing) {
            this.noteThreadMap.delete(noteId);
            const fileThreads = this.threads.get(uri.toString());
            if (fileThreads) {
                const idx = fileThreads.indexOf(existing);
                if (idx > -1) fileThreads.splice(idx, 1);
            }
            existing.dispose();
        }

        setTimeout(() => {
            this.pendingReloads.delete(noteId);
            if (this.noteThreadMap.has(noteId)) return;
            const stored = this.storage.getNoteById(noteId);
            if (!stored) return;
            const note = stored.note;
            const newThread = this.createThreadFromNote(uri, note);
            newThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            const fileThreads = this.threads.get(uri.toString()) ?? [];
            if (!fileThreads.includes(newThread)) {
                fileThreads.push(newThread);
                this.threads.set(uri.toString(), fileThreads);
            }
        }, 0);
    }

    private handleSetCategory(thread: vscode.CommentThread, category: Category): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        this.storage.updateNoteCategory(noteId, category);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
    }

    private handleSetStatus(thread: vscode.CommentThread, status: NoteStatus): void {
        const noteId = this.getNoteIdForThread(thread);
        if (!noteId) return;
        this.storage.updateNoteStatus(noteId, status);
        this.storage.saveImmediately();
        this.reloadThread(thread.uri, noteId);
    }

    private async handleEditProperties(comment: MargoComment): Promise<void> {
        if (!comment.parent) return;

        const thread = comment.parent;
        const noteId = comment.note.id;
        const stored = this.storage.getNoteById(noteId);
        const note = stored?.note ?? comment.note;
        const currentCategory = note.category;

        interface CategoryOption extends vscode.QuickPickItem { category: Category }
        const visibleCategories: Category[] = ['todo', 'bug', 'note'];
        const categoryOptions: CategoryOption[] = visibleCategories.map(cat => ({
            label: `${CATEGORY_CONFIG[cat].icon} ${CATEGORY_CONFIG[cat].label}`,
            description: currentCategory === cat ? '$(check) Current' : '',
            category: cat,
        }));

        const pickedCategory = await vscode.window.showQuickPick(categoryOptions, {
            placeHolder: `Current: ${CATEGORY_CONFIG[currentCategory].icon} ${CATEGORY_CONFIG[currentCategory].label}`,
            title: 'Category',
        });
        if (!pickedCategory) return;

        let needsRefresh = false;
        if (pickedCategory.category !== currentCategory) {
            this.storage.updateNoteCategory(noteId, pickedCategory.category);
            needsRefresh = true;
        }

        if (needsRefresh) {
            this.storage.saveImmediately();
            this.reloadThread(thread.uri, noteId);
        }
    }

    private async handleCreateNote(reply: vscode.CommentReply): Promise<void> {
        const thread = reply.thread;
        const raw = reply.text;
        if (!raw.trim()) return;

        const lines = raw.split(/\r?\n/);
        const title = lines[0].trim();
        const body = lines.slice(1).join('\n').replace(/^\n+/, '').trim();

        const line = thread.range?.start.line ?? 0;
        const config = getConfig();
        const note = createNote(
            line,
            title,
            body,
            config.defaultAuthor,
            'medium',
            config.defaultCategory,
            'local'
        );

        this.storage.addNote(thread.uri, note);

        const comment = new MargoComment(note, this.extensionUri, thread);
        thread.comments = [comment];
        thread.canReply = false;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.label = getThreadLabel(note);

        this.noteThreadMap.set(note.id, thread);
        const fileThreads = this.threads.get(thread.uri.toString()) || [];
        if (!fileThreads.includes(thread)) {
            fileThreads.push(thread);
            this.threads.set(thread.uri.toString(), fileThreads);
        }
    }

    private handleSaveNote(comment: MargoComment): void {
        if (!comment.parent) return;

        const thread = comment.parent;
        const uri = thread.uri;
        const noteId = comment.note.id;
        const raw = typeof comment.body === 'string' ? comment.body : comment.body.value;
        const lines = raw.split(/\r?\n/);
        const newTitle = lines[0].replace(/^\*\*|\*\*$/g, '').trim();
        const newText = lines.slice(1).join('\n').replace(/^\n+/, '').trim();

        this.storage.updateNote(uri, noteId, newTitle, newText);
        this.storage.saveImmediately();

        // VS Code caches comment widget rendering by thread reference; in-place
        // mutation of comment.body is ignored on the first edit/save cycle of
        // a freshly-rendered thread. Dispose + deferred recreate forces a clean render.
        this.noteThreadMap.delete(noteId);
        const fileThreads = this.threads.get(uri.toString());
        if (fileThreads) {
            const idx = fileThreads.indexOf(thread);
            if (idx > -1) fileThreads.splice(idx, 1);
        }
        thread.dispose();

        setTimeout(() => {
            const note = this.storage.getNoteById(noteId)?.note;
            if (!note) return;
            const newThread = this.createThreadFromNote(uri, note);
            newThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }, 0);
    }

    private async handleDeleteNote(thread: vscode.CommentThread, skipConfirm = false): Promise<void> {
        const config = getConfig();
        if (!skipConfirm && config.confirmDelete) {
            const answer = await vscode.window.showWarningMessage(
                'Delete this note?',
                { modal: true },
                'Delete',
                'Cancel'
            );
            if (answer !== 'Delete') return;
        }

        const noteId = this.getNoteIdForThread(thread);
        if (noteId) {
            this.storage.deleteNote(thread.uri, noteId);
            this.noteThreadMap.delete(noteId);
        }

        const fileThreads = this.threads.get(thread.uri.toString());
        if (fileThreads) {
            const index = fileThreads.indexOf(thread);
            if (index > -1) {
                fileThreads.splice(index, 1);
            }
        }

        thread.dispose();
    }

    public renderInlineNotes(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            const byLine = new Map<number, string[]>();
            for (const note of this.storage.getNotesForFile(editor.document.uri)) {
                if (!getConfig().showResolvedNotes && note.status === 'resolved') continue;
                if (note.line < 0 || note.line >= editor.document.lineCount) continue;
                const text = [note.title, note.text].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim();
                const entries = byLine.get(note.line) ?? [];
                entries.push(`${note.status === 'resolved' ? '✓ ' : ''}${text}`);
                byLine.set(note.line, entries);
            }
            editor.setDecorations(this.inlineDecoration, [...byLine].map(([line, texts]) => ({
                range: editor.document.lineAt(line).range,
                renderOptions: { after: { contentText: `[✎] ${texts.join(' | ')}` } }
            })));
        }
    }

    public renderNotesForFile(uri: vscode.Uri): void {
        this.renderInlineNotes();
        this.clearThreadsForFile(uri);

        const config = getConfig();
        const notes = this.storage.getNotesForFile(uri);
        if (notes.length === 0) return;

        const threads: vscode.CommentThread[] = [];
        for (const note of notes) {
            if (!config.showResolvedNotes && note.status === 'resolved') continue;
            if (this.pendingReloads.has(note.id)) continue;
            const existing = this.noteThreadMap.get(note.id);
            if (existing) {
                threads.push(existing);
            } else {
                const thread = this.createThreadFromNote(uri, note);
                threads.push(thread);
            }
        }

        this.threads.set(uri.toString(), threads);
    }

    private createThreadFromNote(uri: vscode.Uri, note: Note): vscode.CommentThread {
        const range = new vscode.Range(note.line, 0, note.line, 0);
        const thread = this.commentController.createCommentThread(uri, range, []);

        const comment = new MargoComment(note, this.extensionUri, thread);
        thread.comments = [comment];
        thread.canReply = false;
        thread.contextValue = 'margoInlineNoteThread';
        thread.label = getThreadLabel(note);
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;

        this.noteThreadMap.set(note.id, thread);
        return thread;
    }

    public async addNoteAtLine(uri: vscode.Uri, line: number): Promise<void> {
        const range = new vscode.Range(line, 0, line, 0);
        const thread = this.commentController.createCommentThread(uri, range, []);
        thread.canReply = true;
        thread.contextValue = 'margoInlineNoteThread';
        thread.label = 'Note';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }

    public registerHoverProvider(context: vscode.ExtensionContext): void {
        const provider = vscode.languages.registerHoverProvider('*', {
            provideHover: (document, position) => {
                const notes = this.storage.getNotesForFile(document.uri);
                const lineNotes = notes.filter(n => n.line === position.line);
                if (lineNotes.length === 0) return undefined;

                const md = new vscode.MarkdownString('', true);
                md.isTrusted = true;
                md.supportHtml = true;

                for (const note of lineNotes) {
                    const cat = CATEGORY_CONFIG[note.category];
                    const status = STATUS_CONFIG[note.status];
                    md.appendMarkdown(`**${cat.icon} ${cat.label}** · ${status.label}\n\n`);
                    md.appendMarkdown(`**${note.title}**\n\n`);
                    if (note.text) md.appendMarkdown(`${note.text}\n\n`);
                    if (lineNotes.length > 1) md.appendMarkdown('---\n\n');
                }

                return new vscode.Hover(md);
            }
        });
        context.subscriptions.push(provider);
    }

    public refreshAllThreads(): void {
        if (vscode.window.activeTextEditor) {
            this.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
    }

    public clearThreadsForFile(uri: vscode.Uri): void {
        const fileThreads = this.threads.get(uri.toString());
        if (fileThreads) {
            for (const thread of fileThreads) {
                const noteId = this.getNoteIdForThread(thread);
                if (noteId) {
                    this.noteThreadMap.delete(noteId);
                }
                thread.dispose();
            }
            this.threads.delete(uri.toString());
        }
    }

    public expandThreadForNote(_uri: vscode.Uri, noteId: string): void {
        const thread = this.noteThreadMap.get(noteId);
        if (thread) {
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }
    }

    public clearAllThreads(): void {
        for (const threads of this.threads.values()) {
            threads.forEach(thread => thread.dispose());
        }
        this.threads.clear();
        this.noteThreadMap.clear();
    }

    public dispose(): void {
        this.storageListener.dispose();
        this.inlineDecoration.dispose();
        this.clearAllThreads();
        this.commentController.dispose();
    }
}
