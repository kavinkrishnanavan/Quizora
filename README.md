# Quiz-Wiz

## CSV upload tips (Excel)

If a CSV converted from Excel “fails to load”, it’s usually because the file isn’t actually plain UTF-8 CSV or because a cell contains a line break.

- Prefer “CSV UTF-8 (Comma delimited)” when saving from Excel.
- Avoid embedded newlines inside cells (Excel Alt+Enter) in the exported sheet.
- If your region uses `;` as the separator, the app will auto-detect it.

### If the data looks messy / causes errors

If a row has lots of random/unrelated columns (or weird characters), the app will automatically send a simplified `.txt`-style version of that row to the AI (including the selected marks column plus name/id-like fields) and retry.
