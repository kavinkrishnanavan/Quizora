# Quiz-Wiz (SharkTank Quiz-Wiz)

Generate baseline worksheets or personalized quizzes (with answers) for students using an AI backend (Groq) and a simple web UI.

The frontend is a static site in `public/`, and the AI call runs server-side via a Netlify Function in `netlify/functions/generate.js` (so your API key is not exposed in the browser).

## Features

- **Personalized Tests**: upload a CSV/XLSX of student names + marks, then generate quizzes whose difficulty adapts to each student's score.
- **Learning Materials (PDF + Web links)**: upload PDFs and/or paste links to notes/slides to summarize what students have learned and generate more personalized quizzes.
- **Baseline Test**: generate a generic worksheet (not personalized to student data).
- **Answer formats**: blank-line answers or MCQ (A-D) with a correct option.
- **CSV/XLSX picker**: drag-select the name column and marks column in a spreadsheet-like preview.

## Project structure

- `public/` - static site (`index.html` for Personalized Tests, `baseline.html` for Baseline Test)
- `netlify/functions/generate.js` - Netlify Function that calls Groq and returns quiz JSON
- `netlify.toml` - Netlify config (`publish = "public"`, `functions = "netlify/functions"`)

## Prerequisites

- Node.js
- A Groq API key set as `GROQ_API_KEY`

## Run locally (with Netlify Functions)

1) Install dependencies:

```bash
npm install
```

2) Install the Netlify CLI (required to run `/.netlify/functions/*` locally):

```bash
npm install -g netlify-cli
```

3) Set your API key and start Netlify dev:

PowerShell:
```powershell
$env:GROQ_API_KEY="YOUR_KEY_HERE"
netlify dev
```

Then open the URL printed by Netlify (commonly `http://localhost:8888`).

## Deploy to Netlify

1) Create a new Netlify site from this repo.
2) Build settings:
   - **Build command**: (none)
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
3) Set `GROQ_API_KEY` in Netlify Site settings -> Environment variables.

## Usage notes (CSV / Excel)

### Uploading data

- The Personalized Tests page accepts `.csv`, `.xlsx`, and `.xls`.
- After upload, **drag to select** the column cells that contain student names, then marks (similar to Excel).

### CSV upload tips (Excel)

If a CSV converted from Excel fails to load, it's usually because the file is not plain UTF-8 CSV or because a cell contains a line break.

- Prefer **CSV UTF-8 (Comma delimited)** when saving from Excel.
- Avoid embedded newlines inside cells (Excel `Alt+Enter`) in the exported sheet.
- If your region uses `;` as the separator, the app auto-detects `,` vs `;`.

### If the data looks messy / causes errors

Rows are sent to the AI as a compact, `.txt`-style key/value representation. If a row has lots of unrelated columns or odd characters, the app retries with a smaller version focused on the selected marks column plus name/id-like fields.

## Configuration

- `GROQ_API_KEY` (required): used only by `netlify/functions/generate.js`
- Model: the function currently uses `openai/gpt-oss-120B` (edit `netlify/functions/generate.js` if you want a different Groq model)

## License

ISC (see `package.json`).
