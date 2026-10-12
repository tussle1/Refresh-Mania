import { createContext, useContext } from 'react';
import type { LocalStore, BeatmapSetRecord, ScoreRecord } from '../storage/db';
import type { Settings } from '../storage/settings';
import type { ModId } from '../gameplay/core/mods';
import type { ReplayData } from '../gameplay/replay/replay';
import type { SessionResult } from '../gameplay/session';

export type ConnectionState = 'checking' | 'offline' | 'online';

export interface GameLaunch {
  hash: string;
  fileName: string;
  mods: ModId[];
  replay?: ReplayData;
}

export interface ResultPayload {
  launch: GameLaunch;
  /** Display title, e.g. "Artist - Title [Difficulty]". */
  title: string;
  result: SessionResult;
  scoreId: string | null;
  bestBefore: number | null;
  /** Previous local scores for this difficulty (for the comparison list). */
  previous: ScoreRecord[];
}

export type Screen =
  | { name: 'menu' }
  | { name: 'play' }
  | { name: 'select' }
  | { name: 'options' }
  | { name: 'game'; launch: GameLaunch }
  | { name: 'results'; payload: ResultPayload };

export interface AppContextValue {
  store: LocalStore | null;
  storeError: string | null;
  settings: Settings;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  sets: BeatmapSetRecord[];
  scores: ScoreRecord[];
  favorites: Set<string>;
  refreshLibrary: () => Promise<void>;
  refreshScores: () => Promise<void>;
  setFavorite: (hash: string, favorite: boolean) => Promise<void>;
  notify: (message: string, kind?: 'info' | 'success' | 'warn' | 'error') => void;
  screen: Screen;
  go: (s: Screen) => void;
  reset: (s: Screen) => void;
  replaceTop: (s: Screen) => void;
  back: () => void;
  connection: ConnectionState;
  reconnect: () => void;
  connectionDetail: string;
  openShortcuts: () => void;
  saveScore: (launch: GameLaunch, result: SessionResult) => Promise<{ scoreId: string | null; previous: ScoreRecord[] }>;
  getAssets: (hash: string) => BeatmapSetRecord['assets'] | undefined;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside <App>');
  return v;
}
