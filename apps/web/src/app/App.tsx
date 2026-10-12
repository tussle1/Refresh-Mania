import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext, type AppContextValue, type ConnectionState, type GameLaunch, type Screen } from './AppContext';
import { LocalStore, type BeatmapSetRecord, type ScoreRecord } from '../storage/db';
import { DEFAULT_SETTINGS, type Settings } from '../storage/settings';
import { gradeFor } from '../gameplay/scoring/score';
import type { SessionResult } from '../gameplay/session';
import { audioEngine } from '../gameplay/audio/audioEngine';
import { MainMenu } from '../screens/MainMenu';
import { PlayMenu } from '../screens/PlayMenu';
import { SongSelect } from '../screens/SongSelect';
import { Options } from '../screens/Options';
import { Gameplay } from '../screens/Gameplay';
import { Results } from '../screens/Results';
import { ShortcutsModal } from '../components/ShortcutsModal';
import { Toasts, type Toast } from '../components/Toasts';
import { BootScreen } from '../components/BootScreen';
import { ConnectionBadge } from '../components/ConnectionBadge';

const CONNECTION_DETAIL_OFFLINE =
  'No online server is configured in this build. Local play, library and scores work fully offline.';

const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function App() {
  const [store, setStore] = useState<LocalStore | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sets, setSets] = useState<BeatmapSetRecord[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ name: 'menu' }]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [connectionDetail, setConnectionDetail] = useState('Checking for an online server…');
  const setsRef = useRef<BeatmapSetRecord[]>([]);
  setsRef.current = sets;

  const screen = stack[stack.length - 1];

  const notify = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = randomId();
    setToasts((t) => [...t.slice(-4), { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!store) return;
    setSets(await store.listSets());
  }, [store]);

  const refreshScores = useCallback(async () => {
    if (!store) return;
    setScores(await store.allScores(1000));
  }, [store]);

  // Boot: open the local database, then load settings, library, scores and favorites.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await LocalStore.open();
        if (cancelled) return;
        setStore(s);
        const [st, lib, sc, fav] = await Promise.all([s.loadSettings(), s.listSets(), s.allScores(1000), s.favorites()]);
        if (cancelled) return;
        setSettings(st);
        setSets(lib);
        setScores(sc);
        setFavorites(fav);
      } catch (e) {
        if (!cancelled) setStoreError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Connection probe. The backend API is not part of this build, so a missing /api/health means offline.
  const probe = useCallback(async () => {
    setConnection('checking');
    setConnectionDetail('Checking for an online server…');
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch('/api/health', { signal: ctrl.signal, headers: { accept: 'application/json' } });
      window.clearTimeout(timer);
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.includes('application/json')) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok) {
          setConnection('online');
          setConnectionDetail('Connected to the bad!osu server.');
          return;
        }
      }
      setConnection('offline');
      setConnectionDetail(CONNECTION_DETAIL_OFFLINE);
    } catch {
      setConnection('offline');
      setConnectionDetail(CONNECTION_DETAIL_OFFLINE);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // Apply UI settings to the document.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(settings.uiScale));
    root.dataset.theme = settings.theme;
    root.classList.toggle('reduced-motion', settings.reducedMotion);
    audioEngine.setVolumes({
      master: settings.masterVolume,
      music: settings.musicVolume,
      effects: settings.effectsVolume,
      preview: settings.previewVolume,
      muted: settings.muted,
    });
  }, [settings]);

  const updateSettings = useCallback(
    async (partial: Partial<Settings>) => {
      if (!store) {
        setSettings((s) => ({ ...s, ...partial }));
        return;
      }
      const next = await store.saveSettings(partial);
      setSettings(next);
    },
    [store],
  );

  const setFavorite = useCallback(
    async (hash: string, favorite: boolean) => {
      if (!store) return;
      await store.setFavorite(hash, favorite);
      setFavorites((f) => {
        const n = new Set(f);
        if (favorite) n.add(hash);
        else n.delete(hash);
        return n;
      });
    },
    [store],
  );

  const go = useCallback((s: Screen) => setStack((st) => [...st, s]), []);
  const reset = useCallback((s: Screen) => setStack([{ name: 'menu' }, s]), []);
  const replaceTop = useCallback((s: Screen) => setStack((st) => [...st.slice(0, -1), s]), []);
  const back = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);

  const saveScore = useCallback(
    async (launch: GameLaunch, result: SessionResult) => {
      const key = `${launch.hash}/${launch.fileName}`;
      const set = setsRef.current.find((s) => s.hash === launch.hash);
      const diff = set?.difficulties.find((d) => d.fileName === launch.fileName);
      const previous = store ? await store.scoresFor(key) : [];
      if (!store || !set || !diff) return { scoreId: null, previous };
      const snap = result.snapshot;
      const total = snap.objectCount;
      const id = randomId();
      const ranked = result.settings.ranked;
      const record: ScoreRecord = {
        id,
        difficultyKey: key,
        hash: launch.hash,
        fileName: launch.fileName,
        title: diff.parsed.metadata.titleUnicode || diff.parsed.metadata.title,
        version: diff.parsed.metadata.version,
        mode: diff.parsed.mode,
        score: snap.score,
        accuracy: snap.accuracy,
        maxCombo: snap.maxCombo,
        totalObjects: total,
        counts: snap.counts,
        followCounts: snap.followCounts,
        grade: gradeFor(snap.accuracy, snap.counts.miss, total),
        mods: launch.mods,
        rate: result.settings.rate,
        passed: result.passed,
        ranked,
        playedAt: Date.now(),
        replayId: result.replay ? id : null,
        progress: downsample(result.progress, 400),
        hitErrors: result.hitErrors.slice(0, 5000),
        durationMs: Math.round(result.durationMs),
        source: 'local',
      };
      await store.addScore(record, result.replay);
      await refreshScores();
      return { scoreId: id, previous };
    },
    [store, refreshScores],
  );

  const getAssets = useCallback((hash: string) => setsRef.current.find((s) => s.hash === hash)?.assets, []);

  const ctx: AppContextValue = useMemo(
    () => ({
      store,
      storeError,
      settings,
      updateSettings,
      sets,
      scores,
      favorites,
      refreshLibrary,
      refreshScores,
      setFavorite,
      notify,
      screen,
      go,
      reset,
      replaceTop,
      back,
      connection,
      reconnect: () => void probe(),
      connectionDetail,
      openShortcuts: () => setShortcutsOpen(true),
      saveScore,
      getAssets,
    }),
    [
      store,
      storeError,
      settings,
      updateSettings,
      sets,
      scores,
      favorites,
      refreshLibrary,
      refreshScores,
      setFavorite,
      notify,
      screen,
      go,
      reset,
      replaceTop,
      back,
      connection,
      probe,
      connectionDetail,
      saveScore,
      getAssets,
    ],
  );

  // Global shortcut: '?' opens the reference (never while typing or in gameplay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      if (e.key === '?' && screen.name !== 'game') setShortcutsOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen.name]);

  // Browsers only allow audio after a user gesture: enable it on the first pointer or key press.
  useEffect(() => {
    const unlock = () => {
      audioEngine.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (storeError) {
    return (
      <BootScreen
        title="Local storage unavailable"
        detail={`The browser refused to open the local database (${storeError}). Beatmap import and score saving need IndexedDB. If this is a private or incognito window, open the page in a normal window. Otherwise allow site data for this site, close other tabs of it, and try again.`}
        action={<button type="button" onClick={() => window.location.reload()}>Try again</button>}
      />
    );
  }
  if (!ready || !store) return <BootScreen title="bad!osu" detail="Opening local library…" />;

  let body: JSX.Element;
  switch (screen.name) {
    case 'menu':
      body = <MainMenu />;
      break;
    case 'play':
      body = <PlayMenu />;
      break;
    case 'select':
      body = <SongSelect />;
      break;
    case 'options':
      body = <Options />;
      break;
    case 'game':
      body = <Gameplay key={JSON.stringify(screen.launch) + stack.length} launch={screen.launch} />;
      break;
    case 'results':
      body = <Results payload={screen.payload} />;
      break;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app app-${screen.name}`}>
        {screen.name !== 'game' && (
          <header className="topbar">
            <div className="brand" aria-label="bad!osu">
              <span className="brand-mark" aria-hidden="true" />
              bad!osu
            </div>
            <nav className="crumbs" aria-label="Breadcrumb">
              {stack.map((s, i) => (
                <span key={i}>{i > 0 && <span className="crumb-sep">›</span>}{crumbLabel(s)}</span>
              ))}
            </nav>
            <ConnectionBadge state={connection} detail={connectionDetail} onReconnect={() => void probe()} />
            <button className="ghost small" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts (?)">
              ?
            </button>
          </header>
        )}
        <main className="screen" aria-live="polite">
          {body}
        </main>
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
        {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      </div>
    </AppContext.Provider>
  );
}

function crumbLabel(s: Screen): string {
  switch (s.name) {
    case 'menu':
      return 'Title';
    case 'play':
      return 'Play';
    case 'select':
      return 'Song select';
    case 'options':
      return 'Options';
    case 'game':
      return 'Playing';
    case 'results':
      return 'Results';
  }
}

/** Downsample progress samples evenly, keeping the first and last point. */
export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]);
  return out;
}
