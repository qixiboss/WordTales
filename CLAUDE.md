# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

WordTales is a static, framework-free English vocabulary learning app. The default route is an FSRS-powered single-card study flow; the original article library remains at `#library` and column hashes. The corpus holds 897 source occurrences mapped to 892 canonical learning entries across 7 sets and 28 columns.

There is no build step and no runtime CDN dependency — the official `ts-fsrs` UMD bundle is checked into `vocab-essays/vendor/ts-fsrs/`, so the app must stay offline- and `file://`-compatible. All application APIs live under the `WordTales` namespace.

Entry point: `vocab-essays/vocab-essays.html`.

## Commands

```bash
python3 -m http.server 8000        # serve http://localhost:8000/vocab-essays/vocab-essays.html
node scripts/check-integrity.js    # integrity gate: script order, assets, 897→892 mapping, audio cues, syntax
node --check <edited .js file>     # syntax-check a script
```

There is no test suite or package manager; verification is `check-integrity.js` plus the browser smoke list under Verification.

## Architecture

Scripts use `defer` and must remain in this dependency order (`check-integrity.js` enforces it):

```text
vendor/ts-fsrs/index.umd.js → js/namespace.js → js/data.js → js/renderer.js
→ js/learning-progress-v2.js → js/study-session.js → js/features.js
```

| Layer | File | Role |
| --- | --- | --- |
| Data | `js/data.js` | Immutable content (`var sets = [...]`), occurrence→entry mapping, context/source-order APIs. |
| Renderer | `js/renderer.js` | Escapes content; renders the legacy article/library DOM. |
| LearningProgress | `js/learning-progress-v2.js` | FSRS-6 scheduling, IndexedDB/localStorage persistence, v1 migration, idempotent events, canonical star state. |
| StudySession | `js/study-session.js` | 20-card rounds, 40-new/day cap, due/new interleaving, card state machine, recovery, summaries. |
| Features/App | `js/features.js` | Hash routing plus article reading, audio, cards, progress panel, games, copy practice. |

`js/learning-progress.js` is not loaded; it exists only as historical reference — do not modify it for active behavior.

## Context loading rules

- Study flow, cards, scheduling, persistence → `js/study-session.js`, `js/learning-progress-v2.js`, plus README's 学习流程 / 数据保存与迁移 sections (the user-facing behavior contract).
- Article read-aloud, word highlighting, audio cues → `.codex/skills/sync-article-audio/SKILL.md` and `references/wordtales-workflow.md` (tokenization contract, cue generation, acceptance checklist).
- Corpus content (sets, columns, words, paragraphs) → `js/data.js`; the integrity rules live in `scripts/check-integrity.js`, not here.
- New essay content from word-list photos → `.trae/skills/vocab-essay/SKILL.md`.
- Frontend code review → `.trae/skills/frontend-code-reviewer/SKILL.md`.
- Deployment → `.github/workflows/jekyll-gh-pages.yml` (sync it when adding a required static directory).
- User-facing changelog → `<template id="changelog-tpl">` in `vocab-essays.html`.

## Hard rules

Routing and learning state:

- Empty hash and `#study` activate the study home; `#library`, set, column and changelog hashes activate the legacy library.
- Canonical state is keyed by entry ID, never by English text or occurrence ID; `Data.resolveEntryId(occurrenceId)` is the only occurrence→entry path.
- Ratings are `Good`, `Hard` and `Again` — never merge Good and Hard.
- `Again` must not return in an ordinary round on the same local day.
- Every rating is committed immediately with an idempotent submission ID.
- An unfinished round is immutable and resumes across refreshes or date changes.
- Article auto-highlighting and automatic exposure must not create learning records.
- `isStarred` in the v2 profile is authoritative; `localStorage.starredWords` is a compatibility mirror only.

Speech:

- Speech failures must never block rating or navigation.
- Study pronunciation is manual-only: the card speaks only via the speaker button, never automatically when advancing.
- All speech respects the persisted US/UK accent (`wordtales.accent`, default `us`); voice selection prefers the accent pool and degrades to any English voice when it is empty.

Data and deployment:

- The 897→892 mapping, the five aliases and the two distinct `brisk` entries are enforced by `scripts/check-integrity.js` — change the corpus only by deliberately updating those assertions.
- Migration must remain repeatable and non-destructive; never clear existing profiles as part of a schema change.
- Preserve offline/`file://` compatibility: no build step, no CDN runtime dependencies, and every new required static directory must be added to the Pages workflow.
- Add a changelog entry for meaningful feature or architecture changes.

## Work principles

- Read the target module and adjacent implementations before modifying; match existing naming, comment density and idioms.
- README describes user-facing behavior; if code and README disagree, trust the code and fix the README.
- Fix root causes; do not expand scope, add workarounds, or paper over failing checks.
- When a fact is uncertain, verify it in code, scripts or docs rather than assuming.

## Verification

For any change:

1. `node scripts/check-integrity.js` — must pass; do not report completion while it fails.
2. `node --check` every edited script; run `git diff --check`.
3. Browser smoke tests must cover: default study route and legacy deep links; Good, Hard and Again answer pages; persistence and refresh recovery; 20-card summary and next-round generation; manual study pronunciation (speaker button), article read-aloud reset and the US/UK accent toggle; article review highlights; unified stars in game, copy practice and progress; desktop and 390 px viewport; local server and `file://` startup.
4. State plainly what was changed and what could not be verified.
