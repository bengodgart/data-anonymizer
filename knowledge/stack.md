---
type: Tech Stack
title: data-anonymizer stack
description: 'Frameworks, storage and services data-anonymizer runs on.'
runtime: Browser
framework: 'None. Plain HTML, CSS and JavaScript, plus a Web Worker.'
build: 'None. Static site, no dependencies to install.'
storage: 'None. No server, no upload, no storage.'
hosting: GitHub Pages
tests: 'node test.js, 202 assertions'
generated:
  by: claude-opus-5
  at: '2026-07-29T04:31:42+00:00'
status: stable
---

# Stack

* **Runtime**: the browser. No server, no upload, no storage. The data never leaves the
  device.
* **Framework**: none. Plain HTML, CSS and JavaScript.
* **Web Worker**: `worker.js` does the heavy work off the main thread. This is the one
  constraint that shapes local development, because a Worker will not load from a `file://`
  URL.
* **Files**: `src/` and `app.js` for the logic, `worker.js` for the worker, `vendor/` for
  bundled third-party code, `samples/` for example inputs, `scripts/` for tooling.
* **Input formats**: `.csv`, `.xlsx` and `.xls`. Multi-sheet workbooks let you pick a sheet.
* **Hosting**: GitHub Pages.
* **Tests**: `node test.js`, 202 assertions, dependency free, printing `ALL PASS`.

## The safety mechanic

Before any download unlocks, the tool merges the two output files back together on
`anon_key` and confirms the original data is reproduced exactly. If that round trip fails,
downloads stay locked. The SHA-256 implementation is checked against published
known-answer vectors, and the round-trip verifier is tested with both a passing case and a
deliberately tampered file.
