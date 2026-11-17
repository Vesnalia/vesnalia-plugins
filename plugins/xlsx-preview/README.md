# Xlsx Preview

Preview `.xlsx` and `.xlsm` spreadsheets inside VesnALIA's file panel.

- Switch between sheets with tabs.
- Read tables with column letters, row numbers, sticky headers, merged cells, and date values.
- Display up to 1,000 rows and 100 columns per sheet, with a notice when content is truncated.
- Find spreadsheets in the current workspace and thread files from the **Spreadsheets** header button.
- Fall back to VesnALIA's built-in preview when parsing fails.

## Install

Install the public Git release with:

```sh
alia plugin install 'git:https://github.com/must-aero/bb-plugin-xlsx-preview.git@^0.1.0'
```

Select **Spreadsheet table** for `.xlsx` and `.xlsm` under **Settings → Files → File openers** if another viewer takes priority.

Requires VesnALIA 0.46 or later and Plugin SDK 0.6.49 or later. No external account or separate spreadsheet application is required. Workbook parsing runs in the browser using `DecompressionStream` and `DOMParser`.

This is a read-only preview. Legacy binary `.xls` files are not supported. It displays stored cell values and does not calculate formulas or execute macros.

## Development

```sh
npm ci
npx tsc --noEmit
alia plugin build .
alia plugin install .
```
