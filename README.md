# Data Anonymizer

Turn a CSV or Excel file of real people into safe, realistic fake data you can
share, test with, or hand to a vendor. **Everything runs in your browser.** No
server, no upload, no storage. Your data never leaves your device.

Live: https://bengodgart.github.io/data-anonymizer/

## What it does

1. You upload a `.csv`, `.xlsx`, or `.xls` file. Excel workbooks with more than
   one sheet let you pick which sheet to use.
2. You map the personal-data columns to common terms (first name, last name,
   date of birth, phone, address, and so on). First name, last name, and date of
   birth are required; a full-name column can satisfy first and last together.
3. The tool produces **two files**, both carrying a shared `anon_key`:
   - `<name>_anonymized.csv`: realistic fake data in place of the personal
     fields.
   - `<name>_original_with_key.csv`: your original data with the matching
     `anon_key` added.
4. Before you can download, it runs a **round-trip test**: it merges the two
   files back together on `anon_key` and confirms the original data is reproduced
   exactly. If that fails, downloads stay locked.

## The `anon_key`

`anon_key` represents one unique person, so the same person always maps to the
same fake record across every row they appear in.

It is built from the first three letters of the first name, the first three
letters of the last name, and the normalized date of birth, then hashed with
SHA-256 (first 16 hex characters kept). The hash means you cannot read the real
name or birth date out of the key at a glance.

### Collision resolution

The first-3 + first-3 + date-of-birth recipe can, on a large dataset, land two
**genuinely different** people in the same bucket (for example `Johnny Smithly`
and `Johnathan Smithson`, both born 3/3/1970). Collapsing them into one key would
corrupt any per-person analysis.

To prevent that, each person also gets a **full-identity signature** built from
their complete first name, complete last name, and date of birth. When a bucket
holds two or more distinct signatures, each one receives a deterministic ordinal
suffix (`-01`, `-02`, ...), assigned in sorted-signature order so the same person
always gets the same suffix no matter the row order. Colliding people also get
separate fake records, because the fake data is seeded from the full signature
rather than the shared bucket. People with no collision keep a clean, unsuffixed
key.

Worked example on `samples/sample-people.csv`:

```
row0 (John Smith 1/1/2000)          -> f475f70c84c13dfe
row1 (Jane Doe 5/5/1990)            -> fa4c24ed4104cbdf
row2 (John Smith 1/1/2000)          -> f475f70c84c13dfe      (same person, same key)
row3 (Robert Johnson 7/4/1985)      -> 241053af0533b35f
row4 (Johnny Smithly 3/3/1970)      -> c5dcbe048f520260-02   (collision resolved)
row5 (Johnathan Smithson 3/3/1970)  -> c5dcbe048f520260-01   (collision resolved)
```

## Fake data rules

- **Names** are drawn from fixed vocabularies, stable per person.
- **Special number** is replaced with `***-**-****`.
- **Phone** becomes `(555) 555-5555` when its source column is text, or
  `5555555555` when the column is numeric.
- **Addresses** stay internally consistent: a fake ZIP always carries the same
  city, state, county, and country, because they all come from one real ZIP
  record chosen for that person.
- Unmapped columns pass through untouched.

## Why client-side

This is a privacy tool, so the strongest design is the one where the sensitive
file physically cannot be sent anywhere. Parsing, anonymization, and the
round-trip check all run in your browser, with the heavy work handed to a Web
Worker so the page stays responsive on large files.

## Running locally

It is a static site. Serve the folder over HTTP (a Web Worker will not load from
a `file://` URL):

```
cd data-anonymizer
python -m http.server 8000
# open http://localhost:8000
```

## Tests

The correctness core (CSV parsing, column-type detection, name splitting, date
normalization, `anon_key` generation, collision resolution, fake generation, and
the round-trip verifier) is covered by a dependency-free Node test:

```
node test.js
```

```
Assertions passed: 94
Assertions failed: 0
ALL PASS
```

The SHA-256 implementation is checked against published known-answer vectors, and
the round-trip verifier is checked with both a passing case and a deliberately
tampered file.

## Third-party code

Reading `.xlsx` / `.xls` uses [SheetJS](https://sheetjs.com) (community build,
vendored in `vendor/`). Everything else, including the SHA-256 hash and the fake
data generator, is written from scratch with no runtime dependencies.

## License

MIT. See `LICENSE`.
