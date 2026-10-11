/**
 * LC-48 — what the Rules pop-up's *Rules file* section and the rules comparison SAY (frontend-components §1, §4).
 * ⚙️ PURE, derived on the SERVER for U5/U6's reason: `public/app.js` has no tests and cannot import from `src/`, so
 * anything decided there is decided where nothing can check it. The routes attach these views; app.js renders them.
 *
 * ONE comparison panel, used by the Rules pop-up AND the restore dialog (BR-53.7) — two renderings of "what this
 * removes" is how the two places would come to disagree.
 *
 * Colour is never the only channel: every state carries words.
 */

import type { RulesComparison } from '../configuration/rulesComparison.js';
import type { LastRulesWrite } from '../configuration/RulesWriter.js';
import type { ButtonView } from './maintenancePanel.js';

export interface ComparisonPanelView {
  /** "1 added, 2 removed, 3 changed" — or "No changes". */
  readonly heading: string;
  /** ⚠️ Shown FIRST and in words (BR-53.6): rules that will be able to skip tracks once automation is on. */
  readonly liveWarning: readonly string[];
  readonly sections: readonly { readonly title: string; readonly items: readonly string[] }[];
  readonly identical: boolean;
}

const label = (r: { id: string; name: string }) => (r.name && r.name !== r.id ? `${r.name} (${r.id})` : r.id);

export function comparisonPanelView(c: RulesComparison): ComparisonPanelView {
  const counts = [
    c.added.length > 0 ? `${c.added.length} added` : null,
    c.removed.length > 0 ? `${c.removed.length} removed` : null,
    c.changed.length > 0 ? `${c.changed.length} changed` : null,
  ].filter((x): x is string => x !== null);

  const sections: { title: string; items: string[] }[] = [];
  if (c.removed.length > 0) sections.push({ title: 'Removed', items: c.removed.map(label) });
  if (c.added.length > 0) sections.push({ title: 'Added', items: c.added.map(label) });
  if (c.changed.length > 0) sections.push({ title: 'Changed', items: c.changed.map((r) => `${label(r)} — ${r.fields.join(', ')}`) });
  if (c.wouldDisable.length > 0) {
    sections.push({ title: 'Would load disabled', items: c.wouldDisable.map((r) => `${label(r)} — ${r.reason}: ${r.detail}`) });
  }

  return {
    heading: counts.length === 0 ? 'No changes' : counts.join(', '),
    liveWarning: c.becomesLive.map(
      (r) => `${label(r)} will be able to skip tracks once automation is on — it could not before.`,
    ),
    sections,
    identical: c.identical,
  };
}

export interface RulesConfirmView {
  readonly needsWord: boolean;
  readonly word: string;
  /** Why the word is needed — "This removes 7 of your 9 rules." / "This file wasn't downloaded…". */
  readonly reason: string | null;
  readonly applyLabel: string;
}

export function rulesConfirmView(
  staged: { readonly kind: 'upload' | 'undo' | 'restore'; readonly typedConfirmationRequired: boolean; readonly typedConfirmationReason: string | null },
  word: string,
): RulesConfirmView {
  return {
    needsWord: staged.typedConfirmationRequired,
    word,
    reason: staged.typedConfirmationReason,
    applyLabel: staged.kind === 'undo' ? 'Undo' : 'Apply',
  };
}

export interface RulesFileStatusView {
  readonly download: ButtonView;
  readonly upload: ButtonView;
  /** Disabled with a reason — never hidden (BR-55.4: an empty state explains itself). */
  readonly undo: ButtonView;
  /**
   * The text beside each button, one button per row — the Backup & restore layout (user, 2026-10-11). A disabled
   * button's row shows its REASON instead, so an empty state still explains itself (BR-55.4).
   */
  readonly rowNotes: { readonly download: string; readonly upload: string; readonly undo: string };
  readonly lastWrite: string | null;
  readonly note: string;
}

export function rulesFileStatusView(s: { readonly hash: string | null; readonly hasPrevious: boolean; readonly lastWrite: LastRulesWrite | null }): RulesFileStatusView {
  return {
    download: s.hash === null
      ? { label: 'Download rules', disabled: true, reason: 'There is no rules file yet — upload one to start.' }
      : { label: 'Download rules', disabled: false, reason: null },
    upload: { label: 'Upload rules…', disabled: false, reason: null },
    undo: s.hasPrevious
      ? { label: 'Undo last rules change…', disabled: false, reason: null }
      : { label: 'Undo last rules change…', disabled: true, reason: 'Nothing to undo yet.' },
    rowNotes: {
      download: s.hash === null ? 'There is no rules file yet — upload one to start.' : 'Saves your current rules file, to edit and upload back.',
      upload: 'Shows what the file adds, removes and changes before anything is saved. Never turns automation on.',
      undo: s.hasPrevious ? 'Puts the rules from before your last change back — the same comparison first.' : 'Nothing to undo yet.',
    },
    lastWrite: s.lastWrite === null ? null : describeWrite(s.lastWrite),
    note: 'Download your rules, edit the file, and upload it.',
  };
}

function describeWrite(w: LastRulesWrite): string {
  const what = w.kind === 'undo' ? 'Undo' : w.kind === 'restore' ? 'Restored from a backup' : 'Upload';
  const when = w.at.replace('T', ' ').slice(0, 16) + ' UTC';
  return w.outcome === 'applied'
    ? `${what} applied ${when}${w.version === null ? '' : ` — rules version ${w.version}`}.`
    : `${what} not applied ${when} (${w.outcome}).`;
}

/** The result line after a confirm — the WATCHER's version, never the write's. */
export function appliedMessage(version: number, c: RulesComparison): string {
  const what = c.identical ? 'No changes' : comparisonPanelView(c).heading;
  return `Applied — ${what}. The rules engine is now on version ${version}; no restart needed.`;
}

