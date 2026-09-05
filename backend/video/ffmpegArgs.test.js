// Unit tests for backend/video/ffmpegArgs.js — Video Editor Phase 0 spike acceptance
// criteria: "escapeWindowsPathForFilter pass test path thật C:\Users\Name\Videos\clip 01.mp4"
// (specs/space-flow-master-plan/04-video-editor.md Phase 0).
// Run with: node backend/video/ffmpegArgs.test.js

const assert = require('assert');
const { escapeFilterArg, escapeWindowsPathForFilter, escapeDrawtextText, quoteFilterValue, concatListLine } = require('./ffmpegArgs');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// Windows path with drive letter, spaces, and backslashes — the concrete acceptance-criteria case.
check(
  'Windows path with drive letter + space',
  escapeWindowsPathForFilter('C:\\Users\\Name\\Videos\\clip 01.mp4'),
  'C\\:/Users/Name/Videos/clip 01.mp4'
);

// UNC-ish / no-drive-letter path still normalizes backslashes.
check(
  'Windows path without escaping needed beyond slash normalization',
  escapeWindowsPathForFilter('D:\\projects\\space-flow\\uploads\\a.mp4'),
  'D\\:/projects/space-flow/uploads/a.mp4'
);

// escapeFilterArg: every filtergraph-structural character gets backslash-escaped.
check('escapeFilterArg: colon', escapeFilterArg('a:b'), 'a\\:b');
check('escapeFilterArg: comma', escapeFilterArg('a,b'), 'a\\,b');
check('escapeFilterArg: brackets', escapeFilterArg('[a]'), '\\[a\\]');
check('escapeFilterArg: single quote', escapeFilterArg("a'b"), "a\\'b");
check('escapeFilterArg: semicolon', escapeFilterArg('a;b'), 'a\\;b');
check('escapeFilterArg: backslash', escapeFilterArg('a\\b'), 'a\\\\b');

// quoteFilterValue: wraps in single quotes, escapes embedded single quotes via the
// close-escape-reopen convention (matches concatListLine's established pattern).
check('quoteFilterValue: plain', quoteFilterValue('hello'), "'hello'");
check('quoteFilterValue: embedded quote', quoteFilterValue("it's"), "'it'\\''s'");

// escapeDrawtextText: drawtext's own text-value special characters.
check('escapeDrawtextText: colon', escapeDrawtextText('12:34'), '12\\:34');
check('escapeDrawtextText: percent', escapeDrawtextText('100%'), '100\\%');
check('escapeDrawtextText: quote', escapeDrawtextText("Alex's clip"), "Alex\\'s clip");

// concatListLine (unchanged behavior, now shared with nodes/video-assembly/execute.js).
check('concatListLine: plain path', concatListLine('/tmp/a.mp4'), "file '/tmp/a.mp4'");
check('concatListLine: embedded quote', concatListLine("/tmp/a'b.mp4"), "file '/tmp/a'\\''b.mp4'");

// Unicode passthrough — must not be mangled by any escaping step.
check(
  'Unicode passthrough in path',
  escapeWindowsPathForFilter('C:\\Users\\Đạt\\Videos\\日本語.mp4'),
  'C\\:/Users/Đạt/Videos/日本語.mp4'
);

console.log(`${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exitCode = 1;
