/**
 * Library search, filtering and sorting. Pure functions over `LibraryEntry` rows (one per difficulty).
 *
 * Search syntax: free text matches title, artist, creator and difficulty name. Field expressions:
 *   artist=name   creator=name / mapper=name   version=name   title=name
 *   ar>=9  od<8  cs=4  hp>5  bpm>180  length<120 (seconds)  objects>500
 * Star rating is not computed by this build, so there is no `stars` filter.
 */

export interface LibraryEntry {
  hash: string;
  fileName: string;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: number;
  cs: number;
  ar: number;
  od: number;
  hp: number;
  bpm: number;
  minBpm: number;
  maxBpm: number;
  lengthMs: number;
  objectCount: number;
  importedAt: number;
  favorite: boolean;
  lastPlayed: number | null;
  bestScore: number | null;
  bestGrade: string | null;
}

export type NumericKey = 'ar' | 'od' | 'cs' | 'hp' | 'bpm' | 'length' | 'objects';
export type TextKey = 'artist' | 'creator' | 'title' | 'version';
export type Op = '<' | '<=' | '>' | '>=' | '=';

export interface ParsedQuery {
  text: string[];
  numeric: { key: NumericKey; op: Op; value: number }[];
  text_fields: { key: TextKey; value: string }[];
}

const NUMERIC_KEYS: Record<string, NumericKey> = {
  ar: 'ar',
  od: 'od',
  cs: 'cs',
  hp: 'hp',
  bpm: 'bpm',
  length: 'length',
  objects: 'objects',
};
const TEXT_KEYS: Record<string, TextKey> = {
  artist: 'artist',
  creator: 'creator',
  mapper: 'creator',
  title: 'title',
  version: 'version',
  diff: 'version',
};

export function parseQuery(input: string): ParsedQuery {
  const out: ParsedQuery = { text: [], numeric: [], text_fields: [] };
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const m = /^([a-z]+)(<=|>=|<|>|=)(.+)$/i.exec(tok);
    if (m) {
      const key = m[1].toLowerCase();
      const op = m[2] as Op;
      const val = m[3];
      if (NUMERIC_KEYS[key]) {
        const n = Number(val);
        if (Number.isFinite(n)) {
          out.numeric.push({ key: NUMERIC_KEYS[key], op, value: n });
          continue;
        }
      }
      if (TEXT_KEYS[key] && op === '=') {
        out.text_fields.push({ key: TEXT_KEYS[key], value: val.toLowerCase() });
        continue;
      }
    }
    out.text.push(tok.toLowerCase());
  }
  return out;
}

const cmp = (a: number, op: Op, b: number): boolean => {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    default:
      return Math.abs(a - b) < 1e-6;
  }
};

export function numericValue(e: LibraryEntry, key: NumericKey): number {
  switch (key) {
    case 'length':
      return e.lengthMs / 1000;
    case 'objects':
      return e.objectCount;
    default:
      return e[key];
  }
}

export function matchesQuery(e: LibraryEntry, q: ParsedQuery): boolean {
  for (const n of q.numeric) if (!cmp(numericValue(e, n.key), n.op, n.value)) return false;
  for (const f of q.text_fields) {
    const hay = (e[f.key] ?? '').toLowerCase();
    if (!hay.includes(f.value)) return false;
  }
  if (q.text.length) {
    const hay = `${e.title} ${e.artist} ${e.creator} ${e.version}`.toLowerCase();
    for (const t of q.text) if (!hay.includes(t)) return false;
  }
  return true;
}

export type SortKey = 'title' | 'artist' | 'creator' | 'bpm' | 'length' | 'added' | 'difficulty';

/** A rough, deterministic difficulty index used for sorting (not an official star rating). */
export function difficultyIndex(e: LibraryEntry): number {
  return e.cs + e.ar + e.od + e.hp + Math.min(16, (e.objectCount / Math.max(1, e.lengthMs / 1000)) * 4);
}

export function sortEntries(entries: LibraryEntry[], key: SortKey): LibraryEntry[] {
  const byText = (f: (e: LibraryEntry) => string) => (a: LibraryEntry, b: LibraryEntry) => f(a).localeCompare(f(b)) || a.version.localeCompare(b.version);
  const cmpFn: Record<SortKey, (a: LibraryEntry, b: LibraryEntry) => number> = {
    title: byText((e) => e.title),
    artist: byText((e) => e.artist),
    creator: byText((e) => e.creator),
    bpm: (a, b) => a.bpm - b.bpm || a.title.localeCompare(b.title),
    length: (a, b) => a.lengthMs - b.lengthMs || a.title.localeCompare(b.title),
    added: (a, b) => b.importedAt - a.importedAt,
    difficulty: (a, b) => difficultyIndex(a) - difficultyIndex(b) || a.title.localeCompare(b.title),
  };
  return [...entries].sort(cmpFn[key]);
}

/** Group difficulty rows into sets (by hash), keeping the set order of the first row. */
export function groupBySet(entries: LibraryEntry[]): { hash: string; rows: LibraryEntry[] }[] {
  const map = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    const list = map.get(e.hash);
    if (list) list.push(e);
    else map.set(e.hash, [e]);
  }
  return [...map.entries()].map(([hash, rows]) => ({ hash, rows }));
}
