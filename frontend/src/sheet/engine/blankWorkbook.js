// createBlankWorkbook() — deliberately kept OUT of engine/univerAdapter.js despite the "every
// @univerjs/* import lives in engine/" rule (univerAdapter.js's own header comment) still
// applying: this file has NO @univerjs/* import at all, just a plain IWorkbookData-shaped
// object literal. Splitting it out means SheetLibraryModal.jsx (which needs a blank workbook
// shape to create a "New Sheet") never has to pull in univerAdapter.js's module-level
// side-effect imports (the full Univer plugin set + all their CSS) just to build that literal —
// only SheetWorkspace.jsx, which actually calls mount(), pays that cost, and only once the user
// is in Sheet mode.

export function createBlankWorkbook(name = 'Sheet1') {
  const sheetId = 'sheet-1';
  return {
    id: crypto.randomUUID(),
    name,
    appVersion: '0.25.1',
    locale: 'enUS',
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: { id: sheetId, name, rowCount: 200, columnCount: 40, cellData: {} },
    },
  };
}
