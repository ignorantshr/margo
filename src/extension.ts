// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import { NoteStorage } from './noteStorage';
import { MargoNotesProvider } from './margoNotesProvider';
import { NotesTreeProvider, registerTreeViewCommands } from './notesTreeProvider';
import { registerExportCommands } from './exportProvider';
import { WorkspaceManager, getCurrentWorkspaceRoot } from './workspaceManager';
import { LineTracker } from './lineTracker';
import { StatusBarManager } from './statusBar';
import { getConfig, onConfigChange } from './config';

let storage: NoteStorage | undefined;
let provider: MargoNotesProvider | undefined;
let workspaceManager: WorkspaceManager | undefined;
let treeProvider: NotesTreeProvider | undefined;
let lineTracker: LineTracker | undefined;
let statusBar: StatusBarManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = getCurrentWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Margo Inline: No workspace folder open');
        return;
    }

    storage = new NoteStorage(workspaceRoot);
    await storage.load();

    provider = new MargoNotesProvider(storage, context);
    provider.registerHoverProvider(context);

    treeProvider = new NotesTreeProvider(storage, context.extensionUri);
    const treeView = vscode.window.createTreeView('margoInlineExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    workspaceManager = new WorkspaceManager();

    const config = getConfig();

    if (config.lineTracking) {
        lineTracker = new LineTracker(storage);
        context.subscriptions.push(lineTracker);
    }

    statusBar = new StatusBarManager(storage);
    statusBar.setVisible(config.showStatusBar);
    context.subscriptions.push(statusBar);

    registerMainCommands(context);
    registerTreeViewCommands(context, storage, provider, treeProvider);
    registerExportCommands(context, storage);
    setupEventListeners(context);

    if (vscode.window.activeTextEditor) {
        provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
    }
}

function registerMainCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('margoInline.addNote', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !provider) return;
            const line = editor.selection.active.line;
            await provider.addNoteAtLine(editor.document.uri, line);
        }),

        vscode.commands.registerCommand('margoInline.refreshTree', () => {
            treeProvider?.refresh();
            if (vscode.window.activeTextEditor && provider) {
                provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
            }
        }),
    );
}

function setupEventListeners(context: vscode.ExtensionContext) {
    if (!storage || !provider || !workspaceManager) return;

    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && provider) {
            provider.renderNotesForFile(editor.document.uri);
        }
    });

    const workspaceChangeListener = workspaceManager.onChange(async (newRoot) => {
        if (!newRoot || !provider) return;

        storage?.dispose();
        provider.clearAllThreads();

        storage = new NoteStorage(newRoot);
        await storage.load();

        provider.updateStorage(storage);
        treeProvider?.updateStorage(storage);

        if (lineTracker) {
            lineTracker.dispose();
            lineTracker = new LineTracker(storage);
        }

        if (statusBar) {
            statusBar.dispose();
            statusBar = new StatusBarManager(storage);
            statusBar.setVisible(getConfig().showStatusBar);
        }

        if (vscode.window.activeTextEditor) {
            provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
    });

    const fileWatcherDisposable = storage.watchFile(() => {
        provider?.clearAllThreads();
        if (vscode.window.activeTextEditor && provider) {
            provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
        treeProvider?.refresh();
    });

    const configChangeListener = onConfigChange(() => {
        const cfg = getConfig();
        statusBar?.setVisible(cfg.showStatusBar);

        if (cfg.lineTracking && !lineTracker && storage) {
            lineTracker = new LineTracker(storage);
        } else if (!cfg.lineTracking && lineTracker) {
            lineTracker.dispose();
            lineTracker = undefined;
        }

        treeProvider?.refresh();
        if (vscode.window.activeTextEditor && provider) {
            provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
    });

    const fileRenameListener = vscode.workspace.onDidRenameFiles((e) => {
        for (const { oldUri, newUri } of e.files) {
            storage?.renameFile(oldUri, newUri);
        }
        treeProvider?.refresh();
        if (vscode.window.activeTextEditor && provider) {
            provider.renderNotesForFile(vscode.window.activeTextEditor.document.uri);
        }
    });

    context.subscriptions.push(
        editorChangeListener,
        workspaceChangeListener,
        fileWatcherDisposable,
        configChangeListener,
        fileRenameListener
    );
}

export function deactivate() {
    provider?.dispose();
    storage?.dispose();
    lineTracker?.dispose();
    statusBar?.dispose();
    treeProvider?.dispose();
}
