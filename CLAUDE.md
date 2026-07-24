# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

WordTales is a single-page, zero-dependency English vocabulary learning app. The application logic lives in one HTML file (`vocab-essays/vocab-essays.html`) with embedded CSS and vanilla JavaScript; prerecorded readings live in `vocab-essays/audio/`. No build step, no package manager, no framework.

## Commands

```bash
# Start local dev server
python3 -m http.server 8000

# Open in browser (after starting server)
# http://localhost:8000/vocab-essays/vocab-essays.html

# Alternatively, open the HTML file directly in a browser — it works offline.
```

There is no `package.json`, no lint/format/test commands, and no build step. Manual smoke-testing is the verification method (see README for checklist).

## Architecture

All JavaScript lives in the global namespace `WordTales`, defined at line 1098 of the HTML file. The init sequence (line 15570) is:

```
DOMContentLoaded → WordTales.App.init
```

That single call chains: render → initialize interactive modules → activate first vocab set → hydrate the learning profile from IndexedDB and migrate legacy localStorage data.

### Namespace layers

| Layer | Lines (approx.) | Role |
|---|---|---|
| `WordTales.Data` | 1107–13828 | Immutable vocab data (7 sets, 28 columns, 897 words, 132 paragraphs), plus lookup indexes (`setMap`, `columnMap`, `wordMap`, `paragraphMap`). Also exposes `addWords()`, `addParagraphs()`, `addSet()` for programmatic content extension. |
| `WordTales.Renderer` | 13830–13890 | Generates all DOM from data: set switcher buttons, TOC nav links, column sections with word cards and essay paragraphs. Escapes HTML via `escapeHtml()`. |
| `WordTales.Features` (IIFE at 13892) | 13892–15568 | All interactive modules live inside this closure. At the bottom (lines 15560–15568), individual sub-modules are exposed as top-level `WordTales.*` references. |

### Feature sub-modules (all under `WordTales.*`)

- **`Navigation`** — `switchSet()`: toggles visible vocab set, rebuilds sticky TOC, updates stats, cancels any in-progress TTS reading.
- **`Reader`** — Uses prerecorded MP3 plus static word cues when a column has `audio` metadata; otherwise uses speech synthesis with utterance-boundary highlighting. It also handles playback cleanup and recorded-audio fallback.
- **`WordPopup`** — Click a highlighted word in an essay → lookup via `data-vocab-id` → show POS/meaning popover + play pronunciation via SpeechSynthesis.
- **`Progress`** — Reads/writes `localStorage.starredWords`; syncs star state across main page and game.
- **`LearningProgress`** — Tracks word/card/game/article/analysis activity, schedules spaced reviews, and renders daily recommendations plus the four-state memory heatmap.
- **`Game`** — Full-screen drag-to-classify game. Floating word cards driven by `requestAnimationFrame`. Drag into "known" or "unknown" buckets; unknown words get starred.
- **`CopyPractice`** — Spelling practice filtered to starred words in the current column. Desktop: keyboard input. Mobile/tablet: horizontal-scroll Canvas handwriting board.
- **`Analysis`** — Toggles essay paragraphs to show Chinese translation + grammar notes with `<span class="keyword">` highlights.
- **`Cards`** — 3D card flip (CSS `transform`), bulk flip toolbar, entry points to Game and CopyPractice.
- **`App`** — `init()` orchestrates the startup sequence; also exposes `WordTales.App.init` for programmatic re-init.

### Data model

```
set → column → { words, paragraphs }
                   │         └── segments[] (string | { vocabId, text })
                   └── { id, word, pos, meaning }
```

Three integrity rules when editing content:
1. All `id` fields must be globally unique across sets/columns/words/paragraphs.
2. Paragraph segment `vocabId` values must reference real word IDs in the same column.
3. `analysis` objects live alongside paragraphs; `points` may contain `<span class="keyword">` markup for emphasis (everything else is HTML-escaped).

## Content-authoring skill

`.trae/skills/vocab-essay/SKILL.md` defines a workflow for generating new vocab sets from images of handwritten word lists. The pipeline: image → OCR word lists → write themed essays → build HTML. Use this when the user wants to add new vocabulary content from a photo.

## Deployment

GitHub Actions (`.github/workflows/jekyll-gh-pages.yml`) deploys on push to `main`: copies `vocab-essays/vocab-essays.html` to `_site/index.html` and publishes to GitHub Pages. Despite the workflow filename, no Jekyll processing runs.

## Tech constraints

- **HTML Audio + Web Speech API** — All current columns use bundled MP3 files and static cues. Future unrecorded columns and individual word pronunciation remain browser/OS-dependent; recorded audio falls back to speech synthesis if loading fails.
- **Canvas 2D** — used only for mobile handwriting in CopyPractice.
- **IndexedDB** — `wordtales-learning` stores the learning profile and append-only event records asynchronously.
- **localStorage** — `starredWords` remains for star compatibility; `wordtales.learning.v1` is now only a migration source and IndexedDB fallback.
- **CSS** — uses custom properties (defined on `:root`), 3D transforms for card flips, `position: sticky` for TOC, media queries for responsive layout, and print styles.
- **No external fonts loaded at runtime** — the CSS specifies `Lora`, `WorkSans`, etc. but these are expected to be system-installed or unavailable; fallback stacks are provided.
