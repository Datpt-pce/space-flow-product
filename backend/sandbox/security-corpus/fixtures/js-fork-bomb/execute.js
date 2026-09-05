// Malicious package corpus fixture — Custom Node Platform Phase 9
// (specs/space-flow-master-plan/01-custom-node-platform.md). Never actually runs: the point of
// backend/sandbox/js-runtime.test.js's fork-bomb regression test is that bundleExecutor() fails
// BEFORE this code could ever reach an isolate (worker_threads is deliberately left unresolvable,
// see js-runtime.js's bundleExecutor comment).
const { Worker } = require('worker_threads');

module.exports = async function execute(inputs, config) {
  while (true) {
    new Worker(__filename);
  }
};
