import { Note } from './utils';

type Point = { line: number; character: number };
type Change = { range: { start: Point; end: Point }; text: string };
const compare = (a: Point, b: Point) => a.line - b.line || a.character - b.character;

// VS Code positions and JS string lengths both use UTF-16 code units.
export function trackNote(note: Note, change: Change): boolean {
    const { start, end } = change.range;
    const lines = change.text.split('\n');
    const delta = lines.length - 1 - (end.line - start.line);
    if (!note.anchor) {
        const before = note.line;
        if (note.line > end.line) note.line = Math.max(0, note.line + delta);
        else if (delta < 0 && note.line > start.line) note.line = start.line;
        return note.line !== before;
    }
    const insertedEnd = {
        line: start.line + lines.length - 1,
        character: lines.length === 1 ? start.character + change.text.length : lines[lines.length - 1].length,
    };
    const transform = (point: Point, isStart: boolean): Point => {
        if (compare(point, start) < 0) return point;
        // Typing at either edge stays outside the annotated text.
        if (compare(start, end) === 0 && compare(point, start) === 0) return isStart ? insertedEnd : start;
        if (compare(point, end) >= 0) return {
            line: point.line + delta,
            character: point.line === end.line ? insertedEnd.character + point.character - end.character : point.character,
        };
        return isStart ? start : insertedEnd;
    };
    const before = [note.line, note.anchor.character, note.anchor.endLine, note.anchor.endCharacter];
    const nextStart = transform({ line: note.line, character: note.anchor.character }, true);
    let nextEnd = transform({ line: note.anchor.endLine, character: note.anchor.endCharacter }, false);
    if (compare(nextEnd, nextStart) < 0) nextEnd = nextStart;
    note.line = nextStart.line;
    note.anchor = { character: nextStart.character, endLine: nextEnd.line, endCharacter: nextEnd.character };
    // Preserve a deleted selection's note as a visible line note.
    if (compare(nextStart, nextEnd) === 0) delete note.anchor;
    const after = [nextStart.line, nextStart.character, nextEnd.line, nextEnd.character];
    return !note.anchor || before.some((value, index) => value !== after[index]);
}
