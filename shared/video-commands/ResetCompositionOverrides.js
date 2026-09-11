const { canonicalJson } = require('../video-document-diff');
const { cloneState } = require('./state');
const { assertAllInvariants } = require('./invariants');
// Reset is a normal reversible transaction, including structural edits. Comparing
// JSON values rather than object identity keeps replay and durable undo valid.
function validate(state, { from, to }) {
  if (canonicalJson(state) !== canonicalJson(from)) throw new Error('Timeline đã thay đổi trước khi khôi phục bản tự động.');
  assertAllInvariants(to);
}
module.exports = { validate, apply: (state, { to }) => cloneState(to), invert: (state, { from }) => cloneState(from) };
