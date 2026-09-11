// Sheet engine spike — Sheet Phase 0 (specs/space-flow-master-plan/03-spreadsheet.md Phase 0).
// Mounts the 100k-cell fixture via univerAdapter, measures mount time, cell-edit round-trip
// latency (plain cell), and recalculation latency (editing a chain's seed cell, timing until
// the 8th dependent formula cell in the same chain reflects the new value). Exposes
// window.__spikeResult / window.__spikeDone for measure.mjs.

import { mount, setRangeValues, getRangeValues } from '../engine/univerAdapter.js';
import { buildFixtureWorkbook, FIXTURE_DIMENSIONS } from '../fixtures/generate100k.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// Polls getRangeValues once per animation frame until it matches `expected` or `timeoutMs`
// elapses. Returns elapsed ms, or -1 if it never matched (timeout).
async function waitForValue(fWorkbook, row, col, expected, timeoutMs) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (getRangeValues(fWorkbook, row, col) === expected) {
      return performance.now() - start;
    }
    await nextFrame();
  }
  return -1;
}

async function main() {
  const container = document.getElementById('container');
  const workbook = buildFixtureWorkbook();

  console.log('spike:mount:start');
  const mountStart = performance.now();
  const { univerAPI, fWorkbook } = mount(container, workbook);
  console.log('spike:mount:createWorkbook-returned');
  await nextFrame();
  await nextFrame();

  // Formulas loaded from a snapshot are NOT auto-calculated on load — only edits made
  // through commands trigger the incremental recompute. An explicit executeCalculation()
  // is required once to evaluate the fixture's initial formula cells. onCalculationEnd() is
  // deprecated/unreliable in this version (fires a hardcoded 30s timeout in practice) — poll
  // the actual cell value instead of trusting the event.
  const formula = univerAPI.getFormula();
  const initialCalcStart = performance.now();
  formula.executeCalculation();
  const expectedInitialDeep = getRangeValues(fWorkbook, 0, 0) + 8;
  const initialCalcElapsed = await waitForValue(fWorkbook, 0, 8, expectedInitialDeep, 15000);
  console.log('spike:mount:initial-calc-elapsed=' + initialCalcElapsed + ' deepValue=' + getRangeValues(fWorkbook, 0, 8) + ' expected=' + expectedInitialDeep);
  const mountDurationMs = performance.now() - mountStart;

  // Cell-edit round-trip: 30 edits on plain (non-formula) cells scattered across the grid,
  // column 150 is outside every chain's column range (chains occupy cols 1-8/41-48/81-88/
  // 121-128/161-168 — see generate100k.js CHAIN_SPACING/CHAIN_DEPTH).
  const editLatencies = [];
  for (let i = 0; i < 30; i++) {
    const row = (i * 17) % 500;
    const newValue = 9000 + i;
    const t0 = performance.now();
    setRangeValues(fWorkbook, row, 150, newValue);
    const elapsed = await waitForValue(fWorkbook, row, 150, newValue, 2000);
    editLatencies.push(elapsed >= 0 ? elapsed : (performance.now() - t0));
  }

  // Recalculation latency: edit a chain's seed cell (col 0 of a row), poll the deepest (8th)
  // dependent formula cell in that same chain until it reflects the propagated new value.
  const recalcLatencies = [];
  for (let i = 0; i < 30; i++) {
    const row = (i * 13) % 500;
    const newSeed = 5000 + i;
    const expectedDeep = newSeed + 8; // chain is =prev+1, 8 levels deep
    setRangeValues(fWorkbook, row, 0, newSeed);
    const elapsed = await waitForValue(fWorkbook, row, 8, expectedDeep, 5000);
    recalcLatencies.push(elapsed);
  }

  const sortedEdit = [...editLatencies].sort((a, b) => a - b);
  const sortedRecalc = [...recalcLatencies].sort((a, b) => a - b);
  const recalcTimeouts = recalcLatencies.filter((v) => v < 0).length;

  window.__spikeResult = {
    fixture: FIXTURE_DIMENSIONS,
    mountDurationMs: Math.round(mountDurationMs),
    cellEditRoundTrip: {
      p50Ms: Math.round(percentile(sortedEdit, 0.5) * 100) / 100,
      p95Ms: Math.round(percentile(sortedEdit, 0.95) * 100) / 100,
      samples: editLatencies.length,
    },
    recalculation: {
      p50Ms: Math.round(percentile(sortedRecalc.filter((v) => v >= 0), 0.5) * 100) / 100,
      p95Ms: Math.round(percentile(sortedRecalc.filter((v) => v >= 0), 0.95) * 100) / 100,
      samples: recalcLatencies.length,
      timeouts: recalcTimeouts,
    },
    memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
  };
  window.__spikeDone = true;
}

main().catch((err) => {
  window.__spikeError = err.message + '\n' + err.stack;
  window.__spikeDone = true;
});
