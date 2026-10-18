/**
 * LC-48 — the server-derived views the UI renders (frontend-components §1–§4). app.js has no tests, so what a
 * section SAYS is decided and tested here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RulesComparison } from '../src/configuration/rulesComparison.js';
import { musicbrainzSectionView, spotifySectionView } from '../src/ui/credentialsPanel.js';
import { spotifyIndicator } from '../src/ui/statusBar.js';
import { comparisonView, statusView } from '../src/ui/maintenancePanel.js';
import { appliedMessage, comparisonPanelView, rulesConfirmView, rulesFileStatusView } from '../src/ui/rulesFilePanel.js';

const EMPTY: RulesComparison = {
  added: [], removed: [], changed: [], unchanged: [], wouldDisable: [], becomesLive: [],
  currentCount: 0, nextCount: 0, massRemoval: false, identical: true,
};

describe('comparisonPanelView — the ONE comparison rendering (BR-53.6, BR-53.7)', () => {
  it('⚠️ the "becomes live" warning is separate, first, and in words', () => {
    const v = comparisonPanelView({ ...EMPTY, identical: false, added: [{ id: 'r9', name: 'Majors' }], becomesLive: [{ id: 'r9', name: 'Majors' }] });
    assert.deepEqual(v.liveWarning, ['Majors (r9) will be able to skip tracks once automation is on — it could not before.']);
    assert.equal(v.heading, '1 added');
  });

  it('removed comes before added, and changed names its fields', () => {
    const v = comparisonPanelView({
      ...EMPTY, identical: false,
      removed: [{ id: 'a', name: 'a' }], added: [{ id: 'b', name: 'b' }],
      changed: [{ id: 'c', name: 'Cee', fields: ['predicate', 'dryRun'] }],
    });
    assert.deepEqual(v.sections.map((x) => x.title), ['Removed', 'Added', 'Changed']);
    assert.deepEqual(v.sections[2]!.items, ['Cee (c) — predicate, dryRun']);
    assert.equal(v.heading, '1 added, 1 removed, 1 changed');
  });

  it('nothing changed says so', () => {
    assert.equal(comparisonPanelView(EMPTY).heading, 'No changes');
  });
});

describe('rulesConfirmView and rulesFileStatusView', () => {
  it('the typed word and its reason travel together', () => {
    const v = rulesConfirmView({ kind: 'upload', typedConfirmationRequired: true, typedConfirmationReason: 'This removes 4 of your 4 rules.' }, 'REPLACE');
    assert.deepEqual(v, { needsWord: true, word: 'REPLACE', reason: 'This removes 4 of your 4 rules.', applyLabel: 'Apply' });
  });

  it('BR-55.4: undo is DISABLED with a reason when there is nothing to undo — never hidden', () => {
    const v = rulesFileStatusView({ hash: 'h', hasPrevious: false, lastWrite: null });
    assert.deepEqual(v.undo, { label: 'Undo last rules change…', disabled: true, reason: 'Nothing to undo yet.' });
    // The assurance moved beside the Upload button when each button got its own row (2026-10-11) — still shown.
    assert.match(v.rowNotes.upload, /Never turns automation on/);
  });

  it('no rules file yet: download is disabled and says why', () => {
    assert.equal(rulesFileStatusView({ hash: null, hasPrevious: false, lastWrite: null }).download.disabled, true);
  });

  it('the applied message reports the ENGINE’s version and no restart', () => {
    assert.match(appliedMessage(12, { ...EMPTY, identical: false, added: [{ id: 'x', name: 'x' }] }), /version 12; no restart needed/);
  });
});

describe('credentials sections (BR-56.6–56.8, BR-57)', () => {
  it('the Spotify status says set / source / when — and the save warning says nothing is kept', () => {
    const v = spotifySectionView({
      set: true, clientIdMasked: '3f2a…91c0', redirectUri: 'http://127.0.0.1:8888/callback',
      secretSet: true, refreshTokenSet: true, replacedAt: '2026-10-08T14:02:00.000Z', source: 'app',
    });
    assert.equal(v.status, 'Set · client 3f2a…91c0 · replaced 2026-10-08 14:02 UTC');
    assert.match(v.saveWarning.join(' '), /not kept anywhere/);
    assert.match(v.saveWarning.join(' '), /turns red/);
    assert.ok(v.guidance.some((g) => g.includes('npm run auth')), 'U8 must keep this in step with the install routine');
  });

  it('not set explains the consequence', () => {
    const v = spotifySectionView({ set: false, clientIdMasked: null, redirectUri: null, secretSet: false, refreshTokenSet: false, replacedAt: null, source: 'none' });
    assert.match(v.status, /^Not set/);
  });

  it('MusicBrainz: a contact saved while labels are off says it needs a restart', () => {
    assert.equal(musicbrainzSectionView({ set: true, masked: 'l…r@example.org' }, true).note, null);
    assert.match(musicbrainzSectionView({ set: false, masked: null }, false).note ?? '', /next restart/);
  });
});

describe('the restore dialog’s rules option (BR-59.2)', () => {
  const base = {
    backup: { takenAt: '2026-10-02T21:14:00Z', plays: 951, decisions: 1120, schemaVersion: 7 },
    current: { takenAt: null, plays: 977, decisions: 1214, schemaVersion: 7 },
  };

  it('no option when the rules are identical or absent', () => {
    assert.equal(comparisonView({ ...base, rules: 'identical', rulesComparison: null, rulesInvalid: null }, 'RESTORE').rulesOption, null);
    assert.equal(comparisonView({ ...base, rules: 'none', rulesComparison: null, rulesInvalid: null }, 'RESTORE').rulesOption, null);
  });

  it('differs and valid → offered, with the shared comparison panel', () => {
    const v = comparisonView({ ...base, rules: 'differs', rulesComparison: { ...EMPTY, identical: false, added: [{ id: 'x', name: 'x' }] }, rulesInvalid: null }, 'RESTORE');
    assert.equal(v.rulesOption?.disabled, false);
    assert.equal(v.rulesOption?.panel?.heading, '1 added');
    assert.match(v.rulesNote, /stay as they are unless you tick/);
  });

  it('differs but INVALID → shown disabled with the validator’s reason, never hidden', () => {
    const v = comparisonView({ ...base, rules: 'differs', rulesComparison: null, rulesInvalid: ['rules[0].onUnknown: bad'] }, 'RESTORE');
    assert.equal(v.rulesOption?.disabled, true);
    assert.match(v.rulesOption?.reason ?? '', /not valid.*onUnknown/);
  });
});

describe('after the restart, the rules outcome is said separately (BR-59.7)', () => {
  const status = (rulesResult?: import('../src/maintenance/startupRestorer.js').RulesRestoreResult) => ({
    busy: null,
    backup: { available: true as const },
    lastRestore: { kind: 'applied' as const, takenAt: '2026-10-02T21:14:00Z', plays: 951, ...(rulesResult ? { rulesResult } : {}) },
    previous: null,
    sweptAtStartup: 0,
    sizes: { databaseBytes: 1, uploadCapBytes: 2, expandedCapBytes: 3 },
    supervised: true,
    startedAt: '2026-10-08T12:00:00Z',
  });

  it('applied → says so, and that Undo last restore does not change rules', () => {
    assert.match(statusView(status('applied')).lastRestore?.text ?? '', /rules were applied too.*Undo last rules change/);
  });

  it('skipped → says why, and that the rules are unchanged', () => {
    assert.match(statusView(status({ skipped: 'your rules changed after you confirmed' })).lastRestore?.text ?? '', /NOT applied: your rules changed.*unchanged/);
  });

  it('not requested → no rules sentence at all', () => {
    assert.doesNotMatch(statusView(status('not-requested')).lastRestore?.text ?? '', /rules/);
  });
});

describe('the Spotify indicator’s wording (U7 Build & Test defect)', () => {
  it('a refusal from Spotify is stated once — never "not answering: Spotify returned an error"', () => {
    const v = spotifyIndicator({ hasSnapshot: true, snapshotError: 'Spotify returned an error: Error getting current track: Failed to refresh access token.' });
    assert.equal(v.level, 'fail');
    assert.equal(v.detail, 'Spotify returned an error: Error getting current track: Failed to refresh access token.');
  });

  it('a transport failure still says the connection is not answering', () => {
    const v = spotifyIndicator({ hasSnapshot: true, snapshotError: 'Could not reach the Spotify MCP server.' });
    assert.match(v.detail, /^Spotify is not answering: Could not reach/);
  });
});

describe('one button per row, with its description (user, 2026-10-11)', () => {
  it('rules rows: a description each — and a disabled button’s row says WHY instead', () => {
    const live = rulesFileStatusView({ hash: 'h', hasPrevious: true, lastWrite: null }).rowNotes;
    assert.match(live.download, /Saves your current rules file/);
    assert.match(live.upload, /before anything is saved/);
    assert.match(live.undo, /Puts the rules from before/);
    const empty = rulesFileStatusView({ hash: null, hasPrevious: false, lastWrite: null }).rowNotes;
    assert.match(empty.download, /no rules file yet/);
    assert.equal(empty.undo, 'Nothing to undo yet.');
  });

  it('Spotify rows: the fill row explains nothing is sent; save has a ready and an incomplete wording', () => {
    const v = spotifySectionView({ set: true, clientIdMasked: 'abcd…wxyz', redirectUri: null, secretSet: true, refreshTokenSet: true, replacedAt: null, source: 'file' });
    assert.match(v.rowNotes.fill, /Nothing is sent until you save/);
    assert.match(v.rowNotes.saveReady, /warning first/);
    assert.equal(v.rowNotes.saveIncomplete, 'Fill in all four fields to save.');
  });
});
