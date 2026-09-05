// Video Editor Phase 13 (specs/space-flow-master-plan/04-video-editor.md §5): pure-logic tests for
// subtitleFormat.js — no React/DOM needed. Run with: node frontend/src/video/subtitleFormat.test.js

import assert from 'assert';
import { parseSubtitle, formatSrt, formatVtt } from './subtitleFormat.js';

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
  check('parseSubtitle: SRT with numeric index + comma timestamp separator', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,500\nHello world\n\n2\n00:00:05,000 --> 00:00:07,250\nSecond cue';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues.length, 2);
    assert.deepStrictEqual(cues[0], { startMs: 1000, endMs: 4500, content: 'Hello world' });
    assert.deepStrictEqual(cues[1], { startMs: 5000, endMs: 7250, content: 'Second cue' });
  });

  check('parseSubtitle: VTT with WEBVTT header + dot timestamp separator, no cue index', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.500\nHello world\n\n00:00:05.000 --> 00:00:07.250\nSecond cue';
    const cues = parseSubtitle(vtt);
    assert.strictEqual(cues.length, 2);
    assert.deepStrictEqual(cues[0], { startMs: 1000, endMs: 4500, content: 'Hello world' });
  });

  check('parseSubtitle: multi-line cue content is preserved with \\n', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nLine one\nLine two';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues[0].content, 'Line one\nLine two');
  });

  check('parseSubtitle: cues are sorted by startMs regardless of file order', () => {
    const srt = '1\n00:00:05,000 --> 00:00:06,000\nSecond\n\n2\n00:00:01,000 --> 00:00:02,000\nFirst';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues[0].content, 'First');
    assert.strictEqual(cues[1].content, 'Second');
  });

  check('parseSubtitle: block with no --> timestamp line is skipped, not thrown', () => {
    const srt = 'NOTE this is a comment block\n\n1\n00:00:01,000 --> 00:00:02,000\nReal cue';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues.length, 1);
    assert.strictEqual(cues[0].content, 'Real cue');
  });

  check('parseSubtitle: cue with empty content (blank line right after timestamp) is skipped', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nReal cue';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues.length, 1);
    assert.strictEqual(cues[0].content, 'Real cue');
  });

  check('parseSubtitle: endMs <= startMs is rejected as malformed, not silently negative-duration', () => {
    const srt = '1\n00:00:05,000 --> 00:00:02,000\nBackwards';
    const cues = parseSubtitle(srt);
    assert.strictEqual(cues.length, 0);
  });

  check('parseSubtitle: CRLF line endings (common on Windows-authored .srt) parse the same as LF', () => {
    const srtCrlf = '1\r\n00:00:01,000 --> 00:00:04,000\r\nHello\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nWorld';
    const cues = parseSubtitle(srtCrlf);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].content, 'Hello');
  });

  check('formatSrt: numbers cues from 1, uses comma separator, blank line between cues', () => {
    const text = formatSrt([
      { startMs: 1000, endMs: 4500, content: 'Hello world' },
      { startMs: 5000, endMs: 7250, content: 'Second cue' },
    ]);
    assert.strictEqual(
      text,
      '1\n00:00:01,000 --> 00:00:04,500\nHello world\n\n2\n00:00:05,000 --> 00:00:07,250\nSecond cue',
    );
  });

  check('formatVtt: WEBVTT header, dot separator, no cue index numbers', () => {
    const text = formatVtt([{ startMs: 1000, endMs: 4500, content: 'Hello world' }]);
    assert.strictEqual(text, 'WEBVTT\n\n00:00:01.000 --> 00:00:04.500\nHello world');
  });

  check('formatSrt -> parseSubtitle round-trip preserves startMs/endMs/content exactly', () => {
    const cues = [
      { startMs: 0, endMs: 2000, content: 'First' },
      { startMs: 3500, endMs: 6125, content: 'Multi\nline' },
    ];
    const roundTripped = parseSubtitle(formatSrt(cues));
    assert.deepStrictEqual(roundTripped, cues);
  });

  check('formatVtt -> parseSubtitle round-trip preserves startMs/endMs/content exactly', () => {
    const cues = [{ startMs: 61000, endMs: 65999, content: 'One minute in' }];
    const roundTripped = parseSubtitle(formatVtt(cues));
    assert.deepStrictEqual(roundTripped, cues);
  });

  check('formatTimestamp (via formatSrt): hours/minutes roll over correctly past 1h', () => {
    const text = formatSrt([{ startMs: 3661500, endMs: 3665000, content: 'x' }]); // 1h 1m 1.5s
    assert.ok(text.includes('01:01:01,500 -->'), text);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
