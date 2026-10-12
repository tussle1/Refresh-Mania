import { describe, expect, it } from 'vitest';
import { parseOsu, parseHitObject, BeatmapParseError } from '../src/beatmaps/parser';
import { buildSliderPath, pathPointAt, circumcircle } from '../src/beatmaps/curves';
import { TimingInfo } from '../src/beatmaps/timing';

const SAMPLE = `osu file format v14

[General]
AudioFilename: audio.mp3
AudioLeadIn: 0
PreviewTime: 1000
Countdown: 0
Mode: 0

[Metadata]
Title:Test Song
TitleUnicode:Test Song
Artist:Someone
Creator:Mapper
Version:Insane
BeatmapID:123
BeatmapSetID:456

[Difficulty]
HPDrainRate:6
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[Events]
//Background and Video events
0,0,"bg.jpg",0,0
2,20000,21000

[TimingPoints]
1000,500,4,1,0,60,1,0
2000,-50,4,1,0,60,0,0

[HitObjects]
256,192,1000,5,0,0:0:0:0:
100,100,1500,1,0,0:0:0:0:
200,200,2000,2,0,L|300:200,1,140
256,192,3000,12,0,4000,0:0:0:0:
`;

describe('parseOsu', () => {
  const bm = parseOsu(SAMPLE);

  it('parses general, metadata and difficulty', () => {
    expect(bm.audioFilename).toBe('audio.mp3');
    expect(bm.previewTime).toBe(1000);
    expect(bm.metadata.artist).toBe('Someone');
    expect(bm.metadata.version).toBe('Insane');
    expect(bm.metadata.beatmapSetId).toBe(456);
    expect(bm.difficulty).toMatchObject({ hpDrainRate: 6, circleSize: 4, overallDifficulty: 8, approachRate: 9, sliderMultiplier: 1.4 });
    expect(bm.mode).toBe(0);
    expect(bm.backgroundFilename).toBe('bg.jpg');
  });

  it('parses breaks and timing points', () => {
    expect(bm.breaks).toEqual([{ start: 20000, end: 21000 }]);
    expect(bm.timingPoints).toHaveLength(2);
    expect(bm.timingPoints[0].uninherited).toBe(true);
    expect(bm.timingPoints[1].uninherited).toBe(false);
  });

  it('parses circles, sliders and spinners in time order', () => {
    expect(bm.hitObjects.map((o) => o.type)).toEqual(['circle', 'circle', 'slider', 'spinner']);
    const slider = bm.hitObjects[2];
    expect(slider.type).toBe('slider');
    if (slider.type === 'slider') {
      expect(slider.curveType).toBe('L');
      expect(slider.curvePoints).toEqual([{ x: 300, y: 200 }]);
      expect(slider.repeats).toBe(1);
      expect(slider.pixelLength).toBe(140);
    }
    const spinner = bm.hitObjects[3];
    if (spinner.type === 'spinner') expect(spinner.endTime).toBe(4000);
  });

  it('rejects non-beatmap text', () => {
    expect(() => parseOsu('hello world')).toThrow(BeatmapParseError);
  });

  it('reports unsupported objects for a taiko chart instead of silently accepting them', () => {
    const taiko = SAMPLE.replace('Mode: 0', 'Mode: 1');
    const parsed = parseOsu(taiko);
    expect(parsed.mode).toBe(1);
    expect(parsed.hitObjects).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });

  it('flags malformed hit objects', () => {
    const obj = parseHitObject('abc,def', 0, 0);
    expect(obj).toBeNull();
  });
});

describe('timing', () => {
  const timing = new TimingInfo(parseOsu(SAMPLE).timingPoints);

  it('uses the active red line beat length', () => {
    expect(timing.beatLengthAt(1000)).toBe(500);
  });

  it('derives slider velocity from inherited points', () => {
    expect(timing.sliderVelocityAt(1500)).toBe(1);
    expect(timing.sliderVelocityAt(2500)).toBeCloseTo(2, 5);
  });

  it('computes slider duration from length, velocity and repeats', () => {
    // 100px at SV=1, multiplier 1.4 => 140 px/beat => one beat of 500ms.
    expect(timing.sliderDuration(1500, 140, 1, 1.4)).toBeCloseTo(500, 5);
    expect(timing.sliderDuration(1500, 140, 2, 1.4)).toBeCloseTo(1000, 5);
    // Doubled velocity halves duration.
    expect(timing.sliderDuration(2500, 140, 1, 1.4)).toBeCloseTo(250, 5);
  });

  it('falls back to a 120 BPM tempo when no red line exists', () => {
    const t = new TimingInfo([]);
    expect(t.beatLengthAt(0)).toBe(500);
  });
});

describe('slider curves', () => {
  it('linear path has the requested length', () => {
    const p = buildSliderPath({ x: 0, y: 0 }, 'L', [{ x: 100, y: 0 }], 80);
    expect(p.length).toBeCloseTo(80, 5);
    const mid = pathPointAt(p, 40, { x: 0, y: 0 });
    expect(mid.x).toBeCloseTo(40, 5);
  });

  it('perfect-circle arc follows the circumcircle', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 50, y: 50 };
    const c = { x: 100, y: 0 };
    const circ = circumcircle(a, b, c)!;
    expect(circ.r).toBeCloseTo(50, 3);
    const p = buildSliderPath(a, 'P', [b, c], Math.PI * 50);
    expect(p.length).toBeCloseTo(Math.PI * 50, 0);
    const end = pathPointAt(p, p.length, { x: 0, y: 0 });
    expect(end.x).toBeCloseTo(100, 0);
    expect(end.y).toBeCloseTo(0, 0);
    for (let d = 0; d <= p.length; d += 10) {
      const q = pathPointAt(p, d, { x: 0, y: 0 });
      expect(Math.hypot(q.x - circ.cx, q.y - circ.cy)).toBeCloseTo(circ.r, 0);
    }
  });

  it('bezier path with a red anchor (duplicate point) is split into segments and ends at the last point', () => {
    const p = buildSliderPath({ x: 0, y: 0 }, 'B', [{ x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 200);
    expect(p.length).toBeCloseTo(200, 3);
    const end = pathPointAt(p, p.length, { x: 0, y: 0 });
    expect(end.x).toBeCloseTo(100, 0);
    expect(end.y).toBeCloseTo(100, 0);
  });

  it('trims paths longer than the authoritative pixel length', () => {
    const p = buildSliderPath({ x: 0, y: 0 }, 'L', [{ x: 300, y: 0 }], 100);
    expect(p.length).toBeCloseTo(100, 5);
  });
});
