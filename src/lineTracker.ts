// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import { NoteStorage } from './noteStorage';
import { trackNote } from './noteTracking';

export class LineTracker implements vscode.Disposable {
    private disposable: vscode.Disposable;

    constructor(private storage: NoteStorage) {
        this.disposable = vscode.workspace.onDidChangeTextDocument(
            (e) => this.onDocumentChange(e)
        );
    }

    private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
        if (e.contentChanges.length === 0) return;
        if (e.document.uri.scheme !== 'file') return;

        const notes = this.storage.getNotesForFileInternal(e.document.uri);
        if (!notes || notes.length === 0) return;

        let changed = false;

        const sortedChanges = [...e.contentChanges].sort(
            (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character
        );
        for (const change of sortedChanges) {
            for (const note of notes) {
                changed = trackNote(note, change) || changed;
            }
        }

        if (changed) {
            this.storage.save();
        }
    }

    dispose(): void {
        this.disposable.dispose();
    }
}
