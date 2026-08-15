# Knowledge Bundle Log

## 2026-08-15
* **Record ID term added**: an optional column that takes over the identity when the
  file has one, so one customer number is one person through a typo or a missing
  birth date, and two people sharing a name and birth date stay separate. The real
  ID is replaced in the anonymized output. Required terms unchanged. Assertion
  count 230 to 250.

## 2026-08-14 (third pass)
* **Rows with no identity no longer merge**: a row with no name and no date of birth
  used to hash to the empty string, so every such row shared one key and one fake
  person. Each distinct row now gets its own `unknown-` key and the count is
  reported. Same defect class found alongside: the pure-JS SHA-256 returned an
  empty string for any name outside Latin-1, merging every non-Latin name into one
  fake identity; it now UTF-8 encodes first and is cross-checked against Node's
  crypto. Assertion count 202 to 230.

## 2026-08-14 (second pass)
* **Terms corrected and extended**: `special_number` renamed to `ssn`; `email` and
  `card_number` added, making the tool's public card copy true for the first time.
  Cards and SSNs are masked, never faked. Fake emails are unique per person and
  empty cells stay empty. Sample dataset regenerated with the two new columns and
  published card TEST numbers. Assertion count 153 to 202.

## 2026-08-14
* **Column suggestions added**: `src/suggest.js` recommends a column per term from the
  column names and value shapes; the map step gained a per-row button and one
  accept-all button. Bundle updated for the new module and the assertion count
  (94 to 153). Verified with `node test.js` and a headless browser pass over the
  shipped sample file.

## 2026-07-29
* **Authoring pass**: every document reviewed and written from this repo's own files
  (CLAUDE.md, AGENTS.md, SETUP.md, PRD.md, README.md, manifests). `live_url` and repo
  visibility confirmed with a live request, not inferred from the README. Documents marked
  `status: stable` are evidenced; any surviving `TODO: fill in` marks a fact this repo
  genuinely does not record.
* **Independent audit**: a separate verification lane re-checked these claims against the
  source and its findings were applied. Reports at `P:/clear-prep/okf-audit-new40.md` and
  `P:/clear-prep/okf-audit-backfill14.md`.
* **Creation**: Draft bundle scaffolded by okf-kit from repo manifests.
