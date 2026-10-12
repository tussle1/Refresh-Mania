import { useEffect, useMemo, useRef } from 'react';
import { useApp, type ResultPayload } from '../app/AppContext';
import { STANDARD_MODS } from '../gameplay/core/mods';
import { validateReplay, serializeReplay, ReplayError } from '../gameplay/replay/replay';
import { MODE_NAMES } from '../beatmaps/types';
import { gradeFor } from '../gameplay/scoring/score';

export function Results({ payload }: { payload: ResultPayload }) {
  const { store, reset, replaceTop, back, notify } = useApp();
  const { launch, result, bestBefore, previous, scoreId } = payload;
  const snap = result.snapshot;
  const total = snap.objectCount;
  const grade = gradeFor(snap.accuracy, snap.counts.miss, total);
  const isNewBest = bestBefore === null ? result.passed : result.snapshot.score > bestBefore;
  const graphRef = useRef<HTMLCanvasElement>(null);
  const errRef = useRef<HTMLCanvasElement>(null);
  const localBoard = useMemo(() => {
    // Previous plays plus this one, best first (this device only).
    const rows = previous.slice(0, 9).map((s) => ({ id: s.id, score: s.score, accuracy: s.accuracy, combo: s.maxCombo, mods: s.mods, date: s.playedAt, grade: s.grade, current: false, passed: s.passed }));
    if (scoreId) {
      rows.push({ id: scoreId, score: snap.score, accuracy: snap.accuracy, combo: snap.maxCombo, mods: launch.mods, date: Date.now(), grade, current: true, passed: result.passed });
    }
    return rows.sort((a, b) => b.score - a.score);
  }, [previous, scoreId, snap, launch.mods, grade, result.passed]);

  // Score progression graph (samples recorded during play).
  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 160;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = result.progress;
    if (pts.length < 2) return;
    const t0 = pts[0][0];
    const t1 = pts[pts.length - 1][0];
    const maxScore = Math.max(1, pts[pts.length - 1][1]);
    ctx.strokeStyle = 'rgba(125,255,178,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([t, s], i) => {
      const x = ((t - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2;
      const y = h - 4 - (s / maxScore) * (h - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [result.progress]);

  // Hit-error histogram.
  useEffect(() => {
    const canvas = errRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 80;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const errs = result.hitErrors;
    if (errs.length === 0) return;
    const range = 160;
    const bins = 64;
    const counts = new Array(bins).fill(0);
    for (const e of errs) {
      const i = Math.floor(((Math.max(-range, Math.min(range, e)) + range) / (2 * range)) * (bins - 1));
      counts[i]++;
    }
    const max = Math.max(...counts, 1);
    for (let i = 0; i < bins; i++) {
      const bh = (counts[i] / max) * (h - 12);
      ctx.fillStyle = i === bins / 2 ? 'rgba(255,255,255,0.5)' : 'rgba(125,210,255,0.8)';
      ctx.fillRect((i / bins) * w + 1, h - bh - 6, w / bins - 2, bh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px system-ui';
    ctx.fillText('early', 2, h - 1);
    ctx.textAlign = 'right';
    ctx.fillText('late', w - 2, h - 1);
  }, [result.hitErrors]);

  const replayFromScore = async () => {
    if (!store || !scoreId) return;
    const data = await store.getReplay(scoreId);
    if (!data) {
      notify('No replay is stored for this score.', 'warn');
      return;
    }
    try {
      const valid = validateReplay(data);
      replaceTop({ name: 'game', launch: { hash: launch.hash, fileName: launch.fileName, mods: valid.mods, replay: valid } });
    } catch (e) {
      notify(e instanceof ReplayError ? `Replay rejected: ${e.message}` : 'Replay could not be loaded.', 'error');
    }
  };

  const exportReplay = async () => {
    if (!result.replay) {
      notify('Only plays recorded on this device can be exported.', 'warn');
      return;
    }
    const blob = new Blob([serializeReplay(result.replay)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${result.replay.beatmap.title.replace(/[^\w.-]+/g, '_')}-${snap.score}.badosu-replay.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify('Exported as a bad!osu replay (local JSON, not an official .osr file).', 'success');
  };

  const retry = () => replaceTop({ name: 'game', launch: { hash: launch.hash, fileName: launch.fileName, mods: launch.mods } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter' && !e.repeat) retry();
      if (e.key === 'Escape') reset({ name: 'select' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  const c = snap.counts;
  const fc = snap.followCounts;
  const judged = c.great + c.good + c.meh + c.miss;
  const pct = (n: number) => (judged ? `${((n / judged) * 100).toFixed(1)}%` : '0%');
  const hitStats = result.hitErrorStats;

  return (
    <section className={`results ${result.passed ? 'passed' : 'failed'}`} aria-label="Results">
      <div className="results-head panel">
        <div className={`grade grade-${grade}`} aria-label={`Grade ${grade}`}>{grade}</div>
        <div className="results-title">
          <div className="small muted">{MODE_NAMES[0]} · {result.passed ? 'Passed' : 'Failed'}</div>
          <h1>{payload.title}</h1>
          <div className="small">
            {result.replay ? 'Recorded on this device' : 'Replay playback'} ·{' '}
            {launch.mods.length ? launch.mods.map((m) => STANDARD_MODS[m].name).join(', ') : 'No mods'}
          </div>
          {isNewBest && result.passed && <div className="chip success">New personal best (this device)</div>}
        </div>
        <div className="big-score">
          <div className="small muted">Score</div>
          <div className="score-num mono">{snap.score.toLocaleString()}</div>
        </div>
      </div>

      <div className="results-grid">
        <div className="panel">
          <h3>Accuracy &amp; combo</h3>
          <div className="stat-line"><span>Accuracy</span><strong>{(snap.accuracy * 100).toFixed(2)}%</strong></div>
          <div className="stat-line"><span>Max combo</span><strong>{snap.maxCombo}x</strong></div>
          <div className="stat-line"><span>Objects judged</span><strong>{total}</strong></div>
          <div className="stat-line"><span>Hit error (mean)</span><strong>{hitStats.mean.toFixed(1)} ms</strong></div>
          <div className="stat-line" title="Standard deviation of hit errors × 10, an approximation of unstable rate."><span>Unstable rate (approx.)</span><strong>{hitStats.unstableRate.toFixed(1)}</strong></div>
          <div className="stat-line"><span>Play length</span><strong>{Math.round(result.durationMs / 1000)} s</strong></div>
        </div>
        <div className="panel">
          <h3>Judgments</h3>
          {(['great', 'good', 'meh', 'miss'] as const).map((k) => (
            <div key={k} className={`judge judge-${k}`}>
              <span className="judge-name">{k === 'great' ? '300' : k === 'good' ? '100' : k === 'meh' ? '50' : 'Miss'}</span>
              <span className="judge-bar"><span style={{ width: pct(c[k]) }} /></span>
              <span className="mono">{c[k]} <span className="muted small">({pct(c[k])})</span></span>
            </div>
          ))}
          <h4>Slider &amp; spinner</h4>
          <div className="small">
            Ticks {fc.tick} / {fc.tick + fc.tickMiss} · Repeats {fc.repeat} / {fc.repeat + fc.repeatMiss} · Tails {fc.tail} / {fc.tail + fc.tailMiss}
          </div>
        </div>
        <div className="panel wide">
          <h3>Score progression</h3>
          <canvas ref={graphRef} className="results-graph" aria-label="Score over the play" />
          <h3>Hit error</h3>
          <canvas ref={errRef} className="results-graph small-graph" aria-label="Hit error distribution" />
        </div>
        <div className="panel wide">
          <h3>Local leaderboard <span className="muted small">— this device only</span></h3>
          {localBoard.length === 0 ? (
            <p className="muted small">No saved plays for this difficulty.</p>
          ) : (
            <table className="board">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Score</th>
                  <th>Accuracy</th>
                  <th>Grade</th>
                  <th>Combo</th>
                  <th>Mods</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {localBoard.map((r, i) => (
                  <tr key={r.id} className={r.current ? 'current' : ''}>
                    <td>{i + 1}</td>
                    <td className="mono">{r.score.toLocaleString()}</td>
                    <td>{(r.accuracy * 100).toFixed(2)}%</td>
                    <td>{r.grade}</td>
                    <td>{r.combo}x</td>
                    <td className="small">{r.mods.join(' ') || '—'}</td>
                    <td className="small">{new Date(r.date).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Online leaderboard: not available. This build has no server, so this score was not submitted or ranked anywhere.
          </p>
          <p className="muted small">Performance points: not calculated by this build. Global ranks: not available offline.</p>
        </div>
      </div>

      <div className="results-actions">
        <button className="primary big" onClick={retry} aria-keyshortcuts="Enter">
          Retry <kbd>Enter</kbd>
        </button>
        <button onClick={() => reset({ name: 'select' })} aria-keyshortcuts="Escape">
          Song select <kbd>Esc</kbd>
        </button>
        <button onClick={replayFromScore} disabled={!scoreId || !result.replay}>
          Watch replay
        </button>
        <button onClick={exportReplay} disabled={!result.replay}>
          Export replay
        </button>
        <button className="ghost" onClick={back}>
          Back
        </button>
      </div>
      <p className="muted small">Replays are local recordings in bad!osu's own format. They are not verified by any server and are not official .osr files.</p>
    </section>
  );
}
