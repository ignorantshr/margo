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
    assert.deepEqual(contributes.configuration.properties['margo.treeGroupBy'].enum, ['file', 'category', 'status']);
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
