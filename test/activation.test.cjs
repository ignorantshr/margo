const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function fixture() {
    const commands = new Map();
    const added = [];
    const warnings = [];
    const disposable = { dispose() {} };
    const vscode = {
        window: {
            showWarningMessage: message => warnings.push(message),
            createTreeView: () => disposable,
            onDidChangeActiveTextEditor: () => disposable,
        },
        workspace: {
            workspaceFolders: [],
            getWorkspaceFolder: uri => uri.root ? { uri: { fsPath: uri.root } } : undefined,
            onDidRenameFiles: () => disposable,
        },
        commands: { registerCommand: (id, fn) => {
            assert.ok(!commands.has(id), `duplicate command: ${id}`);
            commands.set(id, fn);
            return disposable;
        } },
        Disposable: class { constructor(fn) { this.dispose = fn; } },
    };
    class Storage {
        async load() {}
        watchFile() { return disposable; }
    }
    class Provider {
        registerHoverProvider() {}
        renderNotesForFile() {}
        async addNoteAtLine(uri, line) { added.push({ uri, line }); }
    }
    class Status { setVisible() {} }
    const stubs = {
        vscode,
        './noteStorage': { NoteStorage: Storage },
        './margoNotesProvider': { MargoNotesProvider: Provider },
        './notesTreeProvider': { NotesTreeProvider: class {}, registerTreeViewCommands() {} },
        './exportProvider': { registerExportCommands() {} },
        './lineTracker': { LineTracker: class {} },
        './statusBar': { StatusBarManager: Status },
        './config': { getConfig: () => ({}), onConfigChange: () => disposable },
    };
    const original = Module._load;
    for (const file of ['../out/extension', '../out/workspaceManager']) delete require.cache[require.resolve(file)];
    Module._load = function(name, ...args) {
        return stubs[name] || original.call(this, name, ...args);
    };
    let extension;
    try { extension = require('../out/extension'); } finally { Module._load = original; }
    const runAdd = async () => {
        const fn = commands.get('margoInline.addNote');
        if (!fn) throw new Error("command 'margoInline.addNote' not found");
        await fn();
    };
    return { vscode, extension, added, warnings, runAdd, context: { subscriptions: [] } };
}

test('new project with an untitled editor still registers Add Note', async () => {
    const f = fixture();
    f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/new-project' } }];
    f.vscode.window.activeTextEditor = { document: { uri: { scheme: 'untitled' } } };
    await f.extension.activate(f.context);
    const uri = { root: '/new-project' };
    f.vscode.window.activeTextEditor = { document: { uri }, selection: { active: { line: 4 } } };
    await f.runAdd();
    assert.deepEqual(f.added, [{ uri, line: 4 }]);
});

test('empty-window activation recovers when a project is opened later', async () => {
    const f = fixture();
    await f.extension.activate(f.context);
    await f.runAdd();
    const uri = { root: '/new-project' };
    f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: uri.root } }];
    f.vscode.window.activeTextEditor = { document: { uri }, selection: { active: { line: 0 } } };
    await Promise.all([f.runAdd(), f.runAdd()]);
    assert.equal(f.added.length, 2);
});
