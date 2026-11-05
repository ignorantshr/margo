// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';

export function getWorkspaceRoot(uri: vscode.Uri): string | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    return workspaceFolder?.uri.fsPath;
}

export function getCurrentWorkspaceRoot(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    return getWorkspaceRoot(activeEditor.document.uri)
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export class WorkspaceManager {
    private currentWorkspaceRoot: string | undefined;
    private onChangeCallbacks: ((newRoot: string | undefined) => void)[] = [];

    constructor() {
        this.currentWorkspaceRoot = getCurrentWorkspaceRoot();

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                const newRoot = getWorkspaceRoot(editor.document.uri);
                // Comment input editors have no workspace folder. Moving focus into
                // and out of them must not replace storage or destroy editing threads.
                if (!newRoot) return;

                if (newRoot !== this.currentWorkspaceRoot) {
                    this.currentWorkspaceRoot = newRoot;
                    this.notifyChange(newRoot);
                }
            }
        });
    }

    public onChange(callback: (newRoot: string | undefined) => void): vscode.Disposable {
        this.onChangeCallbacks.push(callback);

        return new vscode.Disposable(() => {
            const index = this.onChangeCallbacks.indexOf(callback);
            if (index > -1) {
                this.onChangeCallbacks.splice(index, 1);
            }
        });
    }

    public getWorkspaceRoot(): string | undefined {
        return this.currentWorkspaceRoot;
    }

    private notifyChange(newRoot: string | undefined): void {
        for (const callback of this.onChangeCallbacks) {
            callback(newRoot);
        }
    }
}
