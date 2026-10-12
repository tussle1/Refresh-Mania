import type { BeatmapDifficulty } from '../../beatmaps/types';

/** Mods implemented by the osu!standard ruleset. Other ids are listed in the UI as unavailable. */
export type ModId = 'EZ' | 'NF' | 'HT' | 'DT' | 'HR' | 'SD' | 'HD' | 'AT';

export interface ModInfo {
  id: ModId;
  name: string;
  description: string;
  kind: 'easier' | 'harder' | 'other';
  /** Score multiplier (approximate, see scoring/score.ts). */
  scoreMultiplier: number;
  /** Mods that disqualify a play from online ranking. */
  unranked?: boolean;
  conflicts: ModId[];
}

export const STANDARD_MODS: Record<ModId, ModInfo> = {
  EZ: { id: 'EZ', name: 'Easy', description: 'Halves circle size, approach rate, overall difficulty and HP drain. Gives extra lives in fails.', kind: 'easier', scoreMultiplier: 0.5, conflicts: ['HR'] },
  NF: { id: 'NF', name: 'No Fail', description: 'The song cannot be failed. HP does not end the play.', kind: 'easier', scoreMultiplier: 0.5, conflicts: ['SD'] },
  HT: { id: 'HT', name: 'Half Time', description: 'Plays the song at 0.75x speed (pitch lowered).', kind: 'easier', scoreMultiplier: 0.3, conflicts: ['DT'] },
  DT: { id: 'DT', name: 'Double Time', description: 'Plays the song at 1.5x speed (pitch raised).', kind: 'harder', scoreMultiplier: 1.12, conflicts: ['HT'] },
  HR: { id: 'HR', name: 'Hard Rock', description: 'Increases circle size, AR, OD and HP drain, and flips the playfield vertically.', kind: 'harder', scoreMultiplier: 1.06, conflicts: ['EZ'] },
  SD: { id: 'SD', name: 'Sudden Death', description: 'Fails the play on the first miss.', kind: 'harder', scoreMultiplier: 1.0, conflicts: ['NF'] },
  HD: { id: 'HD', name: 'Hidden', description: 'Circles fade out before they are due to be hit.', kind: 'harder', scoreMultiplier: 1.06, conflicts: [] },
  AT: { id: 'AT', name: 'Autoplay', description: 'Plays the chart automatically. Not eligible for scores or rankings.', kind: 'other', scoreMultiplier: 0, unranked: true, conflicts: [] },
};

export const ALL_MOD_IDS = Object.keys(STANDARD_MODS) as ModId[];

/** Remove mods that conflict with each other, keeping the one that was most recently added. */
export function normalizeMods(mods: ModId[]): ModId[] {
  const out: ModId[] = [];
  for (const m of mods) {
    if (!ALL_MOD_IDS.includes(m) || out.includes(m)) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      if (STANDARD_MODS[m].conflicts.includes(out[i]) || STANDARD_MODS[out[i]].conflicts.includes(m)) out.splice(i, 1);
    }
    out.push(m);
  }
  return out;
}

export interface ModdedSettings {
  difficulty: BeatmapDifficulty;
  /** Playback rate: 1 = normal, 1.5 = DT, 0.75 = HT. */
  rate: number;
  /** Multiplier applied to the score. */
  scoreMultiplier: number;
  ranked: boolean;
  flipVertical: boolean;
  hidden: boolean;
  suddenDeath: boolean;
  noFail: boolean;
  autoplay: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Apply difficulty and playback mods to a chart's difficulty values. Pure function. */
export function applyMods(base: BeatmapDifficulty, mods: ModId[]): ModdedSettings {
  const set = new Set(normalizeMods(mods));
  let cs = base.circleSize;
  let ar = base.approachRate;
  let od = base.overallDifficulty;
  let hp = base.hpDrainRate;
  if (set.has('EZ')) {
    cs /= 2;
    ar /= 2;
    od /= 2;
    hp /= 2;
  }
  if (set.has('HR')) {
    cs = clamp(cs * 1.3, 0, 10);
    ar = clamp(ar * 1.4, 0, 10);
    od = clamp(od * 1.4, 0, 10);
    hp = clamp(hp * 1.4, 0, 10);
  }
  let rate = 1;
  if (set.has('DT')) rate = 1.5;
  if (set.has('HT')) rate = 0.75;
  let scoreMultiplier = 1;
  for (const m of set) scoreMultiplier *= STANDARD_MODS[m].scoreMultiplier;
  return {
    difficulty: { ...base, circleSize: cs, approachRate: ar, overallDifficulty: od, hpDrainRate: hp },
    rate,
    scoreMultiplier: set.has('AT') ? 0 : scoreMultiplier,
    ranked: ![...set].some((m) => STANDARD_MODS[m].unranked),
    flipVertical: set.has('HR'),
    hidden: set.has('HD'),
    suddenDeath: set.has('SD'),
    noFail: set.has('NF'),
    autoplay: set.has('AT'),
  };
}
