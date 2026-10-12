/**
 * Locally recorded replay format.
 *
 * A replay is a flat, time-ordered log of ruleset inputs:
 *   events = [t0, kind0, a0, b0, t1, kind1, a1, b1, ...]
 *   kind 0 = pointer move (a = x, b = y in playfield pixels)
 *   kind 1 = button state (a = bitmask, b unused)
 *   kind 2 = frame tick (time advance only)
 * Playing the log back through the same ruleset reproduces the score. This is NOT the official
 * osu! .osr format; replays are flagged `source: 'local'` and are never treated as officially verified.
 */
import type { ModId } from '../core/mods';
import { ALL_MOD_IDS } from '../core/mods';

export const REPLAY_FORMAT = 'badosu-replay';
export const REPLAY_VERSION = 1;
export const MAX_REPLAY_EVENTS = 2_000_000;

export interface ReplayData {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  mode: number;
  source: 'local';
  beatmap: { hash: string; fileName: string; title: string; version: string; artist: string };
  mods: ModId[];
  rate: number;
  audioOffsetMs: number;
  recordedAt: number;
  events: number[];
  /** Claimed result, re-verified during playback. */
  claimed: { score: number; maxCombo: number; accuracy: number; passed: boolean };
}

export class ReplayError extends Error {}

/** Validate untrusted replay data before playback or import. Throws ReplayError with a user-facing message. */
export function validateReplay(raw: unknown): ReplayData {
  if (!raw || typeof raw !== 'object') throw new ReplayError('Replay is not an object.');
  const r = raw as Partial<ReplayData>;
  if (r.format !== REPLAY_FORMAT) throw new ReplayError('Unknown replay format.');
  if (r.version !== REPLAY_VERSION) throw new ReplayError(`Unsupported replay version ${String(r.version)}.`);
  if (r.mode !== 0) throw new ReplayError('Only osu!standard replays are supported.');
  if (!Array.isArray(r.events)) throw new ReplayError('Replay has no event list.');
  if (r.events.length % 4 !== 0) throw new ReplayError('Replay event list is truncated.');
  if (r.events.length / 4 > MAX_REPLAY_EVENTS) throw new ReplayError('Replay is too long.');
  for (let i = 0; i < r.events.length; i += 4) {
    const t = r.events[i];
    const kind = r.events[i + 1];
    const a = r.events[i + 2];
    const b = r.events[i + 3];
    if (![t, kind, a, b].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new ReplayError(`Non-numeric event at index ${i / 4}.`);
    if (t < -60_000 || t > 24 * 3600_000) throw new ReplayError(`Event time out of range at index ${i / 4}.`);
    if (kind === 0) {
      if (a < -2000 || a > 4000 || b < -2000 || b > 4000) throw new ReplayError(`Pointer out of range at index ${i / 4}.`);
    } else if (kind === 1) {
      if (!Number.isInteger(a) || a < 0 || a > 15) throw new ReplayError(`Invalid button mask at index ${i / 4}.`);
    } else if (kind !== 2) throw new ReplayError(`Unknown event kind ${kind} at index ${i / 4}.`);
  }
  if (!r.beatmap || typeof r.beatmap.hash !== 'string' || typeof r.beatmap.fileName !== 'string') {
    throw new ReplayError('Replay has no beatmap identity.');
  }
  if (!Array.isArray(r.mods) || !r.mods.every((m) => ALL_MOD_IDS.includes(m as ModId))) throw new ReplayError('Replay contains unknown mods.');
  if (typeof r.rate !== 'number' || !(r.rate > 0.5 && r.rate < 2)) throw new ReplayError('Replay has an invalid playback rate.');
  if (!r.claimed || typeof r.claimed.score !== 'number') throw new ReplayError('Replay has no claimed result.');
  return { ...(r as ReplayData), source: 'local' };
}

/** Encode a replay for export (JSON file). */
export function serializeReplay(r: ReplayData): string {
  return JSON.stringify(r);
}

export function parseReplayFile(text: string): ReplayData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReplayError('Replay file is not valid JSON.');
  }
  return validateReplay(data);
}
