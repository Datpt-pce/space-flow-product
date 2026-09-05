// Univer adapter — Sheet Phase 0 (specs/space-flow-master-plan/03-spreadsheet.md Phase 0).
// EVERY import of `@univerjs/*` must live in this file (or a file under this same `engine/`
// directory) — no other module in the codebase should import Univer directly. This is the
// vendor-lock-in mitigation the plan calls for (03-spreadsheet.md §3 phản biện #3): Univer's
// Pro/OSS split has already moved features (import/export, pivot, collaboration) into the
// paid tier once, and the plan's own risk register treats this as an ongoing risk, not a
// one-time audit.
//
// Only the Apache-2.0 packages audited in 03-spreadsheet.md §1 are imported here — no
// `@univerjs-pro/*`, no full "preset" bundle.

import { LocaleType, Univer, mergeLocales } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import DesignEnUS from '@univerjs/design/locale/en-US';
import UiEnUS from '@univerjs/ui/locale/en-US';
import DocsUiEnUS from '@univerjs/docs-ui/locale/en-US';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import SheetsUiEnUS from '@univerjs/sheets-ui/locale/en-US';
import SheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import SheetsFormulaUiEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import SheetsSortUiEnUS from '@univerjs/sheets-sort-ui/locale/en-US';
import SheetsNumfmtUiEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';
import SheetsConditionalFormattingUiEnUS from '@univerjs/sheets-conditional-formatting-ui/locale/en-US';
import SheetsDataValidationEnUS from '@univerjs/sheets-data-validation/locale/en-US';
import SheetsDataValidationUiEnUS from '@univerjs/sheets-data-validation-ui/locale/en-US';
import SheetsHyperLinkEnUS from '@univerjs/sheets-hyper-link/locale/en-US';
import SheetsHyperLinkUiEnUS from '@univerjs/sheets-hyper-link-ui/locale/en-US';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
// The 5 extra OSS plugins audited in 03-spreadsheet.md §1 (sort, numfmt, conditional
// formatting, data validation, hyper-link) — Phase 2 task checklist: "từng gói riêng lẻ,
// không dùng preset bundle đầy đủ" (never `@univerjs/preset-*`, which can pull in Pro
// packages transitively without it showing up as a direct dependency).
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort';
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui';
import { UniverSheetsHyperLinkPlugin } from '@univerjs/sheets-hyper-link';
import { UniverSheetsHyperLinkUIPlugin } from '@univerjs/sheets-hyper-link-ui';

// Side-effect imports: each package registers its FUniver/FWorkbook/... facade extensions
// (e.g. univerAPI.createWorkbook) on import, separately from its plugin class.
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/sheets-formula/facade';
import '@univerjs/sheets-formula-ui/facade';
import '@univerjs/ui/facade';
import '@univerjs/sheets-sort/facade';
import '@univerjs/sheets-numfmt/facade';
import '@univerjs/sheets-conditional-formatting/facade';
import '@univerjs/sheets-data-validation/facade';
import '@univerjs/sheets-hyper-link/facade';
import '@univerjs/sheets-hyper-link-ui/facade';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css';
import '@univerjs/sheets-data-validation-ui/lib/index.css';
import '@univerjs/sheets-hyper-link-ui/lib/index.css';

// mount(container, snapshot) -> { univer, univerAPI, fWorkbook }
// container: HTMLElement. snapshot: Partial<IWorkbookData> (see @univerjs/core typedef).
export function mount(container, snapshot) {
  const locales = {
    [LocaleType.EN_US]: mergeLocales(
      DesignEnUS, UiEnUS, DocsUiEnUS, SheetsEnUS, SheetsUiEnUS, SheetsFormulaEnUS, SheetsFormulaUiEnUS,
      SheetsSortUiEnUS, SheetsNumfmtUiEnUS, SheetsConditionalFormattingUiEnUS,
      SheetsDataValidationEnUS, SheetsDataValidationUiEnUS, SheetsHyperLinkEnUS, SheetsHyperLinkUiEnUS
    ),
  };
  const univer = new Univer({ locale: LocaleType.EN_US, locales });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverUIPlugin, { container });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingUIPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkPlugin);
  univer.registerPlugin(UniverSheetsHyperLinkUIPlugin);

  const univerAPI = FUniver.newAPI(univer);
  const fWorkbook = univerAPI.createWorkbook(snapshot);

  // A snapshot loaded with formula cells is NOT auto-calculated on load — only edits made
  // through commands trigger the incremental recompute (confirmed empirically in the Phase 0
  // spike, frontend/src/sheet/spike/spike.js). Without this, reopening a saved sheet with
  // formulas would show stale/blank formula cells until the user edits something — a visible
  // correctness bug on the exact "reload khôi phục đúng snapshot" path Phase 1/2 both depend on.
  univerAPI.getFormula().executeCalculation();

  return { univer, univerAPI, fWorkbook };
}

export function getSnapshot(fWorkbook) {
  return fWorkbook.save();
}

export function setRangeValues(fWorkbook, row, col, value, sheetName) {
  const sheet = sheetName ? fWorkbook.getSheetByName(sheetName) : fWorkbook.getActiveSheet();
  sheet.getRange(row, col).setValue(value);
}

export function getRangeValues(fWorkbook, row, col, sheetName) {
  const sheet = sheetName ? fWorkbook.getSheetByName(sheetName) : fWorkbook.getActiveSheet();
  return sheet.getRange(row, col).getValue();
}

// cb: (command) => void, fires after every command Univer executes (edits, formatting, etc.)
export function onChange(univerAPI, cb) {
  return univerAPI.onCommandExecuted(cb);
}

// Real implementation is Sheet v2 scope (FFormula.registerFunction/registerAsyncFunction,
// see 03-spreadsheet.md §1) — not needed for the Phase 0 performance spike.
export function registerFunction() {
  throw new Error('univerAdapter.registerFunction() is not implemented — deferred to Sheet v2 (see specs/space-flow-master-plan/03-spreadsheet.md).');
}
