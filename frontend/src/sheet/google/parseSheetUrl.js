// Sheet Phase 3 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 3 task checklist):
// "frontend/src/sheet/google/parseSheetUrl.js: regex lấy spreadsheetId+gid". No @univerjs/*
// import, no network call — pure string parsing so it's cheap to unit test and cheap to import
// from any UI component without pulling in the Univer bundle.

// parseSheetUrl(url) -> { spreadsheetId, gid } | null. gid is null when the URL has no #gid=
// fragment (import defaults to the first tab — see backend/services/googleSheets.js's
// resolveTabTitle). Accepts the standard share-link shape:
// https://docs.google.com/spreadsheets/d/<id>/edit?gid=<gid>#gid=<gid>
export function parseSheetUrl(url) {
  const idMatch = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = String(url).match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}
