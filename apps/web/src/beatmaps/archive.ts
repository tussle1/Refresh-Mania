import JSZip from 'jszip';
import { parseOsu, BeatmapParseError } from './parser';
import type { ParsedBeatmap } from './types';

export interface ImportedDifficulty {
  fileName: string;
  parsed: ParsedBeatmap;
}

export interface ImportedBeatmapSet {
  /** SHA-256 of the archive bytes (hex). Used for duplicate detection. */
  hash: string;
  title: string;
  artist: string;
  creator: string;
  beatmapSetId: number;
  difficulties: ImportedDifficulty[];
  /** All non-.osu files in the archive, keyed by lowercased archive-relative name. */
  assets: Map<string, Blob>;
  /** Warnings collected across all difficulties. */
  warnings: string[];
  /** Difficulties that failed to parse. */
  invalidFiles: { fileName: string; reason: string }[];
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/** Validate and read an .osz (zip) archive into a beatmap set. */
export async function importOsz(file: Blob, fileName: string): Promise<ImportedBeatmapSet> {
  if (!/\.osz$/i.test(fileName)) throw new BeatmapParseError(`"${fileName}" is not an .osz archive.`);
  if (file.size === 0) throw new BeatmapParseError('Archive is empty.');
  if (file.size > MAX_ARCHIVE_BYTES) throw new BeatmapParseError('Archive exceeds the 512 MB import limit.');
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new BeatmapParseError('Archive is not a valid zip file.');
  }
  const assets = new Map<string, Blob>();
  const osuEntries: { name: string; text: string }[] = [];
  const invalidFiles: { fileName: string; reason: string }[] = [];
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  // Reject path traversal and absolute paths.
  for (const entry of entries) {
    if (entry.name.includes('..') || entry.name.startsWith('/')) {
      throw new BeatmapParseError(`Archive contains an unsafe path: ${entry.name}`);
    }
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.osu')) {
      osuEntries.push({ name: entry.name, text: await entry.async('string') });
    } else {
      assets.set(lower, await entry.async('blob'));
    }
  }
  if (osuEntries.length === 0) throw new BeatmapParseError('Archive contains no .osu difficulties.');

  const difficulties: ImportedDifficulty[] = [];
  const warnings: string[] = [];
  for (const { name, text } of osuEntries) {
    try {
      const parsed = parseOsu(text);
      difficulties.push({ fileName: name, parsed });
      warnings.push(...parsed.warnings.map((w) => `${parsed.metadata.version || name}: ${w}`));
    } catch (e) {
      invalidFiles.push({ fileName: name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (difficulties.length === 0) throw new BeatmapParseError('No difficulty in the archive could be parsed.');
  const first = difficulties[0].parsed.metadata;
  return {
    hash,
    title: first.titleUnicode || first.title,
    artist: first.artistUnicode || first.artist,
    creator: first.creator,
    beatmapSetId: first.beatmapSetId,
    difficulties,
    assets,
    warnings,
    invalidFiles,
  };
}
