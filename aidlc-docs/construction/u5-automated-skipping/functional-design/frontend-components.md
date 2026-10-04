# Frontend Components — U5: Automated Skipping

**Date**: 2026-09-26 · **Stage**: CONSTRUCTION — Functional Design, U5
**Continues from**: U4's read-only status bar, rules panel and decision log

U5 adds **two** UI surfaces, both asked for by the user (Q4, Q5), plus the runaway acknowledgement
that BR-35.6 requires. Nothing else changes.

> ### The constraint both requests share
>
> **The primary screen stays as clean as possible.** The user set this explicitly for the kill switch
> (*"put the UI button on the Rules pop-up"*) and implied it for the evaluation state (*"to keep the
> status line clean I suggest not adding more text"*). Every decision below serves it.

---

## 1. FC-U5-1 — the evaluation-state indicator

**User request (Q4)**: show `hold` and evaluation state as colour on the status line rather than as
more text. Suggested palette: *White-idle, Grey-disabled, Yellow-hold, Yellowgreen-passed with missing
info, Green-passed, Red-Failed* — explicitly *"not dictating the solution"*.

### ⚠️ It cannot be the `Rules v#` indicator, and the reason is in the code

`rulesIndicator` (`src/ui/statusBar.ts`) already maps **all four** `IndicatorLevel` values, to a
different variable — **rules-file load health**:

| Level | Current meaning |
|---|---|
| `unknown` | The rules engine is not running, or no file has ever been loaded |
| `warn` | Re-reading the rules file |
| `fail` | ⚠️ A newer rules file was **rejected** — and the label **names the version still in force** |
| `ok` | Applied: *N active, M disabled* |

Its docstring pins why `fail` is load-bearing there (**FQ5**):

> *A light that only says "something failed" leaves exactly the ambiguity the indicator exists to
> remove, and a silent last-known-good is indistinguishable from a successful reload.*

⚠️ **Recolouring it would make red mean either *your rules file is broken* or *a rule matched and the
skip failed*** — two independent variables on one light, destroying the distinction it was built to
carry. A user seeing red would not know whether to open their rules file or their decision log.

### ✅ So: a second, adjacent compact indicator

It reuses the existing `Indicator` contract and sits beside `Rules v#`. **This still meets the stated
goal** — no added prose, one more dot in a row that already has several.

| State | Meaning | Source |
|---|---|---|
| `idle` | No play is currently being evaluated | — |
| `disabled` | Automation off, or every rule dry-run or disabled | BR-33.1/33.2 |
| `hold` | A rule is holding, pending enrichment | BR-38 |
| `passed-partial` | Decided on **partial data** | BR-38.4, BR-22.4 |
| `passed` | Decided on complete facts | BR-22.5 |
| `failed` | ⚠️ A skip was attempted and **not confirmed** | BR-43.3/43.5 |
| `halted` | ⚠️ **Runaway halt in force** — added; not in the user's list, and it must be visible | BR-35.4 |

### ⚠️ Colour cannot be the only channel, and that is already decided

`statusBar.ts` states it in the contract itself:

> `label`: *Short text beside the dot.* ⚠️ **Colour is never the only channel.**
> `glyph`: *A distinct glyph per level, for the same reason.*

So each state needs **a glyph as well as a colour**, exactly as `ok/warn/fail/unknown` have `● ◐ ✕ ○`
today. That is not a departure from the user's request — it is what keeps the indicator readable to
someone who cannot distinguish `Green` from `Yellowgreen`, which is the single hardest pair in the
proposed palette.

⚠️ **`IndicatorLevel` must widen** to carry seven states. The union has **no `default:` clause**
anywhere it is switched, so the compiler will name every site that has to change — the same
deliberate pattern as `applyOnUnknown`. **Do not add a `default:` to silence it.**

### ⚠️ Flashing: recommended against, and offered as an option the user can overrule

The user suggested *"color/flashing queues"*. Flashing is **not** recommended as a state channel:

1. It is an **accessibility hazard** — photosensitivity and vestibular triggers — on a display
   intended to sit visible for hours.
2. It **cannot encode seven states**, so it would have to duplicate something colour already says.
3. ⚠️ On a display the user leaves running, motion reads as *something is wrong* regardless of which
   state is flashing, which is the opposite of a calm idle.

**Recommended instead**: a single transient **pulse on state change**, no sustained animation. If the
user wants sustained flashing for `failed` or `halted` specifically, that is a reasonable call and is
theirs to make — it is the two states where *demanding attention* is the point.

### Where the code goes

⚠️ **The judgement goes in `src/ui/statusBar.ts`, pure and tested. The DOM wiring goes in
`public/app.js`.** That split is not stylistic — `app.js` has **no tests** and is outside the orphan
check, which walks `src/` only, and *both* real defects ever found in it (the liked-refresh race, and
the *"every axis tick says Aug"* bug) were found **by clicking**. A false green would come from exactly
this judgement, so the judgement must be testable.

---

## 2. FC-U5-2 — the kill switch

**User decision (Q5)**: *"put the UI button on the Rules pop-up (Primary screen needs to be kept as
clean as possible)."*

| | |
|---|---|
| Surface | A button **on the Rules pop-up**, plus an API route (BR-34.6) |
| State shown | Current `globalAutomationEnabled`, read from **`/state/automation-state.json`** (⚠️ amended 2026-10-01 from `config/` — see BR-34.1) |
| Effect | Persisted atomically; checked at the **action point** (BR-33.5, BR-34.7) |
| ⚠️ Not on | The primary screen. It is a control, not a status |

⚠️ **The indicator in FC-U5-1 shows `disabled` when automation is off**, so the primary screen still
answers *is this thing armed?* without carrying the control. That is the point of splitting them.

### ⚠️ The failure mode to test for specifically

`config/` is mounted **`:ro`** today (`compose.yaml:202`), and **U5 is the first unit that writes
there**. Until the mount becomes `:rw`, every save fails.

⚠️ **This will present as a kill switch that works in the UI and does not persist** — the worst
possible failure mode for this particular control. The button would flip, the page would re-render
from client state, and a restart would silently re-arm automation.

**So**: the button reflects **what was read back from disk**, never optimistic client state, and a
failed write is surfaced as an error rather than swallowed. And verify **through the container**, not
on the host — on the host the write succeeds and the bug is invisible.

---

## 3. FC-U5-3 — the runaway acknowledgement

BR-35.6: the halt clears on **explicit user acknowledgement only**, and BR-35.8 requires that the
surface state **what tripped it**.

| Shows | Source |
|---|---|
| Which threshold tripped — consecutive or hourly | `RunawayHalt.trigger` |
| The count observed, and the threshold in force **at that moment** | `RunawayHalt.observedCount`, `.threshold` |
| A link to the `SkipAttempt` rows that counted | `RunawayHalt.attemptIds` |

⚠️ **REVISED 2026-10-04 — ONE button, not two.** The original text follows, struck through, because the
*distinction* it protects is right and its *mechanism* was wrong.

~~Two buttons, never one: *"I have reviewed this"* and *"turn automation back on"* are different
statements, and a single button would make the system's halt indistinguishable from the user's own
choice.~~

**What was wrong with it.** Shown together — and alongside the kill switch, which BR-33.4 leaves reading
*"Turn automation off"* through a halt — that is **three controls on screen for one recovery**. Every
ordering then has to be defined and defended (what does pressing the switch before acknowledging mean?),
and none of the variations adds anything. ⚠️ **It turns a linear process into a state machine.**

**What replaces it, and why it is stricter rather than looser:**

| State | Controls shown |
|---|---|
| **Halted** | **one** — *"I have reviewed this — clear the halt and leave automation off"* |
| Not halted | **one** — the ordinary kill switch |

⚠️ **Acknowledging unconditionally sets `globalAutomationEnabled: false`**, so resuming is unavoidably a
**second, deliberate act** on the ordinary switch. With two buttons, one click could clear a safety latch
*and* re-arm — which is precisely what BR-35.5 exists to prevent. **Sequencing the two acts separates
them more strictly than juxtaposing them.**

⚠️ **The switch is NOT RENDERED while halted**, because nothing is being skipped and it has no safety
role there. The region is not blank: it explains why, and points down at the one available action.

⚠️ **BR-35.5 and BR-35.6 are UNCHANGED.** BR-35.5 says the halt is a *third latch* and that
acknowledging and enabling are *different acts*; both hold. BR-35.6's *explicit acknowledgement only*
holds — the single button is that acknowledgement.

⚠️ **The acknowledgement must not be the only place the halt is visible.** A user who does not open
the Rules pop-up would see automation silently doing nothing. That is what FC-U5-1's `halted` state is
for.

---

## 4. What does NOT change

| | Why |
|---|---|
| Rule **authoring** stays file-based | U4 shipped a read-only panel deliberately; authoring is out of scope for U5 |
| The decision log view | U4's, unchanged. `SkipAttempt` joins to it by `evaluationId` |
| The statistics panel | Untouched. ⚠️ `not-observed` stays **counted everywhere and drawn nowhere** — do not tidy it out |
| The liked badge | Untouched. It is a **button**, and nothing polls it by design |
| `Rules v#` | ⚠️ **Not recoloured** — see §1. Its four levels stay bound to load health |

---

## 5. ✅ No longer deferred — P-U5-1 discharged 2026-09-27

`failed` in FC-U5-1 depends on **BR-43.5**, which this section recorded as provisional. **It is now
settled.** The confirmation is `progress_ms` reset **+** a track-id change with a **~3 s grace**
(BR-43.3/43.4), and the hazard this section warned about — *"the reported track changes 18–41 s before
the audible one"* — is **false**: audio follows the reported boundary within ~2 s. ⚠️ **The mechanism
was also backwards**: the DJ stops *playing* early and reports it accurately.

⚠️ **The warning that still applies, restated so it is not lost with the correction:** an indicator
that renders `passed` because the confirmation is guaranteed to succeed is worse than no indicator —
it is a green light asserting something nobody checked. The ~3 s grace is what keeps `failed`
reachable rather than decorative, so **there must be a test that drives FC-U5-1 into `failed`**. A
state that no test can enter is the `recordSuccessorLag` trap in UI form: a live module, a dead
branch, and a coverage figure that looks fine.
