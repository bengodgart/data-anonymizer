/*
 * verify.js - the round-trip merge test.
 *
 * Before the user downloads anything, we prove the two output files can be
 * merged back on anon_key to reclaim the original data. This is the safety
 * gate: if it fails, something in the pipeline dropped or scrambled a row and
 * the files are not trustworthy.
 *
 * The test:
 *   1. Both files must have the same row count and identical anon_key per row.
 *   2. Group the ORIGINAL file's rows by anon_key (queues, preserving order).
 *   3. Walk the ANONYMIZED file; for each row, pop the next original row from
 *      that key's queue and collect it. This is exactly a keyed merge.
 *   4. The reclaimed original rows, in order, must deep-equal the input rows.
 *   5. No original rows may be left unmatched.
 *
 * Works in the browser and in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.DAVerify = api;
})(this, function () {
  'use strict';

  function rowsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (String(a[i] == null ? '' : a[i]) !== String(b[i] == null ? '' : b[i])) return false;
    }
    return true;
  }

  // inputRows: the ORIGINAL input rows (no anon_key), for the deep-equal check.
  // original / anon: { headers, rows } outputs, each ending in an anon_key column.
  function roundTripVerify(inputRows, original, anon) {
    var result = {
      pass: false,
      rowCount: anon.rows.length,
      checks: [],
      firstMismatch: null
    };
    function record(name, ok, detail) {
      result.checks.push({ name: name, ok: ok, detail: detail || '' });
      return ok;
    }

    var keyCol = anon.headers.length - 1; // anon_key is the last column.

    // 1. Row counts line up across all three.
    var countsOk = original.rows.length === anon.rows.length && anon.rows.length === inputRows.length;
    record('Row counts match', countsOk,
      'input=' + inputRows.length + ' anonymized=' + anon.rows.length + ' original=' + original.rows.length);
    if (!countsOk) return result;

    // 2. anon_key identical row-for-row between the two output files.
    var keysAligned = true;
    for (var i = 0; i < anon.rows.length; i++) {
      if (anon.rows[i][keyCol] !== original.rows[i][keyCol]) { keysAligned = false; result.firstMismatch = i; break; }
    }
    record('anon_key aligned across files', keysAligned,
      keysAligned ? '' : 'first divergence at row ' + result.firstMismatch);
    if (!keysAligned) return result;

    // 3. Group original rows into per-key queues, preserving order.
    var queues = {};
    for (i = 0; i < original.rows.length; i++) {
      var k = original.rows[i][keyCol];
      (queues[k] || (queues[k] = [])).push(original.rows[i]);
    }
    var cursor = {};

    // 4. Merge on anon_key and compare the reclaimed original to the input.
    var mergeOk = true;
    for (i = 0; i < anon.rows.length; i++) {
      var key = anon.rows[i][keyCol];
      var idx = cursor[key] || 0;
      var q = queues[key];
      if (!q || idx >= q.length) { mergeOk = false; result.firstMismatch = i; break; }
      cursor[key] = idx + 1;
      var reclaimed = q[idx].slice(0, keyCol); // drop the appended anon_key
      if (!rowsEqual(reclaimed, inputRows[i])) { mergeOk = false; result.firstMismatch = i; break; }
    }
    record('Original data reclaimed via anon_key merge', mergeOk,
      mergeOk ? '' : 'first mismatch at row ' + result.firstMismatch);
    if (!mergeOk) return result;

    // 5. No leftover original rows.
    var leftover = 0;
    for (key in queues) {
      if (queues.hasOwnProperty(key)) leftover += queues[key].length - (cursor[key] || 0);
    }
    var noLeftover = leftover === 0;
    record('No unmatched original rows', noLeftover, noLeftover ? '' : leftover + ' rows unmatched');

    result.pass = countsOk && keysAligned && mergeOk && noLeftover;
    return result;
  }

  return { roundTripVerify: roundTripVerify, rowsEqual: rowsEqual };
});
