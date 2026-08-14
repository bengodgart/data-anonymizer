---
type: Playbook
title: Run data-anonymizer locally
description: 'How to serve data-anonymizer and run its tests on a dev machine.'
generated:
  by: claude-opus-5
  at: '2026-07-29T04:31:42+00:00'
status: stable
---

# Steps

1. Clone the repo: `git clone https://github.com/bengodgart/data-anonymizer.git`
2. `cd data-anonymizer`
3. `python -m http.server 8000`, then open `http://localhost:8000`.

The deployed copy is at https://bengodgart.github.io/data-anonymizer/.

## Available scripts

* `node test.js` runs the correctness core: CSV parsing, column-type detection, name
  splitting, date normalisation, `anon_key` generation, collision resolution, fake
  generation, the column suggestions and the round-trip verifier. 153 assertions,
  ending `ALL PASS`.

## Common failures

* **Opening `index.html` directly from disk does not work.** A Web Worker will not load from
  a `file://` URL. Serve the folder over HTTP as in step 3.
* **Downloads stay locked if the round-trip test fails.** That is the safety gate, not a
  bug: the tool refuses to hand over files it cannot prove reverse cleanly.
* First name, last name and date of birth are required in the mapping. A single full-name
  column can satisfy first and last together.
