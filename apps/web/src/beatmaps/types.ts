/** Shared beatmap data model (parsed from .osu v14 text). Mode ids follow the .osu spec. */
export type GameModeId = 0 | 1 | 2 | 3;
export const MODE_NAMES: Record<GameModeId, string> = {
  0: 'osu!standard',
  1: 'osu!taiko',
  2: 'osu!catch',
  3: 'osu!mania',
};

export interface Vec2 {
  x: number;
  y: number;
}

export interface TimingPoint {
  time: number;
  /** For uninherited points: ms per beat. For inherited: -100 / slider velocity multiplier. */
  beatLength: number;
  meter: number;
  uninherited: boolean;
  volume: number;
  effects: number;
  sampleSet: number;
  sampleIndex: number;
}

export interface CircleObject {
  type: 'circle';
  time: number;
  x: number;
  y: number;
  newCombo: boolean;
  hitSound: number;
}

export interface SliderObject {
  type: 'slider';
  time: number;
  x: number;
  y: number;
  newCombo: boolean;
  hitSound: number;
  curveType: 'L' | 'P' | 'B' | 'C';
  /** Control points after the head (head is x,y). */
  curvePoints: Vec2[];
  /** Number of spans (1 = no repeats). */
  repeats: number;
  /** Authoritative pixel length from the file. */
  pixelLength: number;
}

export interface SpinnerObject {
  type: 'spinner';
  time: number;
  endTime: number;
  x: number;
  y: number;
  newCombo: boolean;
  hitSound: number;
}

export interface HoldObject {
  type: 'hold';
  time: number;
  endTime: number;
  x: number;
  lane: number;
  hitSound: number;
}

export type HitObject = CircleObject | SliderObject | SpinnerObject | HoldObject;

export interface BeatmapDifficulty {
  hpDrainRate: number;
  circleSize: number;
  overallDifficulty: number;
  approachRate: number;
  sliderMultiplier: number;
  sliderTickRate: number;
}

export interface BeatmapMetadata {
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  creator: string;
  version: string;
  source: string;
  beatmapId: number;
  beatmapSetId: number;
}

export interface BreakPeriod {
  start: number;
  end: number;
}

export interface ParsedBeatmap {
  fileFormat: number;
  audioFilename: string;
  audioLeadIn: number;
  previewTime: number;
  mode: GameModeId;
  /** Keys for mania; 0 otherwise. */
  keyCount: number;
  countdown: number;
  stackLeniency: number;
  metadata: BeatmapMetadata;
  difficulty: BeatmapDifficulty;
  timingPoints: TimingPoint[];
  hitObjects: HitObject[];
  backgroundFilename: string | null;
  breaks: BreakPeriod[];
  /** Non-fatal issues found while parsing (skipped lines etc). */
  warnings: string[];
}
