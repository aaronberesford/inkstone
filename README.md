# Inkstone MVP

This folder contains a self-contained first pass of a Chinese learning web app.

## What is included

- `index.html`: the main study workspace
- `styles.css`: the visual system and responsive layout
- `app.js`: review flow, dictionary search, sentence linking, and local file imports
- `assets/data/sample-data.js`: starter HSK-flavored vocabulary and sentence data

## How to use it

1. Serve this folder with a local static server if you want `assets/data/cedict_ts.u8`, `assets/data/cmn.txt`, and `assets/data/hsk_words.json` to auto-load on startup. Opening `index.html` directly over `file://` will still work, but the browser will block those automatic fetches.
2. Use the study queue in the center to flip through cards.
3. Search in the dictionary panel to inspect terms and linked sentences.
4. Import a CEDICT `.u8` file manually if you are not serving the folder yet.
5. Import a sentence TSV, CSV, or Tatoeba-style tab-separated file to add more example rows.

## Current data assumptions

- CEDICT lines are parsed from the common `traditional simplified [pinyin] /definition/` format.
- Sentence imports try to detect Chinese text, optional pinyin, optional English columns, and the standard Tatoeba bilingual tab-separated format.
- Imported sentence rows are linked to words by shared hanzi matches.
- HSK badges and HSK-only filtering are now driven by `assets/data/hsk_words.json`, generated from the public HSK 3.0 CSV derived from the official 2021 MOE word list.

## Next recommended steps

- Add a proper import pipeline that converts CEDICT into a compact SQLite or JSON index.
- Attach Make Me a Hanzi JSON to each character so the inspector can render stroke-order data.
- Expand the HSK metadata with frequency, tags, and user mastery.
- Add Tatoeba `links.csv` support so Chinese and English lines can be paired more accurately.
