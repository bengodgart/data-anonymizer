/*
 * worker.js - runs parsing, anonymization, and verification off the main thread
 * so the page stays responsive on large files. It receives already-extracted
 * CSV text (Excel is converted to CSV on the main thread with SheetJS), maps
 * columns, anonymizes, runs the round-trip verify, and returns both CSV files.
 */
/* global self, importScripts, DAParse, DAAnon, DAVerify */
importScripts('src/zipdata.js', 'src/parse.js', 'src/anonymize.js', 'src/verify.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type !== 'run') return;
  try {
    post('progress', { stage: 'Parsing rows' });
    var dataset = DAParse.parseCsv(msg.csvText);

    post('progress', { stage: 'Detecting column types' });
    var colTypes = DAParse.detectColumnTypes(dataset.headers, dataset.rows, 1000);

    post('progress', { stage: 'Anonymizing ' + dataset.rows.length + ' rows' });
    var out = DAAnon.anonymizeDataset(dataset, msg.mapping, colTypes);

    post('progress', { stage: 'Verifying round trip' });
    var vr = DAVerify.roundTripVerify(dataset.rows, out.original, out.anon);

    post('progress', { stage: 'Building output files' });
    var anonCsv = DAParse.toCsv(out.anon.headers, out.anon.rows);
    var originalCsv = DAParse.toCsv(out.original.headers, out.original.rows);

    // A small preview: original vs anonymized for the first few rows.
    var previewCols = out.anon.headers;
    var preview = [];
    var previewCount = Math.min(5, out.anon.rows.length);
    for (var i = 0; i < previewCount; i++) {
      preview.push({ original: out.original.rows[i], anon: out.anon.rows[i] });
    }

    post('done', {
      anonCsv: anonCsv,
      originalCsv: originalCsv,
      stats: out.stats,
      verify: vr,
      previewCols: previewCols,
      preview: preview
    });
  } catch (err) {
    post('error', { message: (err && err.message) || String(err) });
  }
};

function post(type, payload) {
  payload = payload || {};
  payload.type = type;
  self.postMessage(payload);
}
