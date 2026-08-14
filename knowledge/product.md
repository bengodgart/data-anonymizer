---
type: Product
title: data-anonymizer
description: Turn a CSV or Excel file of real people into safe, realistic fake data you can share, test with, or hand to a vendor. **Everything runs in your browser.** No server, no upload, no storage. Your data never leaves your device.
domain: Data & Analytics
users: Anyone who has to share a file of real people with a vendor, a test environment or a colleague.
lifecycle: shipped
live_url: https://bengodgart.github.io/data-anonymizer/
pricing: Free.
generated:
  by: claude-opus-5
  at: '2026-07-29T04:31:42+00:00'
status: stable
resource: https://github.com/bengodgart/data-anonymizer.git
---

# data-anonymizer

Turn a CSV or Excel file of real people into safe, realistic fake data you can share, test with, or hand to a vendor. **Everything runs in your browser.** No server, no upload, no storage. Your data never leaves your device.

## Who it is for

Whoever is about to hand a spreadsheet of real people to someone who should not see it.

## What problem it solves

Turns a CSV or Excel file of real people into safe, realistic fake data, with a collision-resolving `anon_key` so rows stay joinable, and a round-trip merge test so you can prove the mapping holds. Everything runs in the browser - no server, no upload.

The mapping step reads the column names and values and recommends a match for each term it recognizes, offered as a button per row plus one button that accepts every recommendation at once. Nothing is assigned until the user clicks, so a real file is one click to map and a demo needs no setup at all. Detail in `README.md`, engine in `src/suggest.js`.

Seventeen terms are supported. Only first name, last name and date of birth are ever required, because those three build the key; everything else is optional. Social Security numbers and card numbers are masked rather than faked (no digits survive, not even a card's last four), email becomes `firstname.lastname@example.com` matching that person's fake name, and an empty source cell is left empty rather than filled in.

## Current state

Shipped and public.
