import type { ParsedBeatmap } from './types';
import type { LibraryEntry } from './query';
import type { BeatmapSetRecord, ScoreRecord } from '../storage/db';

export interface ChartStats {
  bpm: number;
  minBpm: number;
  maxBpm: number;
  /** Playable length from first to last object (ms). */
  lengthMs: number;
  objectCount: number;
}

/** BPM and length figures derived from the chart itself. */
export function chartStats(parsed: ParsedBeatmap): ChartStats {
  const reds = parsed.timingPoints.filter((p) => p.uninherited && p.beatLength > 0);
  const bpms = reds.map((p) => 60000 / p.beatLength);
  const bpm = bpms[0] ?? 120;
  const minBpm = bpms.length ? Math.min(...bpms) : bpm;
  const maxBpm = bpms.length ? Math.max(...bpms) : bpm;
  const first = parsed.hitObjects[0];
  const last = parsed.hitObjects[parsed.hitObjects.length - 1];
  const lengthMs = first && last ? ('endTime' in last ? last.endTime : last.time) - first.time : 0;
  return { bpm: round1(bpm), minBpm: round1(minBpm), maxBpm: round1(maxBpm), lengthMs: Math.max(0, lengthMs), objectCount: parsed.hitObjects.length };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Build one library row per playable difficulty. */
export function buildEntries(sets: BeatmapSetRecord[], favorites: Set<string>, scores: ScoreRecord[]): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const set of sets) {
    for (const d of set.difficulties) {
      const p = d.parsed;
      const st = chartStats(p);
      const key = `${set.hash}/${d.fileName}`;
      const mine = scores.filter((s) => s.difficultyKey === key);
      const best = mine.reduce<ScoreRecord | null>((b, s) => (!b || s.score > b.score ? s : b), null);
      const lastPlayed = mine.reduce<number | null>((m, s) => (m === null || s.playedAt > m ? s.playedAt : m), null);
      out.push({
        hash: set.hash,
        fileName: d.fileName,
        title: p.metadata.titleUnicode || p.metadata.title || set.title,
        artist: p.metadata.artistUnicode || p.metadata.artist || set.artist,
        creator: p.metadata.creator || set.creator,
        version: p.metadata.version,
        mode: p.mode,
        cs: p.difficulty.circleSize,
        ar: p.difficulty.approachRate,
        od: p.difficulty.overallDifficulty,
        hp: p.difficulty.hpDrainRate,
        bpm: st.bpm,
        minBpm: st.minBpm,
        maxBpm: st.maxBpm,
        lengthMs: st.lengthMs,
        objectCount: st.objectCount,
        importedAt: set.importedAt,
        favorite: favorites.has(set.hash),
        lastPlayed,
        bestScore: best ? best.score : null,
        bestGrade: best ? best.grade : null,
      });
    }
  }
  return out;
}
