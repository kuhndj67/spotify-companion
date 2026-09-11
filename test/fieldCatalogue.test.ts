/**
 * The field catalogue — membership, operator table, and the two honesty obligations.
 *
 * Membership is tested as tightly as behaviour because the catalogue is the unit's public
 * surface: a field added here becomes writable in a rule that persists across restarts, and a
 * field removed here disables rules that already exist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  allFields,
  findField,
  operatorAllowed,
  operatorsFor,
} from '../src/rules/fieldCatalogue.js';
import type { FieldType } from '../src/rules/types.js';

describe('membership', () => {
  it('every field has a unique, dotted, stable name', () => {
    const names = allFields().map((f) => f.name);
    assert.equal(new Set(names).size, names.length, 'duplicate field name');
    for (const name of names) {
      assert.match(name, /^[a-z]+\.[A-Za-z]+$/, `${name} should be group.field`);
    }
  });

  it('⚠️ context.* is ABSENT — it is never available on the live path (BR-16.6)', () => {
    // context_type is NULL on all 342 live plays and populated on all 85 backfilled ones. A rule
    // over it would be unknown 100% of the time in production while back-testing as populated,
    // which would validate a rule that cannot work.
    for (const f of allFields()) {
      assert.ok(!f.name.startsWith('context.'), `${f.name} must not be in the catalogue`);
    }
    assert.equal(findField('context.type'), undefined);
    assert.equal(findField('context.deviceName'), undefined);
  });

  it('the evaluation instant is not a field', () => {
    // It is an input to evaluation, not a fact about the track. Exposing it would let a rule
    // read a clock by proxy.
    assert.equal(findField('evaluatedAtMs'), undefined);
    assert.equal(findField('track.evaluatedAtMs'), undefined);
  });

  it('every group the design names is represented', () => {
    const groups = new Set(allFields().map((f) => f.name.split('.')[0]));
    for (const expected of ['track', 'artist', 'album', 'label', 'liked', 'history']) {
      assert.ok(groups.has(expected), `missing group: ${expected}`);
    }
  });

  it('findField returns undefined for a name that is not there, rather than throwing', () => {
    assert.equal(findField('no.such'), undefined);
    assert.equal(findField(''), undefined);
  });

  it('the artist-level label verdict is gone and stays gone', () => {
    // Removed by migration 004 on 2026-09-06: it classified over browse /release?artist=, which
    // counts releases the artist merely features on, so every collaborative artist read `major`.
    assert.equal(findField('artist.labelVerdict'), undefined);
    assert.equal(findField('artist.classification'), undefined);
  });
});

describe('the honesty obligations', () => {
  it('label.classification carries the gate result (BR-16.4)', () => {
    const f = findField('label.classification');
    assert.ok(f);
    assert.ok(f!.note, 'must carry a note');
    assert.match(f!.note!, /0\.888/, 'should name the p-value');
    assert.match(f!.note!, /preference/i, 'should say it remains legitimate as a preference');
  });

  it('the artist-level history counts carry the primary-artist caveat (BR-16.5)', () => {
    for (const name of ['history.playsOfArtist', 'history.skipsOfArtist']) {
      const f = findField(name);
      assert.ok(f, name);
      assert.ok(f!.note, `${name} must carry a note`);
      assert.match(f!.note!, /PRIMARY/i);
    }
  });

  it('the track-level history counts do NOT carry it — the limitation is artist-only', () => {
    for (const name of ['history.playsOfTrack', 'history.skipsOfTrack']) {
      assert.equal(findField(name)!.note, undefined, `${name} should have no note`);
    }
  });

  it('availability and note are separate fields, never merged (BR-16.3)', () => {
    const f = findField('label.classification')!;
    assert.equal(f.availability, 'often-unknown');
    assert.ok(f.note);
    // A field can be always-present and still carry a caveat, or often-unknown with none.
    assert.equal(findField('history.playsOfArtist')!.availability, 'usually');
  });
});

describe('the operator table', () => {
  const TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum'];

  it('is-unknown is valid on every type (BR-15.3)', () => {
    for (const t of TYPES) {
      assert.ok(operatorAllowed(t, 'is-unknown'), `${t} should allow is-unknown`);
    }
  });

  it('⚠️ exists is not an operator on any type (BR-15.5)', () => {
    for (const t of TYPES) {
      assert.ok(!operatorsFor(t).includes('exists' as never), `${t} must not offer exists`);
    }
  });

  it('ordering operators are offered only where ordering is meaningful', () => {
    for (const op of ['lt', 'lte', 'gt', 'gte'] as const) {
      assert.ok(operatorAllowed('number', op));
      assert.ok(operatorAllowed('date', op));
      assert.ok(!operatorAllowed('string', op), `string should not offer ${op}`);
      assert.ok(!operatorAllowed('boolean', op), `boolean should not offer ${op}`);
      assert.ok(!operatorAllowed('enum', op), `enum should not offer ${op}`);
    }
  });

  it('contains is offered only for strings', () => {
    assert.ok(operatorAllowed('string', 'contains'));
    assert.ok(!operatorAllowed('number', 'contains'));
    assert.ok(!operatorAllowed('enum', 'contains'));
  });

  it('every enum field declares its values, so an impossible operand can be refused', () => {
    for (const f of allFields()) {
      if (f.type === 'enum') {
        assert.ok(f.enumValues && f.enumValues.length > 0, `${f.name} must declare enumValues`);
      }
    }
  });

  it('artist.genres is the only multi-valued field, and presents as a string', () => {
    const multi = allFields().filter((f) => f.multiValued);
    assert.deepEqual(
      multi.map((f) => f.name),
      ['artist.genres'],
    );
    assert.equal(multi[0]!.type, 'string', 'the list stays an implementation detail');
  });
});

describe('descriptions', () => {
  it('every field has a non-empty description — the catalogue is introspectable (FR-28)', () => {
    for (const f of allFields()) {
      assert.ok(f.description.length > 0, `${f.name} needs a description`);
    }
  });

  it('the fields with a known trap explain it in their description', () => {
    assert.match(findField('artist.genres')!.description, /word boundar/i);
    assert.match(findField('album.releaseDate')!.description, /year-only|ageYears/i);
  });
});
