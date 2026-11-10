const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackNote } = require('../out/noteTracking');
const { createNote } = require('../out/utils');
const make = () => ({ ...createNote(1, 'note', '', 'tester'), anchor: { character: 4, endLine: 1, endCharacter: 8 } });
const edit = (sl, sc, el, ec, text) => ({ range: { start: { line: sl, character: sc }, end: { line: el, character: ec } }, text });

test('same-line edits shift and resize selections using UTF-16', () => {
    const n = make();
    trackNote(n, edit(1, 1, 1, 1, '字😀'));
    assert.deepEqual(n.anchor, { character: 7, endLine: 1, endCharacter: 11 });
    trackNote(n, edit(1, 8, 1, 9, 'abc'));
    assert.deepEqual(n.anchor, { character: 7, endLine: 1, endCharacter: 13 });
});
test('insertions at edges are excluded', () => {
    const n = make();
    trackNote(n, edit(1, 8, 1, 8, 'after'));
    assert.equal(n.anchor.endCharacter, 8);
    trackNote(n, edit(1, 4, 1, 4, 'before'));
    assert.deepEqual(n.anchor, { character: 10, endLine: 1, endCharacter: 14 });
});
test('multiline insertions, joins and CRLF track both endpoints', () => {
    const n = make();
    trackNote(n, edit(1, 2, 1, 2, '\r\nabc'));
    assert.equal(n.line, 2);
    assert.deepEqual(n.anchor, { character: 5, endLine: 2, endCharacter: 9 });
    trackNote(n, edit(1, 2, 2, 3, ''));
    assert.equal(n.line, 1);
    assert.deepEqual(n.anchor, { character: 4, endLine: 1, endCharacter: 8 });
});
test('replacement retains the annotation; deletion converts it to a visible line note', () => {
    const n = make();
    trackNote(n, edit(1, 4, 1, 8, 'replacement'));
    assert.deepEqual(n.anchor, { character: 4, endLine: 1, endCharacter: 15 });
    trackNote(n, edit(0, 0, 2, 0, ''));
    assert.equal(n.line, 0);
    assert.equal(n.anchor, undefined);
    assert.equal(n.title, 'note');
});
test('legacy line notes keep their line tracking behavior', () => {
    const n = createNote(5, 'legacy', '', 'tester');
    trackNote(n, edit(1, 0, 1, 0, '\n\n'));
    assert.equal(n.line, 7);
    assert.equal(n.anchor, undefined);
    trackNote(n, edit(2, 0, 8, 0, ''));
    assert.equal(n.line, 2);
});
