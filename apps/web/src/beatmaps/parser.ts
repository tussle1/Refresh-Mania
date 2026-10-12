import type {
  BeatmapDifficulty,
  BeatmapMetadata,
  BreakPeriod,
  GameModeId,
  HitObject,
  ParsedBeatmap,
  TimingPoint,
  Vec2,
} from './types';

export class BeatmapParseError extends Error {}

const DEFAULT_DIFFICULTY: BeatmapDifficulty = {
  hpDrainRate: 5,
  circleSize: 5,
  overallDifficulty: 5,
  approachRate: 5,
  sliderMultiplier: 1.4,
  sliderTickRate: 1,
};

/** Object type bit flags from the .osu spec. */
const TYPE_CIRCLE = 1;
const TYPE_SLIDER = 2;
const TYPE_SPINNER = 8;
const TYPE_HOLD = 128;
const TYPE_NEW_COMBO = 4;

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function parseTimingPoint(line: string): TimingPoint | null {
  const f = line.split(',');
  if (f.length < 2) return null;
  const time = Number(f[0]);
  const beatLength = Number(f[1]);
  if (!Number.isFinite(time) || !Number.isFinite(beatLength)) return null;
  return {
    time,
    beatLength,
    meter: num(f[2], 4),
    sampleSet: num(f[3], 0),
    sampleIndex: num(f[4], 0),
    volume: num(f[5], 100),
    uninherited: f.length > 6 ? f[6].trim() === '1' : true,
    effects: num(f[7], 0),
  };
}

/** Parse the `x,y,time,type,hitSound,...` line of the [HitObjects] section. */
export function parseHitObject(line: string, mode: GameModeId, keyCount: number): HitObject | { unsupported: string } | null {
  const f = line.split(',');
  if (f.length < 4) return null;
  const x = Number(f[0]);
  const y = Number(f[1]);
  const time = Number(f[2]);
  const type = Number(f[3]);
  const hitSound = num(f[4], 0);
  if (![x, y, time, type].every(Number.isFinite)) return null;
  const newCombo = (type & TYPE_NEW_COMBO) !== 0;

  if (type & TYPE_SLIDER) {
    if (mode !== 0) return { unsupported: `slider in ${mode === 1 ? 'taiko' : mode === 2 ? 'catch' : 'mania'} chart` };
    const curve = (f[5] ?? '').split('|');
    const curveType = (curve[0] || 'L').toUpperCase();
    const validCurve = (['L', 'P', 'B', 'C'] as const).find((c) => c === curveType) ?? 'B';
    const points: Vec2[] = [];
    for (let i = 1; i < curve.length; i++) {
      const [px, py] = curve[i].split(':').map(Number);
      if (Number.isFinite(px) && Number.isFinite(py)) points.push({ x: px, y: py });
    }
    const repeats = Math.max(1, Math.floor(num(f[6], 1)));
    const pixelLength = Math.max(0, num(f[7], 0));
    return {
      type: 'slider',
      time,
      x,
      y,
      newCombo,
      hitSound,
      curveType: validCurve,
      curvePoints: points,
      repeats,
      pixelLength,
    };
  }
  if (type & TYPE_SPINNER) {
    if (mode !== 0) return { unsupported: `spinner in ${mode === 1 ? 'taiko' : mode === 2 ? 'catch' : 'mania'} chart` };
    const endTime = num(f[5], time);
    return { type: 'spinner', time, endTime: Math.max(time, endTime), x: 256, y: 192, newCombo, hitSound };
  }
  if (type & TYPE_HOLD) {
    if (mode !== 3) return { unsupported: 'hold note outside mania' };
    const endTime = Number(f[5]?.split(':')[0] ?? time);
    const lane = Math.floor((x * Math.max(1, keyCount)) / 512);
    return { type: 'hold', time, endTime: Math.max(time, endTime), x, lane: clampNum(lane, 0, keyCount - 1), hitSound };
  }
  if (type & TYPE_CIRCLE) {
    if (mode !== 0) return { unsupported: `circle in ${mode === 1 ? 'taiko' : mode === 2 ? 'catch' : 'mania'} chart` };
    return { type: 'circle', time, x, y, newCombo, hitSound };
  }
  return null;
}

/**
 * Parse an .osu file (format v3..v14 accepted). Throws BeatmapParseError when the file is not a usable beatmap.
 * Unsupported objects for this engine are dropped and recorded in `warnings`.
 */
export function parseOsu(text: string): ParsedBeatmap {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let fileFormat = 0;
  let section = '';
  const general: Record<string, string> = {};
  const metaRaw: Record<string, string> = {};
  const diffRaw: Record<string, string> = {};
  const timingPoints: TimingPoint[] = [];
  const hitLines: string[] = [];
  let backgroundFilename: string | null = null;
  const breaks: BreakPeriod[] = [];
  const warnings: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    if (fileFormat === 0) {
      const m = /^osu file format v(\d+)/i.exec(line);
      if (m) {
        fileFormat = Number(m[1]);
        continue;
      }
    }
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1];
      continue;
    }
    switch (section) {
      case 'General':
      case 'Metadata':
      case 'Difficulty': {
        const idx = line.indexOf(':');
        if (idx < 0) break;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (section === 'General') general[key] = value;
        else if (section === 'Metadata') metaRaw[key] = value;
        else diffRaw[key] = value;
        break;
      }
      case 'Events': {
        const f = line.split(',');
        if (f[0] === '0' && f[2] !== undefined && backgroundFilename === null) {
          backgroundFilename = f[2].replace(/^"|"$/g, '');
        } else if (f[0] === '2' && f.length >= 3) {
          const start = Number(f[1]);
          const end = Number(f[2]);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) breaks.push({ start, end });
        }
        break;
      }
      case 'TimingPoints': {
        const p = parseTimingPoint(line);
        if (p) timingPoints.push(p);
        else warnings.push(`Skipped malformed timing point: ${line}`);
        break;
      }
      case 'HitObjects':
        hitLines.push(line);
        break;
      default:
        break;
    }
  }

  if (fileFormat === 0) throw new BeatmapParseError('Missing "osu file format" header; this is not a .osu beatmap.');
  if (hitLines.length === 0 && timingPoints.length === 0) {
    throw new BeatmapParseError('Beatmap has no [TimingPoints] or [HitObjects] data.');
  }

  const mode = clampNum(Math.floor(num(general.Mode, 0)), 0, 3) as GameModeId;
  const difficulty: BeatmapDifficulty = {
    hpDrainRate: clampNum(num(diffRaw.HPDrainRate, DEFAULT_DIFFICULTY.hpDrainRate), 0, 10),
    circleSize: clampNum(num(diffRaw.CircleSize, DEFAULT_DIFFICULTY.circleSize), 0, 10),
    overallDifficulty: clampNum(num(diffRaw.OverallDifficulty, DEFAULT_DIFFICULTY.overallDifficulty), 0, 10),
    approachRate: clampNum(num(diffRaw.ApproachRate, num(diffRaw.OverallDifficulty, DEFAULT_DIFFICULTY.approachRate)), 0, 10),
    sliderMultiplier: clampNum(num(diffRaw.SliderMultiplier, DEFAULT_DIFFICULTY.sliderMultiplier), 0.4, 3.6),
    sliderTickRate: clampNum(num(diffRaw.SliderTickRate, DEFAULT_DIFFICULTY.sliderTickRate), 0.5, 8),
  };
  const keyCount = mode === 3 ? clampNum(Math.round(difficulty.circleSize), 1, 18) : 0;

  const metadata: BeatmapMetadata = {
    title: metaRaw.Title ?? '',
    titleUnicode: metaRaw.TitleUnicode ?? metaRaw.Title ?? '',
    artist: metaRaw.Artist ?? '',
    artistUnicode: metaRaw.ArtistUnicode ?? metaRaw.Artist ?? '',
    creator: metaRaw.Creator ?? '',
    version: metaRaw.Version ?? '',
    source: metaRaw.Source ?? '',
    beatmapId: num(metaRaw.BeatmapID, 0),
    beatmapSetId: num(metaRaw.BeatmapSetID, -1),
  };

  timingPoints.sort((a, b) => a.time - b.time);

  const hitObjects: HitObject[] = [];
  const unsupported = new Map<string, number>();
  for (const l of hitLines) {
    const obj = parseHitObject(l, mode, keyCount);
    if (!obj) {
      warnings.push(`Skipped malformed hit object: ${l.slice(0, 60)}`);
      continue;
    }
    if ('unsupported' in obj) {
      unsupported.set(obj.unsupported, (unsupported.get(obj.unsupported) ?? 0) + 1);
      continue;
    }
    hitObjects.push(obj);
  }
  for (const [reason, count] of unsupported) {
    warnings.push(`${count} object(s) skipped: ${reason}.`);
  }
  hitObjects.sort((a, b) => a.time - b.time);

  return {
    fileFormat,
    audioFilename: general.AudioFilename ?? '',
    audioLeadIn: num(general.AudioLeadIn, 0),
    previewTime: num(general.PreviewTime, -1),
    mode,
    keyCount,
    countdown: num(general.Countdown, 1),
    stackLeniency: num(general.StackLeniency, 0.7),
    metadata,
    difficulty,
    timingPoints,
    hitObjects,
    backgroundFilename,
    breaks,
    warnings,
  };
}
