import type { ParsedBeatmap } from '../beatmaps/types';
import type { ObjectJudgment, FollowJudgment } from '../gameplay/scoring/score';
import type { ModId } from '../gameplay/core/mods';
import type { ReplayData } from '../gameplay/replay/replay';
import { DEFAULT_SETTINGS, validateSettings, type Settings } from './settings';

/** Stored beatmap set. `hash` is the SHA-256 of the original .osz (duplicate detection key). */
export interface BeatmapSetRecord {
  hash: string;
  title: string;
  artist: string;
  creator: string;
  beatmapSetId: number;
  importedAt: number;
  sourceFileName: string;
  difficulties: { fileName: string; parsed: ParsedBeatmap }[];
  assets: Record<string, Blob>;
  warnings: string[];
}

export interface ScoreRecord {
  id: string;
  difficultyKey: string; // `${hash}/${fileName}`
  hash: string;
  fileName: string;
  title: string;
  version: string;
  mode: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  totalObjects: number;
  counts: Record<ObjectJudgment, number>;
  followCounts: Record<FollowJudgment, number>;
  grade: string;
  mods: ModId[];
  rate: number;
  passed: boolean;
  ranked: boolean;
  playedAt: number;
  replayId: string | null;
  /** Downsampled [songTime, score, accuracy] samples for the progression graph. */
  progress: [number, number, number][];
  hitErrors: number[];
  /** Duration of the play in ms of song time. */
  durationMs: number;
  /** Origin of this record, always 'local' in this build. */
  source: 'local';
}

export interface ReplayRecord {
  scoreId: string;
  replay: ReplayData;
}

const DB_NAME = 'badosu';
const DB_VERSION = 1;

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sets')) db.createObjectStore('sets', { keyPath: 'hash' });
      if (!db.objectStoreNames.contains('scores')) {
        const s = db.createObjectStore('scores', { keyPath: 'id' });
        s.createIndex('difficultyKey', 'difficultyKey');
        s.createIndex('playedAt', 'playedAt');
      }
      if (!db.objectStoreNames.contains('replays')) db.createObjectStore('replays', { keyPath: 'scoreId' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'hash' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
    req.onblocked = () => reject(new Error('Database upgrade blocked by another tab.'));
  });
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

/** Local persistence for offline play: library, scores, replays, favorites and settings. */
export class LocalStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory): Promise<LocalStore> {
    return new LocalStore(await openDatabase(factory));
  }

  close(): void {
    this.db.close();
  }

  // ---- beatmap sets ----
  async putSet(rec: BeatmapSetRecord): Promise<void> {
    const tx = this.db.transaction('sets', 'readwrite');
    tx.objectStore('sets').put(rec);
    await txDone(tx);
  }

  async getSet(hash: string): Promise<BeatmapSetRecord | undefined> {
    const tx = this.db.transaction('sets', 'readonly');
    const rec = await reqP(tx.objectStore('sets').get(hash));
    return rec as BeatmapSetRecord | undefined;
  }

  async listSets(): Promise<BeatmapSetRecord[]> {
    const tx = this.db.transaction('sets', 'readonly');
    return (await reqP(tx.objectStore('sets').getAll())) as BeatmapSetRecord[];
  }

  async deleteSet(hash: string): Promise<void> {
    const tx = this.db.transaction(['sets', 'scores', 'replays'], 'readwrite');
    tx.objectStore('sets').delete(hash);
    // Removing a set also removes its local scores and replays.
    const scores = (await reqP(tx.objectStore('scores').getAll())) as ScoreRecord[];
    for (const s of scores) {
      if (s.hash !== hash) continue;
      tx.objectStore('scores').delete(s.id);
      tx.objectStore('replays').delete(s.id);
    }
    await txDone(tx);
  }

  // ---- scores ----
  async addScore(score: ScoreRecord, replay: ReplayData | null): Promise<void> {
    const tx = this.db.transaction(['scores', 'replays'], 'readwrite');
    tx.objectStore('scores').put(score);
    if (replay) tx.objectStore('replays').put({ scoreId: score.id, replay } satisfies ReplayRecord);
    await txDone(tx);
  }

  async scoresFor(difficultyKey: string): Promise<ScoreRecord[]> {
    const tx = this.db.transaction('scores', 'readonly');
    const idx = tx.objectStore('scores').index('difficultyKey');
    const rows = (await reqP(idx.getAll(difficultyKey))) as ScoreRecord[];
    return rows.sort((a, b) => b.score - a.score);
  }

  async allScores(limit = 500): Promise<ScoreRecord[]> {
    const tx = this.db.transaction('scores', 'readonly');
    const idx = tx.objectStore('scores').index('playedAt');
    const rows = (await reqP(idx.getAll())) as ScoreRecord[];
    return rows.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
  }

  async getReplay(scoreId: string): Promise<ReplayData | null> {
    const tx = this.db.transaction('replays', 'readonly');
    const rec = (await reqP(tx.objectStore('replays').get(scoreId))) as ReplayRecord | undefined;
    return rec?.replay ?? null;
  }

  async deleteScore(id: string): Promise<void> {
    const tx = this.db.transaction(['scores', 'replays'], 'readwrite');
    tx.objectStore('scores').delete(id);
    tx.objectStore('replays').delete(id);
    await txDone(tx);
  }

  // ---- favorites ----
  async setFavorite(hash: string, favorite: boolean): Promise<void> {
    const tx = this.db.transaction('favorites', 'readwrite');
    if (favorite) tx.objectStore('favorites').put({ hash });
    else tx.objectStore('favorites').delete(hash);
    await txDone(tx);
  }

  async favorites(): Promise<Set<string>> {
    const tx = this.db.transaction('favorites', 'readonly');
    const rows = (await reqP(tx.objectStore('favorites').getAll())) as { hash: string }[];
    return new Set(rows.map((r) => r.hash));
  }

  // ---- settings ----
  async loadSettings(): Promise<Settings> {
    const tx = this.db.transaction('settings', 'readonly');
    const rows = (await reqP(tx.objectStore('settings').getAll())) as { key: string; value: unknown }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) raw[r.key] = r.value;
    return validateSettings({ ...DEFAULT_SETTINGS, ...raw });
  }

  async saveSettings(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.loadSettings();
    const next = validateSettings({ ...current, ...partial });
    const tx = this.db.transaction('settings', 'readwrite');
    for (const [key, value] of Object.entries(next)) tx.objectStore('settings').put({ key, value });
    await txDone(tx);
    return next;
  }
}
