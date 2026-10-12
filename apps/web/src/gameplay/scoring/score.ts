/**
 * Score model for osu!standard.
 *
 * This is a documented approximation of classic (ScoreV1-style) scoring:
 *  - Object judgments score 300/100/50 (plus a combo bonus of base*combo*difficulty/25).
 *  - Slider ticks score 10, repeats and tails 30 each; these do not affect accuracy.
 *  - Spinner bonus: 1000 per rotation beyond the requirement.
 *  - Accuracy = weighted hits / (300 * judged objects), matching the osu! accuracy formula.
 * The output is never presented as an official osu! score or pp value.
 */

export type ObjectJudgment = 'great' | 'good' | 'meh' | 'miss';
export type FollowJudgment = 'tick' | 'tickMiss' | 'repeat' | 'repeatMiss' | 'tail' | 'tailMiss';

export const JUDGMENT_VALUE: Record<ObjectJudgment, number> = { great: 300, good: 100, meh: 50, miss: 0 };

export interface ScoreSnapshot {
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  counts: Record<ObjectJudgment, number>;
  followCounts: { tick: number; tickMiss: number; repeat: number; repeatMiss: number; tail: number; tailMiss: number };
  objectCount: number;
  health: number;
}

/** Difficulty multiplier used in the combo bonus. */
export function difficultyMultiplier(hp: number, cs: number, od: number, objects: number, drainSeconds: number): number {
  const density = drainSeconds > 0 ? objects / drainSeconds : 1;
  const raw = (hp + cs + od + Math.min(16, Math.max(1, density * 8))) / 38 * 5;
  return Math.max(1, Math.floor(raw));
}

export class ScoreTracker {
  score = 0;
  combo = 0;
  maxCombo = 0;
  objectWeight = 0;
  objectsJudged = 0;
  counts: Record<ObjectJudgment, number> = { great: 0, good: 0, meh: 0, miss: 0 };
  followCounts = { tick: 0, tickMiss: 0, repeat: 0, repeatMiss: 0, tail: 0, tailMiss: 0 };
  health = 1;

  constructor(
    private readonly diffMultiplier: number,
    private readonly modMultiplier: number,
    private readonly hpGain: number,
    private readonly hpLoss: number,
  ) {}

  private comboBonus(base: number): number {
    const bonus = (base * Math.max(0, this.combo) * this.diffMultiplier) / 25;
    return Math.floor((base + bonus) * this.modMultiplier);
  }

  /** Record a judgment for a hit object (circle, slider summary or spinner). */
  judgeObject(j: ObjectJudgment): void {
    this.objectsJudged++;
    this.counts[j]++;
    this.objectWeight += JUDGMENT_VALUE[j];
    if (j === 'miss') {
      this.combo = 0;
      this.health = Math.max(0, this.health - this.hpLoss);
    } else {
      this.score += this.comboBonus(JUDGMENT_VALUE[j]);
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.health = Math.min(1, this.health + this.hpGain * (j === 'great' ? 1 : j === 'good' ? 0.5 : 0.1));
    }
  }

  /** Record a slider follow-point judgment (ticks, repeats, tail). Accuracy is not affected. */
  judgeFollow(j: FollowJudgment): void {
    const key = j as keyof ScoreTracker['followCounts'];
    this.followCounts[key]++;
    if (j.endsWith('Miss')) {
      this.combo = 0;
      this.health = Math.max(0, this.health - this.hpLoss * 0.25);
      return;
    }
    const base = j === 'tick' ? 10 : 30;
    this.score += this.comboBonus(base);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.health = Math.min(1, this.health + this.hpGain * 0.2);
  }

  /** Spinner bonus: 1000 per spin beyond the requirement (not affected by combo). */
  addSpinnerBonus(spins: number): void {
    this.score += Math.floor(spins * 1000 * this.modMultiplier);
  }

  get accuracy(): number {
    return this.objectsJudged === 0 ? 1 : this.objectWeight / (300 * this.objectsJudged);
  }

  snapshot(objectCount: number): ScoreSnapshot {
    return {
      score: Math.floor(this.score),
      combo: this.combo,
      maxCombo: this.maxCombo,
      accuracy: this.accuracy,
      counts: { ...this.counts },
      followCounts: { ...this.followCounts },
      objectCount,
      health: this.health,
    };
  }
}

/** Grade from accuracy and misses (approximation of osu! rank thresholds). */
export function gradeFor(accuracy: number, misses: number, total: number): 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' {
  if (total > 0 && accuracy >= 1) return 'SS';
  if (accuracy >= 0.9 && misses === 0) return 'S';
  if (accuracy >= 0.8) return 'A';
  if (accuracy >= 0.7) return 'B';
  if (accuracy >= 0.6) return 'C';
  return 'D';
}
