import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { audioEngine } from '../gameplay/audio/audioEngine';

const TIPS = [
  'Press Z and X (or the left and right mouse buttons) to hit circles. Keys are configurable in Options › Input.',
  'Hit windows are real-time: Double Time makes the song faster but keeps the windows the same in real time.',
  'Press ? at any time to see every keyboard shortcut.',
  'Sliders must be followed while a key or mouse button is held down. Ticks and repeats add to your combo.',
  'Turn on Hidden for a harder read: circles fade out before you have to click them.',
  'Your replays are recorded locally and can be watched again from the results screen.',
  'Search supports field expressions like ar>9 or creator=name in the song select search box.',
  'Lower the cursor smoothing to zero to play with the raw, unsmoothed pointer.',
];

/** Smooth closed wobble path for the cookie silhouette (original artwork). */
function cookiePath(points = 48, radius = 100, bumps = 9, depth = 6): string {
  const out: string[] = [];
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = radius + depth * Math.cos(bumps * a);
    const x = 120 + r * Math.cos(a);
    const y = 120 + r * Math.sin(a);
    out.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return out.join(' ') + ' Z';
}

const BARS = 40;

export function MainMenu() {
  const { go, notify, settings, sets, scores, updateSettings, connection, connectionDetail } = useApp();
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [jukebox, setJukebox] = useState(true);
  const [squish, setSquish] = useState(0);
  const cookieRef = useRef<SVGSVGElement | null>(null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const path = useMemo(() => cookiePath(), []);
  const reduced = settings.reducedMotion;

  // Rotate tips.
  useEffect(() => {
    if (!settings.tipsEnabled) return;
    const id = window.setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 9000);
    return () => window.clearInterval(id);
  }, [settings.tipsEnabled]);

  // Jukebox: a synthesized menu loop (original). Starts once audio has been unlocked by a gesture.
  useEffect(() => {
    if (!jukebox || settings.muted) {
      audioEngine.stopJukebox();
      return;
    }
    const start = () => {
      if (audioEngine.ensure()) audioEngine.startJukebox();
    };
    start();
    const onPointer = () => start();
    window.addEventListener('pointerdown', onPointer, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [jukebox, settings.muted]);

  // Stop the jukebox when leaving the title screen for gameplay (unmount).
  useEffect(() => () => audioEngine.stopJukebox(), []);

  // Rhythm pulse + audio-reactive bars. Updates DOM refs directly so React does not re-render per frame.
  useEffect(() => {
    let raf = 0;
    const bpm = 120;
    const beatMs = 60000 / bpm;
    const loop = () => {
      const now = performance.now();
      const beat = (now % beatMs) / beatMs;
      const pulse = Math.exp(-beat * 6);
      const level = jukebox && !settings.muted ? audioEngine.level() : 0;
      const energy = reduced ? 0 : Math.min(1, pulse * 0.6 + level * 0.8);
      const el = cookieRef.current;
      if (el) el.style.setProperty('--energy', energy.toFixed(3));
      if (!reduced && settings.menuParticles) {
        for (let i = 0; i < barsRef.current.length; i++) {
          const b = barsRef.current[i];
          if (!b) continue;
          const wave = 0.5 + 0.5 * Math.sin(now / 180 + i * 0.7);
          const h = 0.12 + 0.88 * Math.min(1, level * (0.6 + 0.8 * wave) + pulse * 0.25 * wave);
          b.style.transform = `scaleY(${h.toFixed(3)})`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [jukebox, settings.muted, settings.menuParticles, reduced]);

  const play = () => go({ name: 'play' });
  const options = () => go({ name: 'options' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'p' || e.key === 'Enter') play();
      else if (k === 'o') options();
      else if (k === 'm') setJukebox((j) => !j);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const difficulties = sets.reduce((n, s) => n + s.difficulties.length, 0);
  const lastScore = scores[0];

  return (
    <div className="title">
      <div className="title-stage">
        <div className="cookie-wrap" style={{ position: 'relative' }}>
          {!reduced && settings.menuParticles && (
            <div className="visualizer" aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    barsRef.current[i] = el;
                  }}
                  style={{ transform: `rotate(${(i / BARS) * 360}deg)` }}
                />
              ))}
            </div>
          )}
          <button
            className={`cookie-btn ${squish ? 'squish' : ''}`}
            aria-label="Play (solo)"
            onClick={() => {
              setSquish((s) => s + 1);
              play();
            }}
            onAnimationEnd={() => setSquish(0)}
          >
            <svg ref={cookieRef} className="cookie" viewBox="0 0 240 240" role="img" aria-hidden="true">
              <defs>
                <radialGradient id="cookieGrad" cx="40%" cy="35%" r="70%">
                  <stop offset="0%" stopColor="#ffd9ec" />
                  <stop offset="55%" stopColor="#ff7fb0" />
                  <stop offset="100%" stopColor="#b53d7a" />
                </radialGradient>
              </defs>
              <path d={path} fill="url(#cookieGrad)" stroke="rgba(255,255,255,0.55)" strokeWidth="3" />
              <circle cx="120" cy="120" r="46" fill="rgba(255,255,255,0.12)" />
              <circle cx="92" cy="98" r="10" fill="rgba(60,20,40,0.55)" />
              <circle cx="150" cy="108" r="8" fill="rgba(60,20,40,0.55)" />
              <circle cx="110" cy="150" r="7" fill="rgba(60,20,40,0.55)" />
              <circle cx="158" cy="160" r="11" fill="rgba(60,20,40,0.5)" />
            </svg>
          </button>
        </div>
        <nav className="menu-buttons" aria-label="Main menu">
          <button className="menu-btn" onClick={play} aria-keyshortcuts="P">
            <span>Play</span>
            <kbd>P</kbd>
          </button>
          <button className="menu-btn" disabled title="The beatmap editor is not part of this build yet." aria-describedby="edit-note">
            <span>Edit</span>
            <kbd>E</kbd>
          </button>
          <button className="menu-btn" onClick={options} aria-keyshortcuts="O">
            <span>Options</span>
            <kbd>O</kbd>
          </button>
          <button
            className="menu-btn"
            onClick={() => notify('Close this browser tab to leave bad!osu. Your library and scores stay saved on this device.', 'info')}
          >
            <span>Exit</span>
            <kbd>Close tab</kbd>
          </button>
          <p id="edit-note" className="note small">Edit is not included in this build. See the README for what is and is not implemented.</p>
        </nav>
      </div>

      <footer className="title-footer">
        <div className="profile panel">
          <div className="avatar" aria-hidden="true">G</div>
          <div>
            <div className="profile-name">Guest (local profile)</div>
            <div className="muted small">
              {connection === 'online' ? 'Signed-in online profiles are available.' : 'Offline. Accounts and online features are not available in this build.'}
            </div>
          </div>
        </div>
        <div className="status panel">
          <div className="small">
            Library: <strong>{sets.length}</strong> sets · <strong>{difficulties}</strong> difficulties
          </div>
          <div className="small muted">
            {lastScore ? `Last score: ${lastScore.score.toLocaleString()} · ${(lastScore.accuracy * 100).toFixed(2)}% · ${lastScore.title}` : 'No local scores yet.'}
          </div>
          <div className="small muted" title={connectionDetail}>
            {connection === 'online' ? 'Online' : 'Offline mode'}
          </div>
        </div>
        <div className="jukebox panel">
          <button className="ghost small" onClick={() => setJukebox((j) => !j)} aria-pressed={jukebox} aria-keyshortcuts="M">
            {jukebox ? 'Music: on' : 'Music: off'} <kbd>M</kbd>
          </button>
          <label className="small">
            Music
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.musicVolume}
              onChange={(e) => void updateSettings({ musicVolume: Number(e.target.value) })}
            />
          </label>
        </div>
        {settings.tipsEnabled && (
          <div className="tip small" role="note">
            <strong>Tip:</strong> {TIPS[tipIndex]}
          </div>
        )}
      </footer>
    </div>
  );
}
