#!/usr/bin/env node
/**
 * Cross-check the published JSON Schema against the real validator.
 *
 * `aidlc-docs/reference/rules.schema.json` covers the STRUCTURAL phase only, so the contract is:
 *
 *   schema rejects  =>  validateRuleSet must reject the whole set
 *   schema accepts  =>  validateRuleSet must NOT reject structurally (rules may still disable)
 *
 * A disagreement in either direction means the published schema lies about the implementation —
 * and the direction matters. A schema that is too STRICT is the worse failure: it reports a
 * whole-file error for something the app treats as one disabled rule, so an author (or a
 * generator) "fixes" a file that was never broken. That exact defect was caught here once, with
 * `minItems: 1` on the `in` operand.
 *
 * ## Why this is a script and not a test
 *
 * It needs a JSON Schema validator, and this project does not depend on one. `ajv` is present
 * only transitively, so a test importing it would pass today and vanish on an unrelated
 * dependency update — a test that can silently stop existing is worse than one you have to
 * remember to run. It FAILS LOUDLY when ajv is absent rather than skipping.
 *
 *   node --import tsx scripts/check-rules-schema.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRuleSet } from '../src/rules/ruleValidator.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let Ajv2020;
try {
  ({ default: Ajv2020 } = await import('ajv/dist/2020.js'));
} catch {
  console.error(
    'This check needs a JSON Schema validator and none is installed.\n' +
      '  npm i -D ajv\n' +
      'Refusing to skip: a check that quietly does nothing is worse than one that is absent.',
  );
  process.exit(2);
}

const schema = JSON.parse(
  readFileSync(join(root, 'aidlc-docs', 'reference', 'rules.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
const check = ajv.compile(schema);

const rule = (predicate, extra = {}) => ({
  id: 'r1',
  name: 'R1',
  enabled: true,
  action: 'skip',
  onUnknown: 'no-match',
  predicate,
  ...extra,
});
const set = (predicate, extra = {}) => ({ rules: [rule(predicate, extra)] });
const compare = (field, op, value) =>
  value === undefined ? { kind: 'compare', field, op } : { kind: 'compare', field, op, value };

const cases = [
  // --- structurally VALID -------------------------------------------------
  ['bare array', [rule(compare('track.title', 'eq', 'x'))]],
  ['object with rules', set(compare('track.title', 'eq', 'x'))],
  ['empty rule set', { version: 1, rules: [] }],
  ['is-unknown without a value', set(compare('track.isrc', 'is-unknown'))],
  ['in with an array', set(compare('album.type', 'in', ['single', 'album']))],
  ['and', set({ kind: 'and', operands: [compare('track.title', 'eq', 'x')] })],
  ['or', set({ kind: 'or', operands: [compare('track.title', 'eq', 'x')] })],
  ['not', set({ kind: 'not', operand: compare('track.title', 'eq', 'x') })],
  ['dryRun present', set(compare('track.title', 'eq', 'x'), { dryRun: true })],
  ['extra top-level member', { version: 9, $schema: './rules.schema.json', rules: [] }],
  // These are SEMANTIC failures: valid shape, rule loads disabled. The schema must accept them.
  ['unknown field (semantic)', set(compare('no.such.field', 'eq', 'x'))],
  ['wrong operator for type (semantic)', set(compare('track.explicit', 'contains', 'x'))],
  ['empty in array (semantic)', set(compare('album.type', 'in', []))],
  ['onUnknown hold (semantic)', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), onUnknown: 'hold' }] }],

  // --- structurally INVALID ------------------------------------------------
  ['missing id', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), id: undefined }] }],
  ['empty id', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), id: '' }] }],
  ['missing predicate', { rules: [{ id: 'a', name: 'A', enabled: true, action: 'skip', onUnknown: 'no-match' }] }],
  ['action not skip', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), action: 'pause' }] }],
  ['bad onUnknown', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), onUnknown: 'maybe' }] }],
  ['enabled not boolean', { rules: [{ ...rule(compare('track.title', 'eq', 'x')), enabled: 'yes' }] }],
  ['dryRun not boolean', set(compare('track.title', 'eq', 'x'), { dryRun: 'yes' })],
  ['unknown predicate kind', set({ kind: 'xor', operands: [] })],
  ['empty operands', set({ kind: 'and', operands: [] })],
  ['and without operands', set({ kind: 'and' })],
  ['not without operand', set({ kind: 'not' })],
  ['binary op without a value', set(compare('track.title', 'eq'))],
  ['is-unknown WITH a value', set(compare('track.isrc', 'is-unknown', 'x'))],
  ['unrecognised operator', set(compare('track.title', 'matches', 'x'))],
  ['empty field name', set(compare('', 'eq', 'x'))],
  ['not an object', 'nope'],
  ['rules not an array', { rules: 'nope' }],
];

let mismatches = 0;

for (const [label, doc] of cases) {
  // JSON round-trip: `undefined` members must disappear the way they would in a real file.
  const parsed = JSON.parse(JSON.stringify(doc));
  const schemaOk = check(parsed);
  const result = validateRuleSet(parsed);

  if (schemaOk !== result.ok) {
    mismatches += 1;
    console.log(`MISMATCH  ${label}`);
    console.log(`          schema=${schemaOk}  validator=${result.ok}`);
    if (!result.ok) console.log(`          validator: ${result.errors.join('; ')}`);
    if (!schemaOk) console.log(`          schema:    ${ajv.errorsText(check.errors)}`);
  } else {
    console.log(`ok        ${label} (${schemaOk ? 'accepted' : 'rejected'} by both)`);
  }
}

console.log(`\n${cases.length} cases, ${mismatches} mismatch(es)`);
process.exit(mismatches === 0 ? 0 : 1);
