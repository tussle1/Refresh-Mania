# bad!osu

An original, browser-based rhythm game inspired by osu!. **This project is not affiliated with or endorsed by ppy / osu!**, does not use osu! artwork or audio, and does not connect to the official osu! service.

This repository currently contains the **offline client** with a complete osu!standard engine. Most of the brief (other modes, accounts, backend, multiplayer, editor) is **not implemented yet**. The sections below state precisely what works.

## Run it

Requirements: Node.js 20+ and a current desktop Chromium, Firefox, or Safari build.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173 (binds 0.0.0.0)
npm run sample     # optional: generates samples/bad-osu-demo.osz (original audio/art/chart)
npm test           # unit + integration tests (Vitest)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
```

Then in the app: **Play → Solo → Import .osz** and pick `samples/bad-osu-demo.osz` (or drag it onto the song select screen).

No account or network connection is needed for any of this. Data (library, scores, replays, settings) is stored in IndexedDB on the device.

## What works

- **Title screen**: animated cookie with rhythm pulse (beat clock + audio level), visualizer bars (DOM refs, no React re-renders per frame), synthesized jukebox loop (original, generated in code), rotating tips, reduced-motion option.
- **Play menu**: Solo (works) and Multiplayer (disabled with an explanation, because no server exists in this build).
- **Song select**: `.osz` import (zip validation, path-traversal guard, SHA-256 duplicate detection, per-difficulty invalid-file reporting, import report), search with field expressions (`ar>9`, `creator=name`, `bpm>180`, `length<120`, `objects>500`), collections (favorites, recently played, unplayed), 7 sort keys, grouped carousel with mouse-wheel and keyboard navigation, background artwork, preview playback, local score table, favorites, removal with confirmation.
- **Mods (osu!standard)**: Easy, No Fail, Half Time, Double Time, Hard Rock (flips playfield), Sudden Death, Hidden. Conflicts are normalised automatically. Each mod changes gameplay (difficulty values, playback rate, fail rules, rendering) and the score multiplier. Scores with mods are saved with the mods recorded.
- **osu!standard engine**: hit circles with approach circles and combo numbering; sliders (linear, perfect-circle, bezier with red-anchor segments, catmull approximated) with ticks, repeats, tails, the slider ball, and follow-circle tracking while a key or mouse button is held; spinners with required rotations and bonus; hit windows from OD in real-time milliseconds, scaled for rate; AR-based approach timing; miss detection; health; fail states.
- **Input**: pointer tracking with coalesced events, per-event timestamps mapped to chart time through the audio clock, configurable K1/K2 keys plus left/right mouse, pointer-capture and focus-loss handling (blur and tab hide auto-pause, all buttons released). Cursor smoothing is visual only; the ruleset always receives the raw pointer.
- **Audio**: Web Audio clock (chart time = audio context time × rate), music / effects / preview / master buses, mute, audio offset (−250…250 ms), synthesized hitsounds, clear errors for undecodable formats. If audio fails to decode the play continues silently on the chart clock.
- **Pause / resume / retry**: pause releases buttons and freezes the clock; resume has a 1.5 s countdown; Retry restarts the attempt; give-up saves a failed play.
- **Results**: grade, score, accuracy, max combo, judgment counts and bars, slider/spinner follow counts, mean hit error, approximate unstable rate, score-progression graph, hit-error histogram, personal-best comparison, local leaderboard for the difficulty.
- **Replays (local format)**: every live play records a timestamped input log. Replays can be validated, exported as JSON, and played back through the same ruleset code path (`badosu-replay` v1). Playback is verified to reproduce score and judgments (see tests). Replays are explicitly *local recordings*, not official `.osr` files. Seeking in replays is not implemented.
- **Persistence**: IndexedDB stores beatmap sets (with their assets), scores, replays, favorites, and settings. Settings are validated on load and on save.
- **Options**: audio, input (with key capture and an input test), gameplay, cursor, graphics, interface (UI scale, theme), online status. Settings persist.
- **Keyboard**: `?` shows the shortcut reference; shortcuts are ignored while typing in text fields.

## Verified

- 48 automated tests (Vitest): `.osu` parsing, timing points, slider geometry, hit windows, circle/slider/spinner judgments, scoring and accuracy, mod math, fail rules, live-vs-replay determinism, replay validation, `.osz` import and validation, search/sort/grouping.
- Headless Chromium smoke run (puppeteer-core against the dev server): title screen renders; the sample archive imports (the broken difficulty is reported and skipped); the Normal difficulty starts gameplay with the canvas running and no runtime errors; the fail flow appears when nothing is hit.
- **Not verified in a browser**: that a human-timed run hits notes accurately with real input latency. The determinism and timing logic is tested headlessly, but I have not run scripted hit sequences in a real browser.

## Not implemented (honest list)

| Area | Status |
| --- | --- |
| osu!taiko, osu!catch, osu!mania engines | **Not implemented.** Non-standard beatmaps are imported and listed, marked "unavailable", and cannot be started. Their objects are skipped with a warning. |
| Beatmap editor (Edit button) | **Not implemented.** The button is disabled. |
| Star rating / performance points | **Not calculated.** Never shown. |
| Accounts, sessions, profiles, friends | **Not implemented.** |
| Backend (Node/Postgres), online score submission, online leaderboards, global rankings | **Not implemented.** The client probes `/api/health`; with no server it reports offline. |
| Multiplayer, chat, presence | **Not implemented.** |
| Skins (archive import, custom hit circles / cursors) | **Not implemented.** Built-in drawn visuals only. |
| Flashlight, Relax, Autopilot, Spun Out, Cinema, Target Practice, Traceable, Nightcore, Daycore, Perfect, Mirror | **Not implemented.** Listed as unavailable. |
| Stacking, sample-set hitsounds from archives, storyboards, video backgrounds | **Not implemented.** Hitsounds are synthesized. |
| Replay seeking, playback-speed controls in replays | **Not implemented.** |
| Notes on fidelity | Scoring, grade thresholds, spinner requirements and slider judgment are **approximations** documented in `src/gameplay/scoring/score.ts` and `ruleset.ts`. They are not verified against official osu! values. |

## Layout

```
apps/web/
  src/beatmaps/      .osu parser, slider curves, timing, .osz import, library query and stats
  src/gameplay/
    core/            mods, difficulty helpers (CS/AR/OD → pixels/ms)
    audio/           song clock, Web Audio engine (decode, buses, hitsounds, jukebox)
    modes/standard/  osu!standard ruleset (deterministic state machine)
    rendering/       canvas renderer (reads ruleset state; no React)
    scoring/         score, accuracy, grade model
    replay/          replay format and validation
    session.ts       one play: clock, recording, playback, pause/resume
  src/storage/       IndexedDB store and validated settings
  src/screens/       title, play menu, song select, gameplay, results, options
  scripts/           sample .osz generator
  tests/             Vitest suites
```

The brief's `apps/server`, `packages/shared`, and `database/` directories do not exist yet because the server work has not started.

## Licensing

All code in this repository is original. The sample beatmap is generated by `scripts/make-sample-osz.mjs`. Do not add third-party beatmaps, skins, or audio without a license that permits redistribution.
