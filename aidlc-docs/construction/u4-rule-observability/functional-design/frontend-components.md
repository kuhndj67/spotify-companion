# Frontend Components — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — Functional Design, U4 *(added after Q4)*

U4 is the first unit with meaningful UI of its own. Three components, all **read-only**: rule
editing is out of scope (Application Design Q2 = A).

> ⚠️ **`public/app.js` has no tests and is not covered by the orphan check**, which walks `src/`
> only. Both real defects found there — the liked-refresh race and the "every axis tick says Aug"
> bug — were found by **clicking**. That is the standing reason U4's live verification is a gate,
> and the reason these components are specified rather than improvised.

---

## FC-1 · Status bar — compact application health

Requested at Q4: *"a header or footer that provides key visuals for app status, often an error text
field and a number of status indicators (red/green with short text) — compact, intended for a quick
app health status indication."*

### Structure

```
┌────────────────────────────────────────────────────────────────────────┐
│ ● Recording   ● Rules v6   ● Connected   ● Spotify        [detail ▾]   │
└────────────────────────────────────────────────────────────────────────┘
        on fault, the row is replaced/prefixed by one error message:
┌────────────────────────────────────────────────────────────────────────┐
│ ⚠ History recording is OFF — database unavailable. Plays are not being │
│   saved.                                    ● Rules v6  ● Connected    │
└────────────────────────────────────────────────────────────────────────┘
```

Fixed to the **bottom**, single row, collapsing to two rows at phone width.

### The four indicators

| Indicator | `ok` | `warn` | `fail` | `unknown` |
|---|---|---|---|---|
| **Recording** | writing to `history.db`, `gaps == 0` | **`degraded`, or `gaps > 0`** | repository null — **not recording** | before first status |
| **Rules** | `v6 applied` | `reloading` | `v7 rejected — running v6` | no rules file |
| **Connection** | WebSocket open | reconnecting | closed | before first attempt |
| **Spotify** | last snapshot carried no `error` | transient `error`, retrying | `error` persisting | before the first snapshot |

### ⚠️ Recording: `repository !== null` is the *least* likely fault *(revised 2026-09-20)*

A null repository happens once, at startup, on a failed migration. The likelier fault is a
**runtime write failure**, and the observer already tracks it: `#degraded` is set and `#gaps` is
incremented every time `recordPlay` throws ([PlayObserver.ts:225](../../../../src/history/PlayObserver.ts)).
An indicator reading only the constructor's outcome shows **green while plays are being dropped** —
a false green about the one artefact that cannot be regenerated, which is the exact failure the
four-state rule was written to prevent.

`gaps` is **sticky**: it counts plays already lost, so it must not clear when writes recover. The
recovery is visible as `degraded` going false; the loss is permanent and stays on the display.

### ⚠️ Spotify: do **not** poll `/api/health` *(revised 2026-09-20)*

`/api/health` performs a **real MCP round-trip** per request. Polling it to keep a dot warm spends
upstream budget that label resolution needs — the same reasoning that stopped the liked badge
being polled (*"~12 requests on a timer to keep a badge warm"*).

The WebSocket **already delivers** the snapshot's `error` state on every poll, at no extra cost.
The dot reads that. `/api/health` stays exactly what it is: the thing you open **on click**, when
the dot is already red and you want to know whether Spotify is actually implicated.

### ⚠️ Four states, not three — and `unknown` is never drawn as `ok`

**A status dot that shows green because nothing has reported yet is this project's central defect
wearing a UI hat.** `null` means unknown and is never `false` or `0` — end to end, including here.
An indicator that has not yet heard from its subsystem renders **grey/unknown**, never green.

This matters most on **Recording**, because a false green there says *"your listening is being
saved"* about the one artefact that cannot be regenerated.

### Accessibility and modern practice

- **Colour is never the only channel.** Every indicator carries a short text label beside its dot,
  and a distinct glyph per state (`●` ok, `◐` warn, `✕` fail, `○` unknown). Red/green alone fails
  for the ~8% of men with red-green colour deficiency, and this bar is *only* red and green.
- The bar is a **`role="status"` / `aria-live="polite"`** region; the error text is
  **`role="alert"`** so a failure is announced rather than merely rendered.
- Each indicator is a `<button>` exposing detail on click — not hover-only, which is unusable on
  touch and invisible to keyboards. Detail includes the **age of the answer**, following the
  precedent set by the liked badge's tooltip.
- Respects `prefers-reduced-motion`: no pulsing dots.
- Minimum tap target 44×44 px.

### ⚠️ It must not become decorative

Every indicator answers a question someone would otherwise have to ask, and each has a defined
`unknown`. **An indicator with no failure mode should be removed rather than shown permanently
green** — a bar that is always green stops being read, and then the one time it is red, it is not
read either.

---

## FC-2 · Rules panel — read-only

Lists the loaded rule set: **version and state** (the Rules indicator's detail view), and per rule
its name, enabled state, `onUnknown` mode, action, and — where applicable — its
**`DisabledReason` and detail**.

⚠️ **A disabled rule must say why, in words.** U3 stores a reason for exactly this; a rule that
silently does nothing is indistinguishable from a rule that does not match. That includes the
`onUnknown: 'hold'` case, which is **stored and disabled with a reason** because FR-33 is partial
until U5 — the panel must say *"disabled: 'hold' is not supported until automated skipping ships"*
rather than showing it as inert.

⚠️ **Rejected-reload state names the running version**: *"v7 rejected — rule 'skip majors'
references unknown field `album.kind`. Still running v6."* A red light that only says something
failed leaves the ambiguity the indicator exists to remove.

---

## FC-3 · Decision log — read-only table

| Column | Notes |
|---|---|
| Time | The decision instant, not the play start |
| Track / artist | From the decision row, not joined live |
| Rule | Name as evaluated — denormalised, so a renamed rule does not rewrite history |
| Verdict | `true` / `false` / **`unknown`**, rendered as three distinct things |
| Matched | Whether it contributed after `onUnknown` |
| Fields seen | Expandable; **nulls shown explicitly as `unknown`**, never blank |

Controls: a **matches-only** filter and a rule filter. Nothing else.

### ⚠️ Rendering rules carried from the existing UI

- **`unknown` is never blank and never `false`.** A blank cell hides a bias instead of showing it,
  and missing data here correlates with what is being measured (R2).
- **`partialData` is shown**, labelled as *"decided before enrichment finished"* — it is the
  measurement that says whether `ENRICHMENT_WAIT_MS` is right.
- **An empty log explains itself**: *"No decisions recorded — no rules are active"* or *"…no plays
  since the last restart"*, never a bare dash. `Label detail` rendered `—`, was read as broken, and
  was nearly deleted; an empty state that does not explain itself eventually gets removed by
  someone who assumes it is broken.

---

## Data flow

```
GET /api/rules      -> FC-2, and the Rules indicator in FC-1
GET /api/decisions  -> FC-3
WebSocket snapshot  -> the Spotify indicator (error state, already broadcast — NOT /api/health)
WebSocket           -> the Connection indicator (existing socket; no new surface)
GET /api/health     -> the Spotify indicator's DETAIL view, on click only (real MCP round-trip)
POST /api/rules/reload -> the reload button (P-19); re-reads, never writes
```

⚠️ **No new WebSocket surface.** The upgrade handler is the one place the admission rule must be
invoked explicitly, and `localGuard.test.ts` pins it structurally because of the `403`. FC-3 polls
over HTTP; only the existing socket drives FC-1's Connection indicator.

---

## Testing

`public/app.js` is untested and outside the orphan check. U4 does not fix that wholesale, but:

- Pure rendering helpers — indicator state derivation, the `unknown`-vs-`false` mapping, empty-state
  text selection — go in **`src/`** as pure functions with tests, and the page calls them.
- ⚠️ **State derivation is where a false green would come from**, so it is the part that must not
  live in an untested file. The DOM wiring can stay in `app.js`; the *judgement* cannot.
