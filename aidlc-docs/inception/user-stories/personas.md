# Personas

**Date**: 2026-08-25 · **Stage**: INCEPTION — User Stories
**Plan**: [`../plans/story-generation-plan.md`](../plans/story-generation-plan.md) (Q1 = A)

---

## An important qualification

**These personas are three modes of one person, not three people.**

This project has exactly one human user, who is also its developer, on a single Spotify account
capped by Development Mode. Modelling multiple user types would be fiction.

What is *not* fiction is that the same person uses this tool in three sharply different states of
attention, with different goals and different tolerance for interruption. Those differences
produce real, testable design constraints — most importantly, that **the interface serving one
mode would be actively wrong for another**. A display dense enough to satisfy the Curator would
be an irritation to the Listener; an editor as sparse as the Listener's display would make rule
authoring miserable.

Each persona below is therefore a **mode of use**, and its value is the constraint it imposes.

---

## P1 — The Listener

> *"Music is on. I'm doing something else. Tell me what this is without making me ask."*

| | |
|---|---|
| **Frequency** | Constant — this is the default state, hours per day |
| **Attention** | **Peripheral.** Working, reading, or otherwise occupied. Glances at the display for a second or two at a time |
| **Trigger** | A track starts and sounds interesting — or annoying |
| **Success** | Answered a question they had, in one glance, without breaking focus |
| **Failure** | Had to click something, wait, or notice the app at all when nothing was wrong |

### Goals
- Know what is playing without interrupting what they are doing
- Notice when something is unusually good — an unfamiliar artist worth following
- Have unwanted tracks disappear **without being asked to confirm anything**

### Constraints this persona imposes
- **The display must be readable at a glance and from a distance.** Information hierarchy matters
  more than information density.
- **It must never demand attention.** No modals, no confirmations, no notifications for normal
  operation.
- **It must update on its own.** A display requiring a refresh has failed this persona entirely.
- **Automated skips must be quiet.** The Listener wants the track *gone*, not a dialogue about it.
  But see P2 — the same person, later, will want to know exactly what happened and why.
- **Absent data must not read as an error.** An unresolved label is normal, not a fault, and must
  not look alarming to someone glancing at it.

### Stories
US-01, US-02, US-04, US-05, US-06, US-07, US-09, US-19, US-26

---

## P2 — The Curator

> *"Spotify keeps giving me things I don't want. I want to say precisely what I don't want, and
> have that enforced."*

| | |
|---|---|
| **Frequency** | Occasional and bursty — a sit-down session after accumulated annoyance |
| **Attention** | **Full and deliberate.** Chose to open the app to do this |
| **Trigger** | A pattern of unwanted tracks; or a rule that fired when it shouldn't have |
| **Success** | Expressed an intent precisely, saw evidence it would behave as expected, and armed it with confidence |
| **Failure** | Wrote a rule, couldn't predict what it would do, and had to arm it and hope |

### Goals
- Express an arbitrary condition over anything known about a track
- Understand what a rule *will* do **before** it is allowed to act
- Run several rules at once without them interfering with each other
- Recover immediately when a rule misbehaves

### Constraints this persona imposes
- **Every referenceable field must be discoverable.** The Curator cannot write rules over "any
  known information" if they must guess what is known — this is what forces the field catalogue
  (FR-28).
- **Rule behaviour must be predictable before arming.** Dry-run and back-testing are not
  conveniences for this persona; they are the difference between authoring and gambling.
- **Unknown data must be a decision, not a default.** The Curator must be able to state what a
  rule does when MusicBrainz has never heard of a release — because neither possible default is
  safe (R2).
- **Density is acceptable here.** This persona chose to be here and wants precision over calm.
- **Mistakes must be cheap and instantly reversible.** A wrong rule is expected and normal; an
  unrecoverable one is not.

### Stories
US-14, US-15, US-17, US-18, US-20, US-21, US-22, US-23, US-24, US-29

---

## P3 — The Analyst

> *"I think Spotify is pushing promoted tracks at me. I want to know whether that's actually
> true, or whether I've been telling myself a story."*

| | |
|---|---|
| **Frequency** | Rare — weeks or months apart, once enough history exists |
| **Attention** | **Full, investigative, and sceptical** — including of their own hypothesis |
| **Trigger** | Enough accumulated data to say something, or a suspicion that a rule isn't earning its place |
| **Success** | Reached a conclusion the data actually supports — including "the hypothesis is wrong" |
| **Failure** | Discovered the recorded data cannot answer the question, because of how it was stored |

### Goals
- Test whether major-label placement predicts their own skip behaviour (R1)
- Distinguish genuine signal from artefacts of how the data was collected
- Re-examine old data under a better classifier without having lost anything
- Retire rules that turn out not to work

### Constraints this persona imposes
- **Raw observations must survive.** This is the persona that makes FR-19/FR-20 non-negotiable:
  storing only a derived verdict destroys the ability to ask a better question later.
- **`unknown` must be distinguishable from `false`.** Collapsing them makes missing-data bias
  invisible — and here the missing data is *correlated with the variable being measured* (R2),
  which is the worst case.
- **The app's own actions must be separable from the user's.** Automated skips are the model's
  output; counting them as user dislike is circular (FR-23).
- **The analysis must be able to disconfirm.** A tool that can only confirm the hypothesis is
  worthless to this persona.

### Stories
US-10, US-11, US-12, US-13, US-24, US-25, US-28

---

## P4 — The Contributor *(added 2026-10-12, U8 — Requirements Question 20)*

> *"I've never seen this project before. I want to run it, understand why it is built the way it is, and change
> something without breaking what the owner learned the hard way."*

⚠️ **The first persona who is not the app's user.** P1–P3 describe the one person whose listening is recorded;
P4 works on the code, and may be an AI agent as well as a person.

| | |
|---|---|
| **Frequency** | Occasional — a fix, a feature, a review |
| **Attention** | Full, but **without the project's tacit knowledge** |
| **Trigger** | A bug they hit, a feature they want, a review they were asked for |
| **Success** | A change merged that CI judged, without needing the owner to explain anything the docs should have |
| **Failure** | Re-learned one of the project's traps by shipping it — or committed a credential |

### Constraints this persona imposes
- **Tacit knowledge must be written down where they will read it** (`CONTRIBUTING.md`, a short `CLAUDE.md`), and
  must stay accurate — a stale document is worse than none, because it is believed.
- **The checks must be enforced, not remembered**: CI on every PR, `main` protected (NFR-30).
- **Nothing secret may be reachable from a clone** (NFR-28).

### Stories
US-31

---

## Where the personas conflict

Recording these explicitly, because they are design decisions rather than oversights.

| Tension | Between | Resolution |
|---|---|---|
| A skip should be silent vs. explained | P1 wants it invisible; P2 needs to know why it fired | Skip quietly **in the moment**; record fully. P2 consults the log later (US-23). Never interrupt P1 to explain |
| Glanceable vs. dense | P1 needs hierarchy; P2 needs every field visible | Separate surfaces. The now-playing display serves P1; the rule editor and field catalogue serve P2 |
| Act fast vs. act on complete data | P1 wants the track gone immediately; P3 needs the decision to be sound | Pre-warm enrichment (FR-36) so both usually hold; on deadline expiry, act and **record that the decision was partial** (FR-35) |
| Convenient defaults vs. honest data | P2 wants rules that just work; P3 needs `unknown` never silently coerced | Tri-state is mandatory (FR-32); the *default* is no-match, but it is always a stated, recorded choice (FR-33) |

The last row is the one most likely to be eroded during implementation. Collapsing `unknown` to
`false` makes rules feel better to write and quietly destroys the dataset's value. It is called
out in NFR-25 as a property test for exactly this reason.

---

## Coverage

| Persona | Stories | Epics served |
|---|---|---|
| P1 Listener | 9 | Awareness, Understanding, Shaping (as beneficiary) |
| P2 Curator | 9 | Shaping, Control |
| P3 Analyst | 7 | Remembering, Hypothesis, Operations |

Every story maps to at least one persona. US-19 and US-24 serve two, and are marked as such in
[`stories.md`](stories.md).
