// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as path from 'path';
import * as os from 'os';

export type Priority = 'high' | 'medium' | 'low';
export type Category = 'todo' | 'bug' | 'note';
export type NoteStatus = 'open' | 'resolved';
export type NoteVault = 'local' | 'team';
export type GroupMode = 'file' | 'category' | 'priority' | 'status' | 'vault';

export const PRIORITY_CONFIG: Record<Priority, { icon: string; label: string; color: string; order: number }> = {
    high: { icon: '⬆︎⬆︎⬆︎', label: 'High', color: '#f44336', order: 0 },
    medium: { icon: '⬆︎⬆︎', label: 'Medium', color: '#ff9800', order: 1 },
    low: { icon: '⬆︎', label: 'Low', color: '#4caf50', order: 2 },
};

export const CATEGORY_CONFIG: Record<Category, { icon: string; label: string }> = {
    todo: { icon: '📋', label: 'TODO' },
    bug: { icon: '🐛', label: 'BUG' },
    note: { icon: '📝', label: 'NOTE' },
};

export const STATUS_CONFIG: Record<NoteStatus, { icon: string; label: string }> = {
    open: { icon: '○', label: 'Open' },
    resolved: { icon: '✓', label: 'Resolved' },
};

export const VAULT_CONFIG: Record<NoteVault, { icon: string; label: string }> = {
    local: { icon: '👤', label: 'Local' },
    team: { icon: '👥', label: 'Team' },
};

export interface Note {
    id: string;
    line: number;
    title: string;
    text: string;
    timestamp: number;
    author: string;
    priority: Priority;
    category: Category;
    status: NoteStatus;
    vault: NoteVault;
    movedAt?: number;
    anchor?: { character: number; endLine: number; endCharacter: number };
}

export interface FilterState {
    categories?: Category[];
    priorities?: Priority[];
    statuses?: NoteStatus[];
    vaults?: NoteVault[];
    textSearch?: string;
}

export function createNote(
    line: number,
    title: string,
    text: string,
    author: string,
    priority: Priority = 'medium',
    category: Category = 'note',
    vault: NoteVault = 'local'
): Note {
    return {
        id: generateId(),
        line,
        title,
        text,
        timestamp: Date.now(),
        author: author || getCurrentUser(),
        priority,
        category,
        status: 'open',
        vault,
    };
}

export function migrateNote(note: Partial<Note> & { id: string; line: number; text: string }): Note {
    const derivedTitle = note.title ?? note.text.split(/\r?\n/)[0].slice(0, 60).trim();
    return {
        id: note.id,
        line: note.line,
        title: derivedTitle,
        ...(note.anchor ? { anchor: { ...note.anchor } } : {}),
        text: note.text,
        timestamp: note.timestamp ?? Date.now(),
        author: note.author ?? 'Unknown',
        priority: note.priority ?? 'medium',
        category: note.category ?? 'note',
        status: note.status ?? 'open',
        vault: note.vault ?? 'local',
    };
}

export function matchesFilter(note: Note, filter: FilterState): boolean {
    if (filter.categories && filter.categories.length > 0 && !filter.categories.includes(note.category)) {
        return false;
    }
    if (filter.priorities && filter.priorities.length > 0 && !filter.priorities.includes(note.priority)) {
        return false;
    }
    if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(note.status)) {
        return false;
    }
    if (filter.vaults && filter.vaults.length > 0 && !filter.vaults.includes(note.vault)) {
        return false;
    }
    if (filter.textSearch) {
        const search = filter.textSearch.toLowerCase();
        if (
            !note.title.toLowerCase().includes(search) &&
            !note.text.toLowerCase().includes(search) &&
            !note.author.toLowerCase().includes(search)
        ) {
            return false;
        }
    }
    return true;
}

export function normalizeFilePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

export function getRelativePath(absolutePath: string, workspaceRoot: string): string {
    const normalized = normalizeFilePath(path.relative(workspaceRoot, absolutePath));
    return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

export function getAbsolutePath(relativePath: string, workspaceRoot: string): string {
    return path.resolve(workspaceRoot, relativePath);
}

export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | undefined;

    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            fn(...args);
        }, delay);
    };
}

export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function getCurrentUser(): string {
    return os.userInfo().username || 'Unknown';
}

export function formatNoteAsMarkdown(note: Note): string {
    return note.text;
}

export function formatTimeCompact(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return 'now';
}
