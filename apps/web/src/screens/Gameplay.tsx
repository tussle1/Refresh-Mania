import { useEffect, useRef, useState } from 'react';
import { useApp, type GameLaunch, type ResultPayload } from '../app/AppContext';
import { GameSession, type SessionResult } from '../gameplay/session';
import { StandardRenderer } from '../gameplay/rendering/standardRenderer';
import { audioEngine, AudioLoadError } from '../gameplay/audio/audioEngine';
import { normalizeMods, STANDARD_MODS } from '../gameplay/core/mods';
import type { ParsedBeatmap } from '../beatmaps/types';

type Overlay = 'none' | 'paused' | 'resuming' | 'failed' | 'loading' | 'error';

const MASK_LEFT = 4;
const MASK_RIGHT = 8;

export function Gameplay({ launch }: { launch: GameLaunch }) {
  const { sets, settings, saveScore, replaceTop, back, notify } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const rendererRef = useRef<StandardRenderer | null>(null);
  const maskRef = useRef(0);
  const overlayRef = useRef<Overlay>('loading');
  const [overlay, setOverlay] = useState<Overlay>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [title, setTitle] = useState('');
  const [failText, setFailText] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const failRef = useRef<ResultPayload | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const isReplay = !!launch.replay;

  const setOv = (o: Overlay) => {
    overlayRef.current = o;
    setOverlay(o);
  };

  // (Re)create the session, renderer and audio for each attempt.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let session: GameSession | null = null;
    let renderer: StandardRenderer | null = null;
    let bgUrl: string | null = null;
    finishedRef.current = false;
    setFailText(null);
    setOv('loading');

    const set = sets.find((s) => s.hash === launch.hash);
    const difficulty = set?.difficulties.find((d) => d.fileName === launch.fileName);
    if (!set || !difficulty) {
      setErrorText('This beatmap is no longer in your library.');
      setOv('error');
      return;
    }
    const parsed: ParsedBeatmap = difficulty.parsed;
    if (launch.replay && (launch.replay.beatmap.hash !== launch.hash || launch.replay.beatmap.fileName !== launch.fileName)) {
      setErrorText('This replay was recorded on a different beatmap.');
      setOv('error');
      return;
    }
    const titleText = `${parsed.metadata.artistUnicode || parsed.metadata.artist} – ${parsed.metadata.titleUnicode || parsed.metadata.title} [${parsed.metadata.version}]`;
    setTitle(titleText);

    (async () => {
      let buffer: AudioBuffer | null = null;
      const audioBlob = set.assets[parsed.audioFilename.toLowerCase()];
      if (audioBlob) {
        try {
          buffer = await audioEngine.decode(audioBlob, parsed.audioFilename);
        } catch (e) {
          const msg = e instanceof AudioLoadError ? e.message : 'Audio failed to load.';
          if (!cancelled) setAudioNote(`${msg} Playing without music; timing still runs on the chart clock.`);
        }
      } else {
        setAudioNote(`Audio file "${parsed.audioFilename}" is missing from the archive. Playing silently.`);
      }
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        session = new GameSession({
          parsed,
          beatmapHash: launch.hash,
          fileName: launch.fileName,
          mods: isReplay ? launch.replay!.mods : normalizeMods(launch.mods),
          audioBuffer: buffer,
          audioOffsetMs: settingsRef.current.audioOffsetMs,
          hitsounds: true,
          replay: launch.replay,
          onEnd: (r) => handleEnd(r),
        });
        sessionRef.current = session;
        renderer = new StandardRenderer(canvas, session, rendererOptions());
        rendererRef.current = renderer;
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : 'Could not start the play.');
        setOv('error');
        return;
      }
      const bg = parsed.backgroundFilename ? set.assets[parsed.backgroundFilename.toLowerCase()] : undefined;
      if (bg) {
        bgUrl = URL.createObjectURL(bg);
        const img = new Image();
        img.src = bgUrl;
        img.onload = () => renderer?.setBackground(img);
      }
      audioEngine.stopJukebox();
      session.start();
      setOv('none');
      if (isReplay) notify('Replay playback started. Space pauses.', 'info');

      let lastCountdown = -1;
      const loop = () => {
        if (!session || !renderer) return;
        if (session.isEnded) return;
        session.frame();
        const phase = session.phase;
        const ov = overlayRef.current;
        if (phase === 'resuming') {
          const rem = Math.ceil(session.resumeRemainingMs / 1000);
          if (rem !== lastCountdown) {
            lastCountdown = rem;
            setCountdown(rem);
          }
          if (ov !== 'resuming') setOv('resuming');
        } else if (phase === 'running' && (ov === 'resuming' || ov === 'paused')) {
          setOv('none');
        }
        renderer.draw(session.chartTime);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    function handleEnd(r: SessionResult) {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (!r.passed && failTextFromSettings(r)) setFailText(failTextFromSettings(r));
      if (isReplay) {
        // Replays are not saved again; go straight to the results of the recorded play.
        notify('Replay finished.', 'info');
        const payload: ResultPayload = { launch, title: titleText, result: r, scoreId: null, bestBefore: null, previous: [] };
        replaceTop({ name: 'results', payload });
        return;
      }
      void (async () => {
        const saved = await saveScore(launch, r);
        const bestBefore = saved.previous.length ? Math.max(...saved.previous.map((s) => s.score)) : null;
        const payload: ResultPayload = { launch, title: titleText, result: r, scoreId: saved.scoreId, bestBefore, previous: saved.previous };
        if (r.passed) replaceTop({ name: 'results', payload });
        else {
          // Failed: offer the fail screen; the play is already saved locally.
          failRef.current = payload;
          setOv('failed');
        }
      })();
    }

    failRef.current = null;

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      session?.pause();
      audioEngine.stopMusic();
      renderer?.dispose();
      rendererRef.current = null;
      sessionRef.current = null;
      if (bgUrl) URL.revokeObjectURL(bgUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function rendererOptions() {
    const s = settingsRef.current;
    return {
      backgroundDim: s.backgroundDim,
      cursorSize: s.cursorSize,
      cursorTrail: s.cursorTrail,
      trailLength: s.trailLength,
      cursorSmoothing: s.cursorSmoothing,
      hitErrorMeter: s.showHitErrorMeter,
      reducedMotion: s.reducedMotion,
    };
  }

  // Live settings changes apply to the running renderer.
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.options = rendererOptions();
  }, [settings]);

  // Pause on focus loss.
  useEffect(() => {
    if (isReplay) return;
    const pause = () => {
      if (sessionRef.current?.phase === 'running') pauseNow();
    };
    const onVis = () => {
      if (document.hidden) pause();
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay]);

  // Keyboard: hit keys, pause and restart.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        if (isReplay) return back();
        if (session.phase === 'running') pauseNow();
        else if (session.phase === 'paused') resumeNow();
        return;
      }
      if (isReplay) {
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          if (session.phase === 'running') pauseNow();
          else if (session.phase === 'paused') resumeNow();
        }
        return;
      }
      if (session.phase === 'paused' || session.phase === 'resuming') {
        if (e.key.toLowerCase() === 'r' && !e.repeat) restartNow();
        return;
      }
      const s = settingsRef.current;
      const bit = e.code === s.keyK1 ? 1 : e.code === s.keyK2 ? 2 : 0;
      if (!bit || e.repeat) return;
      e.preventDefault();
      maskRef.current |= bit;
      session.buttons(e.timeStamp, maskRef.current);
    };
    const up = (e: KeyboardEvent) => {
      const session = sessionRef.current;
      if (!session || isReplay) return;
      const s = settingsRef.current;
      const bit = e.code === s.keyK1 ? 1 : e.code === s.keyK2 ? 2 : 0;
      if (!bit) return;
      maskRef.current &= ~bit;
      session.buttons(e.timeStamp, maskRef.current);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay]);

  function pauseNow() {
    const s = sessionRef.current;
    if (!s) return;
    maskRef.current = 0;
    s.pause();
    setOv('paused');
  }
  function resumeNow() {
    const s = sessionRef.current;
    if (!s) return;
    s.resume();
    setOv('resuming');
  }
  function restartNow() {
    setAttempt((a) => a + 1);
  }

  // Pointer input: coalesced events keep high-polling mice smooth. Each event carries its own timestamp.
  const feedPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const session = sessionRef.current;
    const renderer = rendererRef.current;
    if (!session || !renderer || isReplay) return;
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const list = native.getCoalescedEvents ? native.getCoalescedEvents() : [native];
    for (const ev of list.length ? list : [native]) {
      const p = renderer.clientToPlayfield(ev.clientX, ev.clientY);
      session.pointerMove(ev.timeStamp, p.x, p.y);
    }
  };

  return (
    <div className="gameplay" onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        className="play-canvas"
        role="application"
        aria-label={`Playfield for ${title || 'beatmap'}. Use ${settings.keyK1.replace('Key', '')} and ${settings.keyK2.replace('Key', '')} or the mouse buttons to hit.`}
        tabIndex={0}
        onPointerMove={feedPointer}
        onPointerDown={(e) => {
          const session = sessionRef.current;
          const renderer = rendererRef.current;
          if (!session || !renderer || isReplay || session.phase !== 'running') return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          feedPointer(e);
          const bit = e.button === 0 ? MASK_LEFT : e.button === 2 ? MASK_RIGHT : 0;
          if (!bit) return;
          maskRef.current |= bit;
          session.buttons(e.timeStamp, maskRef.current);
        }}
        onPointerUp={(e) => {
          const session = sessionRef.current;
          if (!session || isReplay) return;
          const bit = e.button === 0 ? MASK_LEFT : e.button === 2 ? MASK_RIGHT : 0;
          if (!bit) return;
          maskRef.current &= ~bit;
          session.buttons(e.timeStamp, maskRef.current);
        }}
        onLostPointerCapture={(e) => {
          const session = sessionRef.current;
          if (!session || isReplay) return;
          maskRef.current &= ~(MASK_LEFT | MASK_RIGHT);
          session.buttons(e.timeStamp, maskRef.current);
        }}
      />
      {overlay === 'loading' && <div className="play-note">Loading {title || 'beatmap'}…</div>}
      {audioNote && overlay !== 'error' && <div className="play-note warn">{audioNote}</div>}
      {isReplay && overlay !== 'error' && <div className="replay-badge">Replay · {launch.replay ? 'local recording' : ''}</div>}

      {overlay === 'error' && (
        <div className="overlay">
          <div className="panel modal">
            <h2>Could not start</h2>
            <p>{errorText}</p>
            <button className="primary" onClick={() => back()}>
              Back
            </button>
          </div>
        </div>
      )}

      {overlay === 'paused' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <div className="panel modal pause-menu">
            <h2>Paused</h2>
            <p className="muted small">{title}</p>
            <div className="modal-actions column">
              <button className="primary big" onClick={resumeNow} autoFocus>
                Resume <kbd>Esc</kbd>
              </button>
              {!isReplay && (
                <button onClick={restartNow}>
                  Retry <kbd>R</kbd>
                </button>
              )}
              <button
                onClick={() => {
                  sessionRef.current?.finish(false);
                }}
              >
                Give up (save as failed)
              </button>
              <button className="ghost" onClick={() => back()}>
                Quit to song select
              </button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'resuming' && (
        <div className="resume-count" aria-live="assertive">
          {countdown > 0 ? countdown : 'Go'}
        </div>
      )}

      {overlay === 'failed' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Failed">
          <div className="panel modal fail-menu">
            <h2>Failed</h2>
            <p className="muted small">{failText ?? 'Your health reached zero. The play was saved as failed on this device.'}</p>
            <div className="modal-actions column">
              <button className="primary big" onClick={restartNow} autoFocus>
                Retry <kbd>R</kbd>
              </button>
              <button
                onClick={() => {
                  const p = failRef.current;
                  if (p) replaceTop({ name: 'results', payload: p });
                  else back();
                }}
              >
                View results
              </button>
              <button className="ghost" onClick={() => back()}>
                Back to song select
              </button>
            </div>
          </div>
        </div>
      )}
      {!isReplay && overlay === 'none' && (
        <div className="hint-strip small">Esc pauses · {settings.keyK1.replace('Key', '')} / {settings.keyK2.replace('Key', '')} or mouse buttons hit</div>
      )}
      {launch.mods.length > 0 && <div className="mods-badge small">{launch.mods.map((m) => STANDARD_MODS[m].name).join(' · ')}</div>}
    </div>
  );
}

function failTextFromSettings(r: SessionResult): string | null {
  return r.settings.suddenDeath ? 'Sudden Death: a single miss ended the play.' : 'Your health reached zero.';
}

