/*
 * parse.js - CSV parsing/serialization + column type detection.
 * Works in the browser and in Node (shared logic, no dependencies).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.DAParse = api;
})(this, function () {
  'use strict';

  // Parse a CSV string into { headers, rows }.
  // Handles quoted fields, doubled quotes ("") as an escaped quote,
  // commas and newlines inside quotes, and both \r\n and \n line endings.
  function parseCsv(text) {
    var rows = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var i = 0;
    var n = text.length;

    // Strip a UTF-8 BOM if present.
    if (n > 0 && text.charCodeAt(0) === 0xfeff) {
      i = 1;
    }

    function endField() {
      record.push(field);
      field = '';
    }
    function endRecord() {
      endField();
      rows.push(record);
      record = [];
    }

    for (; i < n; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          endField();
        } else if (c === '\n') {
          endRecord();
        } else if (c === '\r') {
          // Handle \r\n and a lone \r.
          if (text[i + 1] === '\n') i++;
          endRecord();
        } else {
          field += c;
        }
      }
    }
    // Flush the trailing field/record if the file did not end with a newline.
    if (field !== '' || record.length > 0) {
      endRecord();
    }

    if (rows.length === 0) return { headers: [], rows: [] };
    var headers = rows[0];
    var body = rows.slice(1);
    return { headers: headers, rows: body };
  }

  // Quote a single field for CSV output when needed.
  function quoteField(value) {
    var s = value == null ? '' : String(value);
    if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // Serialize { headers, rows } back into a CSV string (RFC 4180 style, \r\n).
  function toCsv(headers, rows) {
    var out = [];
    out.push(headers.map(quoteField).join(','));
    for (var r = 0; r < rows.length; r++) {
      out.push(rows[r].map(quoteField).join(','));
    }
    return out.join('\r\n');
  }

  // Decide whether a column reads as numeric or string, by sampling its values.
  // A column counts as 'number' only if every non-empty sampled value is numeric.
  function detectColumnType(values) {
    var sawValue = false;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v == null) continue;
      var s = String(v).trim();
      if (s === '') continue;
      sawValue = true;
      // Plain integer or decimal, optional leading sign. No thousands separators.
      if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
        return 'string';
      }
    }
    return sawValue ? 'number' : 'string';
  }

  // Build a per-column type map given headers and rows (samples up to `sample` rows).
  function detectColumnTypes(headers, rows, sample) {
    var limit = Math.min(rows.length, sample || 500);
    var types = {};
    for (var c = 0; c < headers.length; c++) {
      var vals = [];
      for (var r = 0; r < limit; r++) {
        vals.push(rows[r][c]);
      }
      types[c] = detectColumnType(vals);
    }
    return types;
  }

  return {
    parseCsv: parseCsv,
    toCsv: toCsv,
    quoteField: quoteField,
    detectColumnType: detectColumnType,
    detectColumnTypes: detectColumnTypes
  };
});
