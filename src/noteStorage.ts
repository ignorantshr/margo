// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Note, NoteStatus, getRelativePath, normalizeFilePath, debounce, migrateNote, Category } from './utils';

const LOCAL_DIR = '.margo';
const LOCAL_FILENAME = 'local.notes.json';
const LOCAL_GITIGNORE = '*\n';

export type NotesData = { [relativePath: string]: Note[] };
export type NoteChangeListener = () => void;

export class NoteStorage {
    private workspaceRoot: string;
    private readonly localFilePath: string;
    private notes: Map<string, Note[]> = new Map();
    private watchers: vscode.FileSystemWatcher[] = [];
    private saveDebounced: () => void;
    private reloadDebounced?: () => void;
    private changeListeners: NoteChangeListener[] = [];
    private isSelfSaving = false;
    private selfSaveTimer?: ReturnType<typeof setTimeout>;
    private isSaveLocked = false;
    private loadFailed = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.localFilePath = path.join(workspaceRoot, LOCAL_DIR, LOCAL_FILENAME);
        this.saveDebounced = debounce(() => this.saveNow(), 100);
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    public onDidChange(listener: NoteChangeListener): vscode.Disposable {
        this.changeListeners.push(listener);
        return new vscode.Disposable(() => {
            const index = this.changeListeners.indexOf(listener);
            if (index > -1) this.changeListeners.splice(index, 1);
        });
    }

    private notifyChange(): void {
        for (const listener of this.changeListeners) listener();
    }

    public async load(): Promise<void> {
        try {
            const loaded = new Map<string, Note[]>();
            if (fs.existsSync(this.localFilePath)) {
                const data: unknown = JSON.parse(await fs.promises.readFile(this.localFilePath, 'utf-8'));
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid notes file');
                for (const [filePath, notes] of Object.entries(data)) {
                    if (!Array.isArray(notes)) throw new Error('Invalid notes list');
                    const migrated = notes.map(n => {
                        if (!n || typeof n.id !== 'string' || !Number.isInteger(n.line) || n.line < 0 ||
                            typeof n.text !== 'string' ||
                            (n.author !== undefined && typeof n.author !== 'string') ||
                            (n.timestamp !== undefined && (typeof n.timestamp !== 'number' || !Number.isFinite(n.timestamp))) ||
                            (n.title !== undefined && typeof n.title !== 'string') ||
                            (n.category !== undefined && !['todo', 'bug', 'note'].includes(n.category)) ||
                            (n.status !== undefined && !['open', 'resolved'].includes(n.status))) {
                            throw new Error('Invalid note');
                        }
                        if (n.anchor !== undefined) {
                            const a = n.anchor;
                            if (!a || !Number.isSafeInteger(a.character) || a.character < 0 ||
                                !Number.isSafeInteger(a.endLine) || a.endLine < n.line ||
                                !Number.isSafeInteger(a.endCharacter) || a.endCharacter < 0 ||
                                (a.endLine === n.line && a.endCharacter < a.character)) {
                                throw new Error('Invalid note anchor');
                            }
                        }
                        return migrateNote({ ...n, vault: 'local' });
                    });
                    loaded.set(normalizeFilePath(filePath), migrated);
                }
                await this.ensureLocalDir();
            }
            this.notes = loaded;
            this.loadFailed = false;
        } catch (error) {
            this.loadFailed = true;
            console.error('Margo Inline: Failed to load notes:', error);
            vscode.window.showErrorMessage('Margo Inline: Cannot read local notes. Saving is disabled until the file is repaired and reloaded.');
        }
    }

    private async ensureLocalDir(): Promise<void> {
        const dir = path.join(this.workspaceRoot, LOCAL_DIR);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, '.gitignore'), LOCAL_GITIGNORE, 'utf-8');
    }

    public renameFile(oldUri: vscode.Uri, newUri: vscode.Uri): void {
        const oldPath = normalizeFilePath(getRelativePath(oldUri.fsPath, this.workspaceRoot));
        const newPath = normalizeFilePath(getRelativePath(newUri.fsPath, this.workspaceRoot));
        const notes = this.notes.get(oldPath);
        if (!notes) return;
        this.notes.delete(oldPath);
        this.notes.set(newPath, notes);
        this.save();
    }

    public getTotalNoteCount(): number {
        let count = 0;
        for (const notes of this.notes.values()) count += notes.length;
        return count;
    }

    public getAllNotes(): Map<string, Note[]> {
        return new Map(this.notes);
    }

    public getFilesWithNotes(): string[] {
        return Array.from(this.notes.keys());
    }

    public getNotesForFile(fileUri: vscode.Uri): Note[] {
        const relativePath = getRelativePath(fileUri.fsPath, this.workspaceRoot);
        return this.notes.get(normalizeFilePath(relativePath)) || [];
    }

    public getNotesForFileInternal(fileUri: vscode.Uri): Note[] | undefined {
        const relativePath = getRelativePath(fileUri.fsPath, this.workspaceRoot);
        return this.notes.get(normalizeFilePath(relativePath));
    }

    public save(): void {
        this.saveDebounced();
    }

    public saveImmediately(): Promise<boolean> {
        return this.saveNow();
    }

    private async saveNow(): Promise<boolean> {
        while (this.isSaveLocked) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (this.loadFailed) return false;
        this.isSaveLocked = true;
        try {
            const localData: NotesData = {};
            for (const [filePath, notes] of this.notes.entries()) {
                if (notes.length) localData[filePath] = notes;
            }
            if (this.selfSaveTimer) clearTimeout(this.selfSaveTimer);
            this.isSelfSaving = true;

            if (Object.keys(localData).length > 0) {
                await this.ensureLocalDir();
                const temporaryPath = `${this.localFilePath}.tmp`;
                await fs.promises.writeFile(temporaryPath, JSON.stringify(localData, null, 2), 'utf-8');
                await fs.promises.rename(temporaryPath, this.localFilePath);
            } else if (fs.existsSync(this.localFilePath)) {
                await fs.promises.unlink(this.localFilePath);
            }

            this.selfSaveTimer = setTimeout(() => { this.isSelfSaving = false; }, 200);
            this.notifyChange();
            return true;
        } catch (error) {
            this.isSelfSaving = false;
            console.error('Margo Inline: Failed to save notes:', error);
            vscode.window.showErrorMessage('Margo Inline: Failed to save notes file');
            return false;
        } finally {
            this.isSaveLocked = false;
        }
    }

    public getNoteById(noteId: string): { note: Note; filePath: string } | undefined {
        for (const [filePath, notes] of this.notes.entries()) {
            const note = notes.find(n => n.id === noteId);
            if (note) return { note, filePath };
        }
        return undefined;
    }

    public addNote(fileUri: vscode.Uri, note: Note, persist = true): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath) || [];
        fileNotes.push(note);
        this.notes.set(relativePath, fileNotes);
        if (persist) this.save();
    }

    public updateNote(fileUri: vscode.Uri, noteId: string, newTitle: string, newText: string, persist = true): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath);
        if (fileNotes) {
            const note = fileNotes.find(n => n.id === noteId);
            if (note) { note.title = newTitle; note.text = newText; note.timestamp = Date.now(); if (persist) this.save(); }
        }
    }

    public updateNoteCategory(noteId: string, category: Category): void {
        const result = this.getNoteById(noteId);
        if (result) { result.note.category = category; result.note.timestamp = Date.now(); this.save(); }
    }

    public updateNoteStatus(noteId: string, status: NoteStatus): void {
        const result = this.getNoteById(noteId);
        if (result) { result.note.status = status; result.note.timestamp = Date.now(); this.save(); }
    }

    public deleteNote(fileUri: vscode.Uri, noteId: string, persist = true): void {
        const relativePath = normalizeFilePath(getRelativePath(fileUri.fsPath, this.workspaceRoot));
        const fileNotes = this.notes.get(relativePath);
        if (fileNotes) {
            const index = fileNotes.findIndex(n => n.id === noteId);
            if (index > -1) {
                fileNotes.splice(index, 1);
                if (fileNotes.length === 0) this.notes.delete(relativePath);
                if (persist) this.save();
            }
        }
    }

    public watchFile(onExternalChange: () => void): vscode.Disposable {
        const reloadHandler = async () => {
            await this.load();
            this.notifyChange();
            onExternalChange();
        };

        this.reloadDebounced = debounce(() => {
            reloadHandler().catch((err) => {
                console.error('Margo Inline: Failed to reload on external change:', err);
            });
        }, 150);

        const onChange = () => {
            if (this.isSelfSaving) return;
            console.log('Margo Inline: External change detected, reloading...');
            this.reloadDebounced?.();
        };

        const localWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, `${LOCAL_DIR}/${LOCAL_FILENAME}`)
        );
        localWatcher.onDidChange(onChange);
        localWatcher.onDidCreate(onChange);
        localWatcher.onDidDelete(onChange);

        this.watchers = [localWatcher];

        return new vscode.Disposable(() => {
            localWatcher.dispose();
        });
    }

    public dispose(): void {
        for (const w of this.watchers) w.dispose();
    }
}
