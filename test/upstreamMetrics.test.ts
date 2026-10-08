/**
 * LC-28 — M1…M4, and **PBT-50** (the window is a function of records and `now`, with no ambient clock).
 *
 * ## ⚠️ What makes these worth testing rather than trivial
 *
 *   - **M2 must COUNT, not log.** `successor_lag_ms` was `null` on all 662 rows for its entire life
 *     because the two methods meant to write it had no callers — and a structurally empty field reads
 *     as *this never happens*. A rate-limit counter that is always zero because nothing increments it
 *     is the same defect, in the one metric meant to prove the app is well-behaved.
 *   - **A ratio with an empty denominator is `null`, not `0`.** "Zero requests per play" and "no plays
 *     yet" are different facts, and this project's standing rule is that `null` is unknown.
 *   - **The 30-second window is Spotify's own.** An hourly mean hides exactly the burst that would trip
 *     a limit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';
import './fc-config.js';

import { pollOutcomeOf, SPOTIFY_WINDOW_MS, UpstreamMetrics } from '../src/playback/upstreamMetrics.js';

const NOW = 1_700_000_000_000;

describe('M1 — rate per upstream, in Spotify’s own 30s window and per hour', () => {
  it('counts requests inside the 30s window', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW - 10_000);
    m.record('spotify', 'ok', NOW - 20_000);
    m.record('spotify', 'ok', NOW - 29_000);

    const s = m.snapshot(NOW);
    assert.equal(s.perUpstream.spotify.rolling30s, 3);
    assert.equal(s.perUpstream.spotify.perHour, 3);
  });

  it('⚠️ excludes from the 30s window what the hourly count still includes', () => {
    // This is the point of reporting both: a burst five minutes ago is invisible to the 30s window and
    // very visible to the hour, and only one of them is the window Spotify actually uses.
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW - 5 * 60_000);
    const s = m.snapshot(NOW);
    assert.equal(s.perUpstream.spotify.rolling30s, 0);
    assert.equal(s.perUpstream.spotify.perHour, 1);
  });

  it('the window is half-open: exactly 30s old has aged out', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW - SPOTIFY_WINDOW_MS);
    m.record('spotify', 'ok', NOW - SPOTIFY_WINDOW_MS + 1);
    assert.equal(m.snapshot(NOW).perUpstream.spotify.rolling30s, 1);
  });

  it('keeps the three upstreams separate', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW);
    m.record('musicbrainz', 'ok', NOW);
    m.record('musicbrainz', 'ok', NOW);
    m.record('mcp', 'ok', NOW);

    const s = m.snapshot(NOW);
    assert.equal(s.perUpstream.spotify.perHour, 1);
    assert.equal(s.perUpstream.musicbrainz.perHour, 2);
    assert.equal(s.perUpstream.mcp.perHour, 1);
  });

  it('⚠️ prunes records older than the retention window, so it is not a slow leak', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW - 2 * 60 * 60_000);
    assert.equal(m.snapshot(NOW).perUpstream.spotify.perHour, 0);
  });
});

describe('⭐ M2 — rate limits are COUNTED and the Retry-After is KEPT', () => {
  it('counts a rate-limited request and records its Retry-After', () => {
    // webApiClient.ts currently throws with the Retry-After inside a message string, so the app has no
    // idea whether it has ever been rate-limited. That is the gap this closes.
    const m = new UpstreamMetrics();
    m.record('spotify', 'rate-limited', NOW - 1_000, 30_000);

    const s = m.snapshot(NOW).perUpstream.spotify;
    assert.equal(s.rateLimitHits, 1);
    assert.equal(s.lastRetryAfterMs, 30_000, 'the value must survive, not be formatted into a string');
    assert.equal(s.lastRateLimitedAtMs, NOW - 1_000);
  });

  it('a rate-limited request still counts toward the rate', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'rate-limited', NOW, 1_000);
    assert.equal(m.snapshot(NOW).perUpstream.spotify.rolling30s, 1, 'it was still a request we made');
  });

  it('counts errors separately from rate limits', () => {
    const m = new UpstreamMetrics();
    m.record('spotify', 'error', NOW);
    m.record('spotify', 'rate-limited', NOW, null);
    const s = m.snapshot(NOW).perUpstream.spotify;
    assert.equal(s.errors, 1);
    assert.equal(s.rateLimitHits, 1);
  });

  it('⚠️ zero hits means "below the limit", NOT headroom', () => {
    // Recorded as an assertion on the shape rather than a comment alone: the counter being zero is
    // compatible with sitting at 99% of an undocumented ceiling. Spotify publishes no number.
    const m = new UpstreamMetrics();
    for (let i = 0; i < 100; i += 1) m.record('spotify', 'ok', NOW - i * 100);
    const s = m.snapshot(NOW).perUpstream.spotify;
    assert.equal(s.rateLimitHits, 0);
    assert.equal(s.lastRetryAfterMs, null, 'and there is no observed limit to compare against');
  });
});

describe('M3 — requests per play, the efficiency measure', () => {
  it('divides requests by plays', () => {
    const m = new UpstreamMetrics();
    for (let i = 0; i < 10; i += 1) m.record('spotify', 'ok', NOW - i);
    m.recordPlay();
    m.recordPlay();
    assert.equal(m.snapshot(NOW).requestsPerPlay, 5);
  });

  it('⚠️ is NULL with no plays, not zero', () => {
    // "Zero requests per play" and "no plays yet" are different facts. null is unknown and is never 0.
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW);
    assert.equal(m.snapshot(NOW).requestsPerPlay, null);
  });
});

describe('⭐ M4 — the positive liveness signal', () => {
  it('reports the share of polls that found nothing playing', () => {
    const m = new UpstreamMetrics();
    for (let i = 0; i < 3; i += 1) m.recordPoll('playing');
    for (let i = 0; i < 1; i += 1) m.recordPoll('idle');
    assert.equal(m.snapshot(NOW).idleShare, 0.25);
    assert.equal(m.snapshot(NOW).pollsTotal, 4);
  });

  it('⚠️ distinguishes "polling and hearing silence" from "not polling"', () => {
    // The 2026-09-30 outage ran ~13 hours unnoticed because "no new rows" is ambiguous in both
    // directions. A high idle share with a non-zero total says the instrument is alive and the user is
    // not listening; a total of zero says the instrument is not running.
    const alive = new UpstreamMetrics();
    for (let i = 0; i < 100; i += 1) alive.recordPoll('idle');
    const dead = new UpstreamMetrics();

    assert.equal(alive.snapshot(NOW).idleShare, 1, 'alive, hearing silence');
    assert.equal(alive.snapshot(NOW).pollsTotal, 100);

    assert.equal(dead.snapshot(NOW).idleShare, null, 'not polling at all');
    assert.equal(dead.snapshot(NOW).pollsTotal, 0);
  });

  it('⚠️ is NULL before any poll, not zero', () => {
    const m = new UpstreamMetrics();
    assert.equal(m.snapshot(NOW).idleShare, null);
  });
  // ─── U7 (P-55, BR-58.3) ────────────────────────────────────────────────────────────────────────────────
  it('PBT-65: an error poll is neither playing nor idle — it is counted apart and excluded from the share', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('playing' as const, 'idle' as const, 'error' as const)), (outcomes) => {
        const m = new UpstreamMetrics();
        for (const o of outcomes) m.recordPoll(o);
        const snap = m.snapshot(NOW);
        const playing = outcomes.filter((o) => o === 'playing').length;
        const idle = outcomes.filter((o) => o === 'idle').length;
        const errors = outcomes.filter((o) => o === 'error').length;
        assert.equal(snap.pollsTotal, outcomes.length);
        assert.equal(snap.pollsIdle, idle);
        assert.equal(snap.pollsError, errors);
        assert.equal(snap.idleShare, playing + idle === 0 ? null : idle / (playing + idle));
      }),
    );
  });

  it('⚠️ a run of nothing but errors is UNKNOWN, not "100% idle" — a credential outage is not listening silence', () => {
    const m = new UpstreamMetrics();
    for (let i = 0; i < 5; i += 1) m.recordPoll('error');
    assert.equal(m.snapshot(NOW).idleShare, null);
    assert.equal(m.snapshot(NOW).pollsError, 5);
  });
});

describe('pollOutcomeOf — PBT-65, the snapshot shapes the poll service really publishes', () => {
  it('an error snapshot is an error — checked before `playing`', () => {
    assert.equal(pollOutcomeOf({ error: 'Spotify returned an error: x', detail: 'x' }), 'error');
  });

  it('F5 regression: the text-error snapshot that USED to arrive (playing: true, fields null) was a "playing" poll', () => {
    // Kept to document the defect: before FR-71 this exact shape reached recordPollMetrics. FR-71 turns it into
    // an error snapshot upstream; if that ever regresses, this is what the metric would see.
    assert.equal(pollOutcomeOf({ playing: true, track: null, trackId: null, isPlaying: false }), 'playing');
  });

  it('nothing playing is idle; a track is playing', () => {
    assert.equal(pollOutcomeOf({ playing: false }), 'idle');
    assert.equal(pollOutcomeOf({ playing: true, trackId: 'abc' }), 'playing');
  });
});

describe('PBT-50 — the snapshot is a function of (records, now) alone', () => {
  it('the same records and the same now give the same answer', () => {
    const build = () => {
      const m = new UpstreamMetrics();
      m.record('spotify', 'ok', NOW - 1_000);
      m.record('musicbrainz', 'rate-limited', NOW - 2_000, 1_200);
      m.recordPoll('playing');
      m.recordPlay();
      return m;
    };
    assert.deepEqual(build().snapshot(NOW), build().snapshot(NOW));
  });

  it('⚠️ advancing `now` alone changes the window, with no new records', () => {
    // Which is the proof there is no ambient clock: the answer moves because the parameter moved.
    const m = new UpstreamMetrics();
    m.record('spotify', 'ok', NOW);
    assert.equal(m.snapshot(NOW).perUpstream.spotify.rolling30s, 1);
    assert.equal(m.snapshot(NOW + SPOTIFY_WINDOW_MS + 1).perUpstream.spotify.rolling30s, 0);
  });
});
