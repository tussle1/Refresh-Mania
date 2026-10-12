import { useApp } from '../app/AppContext';
import { DEFAULT_SETTINGS, type Settings } from '../storage/settings';
import { useEffect, useState } from 'react';
import { audioEngine } from '../gameplay/audio/audioEngine';

type Section = 'audio' | 'input' | 'gameplay' | 'cursor' | 'graphics' | 'interface' | 'online';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'input', label: 'Input' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'interface', label: 'Interface' },
  { id: 'online', label: 'Online' },
];

const keyLabel = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '');

export function Options() {
  const { settings, updateSettings, back, connection, connectionDetail, notify } = useApp();
  const [section, setSection] = useState<Section>('audio');
  const [capturing, setCapturing] = useState<null | 'keyK1' | 'keyK2'>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState<string[]>([]);

  const set = (p: Partial<Settings>) => void updateSettings(p);

  // Key capture for bindings.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setCapturing(null);
        return;
      }
      const ok = /^(Key[A-Z]|Digit[0-9]|Semicolon|Quote|Comma|Period|Slash|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash)$/.test(e.code);
      if (!ok) {
        notify('That key cannot be used for hitting. Try a letter or number.', 'warn');
        return;
      }
      set({ [capturing]: e.code } as Partial<Settings>);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  // Input test: shows the pointer and the currently held hit keys.
  useEffect(() => {
    if (section !== 'input') return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      setPressed((p) => (p.includes(e.code) ? p : [...p, e.code]));
    };
    const up = (e: KeyboardEvent) => setPressed((p) => p.filter((c) => c !== e.code));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturing) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, capturing]);

  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="setting-row">
      <div>
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div>{control}</div>
    </div>
  );

  const slider = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <div className="slider-control">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        aria-label={String(key)}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Settings>)}
      />
      <span className="mono small">{fmt(settings[key] as number)}</span>
    </div>
  );

  const toggle = (key: keyof Settings, label: string) => (
    <label className="switch">
      <input type="checkbox" checked={settings[key] as boolean} onChange={(e) => set({ [key]: e.target.checked } as Partial<Settings>)} />
      <span>{label}</span>
    </label>
  );

  return (
    <section className="options" aria-labelledby="options-title">
      <aside className="options-nav panel">
        <h1 id="options-title">Options</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`nav-item ${section === s.id ? 'active' : ''}`} onClick={() => setSection(s.id)} aria-current={section === s.id}>
            {s.label}
          </button>
        ))}
        <button className="ghost" onClick={() => {
          const keep = { lastBeatmapHash: settings.lastBeatmapHash, lastDifficultyFile: settings.lastDifficultyFile };
          void updateSettings({ ...DEFAULT_SETTINGS, ...keep, lastMods: settings.lastMods });
          notify('Settings reset to defaults.', 'success');
        }}>
          Reset to defaults
        </button>
        <button className="primary" onClick={back}>
          Back <kbd>Esc</kbd>
        </button>
      </aside>
      <div className="options-body panel">
        {section === 'audio' && (
          <>
            <h2>Audio</h2>
            {row('Master volume', slider('masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`))}
            {row('Music volume', slider('musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`))}
            {row('Effects volume', slider('effectsVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), 'Hitsounds and menu effects.')}
            {row('Preview volume', slider('previewVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), 'Song-select previews.')}
            {row('Audio offset', slider('audioOffsetMs', -250, 250, 1, (v) => `${v} ms`), 'Positive values register hits earlier, compensating for output latency.')}
            {row('Mute everything', toggle('muted', 'Muted'))}
            {row('Test sound', <button onClick={() => { audioEngine.ensure(); audioEngine.playHitsound('great'); }}>Play hitsound</button>)}
          </>
        )}
        {section === 'input' && (
          <>
            <h2>Input</h2>
            {row(
              'Hit key 1 (K1)',
              <button onClick={() => setCapturing(capturing === 'keyK1' ? null : 'keyK1')}>
                {capturing === 'keyK1' ? 'Press a key… (Esc cancels)' : keyLabel(settings.keyK1)}
              </button>,
              'Left mouse button is always a hit key.',
            )}
            {row(
              'Hit key 2 (K2)',
              <button onClick={() => setCapturing(capturing === 'keyK2' ? null : 'keyK2')}>
                {capturing === 'keyK2' ? 'Press a key… (Esc cancels)' : keyLabel(settings.keyK2)}
              </button>,
              'Right mouse button is always a hit key.',
            )}
            <h3>Input test</h3>
            <div
              className="input-test"
              onPointerMove={(e) => setPointer({ x: Math.round(e.clientX), y: Math.round(e.clientY) })}
              onPointerDown={(e) => setPointer({ x: Math.round(e.clientX), y: Math.round(e.clientY) })}
            >
              {pointer ? `Pointer ${pointer.x}, ${pointer.y}` : 'Move the pointer here'}
            </div>
            <div className="small">Held keys: {pressed.length ? pressed.map(keyLabel).join(', ') : 'none'}</div>
          </>
        )}
        {section === 'gameplay' && (
          <>
            <h2>Gameplay</h2>
            {row('Background dim', slider('backgroundDim', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`))}
            {row('Hit error meter', toggle('showHitErrorMeter', 'Show below the playfield'))}
          </>
        )}
        {section === 'cursor' && (
          <>
            <h2>Cursor</h2>
            {row('Cursor size', slider('cursorSize', 0.5, 2, 0.05, (v) => `${v.toFixed(2)}×`))}
            {row('Cursor trail', toggle('cursorTrail', 'Show trail'))}
            {row('Trail length', slider('trailLength', 4, 64, 1, (v) => `${v}`))}
            {row('Cursor smoothing', slider('cursorSmoothing', 0, 1, 0.05, (v) => (v === 0 ? 'Raw' : `${Math.round(v * 100)}%`)), 'Visual only. Hits always use the unsmoothed pointer position.')}
          </>
        )}
        {section === 'graphics' && (
          <>
            <h2>Graphics</h2>
            {row('Reduced motion', toggle('reducedMotion', 'Reduce animations'), 'Shortens or removes non-essential animations.')}
            {row('Menu visualizer', toggle('menuParticles', 'Show visualizer bars on the title screen'))}
            <p className="muted small">The gameplay canvas scales to the window and device pixel ratio (up to 3×).</p>
          </>
        )}
        {section === 'interface' && (
          <>
            <h2>Interface</h2>
            {row('UI scale', slider('uiScale', 0.8, 1.25, 0.05, (v) => `${Math.round(v * 100)}%`))}
            {row('Theme', (
              <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            ))}
            {row('Tips on the title screen', toggle('tipsEnabled', 'Show rotating tips'))}
          </>
        )}
        {section === 'online' && (
          <>
            <h2>Online</h2>
            <div className="setting-row">
              <div>Connection</div>
              <div>
                <strong>{connection === 'online' ? 'Connected' : 'Offline'}</strong>
                <div className="muted small">{connectionDetail}</div>
              </div>
            </div>
            <p className="muted small">
              Accounts, online leaderboards, friends, chat, presence and multiplayer require the bad!osu server. This build ships the offline client only, so these options are not yet available.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
