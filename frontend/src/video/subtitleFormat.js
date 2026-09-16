// Video Editor Phase 13 (specs/space-flow-master-plan/04-video-editor.md §5): pure SRT/VTT
// parse + format helpers, decoupled from the caption-track clip shape on purpose (same
// "unit-testable without React/DOM" split timelineUtils.js's own header comment already
// establishes) — callers (CaptionPanel.jsx) map to/from `{id, timelineInMs, timelineOutMs, ...,
// text: {content}}` caption clips at the UI boundary, 1 InsertClip per parsed cue (no new "batch
// import" command — same "no batch command type" precedent Phase 7/11 already used for
// many-small-edits-in-one-user-action).
//
// Both formats are parsed with the SAME permissive block-splitter (blank-line-separated blocks,
// find the first "-->" line in each, treat everything after it as the cue's text) — SRT's leading
// numeric cue-index line and VTT's "WEBVTT" header / NOTE blocks are simply lines with no "-->"
// that get skipped, rather than 2 separate parsers with duplicated timestamp/block logic.

const TIMESTAMP_RE = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function parseTimestamp(str) {
  const m = TIMESTAMP_RE.exec(str);
  if (!m) return null;
  const [, hh, mm, ss, ms] = m;
  return (((+hh * 60 + +mm) * 60 + +ss) * 1000) + +ms;
}

function formatTimestamp(ms, sep) {
  const total = Math.max(0, Math.round(ms));
  const hh = Math.floor(total / 3600000);
  const mm = Math.floor((total % 3600000) / 60000);
  const ss = Math.floor((total % 60000) / 1000);
  const mmm = total % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(mmm, 3)}`;
}

// parseSubtitle(text) -> [{ startMs, endMs, content }], sorted by startMs. Accepts SRT (comma
// timestamp separator) or VTT (dot separator, optional "WEBVTT" header) — same permissive parser
// for both, see file header. Malformed/empty blocks are silently skipped (no cue-index/timestamp
// line found), not thrown — an imported file with a few bad blocks still yields the good ones.
export function parseSubtitle(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIndex === -1) continue;
    const [startStr, endStr] = lines[timeLineIndex].split('-->');
    const startMs = parseTimestamp(startStr);
    const endMs = parseTimestamp(endStr);
    if (startMs == null || endMs == null || endMs <= startMs) continue;
    const content = lines.slice(timeLineIndex + 1).join('\n').trim();
    if (!content) continue;
    cues.push({ startMs, endMs, content });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

// formatSrt/formatVtt(cues) -> text, cues: [{ startMs, endMs, content }] (same shape parseSubtitle
// returns — caller maps caption clips to this shape first: `{ startMs: clip.timelineInMs, endMs:
// clip.timelineOutMs, content: clip.text.content }`).
export function formatSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.startMs, ',')} --> ${formatTimestamp(c.endMs, ',')}\n${c.content}`)
    .join('\n\n');
}

export function formatVtt(cues) {
  const body = cues
    .map((c) => `${formatTimestamp(c.startMs, '.')} --> ${formatTimestamp(c.endMs, '.')}\n${c.content}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}
