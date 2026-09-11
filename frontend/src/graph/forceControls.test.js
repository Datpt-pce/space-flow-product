// Graph Library Phase 6 (specs/space-flow-master-plan/02-graph-library.md): pure-logic tests for
// forceControls.js. Run with: node frontend/src/graph/forceControls.test.js

import assert from 'assert';
import { FORCE_SLIDERS, DEFAULT_FORCE_SETTINGS, buildFA2Settings } from './forceControls.js';

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
  check('FORCE_SLIDERS: đúng 4 slider, mỗi key khớp 1 field FA2 thật', () => {
    assert.strictEqual(FORCE_SLIDERS.length, 4);
    const keys = FORCE_SLIDERS.map((s) => s.key).sort();
    assert.deepStrictEqual(keys, ['edgeWeightInfluence', 'gravity', 'scalingRatio', 'slowDown']);
  });

  check('buildFA2Settings: không truyền gì -> dùng default, luôn ép barnesHutOptimize true', () => {
    const settings = buildFA2Settings({});
    assert.strictEqual(settings.gravity, DEFAULT_FORCE_SETTINGS.gravity);
    assert.strictEqual(settings.barnesHutOptimize, true);
  });

  check('buildFA2Settings: giá trị slider override đúng default, không đụng field khác', () => {
    const settings = buildFA2Settings({ gravity: 3 });
    assert.strictEqual(settings.gravity, 3);
    assert.strictEqual(settings.scalingRatio, DEFAULT_FORCE_SETTINGS.scalingRatio);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
