import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { importOsz } from '../src/beatmaps/archive';
import { BeatmapParseError } from '../src/beatmaps/parser';

const CHART = `osu file format v14
[General]
AudioFilename: a.mp3
Mode: 0
[Metadata]
Title:Zip Song
Artist:Zip Artist
Creator:Zip Mapper
Version:Insane
BeatmapSetID:77
[Difficulty]
CircleSize:4
OverallDifficulty:5
ApproachRate:5
[TimingPoints]
0,500,4,1,0,60,1,0
[HitObjects]
256,192,1000,1,0
`;

async function makeOsz(entries: Record<string, string | Uint8Array>): Promise<Blob> {
  const z = new JSZip();
  for (const [name, data] of Object.entries(entries)) z.file(name, data);
  const bytes = await z.generateAsync({ type: 'uint8array' });
  return new Blob([bytes as BlobPart]);
}

describe('.osz import', () => {
  it('reads difficulties, assets and metadata', async () => {
    const blob = await makeOsz({ 'easy.osu': CHART, 'a.mp3': 'fake-audio', 'bg.JPG': 'img' });
    const imp = await importOsz(blob, 'set.osz');
    expect(imp.title).toBe('Zip Song');
    expect(imp.artist).toBe('Zip Artist');
    expect(imp.beatmapSetId).toBe(77);
    expect(imp.difficulties).toHaveLength(1);
    expect(imp.difficulties[0].parsed.hitObjects).toHaveLength(1);
    expect(imp.assets.has('a.mp3')).toBe(true);
    expect(imp.assets.has('bg.jpg')).toBe(true); // asset names are case-folded for lookup
    expect(imp.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same hash for identical bytes (duplicate detection key)', async () => {
    const a = await importOsz(await makeOsz({ 'x.osu': CHART }), 'a.osz');
    const b = await importOsz(await makeOsz({ 'x.osu': CHART }), 'b.osz');
    expect(a.hash).toBe(b.hash);
  });

  it('reports invalid difficulties but keeps the valid ones', async () => {
    const imp = await importOsz(await makeOsz({ 'good.osu': CHART, 'bad.osu': 'nope' }), 'mixed.osz');
    expect(imp.difficulties).toHaveLength(1);
    expect(imp.invalidFiles.map((f) => f.fileName)).toEqual(['bad.osu']);
  });

  it('rejects archives with no playable difficulty', async () => {
    await expect(importOsz(await makeOsz({ 'bad.osu': 'nope' }), 'x.osz')).rejects.toBeInstanceOf(BeatmapParseError);
    await expect(importOsz(await makeOsz({ 'readme.txt': 'hi' }), 'x.osz')).rejects.toBeInstanceOf(BeatmapParseError);
  });

  it('rejects non-zip data and unsafe paths', async () => {
    await expect(importOsz(new Blob(['not a zip']), 'x.osz')).rejects.toThrow(/zip/);
    // Traversal names are stripped by the zip reader, so nothing can escape the library directory.
    // The importer also rejects any '..' name that reaches it (defence in depth).
    const bytes = new Uint8Array(await (await makeOsz({ 'AAAAAAAAAAAA': CHART, 'k.osu': CHART })).arrayBuffer());
    const needle = new TextEncoder().encode('AAAAAAAAAAAA');
    const repl = new TextEncoder().encode('../evil.osu.');
    for (let i = 0; i + needle.length <= bytes.length; i++) {
      if (needle.every((b, k) => bytes[i + k] === b)) bytes.set(repl, i);
    }
    const imp = await importOsz(new Blob([bytes as BlobPart]), 'x.osz');
    expect([...imp.assets.keys()].every((k) => !k.includes('..') && !k.startsWith('/'))).toBe(true);
  });

  it('rejects files without the .osz extension', async () => {
    await expect(importOsz(await makeOsz({ 'x.osu': CHART }), 'x.zip')).rejects.toThrow(/not an .osz/);
  });
});
