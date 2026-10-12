# U8 Frontend Components — Team Workflow & Onboarding

**Unit**: U8 · **Date**: 2026-10-12

U8's only UI change is **showing the app version** (NFR-34). Everything else in the unit is documents and CI.

## 1. Version display

| | |
|---|---|
| **Where** | The Settings pop-up (bottom, small text) — **not** the primary screen (memory: keep the primary screen clean) |
| **Text** | `Version 0.8.0` — and, for a pre-release, the full string (`1.0.0-beta.1`) |
| **Source** | Server-derived from `package.json` and sent with the existing Settings/diagnostics data; `public/app.js` only renders it (the U5/U6 precedent: `app.js` has no tests and cannot import `src/`) |
| **Unknown** | If `package.json` cannot be read the server reports `unknown`, and the UI shows **`Version unknown`** — never blank (an empty state explains itself) |

## 2. Diagnostics

`/api/diagnostics` gains an **App version** line beside the existing **schema version**, labelled so the two cannot
be confused (BR-66.6): *App version 0.8.0 · Database schema v7*.

## 3. API integration

No new route. The version rides on the existing diagnostics response and the Settings status payload.
