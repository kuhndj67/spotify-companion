/**
 * The rules-language reference must not drift from the implementation.
 *
 * ⚠️ **A reference document is the one artefact that fails silently.** Code that is wrong breaks
 * a test; documentation that is wrong just misleads whoever reads it next, indefinitely, and
 * this project has already paid for that twice — a CLAUDE.md claim about `recently-played`
 * returning no `external_ids` survived 15 days and was false, and a `compose.yaml` comment
 * asserted a root-ownership hazard that was never observed on this host.
 *
 * So the parts of `rules-language.md` that are *derived from code* are checked against the code:
 * the field catalogue, the operator matrix, the limits and the disabled reasons. Prose is not
 * checked and cannot be.
 *
 * The published JSON Schema is cross-checked separately by `scripts/check-rules-schema.mjs`,
 * which needs a JSON Schema validator this project does not depend on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { allFields, operatorAllowed } from '../src/rules/fieldCatalogue.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import {
  MAX_PREDICATE_DEPTH,
  MAX_RULES,
  MAX_RULES_FILE_BYTES,
  type FieldType,
  type Operator,
} from '../src/rules/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'aidlc-docs', 'reference', 'rules-language.md'), 'utf8');

const ALL_OPERATORS: readonly Operator[] = [
  'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'is-unknown',
];

/** Strip markdown emphasis so `**enum**` and `enum` compare equal. */
const plain = (cell: string) => cell.replace(/\*/g, '').trim();

/**
 * The text of one `## n. Heading` section, so a table is read from where it actually lives.
 *
 * WARNING: scoping matters more than it looks. Section 9 lists *deliberately wrong* field
 * names -- the near-misses a generator invents -- and an unscoped scan reads them as catalogue
 * entries. The first version of this test did exactly that and failed on its own examples.
 */
function section(heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `no section "${heading}" in the document`);
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next === -1 ? undefined : next);
}

/** Rows of the field catalogue table: | `field` | type | availability | notes | */
function documentedFields(): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of section('2. Field catalogue').split('\n')) {
    const match = /^\|\s*`([a-z]+\.[A-Za-z]+)`\s*\|([^|]+)\|/.exec(line);
    if (match !== null) found.set(match[1]!, plain(match[2]!));
  }
  return found;
}

/** Rows of the §3 operator table: | `type` | `op` `op` … | */
function documentedOperators(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const line of section('3. Operators by type').split('\n')) {
    const match = /^\|\s*`(string|number|boolean|date|enum)`\s*\|([^|]+)\|/.exec(line);
    if (match === null) continue;
    const ops = [...match[2]!.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!);
    found.set(match[1]!, new Set(ops));
  }
  return found;
}

describe('the field catalogue table matches the code', () => {
  it('documents every field, and no field that does not exist', () => {
    const documented = new Set(documentedFields().keys());
    const actual = new Set(allFields().map((f) => f.name));

    const missing = [...actual].filter((f) => !documented.has(f));
    const invented = [...documented].filter((f) => !actual.has(f));

    assert.deepEqual(missing, [], 'fields exist in the catalogue but are undocumented');
    assert.deepEqual(invented, [], 'the document describes fields that do not exist');
  });

  it('gives each field its real type', () => {
    const documented = documentedFields();

    for (const field of allFields()) {
      assert.equal(
        documented.get(field.name),
        field.type,
        `${field.name} is documented as "${documented.get(field.name)}" but is ${field.type}`,
      );
    }
  });

  it('documents exactly the twenty fields that exist', () => {
    // A blunt count, so a field added without touching the table fails here even if the
    // regexes above are somehow fooled.
    assert.equal(documentedFields().size, allFields().length);
  });
});

describe('the operator matrix matches the code', () => {
  it('lists exactly the permitted operators for each type', () => {
    const documented = documentedOperators();
    const types: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum'];

    for (const type of types) {
      const listed = documented.get(type);
      assert.ok(listed !== undefined, `${type} has no row in the operator table`);

      const permitted = ALL_OPERATORS.filter((op) => operatorAllowed(type, op));
      assert.deepEqual(
        [...listed!].sort(),
        [...permitted].sort(),
        `the ${type} row disagrees with operatorAllowed`,
      );
    }
  });

  /** BR-15.3: it asks about presence, not value, so it applies everywhere. */
  it('claims is-unknown works on every type, and it does', () => {
    for (const type of ['string', 'number', 'boolean', 'date', 'enum'] as FieldType[]) {
      assert.ok(operatorAllowed(type, 'is-unknown'));
    }
    assert.match(doc, /`is-unknown` is valid on \*\*every\*\* type/);
  });
});

describe('the limits table matches the constants', () => {
  it('states the real predicate depth, rule count and file size', () => {
    assert.match(doc, new RegExp(`Predicate depth \\| ${MAX_PREDICATE_DEPTH}`));
    assert.match(doc, new RegExp(`Rules per file \\| ${MAX_RULES}`));
    // 1 MiB, written as humans write it rather than as bytes.
    assert.equal(MAX_RULES_FILE_BYTES, 1_048_576);
    assert.match(doc, /File size \| 1 MiB/);
  });
});

describe('the enum values match the catalogue', () => {
  it('documents the real members of every enum field', () => {
    for (const field of allFields()) {
      if (field.enumValues === undefined) continue;
      for (const value of field.enumValues) {
        assert.ok(
          doc.includes(`\`${value}\``),
          `${field.name} allows "${value}" but the document never mentions it`,
        );
      }
    }
  });

  /**
   * ⚠️ The trap that caught the very first live decisions. `unknown` is a VALUE of
   * `label.classification`, not an absence — so `is-unknown` is false for those rows and
   * `eq "major"` is decisively false rather than unknown. If the enum ever loses that member,
   * this section becomes wrong and actively misleading.
   */
  it('still warns about the label.classification value named "unknown"', () => {
    const classification = allFields().find((f) => f.name === 'label.classification');
    assert.ok(classification?.enumValues?.includes('unknown'));
    assert.match(doc, /has a value literally named/);
  });
});

describe('the disabled reasons match the validator', () => {
  it('documents every reason the validator can produce', () => {
    // Taken from `semanticStatus` in ruleValidator.ts. A new reason added there without a row
    // here leaves someone reading an unexplained status in the UI.
    for (const reason of ['unknown-field', 'type-mismatch', 'too-deep', 'unsupported-on-unknown']) {
      assert.ok(doc.includes(`\`${reason}\``), `the document never mentions ${reason}`);
    }
  });
});

describe('the schema file is referenced and parseable', () => {
  it('exists, is valid JSON, and is linked from the document', () => {
    const schemaPath = join(root, 'aidlc-docs', 'reference', 'rules.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

    assert.equal(schema['$schema'], 'https://json-schema.org/draft/2020-12/schema');
    assert.match(doc, /rules\.schema\.json/);
  });

  /**
   * ⚠️ The schema must never be stricter than the structural phase. It was, once: an
   * `minItems: 1` on the `in` operand reported a whole-file error for what the validator
   * treats as a single disabled rule.
   */
  it('does not constrain the in-operand to be non-empty', () => {
    const schemaPath = join(root, 'aidlc-docs', 'reference', 'rules.schema.json');
    const raw = readFileSync(schemaPath, 'utf8');
    const comparison = /"comparison":[\s\S]*?"junction"/.exec(raw)?.[0] ?? '';

    assert.ok(
      !comparison.includes('"minItems"'),
      'an empty `in` array disables one rule; it does not reject the set',
    );
  });
});

describe('every example in the document is a rule the validator accepts', () => {
  /**
   * ⚠️ This is the test that matters most now the document is destined to be context for a
   * generator. **An example is the strongest instruction in a reference** — a model shown a
   * malformed rule will reproduce it faithfully, and unlike prose, a wrong example is
   * indistinguishable from a right one to the reader.
   */
  function jsonBlocks(): string[] {
    return [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  }

  /** Wrap whatever shape the example is in so one validator call covers all three. */
  function asRuleSet(parsed: unknown): unknown {
    const value = parsed as Record<string, unknown>;
    if ('rules' in value) return value;
    if ('predicate' in value) return { rules: [value] };
    // A bare predicate fragment: give it the smallest legal rule around it.
    return {
      rules: [
        {
          id: 'example',
          name: 'Example',
          enabled: true,
          action: 'skip',
          onUnknown: 'no-match',
          predicate: value,
        },
      ],
    };
  }

  it('finds the examples at all, so this test cannot pass vacuously', () => {
    assert.ok(jsonBlocks().length >= 5, `only found ${jsonBlocks().length} json blocks`);
  });

  it('parses as JSON', () => {
    for (const block of jsonBlocks()) {
      assert.doesNotThrow(() => JSON.parse(block), `not valid JSON:\n${block}`);
    }
  });

  it('passes structural validation — no example would reject the file', () => {
    for (const block of jsonBlocks()) {
      const result = validateRuleSet(asRuleSet(JSON.parse(block)));
      assert.ok(
        result.ok,
        `an example is structurally invalid, and copying it would disarm every other rule:\n` +
          `${block}\n${result.ok ? '' : result.errors.join('; ')}`,
      );
    }
  });

  it('passes semantic validation — no example loads disabled', () => {
    for (const block of jsonBlocks()) {
      const result = validateRuleSet(asRuleSet(JSON.parse(block)));
      if (!result.ok) continue; // reported by the test above
      for (const loaded of result.value) {
        assert.equal(
          loaded.status.state,
          'active',
          `an example loads disabled (${loaded.status.state === 'disabled' ? loaded.status.detail : ''}):\n${block}`,
        );
      }
    }
  });
});

describe('the natural-language section teaches real field names', () => {
  /**
   * ⚠️ Section 9 contains field names on purpose that do NOT exist — the near-misses a
   * generator invents. Those are listed in the left column of its own table, and anything
   * else in the section claiming to be a field must be real, or the document teaches a
   * hallucination as fact.
   */
  function deliberatelyWrongNames(): Set<string> {
    const wrong = new Set<string>();
    const table = /\| Tempting \| Correct \|([\s\S]*?)\n\n/.exec(section('9. Authoring from natural language'));
    if (table === null) return wrong;
    for (const line of table[1]!.split('\n')) {
      const cells = line.split('|');
      if (cells.length < 3) continue;
      for (const match of cells[1]!.matchAll(/`([a-z]+\.[A-Za-z]+)`/g)) wrong.add(match[1]!);
    }
    return wrong;
  }

  it('has a near-miss table, so the exemption below is not silently empty', () => {
    assert.ok(deliberatelyWrongNames().size >= 5);
  });

  it('mentions no field that neither exists nor is flagged as a near-miss', () => {
    const real = new Set(allFields().map((f) => f.name));
    const offenders: string[] = [];

    // ⚠️ The near-miss table is EXCISED rather than allowlisted. Allowlisting its names
    // globally meant a hallucinated field was excused anywhere in the section — including in
    // the mapping table, which teaches correct answers. A mutation test caught that: swapping
    // `artist.genres` for `artist.genre` in the mapping table passed, because `artist.genre`
    // was on the near-miss list. Only the near-miss table itself may contain wrong names.
    const scanned = section('9. Authoring from natural language').replace(
      /\| Tempting \| Correct \|[\s\S]*?\n\n/,
      '',
    );

    // ⚠️ Scoped to the catalogue's own namespaces. The field vocabulary is closed, so anything
    // under these prefixes claims to be a field; `status.state` and friends are code
    // references and are none of this test's business.
    const prefixes = new Set(allFields().map((f) => f.name.split('.')[0]!));
    const pattern = new RegExp(`\`((?:${[...prefixes].join('|')})\.[A-Za-z]+)[^\`]*\``, 'g');

    for (const match of scanned.matchAll(pattern)) {
      const name = match[1]!;
      if (!real.has(name)) offenders.push(name);
    }

    assert.deepEqual([...new Set(offenders)], [], 'these read as field names and are neither real nor flagged');
  });

  it('gives every near-miss a real replacement', () => {
    const real = new Set(allFields().map((f) => f.name));
    const table = /\| Tempting \| Correct \|([\s\S]*?)\n\n/.exec(section('9. Authoring from natural language'))![1]!;

    for (const line of table.split('\n')) {
      const cells = line.split('|');
      if (cells.length < 3 || !cells[1]!.includes('`')) continue;
      const corrections = [...cells[2]!.matchAll(/`([a-z]+\.[A-Za-z]+)`/g)].map((m) => m[1]!);
      assert.ok(corrections.length > 0, `no correction offered for: ${cells[1]!.trim()}`);
      for (const name of corrections) {
        assert.ok(real.has(name), `the "correct" column names a field that does not exist: ${name}`);
      }
    }
  });
});
