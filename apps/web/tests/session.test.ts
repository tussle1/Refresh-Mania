import { describe, expect, it, beforeEach } from 'vitest';
import { parseOsu } from '../src/beatmaps/parser';
import { GameSession } from '../src/gameplay/session';
import { audioEngine } from '../src/gameplay/audio/audioEngine';
import { validateReplay, ReplayError } from '../src/gameplay/replay/replay';

// Drive the audio clock from a fake time so the test is deterministic.
let fakeSec = 0;
beforeEach(() => {
  fakeSec = 0;
  audioEngine.clockSeconds = () => fakeSec;
});

const MAP = `osu file format v14

[General]
AudioFilename: a.mp3
Mode: 0

[Metadata]
Title:Replay Test
Artist:A
Creator:C
Version:V

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6
ApproachRate:8
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
500,500,4,1,0,60,1,0

[HitObjects]
100,100,1000,1,0
300,100,1500,1,0
200,200,2000,2,0,L|260:200,1,100
256,192,3500,8,0,4000,0:0:0:0:
120,300,4200,1,0
`;

function liveSession(parsed: ReturnType<typeof parseOsu>, onEnd: (r: any) => void) {
  return new GameSession({
    parsed,
    beatmapHash: 'abc',
    fileName: 'x.osu',
    mods: [],
    audioBuffer: null,
    audioOffsetMs: 0,
    hitsounds: false,
    onEnd,
  });
}

/** A scripted player that actually plays the chart: each action is a timed input plus frames. */
function scriptedPlay(parsed: ReturnType<typeof parseOsu>, session: GameSession, startChart: number): void {
  const actions: { t: number; run: () => void }[] = [];
  const press = (t: number, x: number, y: number) =>
    actions.push({
      t,
      run: () => {
        session.pointerMove(performance.now(), x, y);
        session.buttons(performance.now(), 1);
      },
    });
  const release = (t: number) => actions.push({ t, run: () => session.buttons(performance.now(), 0) });
  const move = (t: number, x: number, y: number) => actions.push({ t, run: () => session.pointerMove(performance.now(), x, y) });
  press(1000, 100, 100);
  release(1040);
  press(1500, 300, 100);
  release(1530);
  // Slider head at 2000 then follow along the path (length 100 px, 1 span, 500ms)
  const sl = parsed.hitObjects[2] as any;
  press(2000, sl.x, sl.y);
  for (let t = 2010; t <= 2500; t += 10) move(t, sl.x + ((t - 2000) / 500) * 100, sl.y);
  release(2520);
  // Spinner 3500..4000, spinning in a circle while held
  press(3500, 256 + 90, 192);
  for (let t = 3510, a = 0; t <= 4000; t += 10, a += 0.35) move(t, 256 + 90 * Math.cos(a), 192 + 90 * Math.sin(a));
  release(4010);
  // A circle we deliberately miss
  press(4300, 0, 0);
  release(4310);

  actions.sort((x, y) => x.t - y.t);
  let ai = 0;
  for (let t = startChart; t <= 6500; t += 4) {
    fakeSec = (t - startChart) / 1000;
    // Run actions that are due (before the frame update), like browser events arriving in time.
    while (ai < actions.length && actions[ai].t <= t) {
      fakeSec = (actions[ai].t - startChart) / 1000;
      actions[ai].run();
      ai++;
    }
    fakeSec = (t - startChart) / 1000;
    session.frame();
    if (session.isEnded) break;
  }
}

describe('live play and replay determinism', () => {
  it('records a play whose replay reproduces the same score, counts and combo', () => {
    const parsed = parseOsu(MAP);
    let live: any = null;
    const session = liveSession(parsed, (r) => (live = r));
    const startChart = session.introStartChart;
    fakeSec = 0;
    session.start();
    scriptedPlay(parsed, session, startChart);
    expect(live).not.toBeNull();
    // One deliberate miss does not fail a healthy play; it completes.
    expect(live.passed).toBe(true);
    const counts = live.snapshot.counts;
    expect(counts.great + counts.good + counts.meh).toBeGreaterThanOrEqual(3);
    expect(counts.miss).toBeGreaterThanOrEqual(1);
    expect(live.snapshot.score).toBeGreaterThan(0);
    expect(live.replay).not.toBeNull();

    // Replay: same events, no live input.
    const replay = validateReplay(JSON.parse(JSON.stringify(live.replay)));
    expect(live.snapshot.counts.great).toBeGreaterThanOrEqual(2);
    let played: any = null;
    const rp = new GameSession({
      parsed,
      beatmapHash: 'abc',
      fileName: 'x.osu',
      mods: [],
      audioBuffer: null,
      audioOffsetMs: 0,
      hitsounds: false,
      replay,
      onEnd: (r) => (played = r),
    });
    fakeSec = 0;
    rp.start();
    for (let t = startChart; t <= 6500; t += 4) {
      fakeSec = (t - startChart) / 1000;
      rp.frame();
      if (rp.isEnded) break;
    }
    expect(played).not.toBeNull();
    expect(played.snapshot.score).toBe(live.snapshot.score);
    expect(played.snapshot.maxCombo).toBe(live.snapshot.maxCombo);
    expect(played.snapshot.counts).toEqual(live.snapshot.counts);
    expect(played.snapshot.followCounts).toEqual(live.snapshot.followCounts);
  });

  it('pausing releases buttons and freezes the chart clock', () => {
    const parsed = parseOsu(MAP);
    const session = liveSession(parsed, () => {});
    fakeSec = 0;
    session.start();
    fakeSec = 0.5;
    session.frame();
    const before = session.chartTime;
    session.pause();
    fakeSec = 3;
    expect(session.chartTime).toBeCloseTo(before, 5);
    expect(session.phase).toBe('paused');
  });
});

describe('replay validation', () => {
  const base = {
    format: 'badosu-replay',
    version: 1,
    mode: 0,
    source: 'local',
    beatmap: { hash: 'h', fileName: 'f.osu', title: 't', version: 'v', artist: 'a' },
    mods: [],
    rate: 1,
    audioOffsetMs: 0,
    recordedAt: 0,
    events: [0, 2, 0, 0],
    claimed: { score: 0, maxCombo: 0, accuracy: 1, passed: true },
  };
  it('accepts a well-formed replay', () => {
    expect(() => validateReplay(base)).not.toThrow();
  });
  it('rejects truncated, unknown-kind and out-of-range data', () => {
    expect(() => validateReplay({ ...base, events: [0, 2, 0] })).toThrow(ReplayError);
    expect(() => validateReplay({ ...base, events: [0, 9, 0, 0] })).toThrow(ReplayError);
    expect(() => validateReplay({ ...base, events: [0, 1, 99, 0] })).toThrow(ReplayError);
    expect(() => validateReplay({ ...base, events: [0, 0, 1e9, 0] })).toThrow(ReplayError);
    expect(() => validateReplay({ ...base, mods: ['XX'] })).toThrow(ReplayError);
    expect(() => validateReplay({ ...base, format: 'osr' })).toThrow(ReplayError);
  });
});
