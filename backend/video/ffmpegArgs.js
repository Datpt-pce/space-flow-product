// FFmpeg filtergraph/path escaping — Video Editor Phase 0 spike
// (specs/space-flow-master-plan/04-video-editor.md Phase 0). Even with `execFile('ffmpeg',
// args)` (no shell), the filtergraph string passed via `-filter_complex "..."` is its own
// mini-language with special characters (`:` `,` `'` `[` `]` `;` `\`) — user-supplied text
// (clip/track titles) or a Windows path with a drive letter (`C:\...`) breaks it if inserted
// raw, because `:` collides with the filter-option separator. This is NOT the same problem as
// shell command injection (execFile already prevents that) — it's filtergraph-string syntax
// correctness.
//
// `nodes/video-assembly/execute.js` already has `concatListLine()` for the UNRELATED concat
// DEMUXER list-file format — that module now requires it from here instead of duplicating it,
// see module.exports below. Filtergraph escaping (this file's main purpose) is a different
// escaping domain and was not previously implemented anywhere in the codebase.

// Escapes a value for use inside a filtergraph OPTION (e.g. `option=VALUE`), for the set of
// characters that are structurally special at the filtergraph description level:
// backslash, single-quote, colon, comma, semicolon, and square brackets.
function escapeFilterArg(str) {
  return String(str).replace(/([\\':,;[\]])/g, '\\$1');
}

// Normalizes a Windows path for safe use inside a filtergraph string: backslashes become
// forward slashes (FFmpeg accepts '/' as a path separator on Windows, avoiding the need to
// double-escape every backslash), and the drive-letter colon (and any other literal colon)
// is backslash-escaped so it isn't parsed as a filter-option delimiter.
// e.g. `C:\Users\Name\Videos\clip 01.mp4` -> `C\:/Users/Name/Videos/clip 01.mp4`
function escapeWindowsPathForFilter(rawPath) {
  return String(rawPath).replace(/\\/g, '/').replace(/:/g, '\\:');
}

// Two-layer escape for drawtext's `text=` option specifically (04-video-editor.md §3: "text
// overlay cần escape 2 lớp"). Layer 1 (this function): drawtext's OWN text-value parser
// treats `\ : '` as special even before the outer filtergraph parser sees them (per FFmpeg
// drawtext documentation). The result must still be wrapped in single quotes by the caller
// when building the full `text='...'` option — that outer quoting is the filtergraph-level
// (layer 2) escaping, handled by wrapping in quoteFilterValue() below, not by this function.
function escapeDrawtextText(str) {
  return String(str).replace(/([\\:'%])/g, '\\$1');
}

// Wraps an already-escaped value in single quotes for embedding as a filtergraph option
// value, e.g. `text='...'` or `fontfile='...'`. Escapes any literal single quote using
// FFmpeg's own single-quote-inside-single-quote convention (close quote, escaped quote,
// reopen quote) — this is the filtergraph-level (layer 2) quoting.
function quoteFilterValue(alreadyEscaped) {
  return `'${String(alreadyEscaped).replace(/'/g, "'\\''")}'`;
}

// ffmpeg concat-demuxer list file line: single-quote each path, escape embedded single
// quotes per ffmpeg's own escaping rule (close quote, literal \', reopen quote). Extracted
// from nodes/video-assembly/execute.js (unrelated to filtergraph escaping above — this is
// the concat DEMUXER's list-file format, a different mini-language).
function concatListLine(filePath) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

module.exports = { escapeFilterArg, escapeWindowsPathForFilter, escapeDrawtextText, quoteFilterValue, concatListLine };
