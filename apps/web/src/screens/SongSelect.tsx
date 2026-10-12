import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, type GameLaunch } from '../app/AppContext';
import { buildEntries } from '../beatmaps/stats';
import { groupBySet, matchesQuery, parseQuery, sortEntries, type LibraryEntry, type SortKey } from '../beatmaps/query';
import { importOsz } from '../beatmaps/archive';
import { BeatmapParseError } from '../beatmaps/parser';
import { STANDARD_MODS, normalizeMods, type ModId } from '../gameplay/core/mods';
import { audioEngine, AudioLoadError } from '../gameplay/audio/audioEngine';
import { MODE_NAMES } from '../beatmaps/types';
import type { BeatmapSetRecord, ScoreRecord } from '../storage/db';

/** Mods that are implemented by the osu!standard engine. Everything else is listed as unavailable. */
const IMPLEMENTED_MODS: ModId[] = ['EZ', 'NF', 'HT', 'DT', 'HR', 'SD', 'HD'];
const UNAVAILABLE_MODS = ['Relax', 'Autopilot', 'Spun Out', 'Cinema', 'Target Practice', 'Flashlight', 'Traceable', 'Daycore', 'Nightcore', 'Perfect', 'Mirror', 'Deflate', 'Wiggle', 'Autoplay (not a ranked mod)'];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'creator', label: 'Creator' },
  { id: 'bpm', label: 'BPM' },
  { id: 'length', label: 'Length' },
  { id: 'added', label: 'Date added' },
  { id: 'difficulty', label: 'Difficulty index' },
];

type Collection = 'all' | 'favorites' | 'played' | 'unplayed';

export const fmtLen = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function SongSelect() {
  const { store, sets, scores, favorites, settings, updateSettings, refreshLibrary, refreshScores, setFavorite, notify, go, back, openShortcuts } = useApp();
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<Collection>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'standard'>(settings.modeFilter);
  const [sort, setSort] = useState<SortKey>(settings.sort);
  const [selectedHash, setSelectedHash] = useState<string | null>(settings.lastBeatmapHash);
  const [selectedFile, setSelectedFile] = useState<string | null>(settings.lastDifficultyFile);
  const [expanded, setExpanded] = useState<string | null>(settings.lastBeatmapHash);
  const [mods, setMods] = useState<ModId[]>(normalizeMods(settings.lastMods.filter((m) => IMPLEMENTED_MODS.includes(m))));
  const [modsOpen, setModsOpen] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [report, setReport] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const entries = useMemo(() => buildEntries(sets, favorites, scores), [sets, favorites, scores]);
  const filtered = useMemo(() => {
    const q = parseQuery(query);
    let list = entries.filter((e) => matchesQuery(e, q));
    if (modeFilter === 'standard') list = list.filter((e) => e.mode === 0);
    if (collection === 'favorites') list = list.filter((e) => e.favorite);
    if (collection === 'played') list = list.filter((e) => e.lastPlayed !== null);
    if (collection === 'unplayed') list = list.filter((e) => e.lastPlayed === null);
    return sortEntries(list, sort);
  }, [entries, query, modeFilter, collection, sort]);
  const groups = useMemo(() => groupBySet(filtered), [filtered]);

  const selectedEntry: LibraryEntry | undefined = useMemo(() => {
    const inList = filtered.find((e) => e.hash === selectedHash && e.fileName === selectedFile);
    return inList ?? filtered.find((e) => e.hash === selectedHash) ?? filtered[0];
  }, [filtered, selectedHash, selectedFile]);
  const selectedSet = sets.find((s) => s.hash === selectedEntry?.hash);
  const selectedParsed = selectedSet?.difficulties.find((d) => d.fileName === selectedEntry?.fileName)?.parsed;
  const localScores: ScoreRecord[] = useMemo(
    () => (selectedEntry ? scores.filter((s) => s.difficultyKey === `${selectedEntry.hash}/${selectedEntry.fileName}`).sort((a, b) => b.score - a.score).slice(0, 8) : []),
    [scores, selectedEntry],
  );

  // Remember the selection and filters.
  useEffect(() => {
    if (!selectedEntry) return;
    void updateSettings({ lastBeatmapHash: selectedEntry.hash, lastDifficultyFile: selectedEntry.fileName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry?.hash, selectedEntry?.fileName]);
  useEffect(() => {
    void updateSettings({ sort, modeFilter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, modeFilter]);

  // Keep the selection valid when the filter changes.
  useEffect(() => {
    if (selectedEntry && (selectedEntry.hash !== selectedHash || selectedEntry.fileName !== selectedFile)) {
      setSelectedHash(selectedEntry.hash);
      setSelectedFile(selectedEntry.fileName);
      setExpanded(selectedEntry.hash);
    }
  }, [selectedEntry, selectedHash, selectedFile]);

  // Background artwork for the selected set (object URL, revoked on change).
  useEffect(() => {
    const bg = selectedParsed?.backgroundFilename;
    const assets = selectedSet?.assets;
    if (!bg || !assets) {
      setBgUrl(null);
      return;
    }
    const blob = assets[bg.toLowerCase()];
    if (!blob) {
      setBgUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setBgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedSet?.hash, selectedParsed?.backgroundFilename]);

  // Preview playback for the selected difficulty's audio.
  const previewKey = selectedEntry ? `${selectedEntry.hash}/${selectedEntry.fileName}` : '';
  useEffect(() => {
    if (!selectedParsed || !selectedSet) return;
    let cancelled = false;
    const audioBlob = selectedSet.assets[selectedParsed.audioFilename.toLowerCase()];
    if (!audioBlob) {
      audioEngine.stopPreview();
      return;
    }
    (async () => {
      try {
        const buf = await audioEngine.decode(audioBlob, selectedParsed.audioFilename);
        if (cancelled) return;
        const at = selectedParsed.previewTime >= 0 ? selectedParsed.previewTime / 1000 : buf.duration * 0.4;
        audioEngine.playPreview(buf, at);
      } catch (e) {
        if (!cancelled) notify(e instanceof AudioLoadError ? e.message : 'Preview unavailable.', 'warn');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  useEffect(() => () => audioEngine.stopPreview(), []);

  const select = useCallback((hash: string, file: string | null) => {
    setSelectedHash(hash);
    setSelectedFile(file);
    setExpanded(hash);
  }, []);

  const moveSelection = useCallback(
    (dir: 1 | -1) => {
      const flat: { hash: string; file: string }[] = [];
      for (const g of groups) {
        const open = expanded === g.hash;
        if (open) for (const r of g.rows) flat.push({ hash: g.hash, file: r.fileName });
        else flat.push({ hash: g.hash, file: g.rows[0].fileName });
      }
      if (flat.length === 0) return;
      const idx = Math.max(0, flat.findIndex((f) => f.hash === selectedEntry?.hash && f.file === selectedEntry?.fileName));
      const next = flat[(idx + dir + flat.length) % flat.length];
      select(next.hash, next.file);
    },
    [groups, expanded, selectedEntry, select],
  );

  const start = useCallback(() => {
    if (!selectedEntry) {
      notify('Import a beatmap (.osz) first.', 'warn');
      return;
    }
    if (selectedEntry.mode !== 0) {
      notify(`${MODE_NAMES[selectedEntry.mode as 0 | 1 | 2 | 3]} is not implemented in this build. Only osu!standard can be played.`, 'warn');
      return;
    }
    const launch: GameLaunch = { hash: selectedEntry.hash, fileName: selectedEntry.fileName, mods: normalizeMods(mods) };
    audioEngine.stopPreview();
    audioEngine.ensure();
    go({ name: 'game', launch });
  }, [selectedEntry, mods, go, notify]);

  // Keyboard navigation (ignored while typing in the search box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) {
        if (e.key === 'Escape') (t as HTMLInputElement).blur();
        return;
      }
      if (modsOpen) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!selectedEntry) return;
        const rows = groups.find((g) => g.hash === selectedEntry.hash)?.rows ?? [];
        const i = rows.findIndex((r) => r.fileName === selectedEntry.fileName);
        const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + rows.length) % rows.length;
        if (rows[j]) select(selectedEntry.hash, rows[j].fileName);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        start();
      } else if (e.key === 'Escape') {
        back();
      } else if (e.key.toLowerCase() === 'm') {
        setModsOpen(true);
      } else if (e.key.toLowerCase() === 'f' && selectedEntry) {
        void setFavorite(selectedEntry.hash, !selectedEntry.favorite);
      } else if (e.key === 'Delete' && selectedSet) {
        void removeSet(selectedSet.hash);
      } else if (e.key === '?') {
        openShortcuts();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSelection, selectedEntry, groups, start, modsOpen, selectedSet, back]);

  // Scroll the selected row into view.
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedEntry?.hash, selectedEntry?.fileName]);

  // Wheel navigation over the carousel.
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 4) return;
    moveSelection(e.deltaY > 0 ? 1 : -1);
  };

  const importFiles = async (files: FileList | File[]) => {
    if (!store) return;
    const list = Array.from(files);
    const lines: string[] = [];
    for (const file of list) {
      setImporting(`Reading ${file.name}…`);
      try {
        setImporting(`Validating ${file.name}…`);
        const imp = await importOsz(file, file.name);
        if (sets.some((s) => s.hash === imp.hash)) {
          lines.push(`${file.name}: already in your library (duplicate, not imported).`);
          continue;
        }
        setImporting(`Saving ${imp.title}…`);
        const rec: BeatmapSetRecord = {
          hash: imp.hash,
          title: imp.title,
          artist: imp.artist,
          creator: imp.creator,
          beatmapSetId: imp.beatmapSetId,
          importedAt: Date.now(),
          sourceFileName: file.name,
          difficulties: imp.difficulties.map((d) => ({ fileName: d.fileName, parsed: d.parsed })),
          assets: Object.fromEntries(imp.assets),
          warnings: imp.warnings,
        };
        await store.putSet(rec);
        const unsupported = imp.difficulties.filter((d) => d.parsed.mode !== 0).length;
        lines.push(
          `${imp.artist} – ${imp.title}: ${imp.difficulties.length} difficult${imp.difficulties.length === 1 ? 'y' : 'ies'} imported` +
            (unsupported ? ` (${unsupported} not playable: other modes are not implemented yet)` : '') +
            (imp.invalidFiles.length ? ` · ${imp.invalidFiles.length} invalid .osu skipped` : '') +
            (imp.warnings.length ? ` · ${imp.warnings.length} warning(s)` : ''),
        );
        if (imp.warnings.length) lines.push(...imp.warnings.slice(0, 6).map((w) => `  ↳ ${w}`));
        select(imp.hash, imp.difficulties.find((d) => d.parsed.mode === 0)?.fileName ?? imp.difficulties[0].fileName);
      } catch (e) {
        const msg = e instanceof BeatmapParseError ? e.message : e instanceof Error ? e.message : String(e);
        lines.push(`${file.name}: could not import. ${msg}`);
      }
    }
    setImporting(null);
    setReport(lines);
    await refreshLibrary();
    notify(lines.some((l) => l.includes('could not')) ? 'Import finished with errors. See the import report.' : 'Import finished.', lines.some((l) => l.includes('could not')) ? 'warn' : 'success');
  };

  const removeSet = async (hash: string) => {
    if (!store) return;
    const set = sets.find((s) => s.hash === hash);
    if (!set) return;
    if (!window.confirm(`Remove "${set.title}" and its local scores and replays from this device?`)) return;
    await store.deleteSet(hash);
    await refreshLibrary();
    await refreshScores();
    notify(`Removed ${set.title}.`, 'success');
    setSelectedHash(null);
    setSelectedFile(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.osz$/i.test(f.name));
    if (files.length === 0) notify('Drop .osz beatmap archives here.', 'warn');
    else void importFiles(files);
  };

  const toggleMod = (id: ModId) => {
    setMods((cur) => {
      const next = cur.includes(id) ? cur.filter((m) => m !== id) : normalizeMods([...cur, id]);
      void updateSettings({ lastMods: next });
      return next;
    });
  };

  const diffs = selectedSet?.difficulties ?? [];
  const unsupportedWarn = selectedParsed && selectedParsed.mode !== 0 ? `${MODE_NAMES[selectedParsed.mode as 0 | 1 | 2 | 3]} is not implemented yet.` : null;

  return (
    <section
      className={`select ${dragging ? 'dragging' : ''}`}
      aria-label="Song select"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {bgUrl && <div className="select-bg" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden="true" />}
      <div className="select-left panel">
        <div className="toolbar">
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder="Search · ar>9 creator=name bpm>180 length<120"
            aria-label="Search beatmaps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Collection" value={collection} onChange={(e) => setCollection(e.target.value as Collection)}>
            <option value="all">All</option>
            <option value="favorites">Favorites</option>
            <option value="played">Recently played</option>
            <option value="unplayed">Unplayed</option>
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <select aria-label="Mode" value={modeFilter} onChange={(e) => setModeFilter(e.target.value as 'all' | 'standard')}>
            <option value="all">All modes</option>
            <option value="standard">osu!standard</option>
          </select>
          <button onClick={() => fileRef.current?.click()}>Import .osz</button>
          <input
            ref={fileRef}
            type="file"
            accept=".osz,application/zip"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="count muted small">
          {filtered.length} of {entries.length} difficulties · {groups.length} sets
          {query.trim() && <span> · filtered</span>}
        </div>
        <div className="carousel" ref={listRef} onWheel={onWheel} role="listbox" aria-label="Beatmap sets">
          {groups.length === 0 && (
            <div className="empty">
              {sets.length === 0 ? (
                <>
                  <p>Your library is empty.</p>
                  <p className="muted small">Import a standard <code>.osz</code> archive (drag it here or use Import). Archives are read and stored on this device only.</p>
                </>
              ) : (
                <p>No beatmaps match the current search and filters.</p>
              )}
            </div>
          )}
          {groups.map((g) => {
            const head = g.rows[0];
            const open = expanded === g.hash;
            const isSel = selectedEntry?.hash === g.hash;
            return (
              <div key={g.hash} className={`set ${open ? 'open' : ''} ${isSel ? 'sel' : ''}`}>
                <button
                  className="set-head"
                  onClick={() => {
                    if (open && isSel) setExpanded(null);
                    else select(g.hash, selectedEntry?.hash === g.hash ? selectedEntry.fileName : head.fileName);
                  }}
                  aria-expanded={open}
                  aria-label={`${head.artist} – ${head.title}`}
                  data-selected={isSel}
                >
                  <span className="set-title">{head.title}</span>
                  <span className="set-artist muted">{head.artist}</span>
                  <span className="set-meta small">
                    mapped by {head.creator} · {g.rows.length} diff{g.rows.length === 1 ? '' : 's'}
                    {head.favorite && <span className="fav" aria-label="favorite"> ★</span>}
                  </span>
                </button>
                {open &&
                  g.rows.map((r) => {
                    const selected = selectedEntry?.hash === r.hash && selectedEntry?.fileName === r.fileName;
                    return (
                      <button
                        key={r.fileName}
                        className={`diff ${selected ? 'sel' : ''} ${r.mode !== 0 ? 'unsupported' : ''}`}
                        onClick={() => select(r.hash, r.fileName)}
                        data-selected={selected}
                        aria-selected={selected}
                        role="option"
                      >
                        <span className="diff-dot" style={{ background: diffColor(r.ar, r.od, r.cs) }} aria-hidden="true" />
                        <span className="diff-name">{r.version || r.fileName}</span>
                        <span className="small muted">
                          CS {r.cs.toFixed(1)} · AR {r.ar.toFixed(1)} · OD {r.od.toFixed(1)} · {Math.round(r.bpm)} BPM
                        </span>
                        {r.mode !== 0 && <span className="chip warn">{MODE_NAMES[r.mode as 0 | 1 | 2 | 3]} · unavailable</span>}
                        {r.bestScore !== null && <span className="small">best {r.bestScore.toLocaleString()} ({r.bestGrade})</span>}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
        {importing && (
          <div className="import-progress" role="status">
            {importing}
          </div>
        )}
        {report.length > 0 && (
          <details className="import-report" open>
            <summary>
              Import report <button className="link small" onClick={() => setReport([])}>dismiss</button>
            </summary>
            <ul>
              {report.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="select-right panel">
        {!selectedEntry || !selectedSet || !selectedParsed ? (
          <div className="empty">
            <h2>No beatmap selected</h2>
            <p className="muted">Pick a set on the left, or import an .osz archive. Drag files anywhere on this screen to import them.</p>
          </div>
        ) : (
          <>
            <div className="detail-art" style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined} aria-hidden="true" />
            <div className="detail-head">
              <h2 title={selectedParsed.metadata.titleUnicode}>{selectedParsed.metadata.titleUnicode || selectedParsed.metadata.title}</h2>
              <div className="muted">{selectedParsed.metadata.artistUnicode || selectedParsed.metadata.artist}</div>
              <div className="small">
                Mapper <strong>{selectedParsed.metadata.creator}</strong> · Difficulty <strong>{selectedParsed.metadata.version}</strong>
              </div>
              {selectedParsed.metadata.source && <div className="small muted">Source: {selectedParsed.metadata.source}</div>}
            </div>
            <dl className="stats">
              <div><dt>BPM</dt><dd>{selectedEntry.minBpm === selectedEntry.maxBpm ? selectedEntry.bpm : `${selectedEntry.minBpm}–${selectedEntry.maxBpm}`}</dd></div>
              <div><dt>Length</dt><dd>{fmtLen(selectedEntry.lengthMs)}</dd></div>
              <div><dt>Objects</dt><dd>{selectedEntry.objectCount}</dd></div>
              <div><dt>CS</dt><dd>{selectedParsed.difficulty.circleSize}</dd></div>
              <div><dt>AR</dt><dd>{selectedParsed.difficulty.approachRate}</dd></div>
              <div><dt>OD</dt><dd>{selectedParsed.difficulty.overallDifficulty}</dd></div>
              <div><dt>HP</dt><dd>{selectedParsed.difficulty.hpDrainRate}</dd></div>
              <div><dt>Mode</dt><dd>{MODE_NAMES[selectedParsed.mode as 0 | 1 | 2 | 3]}</dd></div>
            </dl>
            <p className="small muted">Star rating and performance points are not calculated by this build, so they are not shown.</p>
            {diffs.length > 1 && (
              <div className="diff-pills" role="radiogroup" aria-label="Difficulty">
                {groups.find((g) => g.hash === selectedSet.hash)?.rows.map((r) => (
                  <button key={r.fileName} className={`pill ${r.fileName === selectedEntry.fileName ? 'active' : ''}`} role="radio" aria-checked={r.fileName === selectedEntry.fileName} onClick={() => select(r.hash, r.fileName)}>
                    {r.version}
                  </button>
                ))}
              </div>
            )}
            {unsupportedWarn && <div className="warn-box">{unsupportedWarn} You can still import and browse this difficulty.</div>}
            {selectedParsed.warnings.length > 0 && (
              <details className="warn-box">
                <summary>{selectedParsed.warnings.length} import warning(s)</summary>
                <ul className="small">
                  {selectedParsed.warnings.slice(0, 10).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mods-row">
              <button onClick={() => setModsOpen(true)} aria-keyshortcuts="M">
                Mods <kbd>M</kbd>
              </button>
              <span className="mods-active">
                {mods.length ? mods.map((m) => <span key={m} className="chip">{STANDARD_MODS[m].name}</span>) : <span className="muted small">No mods</span>}
              </span>
            </div>
            <div className="local-scores">
              <h3>Your local scores</h3>
              {localScores.length === 0 ? (
                <p className="muted small">No plays on this device yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Score</th>
                      <th>Acc</th>
                      <th>Grade</th>
                      <th>Combo</th>
                      <th>Mods</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localScores.map((s, i) => (
                      <tr key={s.id}>
                        <td>{i + 1}</td>
                        <td className="mono">{s.score.toLocaleString()}</td>
                        <td>{(s.accuracy * 100).toFixed(2)}%</td>
                        <td>{s.grade}</td>
                        <td>{s.maxCombo}x</td>
                        <td className="small">{s.mods.join(' ') || '—'}</td>
                        <td className="small">{new Date(s.playedAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small">Local scores are kept on this device and are not submitted to any ranking.</p>
            </div>
            <div className="detail-actions">
              <button className="primary big" onClick={start} disabled={selectedEntry.mode !== 0} aria-keyshortcuts="Enter">
                Play <kbd>Enter</kbd>
              </button>
              <button onClick={() => void setFavorite(selectedEntry.hash, !selectedEntry.favorite)} aria-pressed={selectedEntry.favorite} aria-keyshortcuts="F">
                {selectedEntry.favorite ? '★ Favorited' : '☆ Favorite'} <kbd>F</kbd>
              </button>
              <button className="danger" onClick={() => void removeSet(selectedSet.hash)} aria-keyshortcuts="Delete">
                Remove <kbd>Del</kbd>
              </button>
            </div>
          </>
        )}
      </div>

      {modsOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Mods" onClick={() => setModsOpen(false)}>
          <div className="panel modal mods-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Mods</h2>
            <p className="muted small">Mods change the rules and the score. Conflicting mods are removed automatically. Scores with mods are saved locally.</p>
            <div className="mod-grid">
              {IMPLEMENTED_MODS.map((id) => {
                const info = STANDARD_MODS[id];
                const on = mods.includes(id);
                return (
                  <button key={id} className={`mod ${on ? 'on' : ''} ${info.kind}`} onClick={() => toggleMod(id)} aria-pressed={on}>
                    <span className="mod-abbr">{id}</span>
                    <span className="mod-name">{info.name}</span>
                    <span className="mod-desc small">{info.description}</span>
                    <span className="small muted">Score ×{info.scoreMultiplier}</span>
                  </button>
                );
              })}
            </div>
            <h3>Not available in this build</h3>
            <p className="muted small">{UNAVAILABLE_MODS.join(' · ')}. These are listed for reference only; they are not implemented and cannot be selected.</p>
            <div className="modal-actions">
              <button onClick={() => { setMods([]); void updateSettings({ lastMods: [] }); }}>Clear mods</button>
              <button className="primary" onClick={() => setModsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {dragging && <div className="drop-hint">Drop .osz files to import</div>}
    </section>
  );
}

function diffColor(ar: number, od: number, cs: number): string {
  const v = (ar + od + cs) / 30;
  const hue = 200 - v * 170;
  return `hsl(${Math.round(hue)} 80% 60%)`;
}
