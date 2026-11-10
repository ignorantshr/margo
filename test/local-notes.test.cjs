const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');

const vscode = {
    __esModule: true,
    Disposable: class { constructor(fn) { this.dispose = fn; } },
    window: { visibleTextEditors: [], showErrorMessage() {} },
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
};
const originalLoad = Module._load;
Module._load = function(name, ...args) {
    return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args);
};
const { NoteStorage } = require('../out/noteStorage');
const { MargoNotesProvider } = require('../out/margoNotesProvider');
const { createNote } = require('../out/utils');
const { WorkspaceManager } = require('../out/workspaceManager');
Module._load = originalLoad;

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'margo-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const storage = new NoteStorage(root);
    const local = path.join(root, '.margo', 'local.notes.json');
    await fs.mkdir(path.dirname(local));
    return { root, storage, local };
}

test('private notes load, repair ignore rules, and leave legacy team data untouched', async t => {
    const { root, storage, local } = await fixture(t);
    const note = createNote(0, '私人备注', 'body', 'tester');
    await fs.writeFile(local, JSON.stringify({ './file.ts': [note] }));
    const legacy = JSON.stringify({ './other.ts': [createNote(1, 'team', '', 'tester')] });
    await fs.writeFile(path.join(root, '.notes.json'), legacy);
    await fs.writeFile(path.join(root, '.margo', '.gitignore'), '*\n!.gitignore\n');
    await storage.load();
    assert.equal(storage.getTotalNoteCount(), 1);
    await storage.saveImmediately();
    assert.equal(await fs.readFile(path.join(root, '.notes.json'), 'utf8'), legacy);
    execFileSync('git', ['init', '-q', root]);
    for (const file of ['.margo/local.notes.json', '.margo/.gitignore']) {
        execFileSync('git', ['check-ignore', '-q', file], { cwd: root });
    }
    assert.equal(JSON.parse(await fs.readFile(local, 'utf8'))['./file.ts'][0].title, '私人备注');
});

test('invalid external notes do not replace loaded notes or get overwritten', async t => {
    const { storage, local } = await fixture(t);
    await fs.writeFile(local, JSON.stringify({ './file.ts': [createNote(0, 'keep me', '', 'tester')] }));
    await storage.load();
    for (const invalid of ['{broken', '{"./file.ts":[{"id":"x","line":-1,"text":"bad"}]}']) {
        await fs.writeFile(local, invalid);
        await storage.load();
        assert.equal(storage.getTotalNoteCount(), 1);
        await storage.saveImmediately();
        assert.equal(await fs.readFile(local, 'utf8'), invalid);
    }
});

test('inline notes display full text, combine same-line notes, and clear deleted notes in every editor', () => {
    let notes = [createNote(1, '标题', '第一行\n第二行', 'tester'), createNote(1, 'another', '', 'tester')];
    const results = [];
    vscode.window.visibleTextEditors = [0, 1].map(index => ({
        document: { uri: {}, lineCount: 3, lineAt: line => ({ range: { line } }) },
        setDecorations: (_type, values) => { results[index] = values; },
    }));
    const provider = { storage: { getNotesForFile: () => notes }, inlineDecoration: {} };
    MargoNotesProvider.prototype.renderInlineNotes.call(provider);
    for (const result of results) {
        assert.equal(result.length, 1);
        assert.equal(result[0].range.line, 1);
        assert.equal(result[0].renderOptions.after.contentText, '[✎] 标题 — 第一行 第二行 | another');
    }
    notes = [];
    MargoNotesProvider.prototype.renderInlineNotes.call(provider);
    assert.deepEqual(results, [[], []]);
});

test('new notes create private storage and edits/deletion persist', async t => {
    const { root, storage, local } = await fixture(t);
    await fs.rmdir(path.dirname(local));
    await storage.load();
    const uri = { fsPath: path.join(root, 'file.ts') };
    const note = createNote(0, 'initial', '', 'tester');
    storage.addNote(uri, note);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(JSON.parse(await fs.readFile(local, 'utf8'))['./file.ts'][0].title, 'initial');
    storage.updateNote(uri, note.id, 'updated', 'body');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(JSON.parse(await fs.readFile(local, 'utf8'))['./file.ts'][0].title, 'updated');
    storage.deleteNote(uri, note.id);
    await new Promise(resolve => setTimeout(resolve, 350));
    await assert.rejects(fs.access(local), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, '.margo', '.gitignore'), 'utf8'), '*\n');
});

test('manifest exposes no priority or vault controls', () => {
    const { contributes } = require('../package.json');
    assert.ok(contributes.commands.every(c => !/Priority|Vault/.test(c.command)));
    assert.deepEqual(contributes.configuration.properties['margoInline.treeGroupBy'].enum, ['file', 'category', 'status']);
});

test('hover includes single-line titles and multiline bodies', () => {
    let hoverProvider;
    vscode.languages = { registerHoverProvider: (_selector, provider) => {
        hoverProvider = provider;
        return { dispose() {} };
    } };
    vscode.MarkdownString = class {
        constructor(value = '') { this.value = value; }
        appendMarkdown(value) { this.value += value; return this; }
    };
    vscode.Hover = class { constructor(contents) { this.contents = contents; } };
    const notes = [createNote(1, '这是单行备注', '', 'tester'), createNote(2, '多行标题', '详细正文', 'tester')];
    MargoNotesProvider.prototype.registerHoverProvider.call(
        { storage: { getNotesForFile: () => notes } }, { subscriptions: [] }
    );
    const single = hoverProvider.provideHover({ uri: {} }, { line: 1 });
    assert.ok(single.contents.value.includes('这是单行备注'));
    const multi = hoverProvider.provideHover({ uri: {} }, { line: 2 });
    assert.ok(multi.contents.value.includes('多行标题'));
    assert.ok(multi.contents.value.includes('详细正文'));
    assert.equal(hoverProvider.provideHover({ uri: {} }, { line: 0 }), undefined);
});

function commentFixture() {
    const liveThreads = new Set();
    const commands = new Map();
    vscode.CommentMode = { Preview: 0, Editing: 1 };
    vscode.CommentThreadCollapsibleState = { Collapsed: 0, Expanded: 1 };
    vscode.MarkdownString = class { constructor(value = '') { this.value = value; } };
    vscode.Range = class {
        constructor(line, character = 0, endLine = line, endCharacter = character) {
            this.start = { line, character }; this.end = { line: endLine, character: endCharacter };
            this.isEmpty = line === endLine && character === endCharacter;
        }
        contains(p) {
            const cmp = (a, b) => a.line - b.line || a.character - b.character;
            return cmp(p, this.start) >= 0 && cmp(p, this.end) <= 0;
        }
    };
    vscode.Uri = { joinPath: () => ({}) };
    vscode.commands = { executeCommand: async () => {}, registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; } };
    const uri = { fsPath: '/workspace/file.ts', toString: () => 'file:///workspace/file.ts' };
    const notes = [createNote(1, 'Original', 'Body', 'tester')];
    const provider = Object.create(MargoNotesProvider.prototype);
    Object.assign(provider, {
        draftThreads: new Map(), threads: new Map(), noteThreadMap: new Map(), deleteArmTimers: new Map(),
        extensionUri: {}, renderInlineNotes() {},
        storage: {
            getNotesForFile: () => notes,
            getNoteById: id => { const note = notes.find(n => n.id === id); return note ? { note, filePath: './file.ts' } : undefined; },
            addNote: (_uri, note) => notes.push(note),
            deleteNote: (_uri, id) => { const index = notes.findIndex(n => n.id === id); if (index >= 0) notes.splice(index, 1); },
            updateNote: (_uri, id, title, text) => Object.assign(notes.find(n => n.id === id), { title, text }),
            saveImmediately: async () => true,
        },
        commentController: {
            createCommentThread: (uri, range, comments) => {
                const thread = { uri, range, comments, dispose() { liveThreads.delete(thread); } };
                liveThreads.add(thread);
                return thread;
            },
        },
    });
    provider.registerCommands({ subscriptions: [] });
    provider.renderNotesForFile(uri);
    return { provider, notes, uri, liveThreads, commands };
}

test('save then refresh does not leave duplicate comment threads', async () => {
    const { provider, notes, uri, liveThreads } = commentFixture();
    const comment = provider.noteThreadMap.get(notes[0].id).comments[0];
    comment.body = 'Updated\nNew body';
    provider.handleSaveNote(comment);
    provider.renderNotesForFile(uri);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Updated');
    assert.equal(liveThreads.size, 1, 'only one live UI thread per stored note');
    provider.clearAllThreads();
    assert.equal(liveThreads.size, 0);
});

test('refresh preserves an edit draft and saving updates the same note', async () => {
    const { provider, notes, uri, liveThreads, commands } = commentFixture();
    const thread = provider.noteThreadMap.get(notes[0].id);
    const comment = thread.comments[0];
    commands.get('margoInline.editNote')(comment);
    assert.equal(comment.body, 'Original\nBody', 'editing receives original text without preview markup');
    comment.body = 'Draft\nChanged body';
    provider.renderNotesForFile(uri);
    assert.ok(liveThreads.has(thread), 'refresh must not dispose the active editor');
    assert.equal(thread.comments[0].body, 'Draft\nChanged body');
    await commands.get('margoInline.saveNote')(comment);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Draft');
    assert.equal(thread.comments[0].mode, vscode.CommentMode.Preview);
    assert.equal(thread.collapsibleState, vscode.CommentThreadCollapsibleState.Collapsed);
});

test('repeated create submission on a saved thread does not add another note', async () => {
    const { provider, notes, uri } = commentFixture();
    const thread = provider.commentController.createCommentThread(uri, new vscode.Range(2), []);
    await provider.handleCreateNote({ thread, text: 'New note' });
    const id = thread.comments[0].note.id;
    await provider.handleCreateNote({ thread, text: 'New note' });
    assert.equal(notes.length, 2);
    assert.equal(thread.comments[0].note.id, id);
    assert.equal(thread.collapsibleState, vscode.CommentThreadCollapsibleState.Collapsed);
});

test('cancel restores saved content after editing', () => {
    const { provider, notes, commands } = commentFixture();
    const thread = provider.noteThreadMap.get(notes[0].id);
    const comment = thread.comments[0];
    commands.get('margoInline.editNote')(comment);
    comment.body = 'Unwanted draft';
    commands.get('margoInline.cancelNote')(comment);
    assert.equal(thread.comments[0].body.value, '**Original**\n\nBody');
    assert.equal(notes[0].title, 'Original');
});

test('editing twice persists one note with the original ID after reloading storage', async t => {
    const { storage, local } = await fixture(t);
    const { provider, uri, commands } = commentFixture();
    // Use a URI inside the temporary workspace with the real persistence layer.
    uri.fsPath = path.join(storage.getWorkspaceRoot(), 'file.ts');
    const note = createNote(1, 'Before', '', 'tester');
    await fs.writeFile(local, JSON.stringify({ './file.ts': [note] }));
    await storage.load();
    provider.clearAllThreads();
    provider.storage = storage;
    provider.renderNotesForFile(uri);
    for (const title of ['First edit', '**Literal stars**']) {
        const comment = provider.noteThreadMap.get(note.id).comments[0];
        commands.get('margoInline.editNote')(comment);
        comment.body = title + '\nSaved body';
        await commands.get('margoInline.saveNote')(comment);
        provider.renderNotesForFile(uri);
        await storage.saveImmediately();
    }
    // Allow the storage debounce to flush before removing the temporary fixture.
    await new Promise(resolve => setTimeout(resolve, 350));
    const reloaded = new NoteStorage(storage.getWorkspaceRoot());
    await reloaded.load();
    assert.equal(reloaded.getTotalNoteCount(), 1);
    assert.equal(reloaded.getNoteById(note.id).note.title, '**Literal stars**');
    assert.equal(reloaded.getNoteById(note.id).note.text, 'Saved body');
});

test('refresh keeps the comment object used by queued editor actions', async () => {
    const { provider, notes, uri, commands } = commentFixture();
    const thread = provider.noteThreadMap.get(notes[0].id);
    // VS Code may dispatch an action using the comment it rendered before a refresh.
    const displayedComment = thread.comments[0];
    provider.renderNotesForFile(uri);
    assert.equal(thread.comments[0], displayedComment, 'comment identity must remain stable');
    commands.get('margoInline.editNote')(displayedComment);
    displayedComment.body = 'Saved after focus change';
    await commands.get('margoInline.saveNote')(displayedComment);
    assert.equal(notes[0].title, 'Saved after focus change');
    assert.equal(thread.comments[0], displayedComment);
});

test('save waits for persistence and retains the draft on write failure', async () => {
    const { provider, notes, commands } = commentFixture();
    const thread = provider.noteThreadMap.get(notes[0].id);
    const comment = thread.comments[0];
    commands.get('margoInline.editNote')(comment);
    comment.body = 'Retry this draft';
    let finish;
    provider.storage.saveImmediately = () => new Promise(resolve => { finish = resolve; });
    const saving = commands.get('margoInline.saveNote')(comment);
    assert.equal(comment.mode, vscode.CommentMode.Editing);
    assert.equal(thread.comments[0], comment);
    assert.ok(saving && typeof saving.then === 'function', 'command must await the write');
    finish(false);
    await saving;
    assert.equal(comment.mode, vscode.CommentMode.Editing);
    assert.equal(comment.body, 'Retry this draft');
    provider.storage.saveImmediately = async () => true;
    await commands.get('margoInline.saveNote')(comment);
    assert.equal(comment.mode, vscode.CommentMode.Preview);
    assert.equal(comment.body.value, '**Retry this draft**');
});


test('comment input focus does not reload the active workspace storage', () => {
    let onEditorChange;
    const oldEditor = vscode.window.activeTextEditor;
    const oldGetFolder = vscode.workspace.getWorkspaceFolder;
    const oldEvent = vscode.window.onDidChangeActiveTextEditor;
    try {
        const fileEditor = { document: { uri: { scheme: 'file' } } };
        vscode.window.activeTextEditor = fileEditor;
        vscode.workspace.getWorkspaceFolder = uri => uri.scheme === 'file' ? { uri: { fsPath: '/workspace' } } : undefined;
        vscode.window.onDidChangeActiveTextEditor = fn => { onEditorChange = fn; return { dispose() {} }; };
        const manager = new WorkspaceManager();
        const changes = [];
        manager.onChange(root => changes.push(root));
        onEditorChange({ document: { uri: { scheme: 'comment' } } });
        onEditorChange(fileEditor);
        assert.deepEqual(changes, [], 'comment editor focus must not switch or reload storage');
    } finally {
        vscode.window.activeTextEditor = oldEditor;
        vscode.workspace.getWorkspaceFolder = oldGetFolder;
        vscode.window.onDidChangeActiveTextEditor = oldEvent;
    }
});

test('new notes start in editing mode, save once, and collapse only on success', async () => {
    const { provider, notes, uri, commands } = commentFixture();
    await provider.addNoteAtLine(uri, 3);
    assert.equal(notes.length, 1, 'opening the editor must not persist an empty note');
    const thread = [...provider.draftThreads.values()][0];
    const comment = thread.comments[0];
    assert.equal(comment.mode, vscode.CommentMode.Editing);
    assert.equal(comment.body, '');
    comment.body = 'New note\nBody';
    await commands.get('margoInline.saveNote')(comment);
    assert.equal(notes.length, 2);
    assert.equal(thread.collapsibleState, vscode.CommentThreadCollapsibleState.Collapsed);
    assert.equal(provider.draftThreads.size, 0);
    assert.equal(provider.noteThreadMap.get(comment.note.id), thread);
});

test('canceling a new note leaves storage unchanged', async () => {
    const { provider, notes, uri, commands, liveThreads } = commentFixture();
    await provider.addNoteAtLine(uri, 3);
    const thread = [...provider.draftThreads.values()][0];
    commands.get('margoInline.cancelNote')(thread.comments[0]);
    assert.equal(notes.length, 1);
    assert.equal(provider.draftThreads.size, 0);
    assert.equal(liveThreads.has(thread), false);
});

test('failed new note stays editable without leaking into later saves', async () => {
    const { provider, notes, uri, commands } = commentFixture();
    await provider.addNoteAtLine(uri, 3);
    const thread = [...provider.draftThreads.values()][0];
    const comment = thread.comments[0];
    comment.body = 'Unsaved draft';
    provider.storage.saveImmediately = async () => false;
    await commands.get('margoInline.saveNote')(comment);
    assert.equal(notes.length, 1);
    assert.equal(comment.body, 'Unsaved draft');
    assert.equal(comment.mode, vscode.CommentMode.Editing);
    assert.equal(thread.collapsibleState, vscode.CommentThreadCollapsibleState.Expanded);
    provider.storage.saveImmediately = async () => true;
    await commands.get('margoInline.saveNote')(comment);
    assert.equal(notes.length, 2);
    assert.equal(thread.collapsibleState, vscode.CommentThreadCollapsibleState.Collapsed);
});


test('selected text persists across saving and reload, while empty selections stay line notes', async t => {
    const { storage, local } = await fixture(t);
    const { provider, uri, commands } = commentFixture();
    uri.fsPath = path.join(storage.getWorkspaceRoot(), 'file.ts');
    provider.clearAllThreads();
    provider.storage = storage;
    await provider.addNoteAtLine(uri, 3, new vscode.Range(1, 2, 3, 4));
    const thread = [...provider.draftThreads.values()][0];
    thread.comments[0].body = 'Selected text';
    await commands.get('margoInline.saveNote')(thread.comments[0]);
    await storage.load();
    const note = storage.getNotesForFile(uri)[0];
    assert.equal(note.line, 1);
    assert.deepEqual(note.anchor, { character: 2, endLine: 3, endCharacter: 4 });
    assert.deepEqual(JSON.parse(await fs.readFile(local, 'utf8'))['./file.ts'][0].anchor, note.anchor);
    provider.renderNotesForFile(uri);
    assert.equal(provider.noteThreadMap.get(note.id).range.end.character, 4);
    await provider.addNoteAtLine(uri, 5, new vscode.Range(5, 2, 5, 2));
    assert.equal([...provider.draftThreads.values()][0].comments[0].note.anchor, undefined);
});

test('malformed anchors block writes without losing loaded notes', async t => {
    const { storage, local } = await fixture(t);
    const note = createNote(1, 'Keep', '', 'tester');
    await fs.writeFile(local, JSON.stringify({ './file.ts': [note] }));
    await storage.load();
    for (const anchor of [null, {}, { character: -1, endLine: 1, endCharacter: 4 },
        { character: 4, endLine: 1, endCharacter: 2 }, { character: 0, endLine: 0, endCharacter: 4 }]) {
        const invalid = JSON.stringify({ './file.ts': [{ ...note, anchor }] });
        await fs.writeFile(local, invalid);
        await storage.load();
        assert.equal(storage.getTotalNoteCount(), 1);
        assert.equal(await storage.saveImmediately(), false);
        assert.equal(await fs.readFile(local, 'utf8'), invalid);
    }
});

test('text notes underline only their ranges and hover does not leak to adjacent words', () => {
    commentFixture();
    const first = { ...createNote(1, 'First word', '', 'tester'), anchor: { character: 2, endLine: 1, endCharacter: 5 } };
    const second = { ...createNote(1, 'Second word', '', 'tester'), anchor: { character: 8, endLine: 1, endCharacter: 12 } };
    const notes = [first, second];
    const decorations = new Map();
    const document = { uri: {}, lineCount: 3, validateRange: range => range };
    vscode.window.visibleTextEditors = [{ document, setDecorations: (type, values) => decorations.set(type, values) }];
    const provider = { storage: { getNotesForFile: () => notes }, inlineDecoration: {}, anchorDecoration: {} };
    MargoNotesProvider.prototype.renderInlineNotes.call(provider);
    assert.equal(decorations.get(provider.anchorDecoration).length, 2);
    assert.deepEqual(decorations.get(provider.inlineDecoration), []);
    let hover;
    vscode.languages = { registerHoverProvider: (_selector, p) => { hover = p; return { dispose() {} }; } };
    vscode.MarkdownString = class { constructor(value = '') { this.value = value; } appendMarkdown(v) { this.value += v; } };
    vscode.Hover = class { constructor(contents) { this.contents = contents; } };
    MargoNotesProvider.prototype.registerHoverProvider.call(provider, { subscriptions: [] });
    const point = character => ({ line: 1, character, isEqual(p) { return this.line === p.line && this.character === p.character; } });
    assert.ok(hover.provideHover(document, point(3)).contents.value.includes('First word'));
    assert.ok(!hover.provideHover(document, point(3)).contents.value.includes('Second word'));
    assert.equal(hover.provideHover(document, point(5)), undefined);
    assert.equal(hover.provideHover(document, point(7)), undefined);
    assert.ok(hover.provideHover(document, point(9)).contents.value.includes('Second word'));
    notes.length = 0;
    MargoNotesProvider.prototype.renderInlineNotes.call(provider);
    assert.deepEqual(decorations.get(provider.anchorDecoration), []);
});
