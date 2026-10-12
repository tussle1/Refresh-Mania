import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { LocalStore, openDatabase, type ScoreRecord } from '../src/storage/db';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

let counter = 0;

function score(id: string, difficultyKey: string, value: number): ScoreRecord {
  return {
    id,
    difficultyKey,
    hash: difficultyKey.split('/')[0],
    fileName: 'a.osu',
    title: 'T',
    version: 'V',
    mode: 0,
    score: value,
    accuracy: 0.9,
    maxCombo: 10,
    totalObjects: 20,
    counts: { 300: 10, 100: 5, 50: 0, miss: 5 } as unknown as ScoreRecord['counts'],
    followCounts: { hit: 0, miss: 0 } as unknown as ScoreRecord['followCounts'],
    grade: 'B',
    mods: [],
    rate: 1,
    passed: true,
    ranked: false,
    playedAt: ++counter,
    replayId: null,
    progress: [],
    hitErrors: [],
    durationMs: 1000,
    source: 'local',
  };
}

describe('local storage (fake-indexeddb)', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('badosu');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('opens a fresh database and returns default settings', async () => {
    const store = await LocalStore.open();
    expect(await store.loadSettings()).toEqual(DEFAULT_SETTINGS);
    store.close();
  });

  it('persists settings across reopen', async () => {
    const store = await LocalStore.open();
    const saved = await store.saveSettings({ masterVolume: 0.25 } as never);
    store.close();
    const again = await LocalStore.open();
    const loaded = await again.loadSettings();
    expect(loaded).toEqual(saved);
    again.close();
  });

  it('stores scores per difficulty, newest first across the library', async () => {
    const store = await LocalStore.open();
    await store.addScore(score('s1', 'h1/a.osu', 100), null);
    await store.addScore(score('s2', 'h1/a.osu', 300), null);
    await store.addScore(score('s3', 'h2/b.osu', 50), null);
    const diff = await store.scoresFor('h1/a.osu');
    expect(diff.map((s) => s.id)).toEqual(['s2', 's1']);
    const all = await store.allScores();
    expect(all[0].id).toBe('s3');
    store.close();
  });

  it('toggles favorites', async () => {
    const store = await LocalStore.open();
    await store.setFavorite('h1', true);
    await store.setFavorite('h2', true);
    await store.setFavorite('h2', false);
    expect([...(await store.favorites())]).toEqual(['h1']);
    store.close();
  });

  it('deleting a score removes it', async () => {
    const store = await LocalStore.open();
    await store.addScore(score('gone', 'h1/a.osu', 1), null);
    await store.deleteScore('gone');
    expect(await store.scoresFor('h1/a.osu')).toEqual([]);
    store.close();
  });
});

describe('openDatabase failure reporting', () => {
  it('reports the browser error name and message', async () => {
    const fakeFactory = {
      open() {
        const req: { error?: DOMException; onerror?: () => void } = {
          error: new DOMException('Internal error.', 'UnknownError'),
        };
        queueMicrotask(() => req.onerror?.());
        return req;
      },
    } as unknown as IDBFactory;
    await expect(openDatabase(fakeFactory)).rejects.toThrow('UnknownError: Internal error.');
  });
});
