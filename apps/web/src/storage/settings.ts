import type { ModId } from '../gameplay/core/mods';

/** User settings persisted locally. Every value is validated on load and on save. */
export interface Settings {
  musicVolume: number; // 0..1
  effectsVolume: number; // 0..1
  previewVolume: number; // 0..1
  masterVolume: number; // 0..1
  muted: boolean;
  /** Audio output offset in ms (positive = input is registered earlier). -250..250 */
  audioOffsetMs: number;
  /** Keys for hit buttons (KeyboardEvent.code). */
  keyK1: string;
  keyK2: string;
  cursorSize: number; // 0.5..2
  cursorTrail: boolean;
  trailLength: number; // 4..64
  cursorSmoothing: number; // 0 = raw, 1 = heavy smoothing (visual only)
  backgroundDim: number; // 0..1
  showHitErrorMeter: boolean;
  reducedMotion: boolean;
  menuParticles: boolean;
  playfieldFollowMouse: boolean;
  lastMods: ModId[];
  selectedMode: 'solo' | 'multiplayer';
  sort: 'title' | 'artist' | 'creator' | 'bpm' | 'length' | 'added' | 'difficulty';
  modeFilter: 'all' | 'standard';
  onlySelectedSet: boolean;
  lastBeatmapHash: string | null;
  lastDifficultyFile: string | null;
  tipsEnabled: boolean;
  chatVisible: boolean;
  theme: 'dark' | 'light';
  uiScale: number; // 0.8..1.25
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.6,
  effectsVolume: 0.7,
  previewVolume: 0.5,
  masterVolume: 1,
  muted: false,
  audioOffsetMs: 0,
  keyK1: 'KeyZ',
  keyK2: 'KeyX',
  cursorSize: 1,
  cursorTrail: true,
  trailLength: 24,
  cursorSmoothing: 0,
  backgroundDim: 0.6,
  showHitErrorMeter: true,
  reducedMotion: false,
  menuParticles: true,
  playfieldFollowMouse: false,
  lastMods: [],
  selectedMode: 'solo',
  sort: 'title',
  modeFilter: 'all',
  onlySelectedSet: false,
  lastBeatmapHash: null,
  lastDifficultyFile: null,
  tipsEnabled: true,
  chatVisible: true,
  theme: 'dark',
  uiScale: 1,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string, allowed?: readonly string[]) =>
  typeof v === 'string' && v.length <= 64 && (!allowed || allowed.includes(v)) ? v : fallback;
const KEY_RE = /^(Key[A-Z]|Digit[0-9]|Semicolon|Quote|Comma|Period|Slash|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash)$/;

/** Validate an untrusted settings object, falling back to defaults for any invalid value. */
export function validateSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const modIds = ['EZ', 'NF', 'HT', 'DT', 'HR', 'SD', 'HD'];
  const lastMods = Array.isArray(r.lastMods) ? r.lastMods.filter((m): m is ModId => typeof m === 'string' && modIds.includes(m)) : d.lastMods;
  const sorts = ['title', 'artist', 'creator', 'bpm', 'length', 'added', 'difficulty'] as const;
  return {
    musicVolume: num(r.musicVolume, 0, 1, d.musicVolume),
    effectsVolume: num(r.effectsVolume, 0, 1, d.effectsVolume),
    previewVolume: num(r.previewVolume, 0, 1, d.previewVolume),
    masterVolume: num(r.masterVolume, 0, 1, d.masterVolume),
    muted: bool(r.muted, d.muted),
    audioOffsetMs: Math.round(num(r.audioOffsetMs, -250, 250, d.audioOffsetMs)),
    keyK1: typeof r.keyK1 === 'string' && KEY_RE.test(r.keyK1) ? r.keyK1 : d.keyK1,
    keyK2: typeof r.keyK2 === 'string' && KEY_RE.test(r.keyK2) ? r.keyK2 : d.keyK2,
    cursorSize: num(r.cursorSize, 0.5, 2, d.cursorSize),
    cursorTrail: bool(r.cursorTrail, d.cursorTrail),
    trailLength: Math.round(num(r.trailLength, 4, 64, d.trailLength)),
    cursorSmoothing: num(r.cursorSmoothing, 0, 1, d.cursorSmoothing),
    backgroundDim: num(r.backgroundDim, 0, 1, d.backgroundDim),
    showHitErrorMeter: bool(r.showHitErrorMeter, d.showHitErrorMeter),
    reducedMotion: bool(r.reducedMotion, d.reducedMotion),
    menuParticles: bool(r.menuParticles, d.menuParticles),
    playfieldFollowMouse: bool(r.playfieldFollowMouse, d.playfieldFollowMouse),
    lastMods,
    selectedMode: str(r.selectedMode, d.selectedMode, ['solo', 'multiplayer']) as Settings['selectedMode'],
    sort: str(r.sort, d.sort, sorts) as Settings['sort'],
    modeFilter: str(r.modeFilter, d.modeFilter, ['all', 'standard']) as Settings['modeFilter'],
    onlySelectedSet: bool(r.onlySelectedSet, d.onlySelectedSet),
    lastBeatmapHash: typeof r.lastBeatmapHash === 'string' ? r.lastBeatmapHash : null,
    lastDifficultyFile: typeof r.lastDifficultyFile === 'string' ? r.lastDifficultyFile : null,
    tipsEnabled: bool(r.tipsEnabled, d.tipsEnabled),
    chatVisible: bool(r.chatVisible, d.chatVisible),
    theme: str(r.theme, d.theme, ['dark', 'light']) as Settings['theme'],
    uiScale: num(r.uiScale, 0.8, 1.25, d.uiScale),
  };
}
