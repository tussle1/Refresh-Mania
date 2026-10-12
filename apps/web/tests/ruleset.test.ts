import { describe, expect, it } from 'vitest';
import { parseOsu } from '../src/beatmaps/parser';
import { applyMods } from '../src/gameplay/core/mods';
import { StandardRuleset, type RulesetEvent } from '../src/gameplay/modes/standard/ruleset';
import { hitWindows, circleRadius, approachPreemptMs } from '../src/gameplay/core/difficulty';

function makeMap(objects: string, extraDiff = '', timing = '1000,500,4,1,0,60,1,0') {
  return parseOsu(`osu file format v14

[General]
AudioFilename: a.mp3
Mode: 0

[Metadata]
Title:T
Artist:A
Creator:C
Version:V

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:5
ApproachRate:8
SliderMultiplier:1
SliderTickRate:1
${extraDiff}

[TimingPoints]
${timing}

[HitObjects]
${objects}
`);
}

function run(rs: StandardRuleset, script: [number, 'move' | 'press' | 'release', number?, number?][]) {
  for (const [t, kind, x = 256, y = 192] of script) {
    rs.update(t);
    if (kind === 'move') rs.setPointer(t, x, y);
    if (kind === 'press') {
      rs.setPointer(t, x, y);
      rs.setButtons(t, 1);
    }
    if (kind === 'release') rs.setButtons(t, 0);
  }
}

describe('difficulty helpers', () => {
  it('computes OD windows per osu! formula', () => {
    const w = hitWindows(5);
    expect(w.great).toBe(50);
    expect(w.good).toBe(100);
    expect(w.meh).toBe(150);
  });
  it('computes AR preempt and circle radius', () => {
    expect(approachPreemptMs(5)).toBe(1200);
    expect(approachPreemptMs(10)).toBe(450);
    expect(circleRadius(4)).toBeCloseTo(36.48, 2);
  });
});

describe('mods', () => {
  it('applies Hard Rock and Easy scaling with clamping', () => {
    const base = makeMap('').difficulty;
    const hr = applyMods({ ...base, circleSize: 8, approachRate: 9 }, ['HR']);
    expect(hr.difficulty.circleSize).toBeCloseTo(10, 5);
    expect(hr.difficulty.approachRate).toBe(10);
    expect(hr.flipVertical).toBe(true);
    const ez = applyMods({ ...base, circleSize: 4 }, ['EZ']);
    expect(ez.difficulty.circleSize).toBe(2);
  });
  it('removes conflicting mods (EZ vs HR, DT vs HT)', () => {
    const s = applyMods(makeMap('').difficulty, ['EZ', 'HR']);
    expect(s.flipVertical).toBe(true);
    expect(s.difficulty.circleSize).toBeCloseTo(4 * 1.3, 5);
    const r = applyMods(makeMap('').difficulty, ['DT', 'HT']);
    expect(r.rate).toBe(0.75);
  });
  it('marks autoplay as unranked with zero score multiplier', () => {
    const s = applyMods(makeMap('').difficulty, ['AT']);
    expect(s.ranked).toBe(false);
    expect(s.scoreMultiplier).toBe(0);
  });
  it('combines score multipliers', () => {
    const s = applyMods(makeMap('').difficulty, ['HD', 'HR']);
    expect(s.scoreMultiplier).toBeCloseTo(1.06 * 1.06, 6);
  });
});

describe('osu!standard circles', () => {
  const bm = makeMap('256,192,1000,1,0\n100,100,2000,1,0');
  const mods = applyMods(bm.difficulty, []);

  it('judges a centered click at the exact time as great', () => {
    const events: RulesetEvent[] = [];
    const rs = new StandardRuleset({ beatmap: bm, mods, onEvent: (e) => events.push(e) });
    run(rs, [[1000, 'press', 256, 192]]);
    rs.update(1100);
    expect(rs.score.counts.great).toBe(1);
    expect(rs.score.combo).toBe(1);
    expect(events.some((e) => e.type === 'judgment' && e.judgment === 'great')).toBe(true);
  });

  it('classifies hits by real-time windows (good and meh)', () => {
    const rs = new StandardRuleset({ beatmap: bm, mods });
    run(rs, [[1000 + 70, 'press', 256, 192]]);
    expect(rs.objects[0].kind === 'circle' && rs.objects[0].judgment).toBe('good');
  });

  it('ignores clicks outside the hit window and misses the circle afterwards', () => {
    const rs = new StandardRuleset({ beatmap: bm, mods });
    run(rs, [[1000 - 300, 'press', 256, 192], [1000 - 290, 'release']]);
    rs.update(1000 + 200);
    const c = rs.objects[0];
    expect(c.kind === 'circle' && c.judgment).toBe('miss');
    expect(rs.score.combo).toBe(0);
  });

  it('does not hit when the cursor is outside the circle', () => {
    const rs = new StandardRuleset({ beatmap: bm, mods });
    run(rs, [[1000, 'press', 0, 0]]);
    rs.update(1300);
    expect(rs.score.counts.miss).toBe(1);
  });

  it('does not let a later circle be hit before an earlier one resolves when both are in range', () => {
    const near = makeMap('256,192,1000,1,0\n256,192,1040,1,0');
    const rs = new StandardRuleset({ beatmap: near, mods: applyMods(near.difficulty, []) });
    run(rs, [[1000, 'press', 256, 192], [1010, 'release']]);
    expect(rs.score.counts.great).toBe(1);
    // The second circle (40ms later) is still in its window at 1100 and is hit by the next press.
    run(rs, [[1100, 'press', 256, 192], [1110, 'release']]);
    expect(rs.score.counts.great + rs.score.counts.good + rs.score.counts.meh).toBe(2);
    expect(rs.score.counts.miss).toBe(0);
  });
});

describe('osu!standard sliders and spinners', () => {
  it('a slider followed to the tail judges ticks and tail and scores the head', () => {
    // 100 px slider at SV 1, multiplier 1 => 100 px/beat => 500ms duration with 1 beat length.
    const bm = makeMap('100,100,1000,2,0,L|200:100,1,100');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    const s = rs.objects[0];
    expect(s.kind).toBe('slider');
    if (s.kind !== 'slider') return;
    expect(s.endTime - s.time).toBeCloseTo(500, 3);
    // Head click
    run(rs, [[1000, 'press', 100, 100]]);
    // Follow the ball along the slider while holding.
    for (let t = 1010; t <= 1500; t += 10) {
      const d = rs.ballDistance(s, t);
      rs.update(t);
      rs.setPointer(t, 100 + d, 100);
    }
    rs.update(1600);
    expect(rs.score.followCounts.tail).toBe(1);
    expect(rs.score.counts.great).toBe(1);
    expect(rs.score.counts.miss).toBe(0);
  });

  it('a slider with no follow is judged as miss-broken, and its ticks count as misses', () => {
    const bm = makeMap('100,100,1000,2,0,L|200:100,1,100');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    run(rs, [[1000, 'press', 100, 100], [1010, 'release']]);
    rs.update(1600);
    expect(rs.score.counts.miss).toBe(1);
    expect(rs.score.followCounts.tailMiss).toBe(1);
  });

  it('spinner completes when enough rotations are made while held', () => {
    const bm = makeMap('256,192,1000,8,0,2000,0:0:0:0:');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    const sp = rs.objects[0];
    if (sp.kind !== 'spinner') throw new Error('expected spinner');
    expect(sp.requiredRotations).toBeGreaterThan(0);
    rs.update(1000);
    rs.setButtons(1000, 1);
    let angle = 0;
    for (let t = 1000; t <= 2000; t += 5) {
      rs.update(t);
      angle += 0.4;
      rs.setPointer(t, 256 + 100 * Math.cos(angle), 192 + 100 * Math.sin(angle));
    }
    rs.update(2100);
    expect(sp.judgment).toBe('great');
    expect(sp.rotations).toBeGreaterThanOrEqual(sp.requiredRotations);
  });

  it('spinner without rotation is a miss', () => {
    const bm = makeMap('256,192,1000,8,0,2000,0:0:0:0:');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    rs.update(2100);
    const sp = rs.objects[0];
    expect(sp.kind === 'spinner' && sp.judgment).toBe('miss');
  });
});

describe('scoring and fail states', () => {
  it('accuracy uses the osu! weighting (300/100/50/0)', () => {
    const bm = makeMap('256,192,1000,1,0\n256,192,2000,1,0\n256,192,3000,1,0\n256,192,4000,1,0');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, ['NF']) });
    run(rs, [[1000, 'press', 256, 192], [1010, 'release'], [2000 + 100, 'press', 256, 192], [2110, 'release']]);
    rs.update(5000);
    // great (300) + good (100) + two misses (0) = 400 / (300*4)
    expect(rs.score.accuracy).toBeCloseTo(400 / 1200, 5);
    expect(rs.score.counts.miss).toBe(2);
  });

  it('sudden death fails on the first miss', () => {
    const bm = makeMap('256,192,1000,1,0\n256,192,2000,1,0');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, ['SD']) });
    rs.update(1300);
    expect(rs.failed).toBe(true);
  });

  it('no fail keeps the play alive at zero health', () => {
    const notes = Array.from({ length: 60 }, (_, i) => `256,192,${1000 + i * 500},1,0`).join('\n');
    const bm = makeMap(notes);
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, ['NF']) });
    rs.update(40000);
    expect(rs.score.health).toBe(0);
    expect(rs.failed).toBe(false);
    expect(rs.score.counts.miss).toBe(60);
  });

  it('health drops to zero and fails a long run of misses', () => {
    const notes = Array.from({ length: 60 }, (_, i) => `256,192,${1000 + i * 500},1,0`).join('\n');
    const bm = makeMap(notes);
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    rs.update(40000);
    expect(rs.failed).toBe(true);
  });

  it('combo bonus increases score for later hits', () => {
    const bm = makeMap('256,192,1000,1,0\n256,192,1500,1,0');
    const rs = new StandardRuleset({ beatmap: bm, mods: applyMods(bm.difficulty, []) });
    run(rs, [[1000, 'press', 256, 192], [1020, 'release'], [1500, 'press', 256, 192], [1520, 'release']]);
    rs.update(3000);
    const first = 300;
    expect(rs.score.score).toBeGreaterThan(first * 2);
    expect(rs.score.maxCombo).toBe(2);
  });
});
