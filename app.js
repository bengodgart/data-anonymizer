/*
 * app.js - UI orchestration for the Data Anonymizer.
 * Wizard: upload -> (sheet) -> map columns -> verify -> download.
 * All work is client-side. Heavy work runs in worker.js.
 */
(function () {
  'use strict';

  var TERMS = DAAnon.TERMS;
  var TERM_LABELS = DAAnon.TERM_LABELS;
  var REQUIRED_HINT = { first_name: true, last_name: true, date_of_birth: true };

  var state = {
    fileBaseName: 'data',
    headers: [],
    sampleRows: [],
    csvText: '',
    suggestions: {},
    result: null
  };

  var el = {
    stepIndicator: document.getElementById('stepIndicator'),
    errorAlert: document.getElementById('errorAlert'),
    errorList: document.getElementById('errorList'),
    fileInput: document.getElementById('fileInput'),
    dropzone: document.getElementById('dropzone'),
    sheetChoices: document.getElementById('sheetChoices'),
    suggestBar: document.getElementById('suggestBar'),
    suggestText: document.getElementById('suggestText'),
    acceptAllBtn: document.getElementById('acceptAllBtn'),
    mapGrid: document.getElementById('mapGrid'),
    runBtn: document.getElementById('runBtn'),
    progressText: document.getElementById('progressText'),
    verdict: document.getElementById('verdict'),
    stats: document.getElementById('stats'),
    previewTable: document.getElementById('previewTable'),
    downloads: document.getElementById('downloads'),
    restartBtn: document.getElementById('restartBtn')
  };

  var PANELS = ['upload', 'sheet', 'map', 'verify', 'download'];

  function show(step) {
    PANELS.forEach(function (p) {
      var panel = document.getElementById('panel-' + p);
      if (panel) panel.hidden = p !== step;
    });
    // Step indicator state.
    var order = PANELS;
    var activeIdx = order.indexOf(step);
    Array.prototype.forEach.call(el.stepIndicator.children, function (li, i) {
      li.classList.remove('active', 'done');
      if (i < activeIdx) li.classList.add('done');
      else if (i === activeIdx) li.classList.add('active');
    });
  }

  function showErrors(list) {
    if (!list || !list.length) {
      el.errorAlert.hidden = true;
      el.errorList.innerHTML = '';
      return;
    }
    el.errorList.innerHTML = '';
    list.forEach(function (msg) {
      var li = document.createElement('li');
      li.textContent = msg;
      el.errorList.appendChild(li);
    });
    el.errorAlert.hidden = false;
    el.errorAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function baseName(fileName) {
    return fileName.replace(/\.[^.]+$/, '');
  }

  // -------------------------------------------------------------------------
  // Upload handling.
  // -------------------------------------------------------------------------
  function handleFile(file) {
    showErrors([]);
    state.fileBaseName = baseName(file.name);
    var lower = file.name.toLowerCase();
    if (lower.slice(-4) === '.csv') {
      var reader = new FileReader();
      reader.onload = function () {
        state.csvText = String(reader.result);
        goToMapping();
      };
      reader.onerror = function () { showErrors(['Could not read the file.']); };
      reader.readAsText(file);
    } else if (lower.slice(-5) === '.xlsx' || lower.slice(-4) === '.xls') {
      var r2 = new FileReader();
      r2.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(r2.result), { type: 'array' });
          if (!wb.SheetNames.length) { showErrors(['This workbook has no sheets.']); return; }
          if (wb.SheetNames.length === 1) {
            state.csvText = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
            goToMapping();
          } else {
            offerSheets(wb);
          }
        } catch (err) {
          showErrors(['Could not read the Excel file: ' + (err.message || err)]);
        }
      };
      r2.onerror = function () { showErrors(['Could not read the file.']); };
      r2.readAsArrayBuffer(file);
    } else {
      showErrors(['Unsupported file type. Use a .csv, .xlsx, or .xls file.']);
    }
  }

  function offerSheets(wb) {
    el.sheetChoices.innerHTML = '';
    wb.SheetNames.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg';
      b.textContent = name;
      b.addEventListener('click', function () {
        state.csvText = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        goToMapping();
      });
      el.sheetChoices.appendChild(b);
    });
    show('sheet');
  }

  // -------------------------------------------------------------------------
  // Mapping.
  // -------------------------------------------------------------------------
  function goToMapping() {
    // Parse just headers and a few sample rows for the preview + type hints.
    var parsedHead = DAParse.parseCsv(firstLines(state.csvText, 8));
    state.headers = parsedHead.headers;
    state.sampleRows = parsedHead.rows;
    if (!state.headers.length) {
      showErrors(['The file appears to be empty or has no header row.']);
      show('upload');
      return;
    }
    // Recommendations only. Nothing is assigned until the user says so.
    state.suggestions = DASuggest.suggestMapping(state.headers, state.sampleRows);
    buildMapGrid();
    show('map');
  }

  function firstLines(text, n) {
    var count = 0;
    var i = 0;
    for (; i < text.length && count < n; i++) {
      if (text[i] === '\n') count++;
    }
    return text.slice(0, i);
  }

  function sampleFor(colIdx) {
    for (var r = 0; r < state.sampleRows.length; r++) {
      var v = state.sampleRows[r][colIdx];
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function buildMapGrid() {
    el.mapGrid.innerHTML = '';
    TERMS.forEach(function (term) {
      var row = document.createElement('div');
      row.className = 'map-row';
      row.dataset.term = term;

      var label = document.createElement('div');
      label.className = 'map-label';
      var span = document.createElement('span');
      span.textContent = TERM_LABELS[term];
      label.appendChild(span);
      if (REQUIRED_HINT[term]) {
        var badge = document.createElement('span');
        badge.className = 'req-badge';
        badge.textContent = 'required';
        label.appendChild(badge);
      }

      var select = document.createElement('select');
      select.dataset.term = term;
      var optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = 'Not assigned';
      select.appendChild(optNone);
      state.headers.forEach(function (h, idx) {
        var opt = document.createElement('option');
        opt.value = String(idx);
        var sample = sampleFor(idx);
        opt.textContent = (h || ('Column ' + (idx + 1))) + (sample ? '  (e.g. ' + truncate(sample, 22) + ')' : '');
        select.appendChild(opt);
      });
      select.addEventListener('change', liveValidate);

      row.appendChild(label);
      row.appendChild(select);
      row.appendChild(buildSuggestCell(term));
      el.mapGrid.appendChild(row);
    });
    liveValidate();
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function columnLabel(idx) {
    return state.headers[idx] || ('Column ' + (idx + 1));
  }

  // -------------------------------------------------------------------------
  // Suggestions. Each row offers its own one-click fix; the bar at the top
  // takes all of them at once. Neither ever runs on its own.
  // -------------------------------------------------------------------------
  function buildSuggestCell(term) {
    var cell = document.createElement('div');
    cell.className = 'map-suggest';
    if (state.suggestions[term]) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-suggest';
      btn.dataset.term = term;
      btn.addEventListener('click', function () {
        applySuggestion(term);
      });
      cell.appendChild(btn);
    } else {
      var none = document.createElement('span');
      none.className = 'map-suggest-none';
      none.textContent = 'No match found';
      cell.appendChild(none);
    }
    return cell;
  }

  function selectFor(term) {
    return el.mapGrid.querySelector('select[data-term="' + term + '"]');
  }

  // Point one dropdown at its suggested column. A column can only be mapped
  // once, so it is taken off anything else that holds it.
  function assignSuggestion(term) {
    var suggestion = state.suggestions[term];
    var target = selectFor(term);
    if (!suggestion || !target) return;
    Array.prototype.forEach.call(el.mapGrid.querySelectorAll('select'), function (sel) {
      if (sel !== target && sel.value === String(suggestion.col)) sel.value = '';
    });
    target.value = String(suggestion.col);
  }

  function applySuggestion(term) {
    assignSuggestion(term);
    liveValidate();
  }

  function acceptAllSuggestions() {
    TERMS.forEach(function (term) {
      if (state.suggestions[term]) assignSuggestion(term);
    });
    liveValidate();
  }

  function refreshSuggestUi() {
    var total = 0;
    var pending = 0;
    Array.prototype.forEach.call(el.mapGrid.querySelectorAll('.btn-suggest'), function (btn) {
      var suggestion = state.suggestions[btn.dataset.term];
      if (!suggestion) return;
      total++;
      var sel = selectFor(btn.dataset.term);
      var name = columnLabel(suggestion.col);
      if (sel && sel.value === String(suggestion.col)) {
        btn.disabled = true;
        btn.textContent = 'Suggestion applied';
        btn.title = 'This is set to the column "' + name + '". ' + suggestion.reason;
      } else {
        pending++;
        btn.disabled = false;
        btn.textContent = 'Use "' + truncate(name, 13) + '"';
        btn.title = 'Set this to the column "' + name + '". ' + suggestion.reason;
      }
    });
    updateSuggestBar(total, pending);
  }

  function updateSuggestBar(total, pending) {
    if (!total) {
      el.suggestBar.hidden = true;
      return;
    }
    el.suggestBar.hidden = false;
    if (pending > 0) {
      el.suggestText.textContent = total === 1
        ? 'One column in your file looks like a match. Check it before you continue.'
        : total + ' columns in your file look like a match. Check them before you continue.';
      el.acceptAllBtn.disabled = false;
      el.acceptAllBtn.textContent = 'Accept all suggestions';
    } else {
      el.suggestText.textContent = total === 1
        ? 'The suggested column is filled in below. Change it if it is wrong.'
        : 'All ' + total + ' suggested columns are filled in below. Change any that are wrong.';
      el.acceptAllBtn.disabled = true;
      el.acceptAllBtn.textContent = 'All suggestions applied';
    }
  }

  function readMapping() {
    var mapping = {};
    Array.prototype.forEach.call(el.mapGrid.querySelectorAll('select'), function (sel) {
      if (sel.value !== '') mapping[sel.dataset.term] = parseInt(sel.value, 10);
    });
    return mapping;
  }

  function liveValidate() {
    var mapping = readMapping();
    var errors = DAAnon.validateMapping(mapping);
    // Mark satisfied rows (green) for required-ish terms.
    var hasFull = mapping.full_name_last_first != null || mapping.full_name_first_last != null;
    Array.prototype.forEach.call(el.mapGrid.querySelectorAll('.map-row'), function (row) {
      var term = row.dataset.term;
      var satisfied = mapping[term] != null ||
        ((term === 'first_name' || term === 'last_name') && hasFull);
      row.classList.toggle('satisfied', satisfied);
    });
    el.runBtn.disabled = errors.length > 0;
    showErrors(errors);
    refreshSuggestUi();
    return errors;
  }

  // -------------------------------------------------------------------------
  // Run (worker) + results.
  // -------------------------------------------------------------------------
  function run() {
    var mapping = readMapping();
    var errors = DAAnon.validateMapping(mapping);
    if (errors.length) { showErrors(errors); return; }
    showErrors([]);
    show('verify');
    el.progressText.textContent = 'Starting';

    var worker = new Worker('worker.js');
    worker.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === 'progress') {
        el.progressText.textContent = msg.stage;
      } else if (msg.type === 'done') {
        state.result = msg;
        worker.terminate();
        renderResults(msg);
      } else if (msg.type === 'error') {
        worker.terminate();
        show('map');
        showErrors(['Processing failed: ' + msg.message]);
      }
    };
    worker.onerror = function (err) {
      worker.terminate();
      show('map');
      showErrors(['Worker error: ' + (err.message || 'unknown')]);
    };
    worker.postMessage({ type: 'run', csvText: state.csvText, mapping: mapping });
  }

  function renderResults(msg) {
    var vr = msg.verify;
    var stats = msg.stats;

    // Verdict banner.
    el.verdict.className = 'verdict ' + (vr.pass ? 'pass' : 'fail');
    if (vr.pass) {
      el.verdict.innerHTML = 'Round-trip verification passed. ' +
        'The two files merge back on <code>anon_key</code> to reproduce the original data exactly.' +
        '<small>Checks: ' + vr.checks.map(function (c) { return c.name; }).join(' | ') + '</small>';
    } else {
      var failed = vr.checks.filter(function (c) { return !c.ok; });
      el.verdict.innerHTML = 'Round-trip verification FAILED. Downloads are disabled so you do not ship bad files.' +
        '<small>' + (failed.length ? failed.map(function (c) { return c.name + ': ' + c.detail; }).join(' | ') : 'See console.') + '</small>';
    }

    // Stats.
    el.stats.innerHTML = '';
    addStat(stats.rowCount, 'Rows');
    addStat(stats.uniquePersons, 'Unique people');
    if (stats.unidentifiedRows > 0) addStat(stats.unidentifiedRows, 'Rows with no identity', true);
    addStat(stats.assignedTerms.length, 'Fields anonymized');
    addStat(stats.collisionCount, 'Collisions resolved', stats.collisionCount > 0);

    // Explain anything the run had to resolve, in the order it would worry you.
    ['collisionNote', 'unidentifiedNote'].forEach(function (id) {
      var existing = document.getElementById(id);
      if (existing) existing.remove();
    });
    if (stats.collisionCount > 0) {
      addNote('collisionNote', stats.collidedPeople + ' people fell into ' + stats.collisionCount +
        ' shared key bucket(s) (same first 3 letters, last 3 letters, and date of birth). ' +
        'They were kept distinct by their full name and given ordinal suffixes (for example -01, -02) ' +
        'plus separate fake records, so no two people were merged.');
    }
    if (stats.unidentifiedRows > 0) {
      addNote('unidentifiedNote', stats.unidentifiedRows + ' rows had no name and no date of birth, so there was ' +
        'nothing in them to identify a person with. Rather than merging them into one person, each different ' +
        'row was given its own key starting with "unknown-" and its own fake record, which came to ' +
        stats.unidentifiedKeys + ' of them. They are not counted as people above.');
    }

    // Preview table (original vs anonymized).
    renderPreview(msg.previewCols, msg.preview);

    // Downloads.
    el.downloads.innerHTML = '';
    var anonName = state.fileBaseName + '_anonymized.csv';
    var origName = state.fileBaseName + '_original_with_key.csv';
    addDownload(anonName, 'Fake data in place of personal details, plus the anon_key column.', msg.anonCsv, vr.pass);
    addDownload(origName, 'Your original data with the matching anon_key column added.', msg.originalCsv, vr.pass);

    show('download');
  }

  function addNote(id, text) {
    var note = document.createElement('p');
    note.id = id;
    note.className = 'note';
    note.textContent = text;
    el.stats.parentNode.insertBefore(note, el.stats.nextSibling);
  }

  function addStat(num, lbl, warn) {
    var d = document.createElement('div');
    d.className = 'stat' + (warn ? ' warn' : '');
    d.innerHTML = '<div class="num">' + num + '</div><div class="lbl">' + lbl + '</div>';
    el.stats.appendChild(d);
  }

  function renderPreview(cols, preview) {
    var t = el.previewTable;
    t.innerHTML = '';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    var corner = document.createElement('th');
    corner.textContent = '';
    htr.appendChild(corner);
    cols.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);

    var tbody = document.createElement('tbody');
    preview.forEach(function (pair) {
      appendPreviewRow(tbody, 'Original', pair.original, null);
      appendPreviewRow(tbody, 'Anonymized', pair.anon, pair.original);
    });
    t.appendChild(tbody);
  }

  function appendPreviewRow(tbody, label, cells, compareTo) {
    var tr = document.createElement('tr');
    var lab = document.createElement('td');
    lab.className = 'rowlabel';
    lab.textContent = label;
    tr.appendChild(lab);
    cells.forEach(function (val, i) {
      var td = document.createElement('td');
      td.textContent = val == null ? '' : val;
      if (compareTo && String(compareTo[i]) !== String(val)) td.className = 'changed';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  function addDownload(fileName, desc, csvText, enabled) {
    var card = document.createElement('div');
    card.className = 'dl-card';
    var fn = document.createElement('div');
    fn.className = 'fname';
    fn.textContent = fileName;
    var d = document.createElement('div');
    d.className = 'desc';
    d.textContent = desc;
    var btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Download';
    btn.disabled = !enabled;
    btn.addEventListener('click', function () { downloadCsv(fileName, csvText); });
    card.appendChild(fn);
    card.appendChild(d);
    card.appendChild(btn);
    el.downloads.appendChild(card);
  }

  function downloadCsv(fileName, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function restart() {
    state.result = null;
    state.csvText = '';
    state.suggestions = {};
    el.suggestBar.hidden = true;
    el.fileInput.value = '';
    showErrors([]);
    show('upload');
  }

  // -------------------------------------------------------------------------
  // Wiring.
  // -------------------------------------------------------------------------
  el.fileInput.addEventListener('change', function () {
    if (el.fileInput.files && el.fileInput.files[0]) handleFile(el.fileInput.files[0]);
  });
  el.dropzone.addEventListener('dragover', function (e) { e.preventDefault(); el.dropzone.classList.add('drag'); });
  el.dropzone.addEventListener('dragleave', function () { el.dropzone.classList.remove('drag'); });
  el.dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    el.dropzone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  el.runBtn.addEventListener('click', run);
  el.acceptAllBtn.addEventListener('click', acceptAllSuggestions);
  el.restartBtn.addEventListener('click', restart);
  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
    b.addEventListener('click', function () { show(b.dataset.goto); });
  });

  show('upload');
})();
