# CLAUDE.md

Guidance for coding agents working in this repository.

## Project overview

WordTales is a static, framework-free vocabulary learning app. The default route is an FSRS-powered single-card study flow; the original article library remains available at `#library` and column hashes. It contains 897 source occurrences mapped to 892 canonical learning entries across 7 sets and 28 columns.

There is no build step. The official `ts-fsrs` UMD bundle is checked into `vocab-essays/vendor/ts-fsrs/`, so the app stays offline- and `file://`-compatible.

## Commands

```bash
python3 -m http.server 8000
node scripts/check-integrity.js
```

Open `http://localhost:8000/vocab-essays/vocab-essays.html` or open that HTML file directly.

## Script order and architecture

Classic scripts use `defer` and must remain in this dependency order:

```text
vendor/ts-fsrs/index.umd.js
→ js/namespace.js
→ js/data.js
→ js/renderer.js
→ js/learning-progress-v2.js
→ js/study-session.js
→ js/features.js
```

All application APIs live under `WordTales`.

| Layer | File | Role |
| --- | --- | --- |
| `Data` | `js/data.js` | Immutable content, source-occurrence indexes, canonical-entry mapping, context and source-order APIs. |
| `Renderer` | `js/renderer.js` | Escapes content and renders the legacy article/library DOM. |
| `LearningProgress` | `js/learning-progress-v2.js` | FSRS-6 scheduling, IndexedDB/localStorage persistence, v1 migration, idempotent events and canonical star state. |
| `StudySession` | `js/study-session.js` | 20-card rounds, 40-new/day cap, due/new interleaving, card state machine, recovery, summaries and article-review routing. |
| Features/App | `js/features.js` | Routing plus article reading, audio, cards, progress panel, games, copy practice and analysis. |

The old `js/learning-progress.js` is not loaded; it remains only as historical reference. Do not modify it for active behavior.

## Core invariants

- Empty hash and `#study` activate the study home. `#library`, set hashes, column hashes and changelog hashes activate the legacy library.
- Canonical learning state is keyed by entry ID, not English text or occurrence ID.
- `Data.resolveEntryId(occurrenceId)` is the only occurrence-to-entry conversion path.
- `isStarred` in the v2 profile is authoritative. `localStorage.starredWords` is a compatibility mirror only.
- Ratings are `Good`, `Hard` and `Again`; do not merge Good and Hard.
- `Again` must not return in an ordinary round on the same local day.
- Every rating is committed immediately with an idempotent submission ID.
- An unfinished round is immutable and resumes across refreshes or date changes.
- Article auto-highlighting and automatic exposure do not create learning records.
- Speech failures must never block rating or navigation.

## Canonical data mapping

The expected count is exactly 897 occurrences → 892 entries. These five aliases are intentional:

- `s6col2-radiate` → `s1col1-radiate`
- `s6col4-proximity` → `s1col1-proximity`
- `s6col3-barren` → `s1col1-barren`
- `s3col5-inferior` → `s2col2-inferior`
- `s6col4-discern` → `s4col3-discern`

The two meanings of `brisk` must remain distinct entries.

## Content integrity

The source model is `set → column → words / paragraphs`; paragraph segments are strings or `{ vocabId, text }` objects.

1. Set, column, occurrence and paragraph IDs must stay unique.
2. Every segment `vocabId` must reference an occurrence from the same column.
3. Every canonical entry must have at least one complete context sentence and stable source order.
4. Audio cues must keep a one-to-one relationship with runtime essay tokens.
5. When adding content, preserve the 897/892 expectations only if the source corpus is unchanged; otherwise update the integrity assertions deliberately.

## Persistence

IndexedDB database `wordtales-learning` stores the profile and append-only events. v1 and old textual stars are migration inputs. When IndexedDB is unavailable, the app falls back to localStorage without blocking the learning flow.

Migration must remain repeatable and non-destructive. Never clear existing profiles as part of a schema change.

## Changelog and deployment

`<template id="changelog-tpl">` in `vocab-essays.html` is the user-facing changelog. Add an entry for meaningful feature or architecture changes.

GitHub Pages deploys the static HTML plus `css/`, `js/`, `audio/`, `vendor/` and README. Keep the workflow in sync with any new required static directory.

## Verification checklist

Run `node scripts/check-integrity.js`, syntax-check edited scripts, and check `git diff --check`. Browser smoke tests should cover:

- default study route and legacy deep links;
- Good, Hard and Again answer pages;
- persistence and refresh recovery;
- 20-card summary and next-round generation;
- audio activation/reset behavior;
- article review highlights;
- unified stars in game, copy practice and progress;
- desktop, 390 px viewport, local server and `file://` startup.
