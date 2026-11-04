// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import { NoteStorage } from './noteStorage';

export class StatusBarManager implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private changeDisposable: vscode.Disposable;

    constructor(private storage: NoteStorage) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this.item.command = 'margoInlineExplorer.focus';
        this.item.tooltip = 'Margo Inline — click to open explorer';

        this.changeDisposable = storage.onDidChange(() => this.update());
        this.update();
    }

    update(): void {
        const allNotes = this.storage.getAllNotes();
        let total = 0;
        let high = 0;
        let open = 0;

        for (const notes of allNotes.values()) {
            for (const note of notes) {
                total++;
                if (note.priority === 'high') high++;
                if (note.status === 'open') open++;
            }
        }

        if (total === 0) {
            this.item.hide();
            return;
        }

        let text = `$(comment-discussion) ${total}`;
        if (high > 0) {
            text += `  $(flame) ${high}`;
        }
        const resolved = total - open;
        if (resolved > 0) {
            text += `  $(check) ${resolved}`;
        }

        this.item.text = text;
        this.item.show();
    }

    setVisible(visible: boolean): void {
        if (visible) {
            this.update();
        } else {
            this.item.hide();
        }
    }

    dispose(): void {
        this.item.dispose();
        this.changeDisposable.dispose();
    }
}
