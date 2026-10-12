import { describe, expect, it } from 'vitest';
import { groupBySet, matchesQuery, parseQuery, sortEntries, type LibraryEntry } from '../src/beatmaps/query';

const e = (over: Partial<LibraryEntry>): LibraryEntry => ({
  hash: 'h1',
  fileName: 'a.osu',
  title: 'Song',
  artist: 'Artist',
  creator: 'Mapper',
  version: 'Easy',
  mode: 0,
  cs: 4,
  ar: 8,
  od: 8,
  hp: 6,
  bpm: 180,
  minBpm: 180,
  maxBpm: 180,
  lengthMs: 120000,
  objectCount: 300,
  importedAt: 1,
  favorite: false,
  lastPlayed: null,
  bestScore: null,
  bestGrade: null,
  ...over,
});

describe('library query', () => {
  it('parses field expressions and free text', () => {
    const q = parseQuery('ar>=9 creator=Foo cool track length<120');
    expect(q.numeric).toEqual([
      { key: 'ar', op: '>=', value: 9 },
      { key: 'length', op: '<', value: 120 },
    ]);
    expect(q.text_fields).toEqual([{ key: 'creator', value: 'foo' }]);
    expect(q.text).toEqual(['cool', 'track']);
  });

  it('filters by numeric ranges and text', () => {
    const rows = [e({ ar: 9.5, bpm: 200 }), e({ ar: 8, title: 'Other' }), e({ ar: 10, bpm: 90, lengthMs: 60000, creator: 'Someone' })];
    expect(rows.filter((r) => matchesQuery(r, parseQuery('ar>9')))).toHaveLength(2);
    expect(rows.filter((r) => matchesQuery(r, parseQuery('bpm>=180')))).toHaveLength(2);
    expect(rows.filter((r) => matchesQuery(r, parseQuery('length<=60')))).toHaveLength(1);
    expect(rows.filter((r) => matchesQuery(r, parseQuery('mapper=someone')))).toHaveLength(1);
    expect(rows.filter((r) => matchesQuery(r, parseQuery('oth')))).toHaveLength(1);
  });

  it('sorts by each supported key', () => {
    const rows = [e({ title: 'B', artist: 'Z', bpm: 100, lengthMs: 5000, importedAt: 5 }), e({ title: 'A', artist: 'Y', bpm: 200, lengthMs: 9000, importedAt: 9, hash: 'h2' })];
    expect(sortEntries(rows, 'title')[0].title).toBe('A');
    expect(sortEntries(rows, 'artist')[0].artist).toBe('Y');
    expect(sortEntries(rows, 'bpm')[0].bpm).toBe(100);
    expect(sortEntries(rows, 'length')[0].lengthMs).toBe(5000);
    expect(sortEntries(rows, 'added')[0].importedAt).toBe(9);
    expect(sortEntries(rows, 'creator')).toHaveLength(2);
    expect(sortEntries(rows, 'difficulty')).toHaveLength(2);
  });

  it('groups difficulty rows by set', () => {
    const groups = groupBySet([e({ hash: 'a' }), e({ hash: 'b' }), e({ hash: 'a', version: 'Hard' })]);
    expect(groups.map((g) => [g.hash, g.rows.length])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});
