// 08-L L3 (specs/ai-creative-operations-platform/08-v2/08-l-3-canonical-action-registry.md) —
// pure unit tests for actionRegistry.js. No DOM/network. Run with:
// node frontend/src/video/actionRegistry.test.js

import assert from 'assert';
import { ACTIONS, getAction, actionsForRegion } from './actionRegistry.js';

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function main() {
  check('every action has a unique id', () => {
    const ids = ACTIONS.map((a) => a.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate action id found');
  });

  check('every action declares the full §5.1 shape (region, selectionCardinality, transactionType, destructive, enabledWhen, disabledReason, entryPoints)', () => {
    for (const a of ACTIONS) {
      assert.ok(a.region, `${a.id} missing region`);
      assert.ok(['none', 'single', 'multi'].includes(a.selectionCardinality), `${a.id} bad selectionCardinality`);
      assert.ok(['command', 'session'].includes(a.transactionType), `${a.id} bad transactionType`);
      assert.strictEqual(typeof a.destructive, 'boolean', `${a.id} missing destructive`);
      assert.strictEqual(typeof a.enabledWhen, 'function', `${a.id} missing enabledWhen`);
      assert.strictEqual(typeof a.disabledReason, 'function', `${a.id} missing disabledReason`);
      assert.ok(a.entryPoints, `${a.id} missing entryPoints`);
    }
  });

  check('every action has at least ONE real entry point today (registry mirrors reality, not aspiration)', () => {
    for (const a of ACTIONS) {
      const { toolbar, shortcut, contextMenu, dragGesture } = a.entryPoints;
      assert.ok(toolbar || shortcut || contextMenu || dragGesture, `${a.id} has no entry point at all — that would mean the action is unreachable, contradicting it existing in the app today`);
    }
  });

  check('getAction() resolves a known id and returns undefined for an unknown one', () => {
    assert.strictEqual(getAction('timeline.undo').label, 'Undo');
    assert.strictEqual(getAction('nonexistent.action'), undefined);
  });

  check('actionsForRegion() filters correctly', () => {
    const timelineActions = actionsForRegion('timeline');
    assert.ok(timelineActions.length > 0);
    assert.ok(timelineActions.every((a) => a.region === 'timeline'));
    assert.strictEqual(actionsForRegion('nonexistent-region').length, 0);
  });

  check('disabledReason returns null exactly when enabledWhen is true, and a non-empty string otherwise (no silent mismatch)', () => {
    const ctxVariants = [
      { primarySelectedClip: null, selectedIds: [], canUndo: false, canRedo: false, hasProjectState: false },
      { primarySelectedClip: { clip: { id: 'c1' }, track: { locked: false } }, selectedIds: ['c1'], canUndo: true, canRedo: true, hasProjectState: true },
      { primarySelectedClip: { clip: { id: 'c1' }, track: { locked: true } }, selectedIds: ['c1'], canUndo: false, canRedo: false, hasProjectState: true },
    ];
    for (const a of ACTIONS) {
      for (const ctx of ctxVariants) {
        const enabled = a.enabledWhen(ctx);
        const reason = a.disabledReason(ctx);
        if (enabled) {
          assert.strictEqual(reason, null, `${a.id}: enabledWhen=true but disabledReason returned "${reason}" instead of null`);
        } else {
          assert.ok(typeof reason === 'string' && reason.length > 0, `${a.id}: enabledWhen=false but disabledReason returned "${reason}", expected a non-empty explanation`);
        }
      }
    }
  });

  check('duplicateClip: the 08-l-3 §2 finding #2 gap (missing toolbar/context-menu entry point) is now patched — has all 3 entry points', () => {
    const a = getAction('timeline.duplicateClip');
    assert.strictEqual(a.entryPoints.toolbar, true);
    assert.strictEqual(a.entryPoints.contextMenu, true);
    assert.strictEqual(a.entryPoints.shortcut, 'Mod+D');
  });

  check('transport.togglePlay: the 08-l-3 §2 finding #3 gap (missing keyboard shortcut) is now patched — Space is bound', () => {
    const a = getAction('transport.togglePlay');
    assert.strictEqual(a.entryPoints.shortcut, 'Space');
    assert.strictEqual(a.entryPoints.toolbar, true);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
