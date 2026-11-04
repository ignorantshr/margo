// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as vscode from 'vscode';
import { Category, GroupMode } from './utils';

const SECTION = 'margo';

export interface MargoConfig {
    defaultAuthor: string;
    defaultCategory: Category;
    confirmDelete: boolean;
    showStatusBar: boolean;
    treeGroupBy: GroupMode;
    showResolvedNotes: boolean;
    lineTracking: boolean;
}

export function getConfig(): MargoConfig {
    const config = vscode.workspace.getConfiguration(SECTION);
    return {
        defaultAuthor: config.get<string>('defaultAuthor', ''),
        defaultCategory: config.get<Category>('defaultCategory', 'note'),
        confirmDelete: config.get<boolean>('confirmDelete', true),
        showStatusBar: config.get<boolean>('showStatusBar', true),
        treeGroupBy: (['file', 'category', 'status'].includes(config.get<string>('treeGroupBy', 'category')) ? config.get<GroupMode>('treeGroupBy', 'category') : 'category'),
        showResolvedNotes: config.get<boolean>('showResolvedNotes', true),
        lineTracking: config.get<boolean>('lineTracking', true),
    };
}

export function onConfigChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
            callback();
        }
    });
}
