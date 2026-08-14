/*
 * test.js - Node smoke test for the data-anonymizer core.
 * Run: node test.js   (exit 0 = all assertions passed)
 * No dependencies; exercises every rule in the spec.
 */
'use strict';

var parse = require('./src/parse.js');
var anon = require('./src/anonymize.js');
var verify = require('./src/verify.js');
var zipdata = require('./src/zipdata.js');
var suggest = require('./src/suggest.js');

var passed = 0;
var failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// ---------------------------------------------------------------------------
// SHA-256 known-answer vectors (proves the pure-JS hash is correct).
// ---------------------------------------------------------------------------
eq(anon.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256 empty string');
eq(anon.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 "abc"');
eq(anon.sha256Hex('The quick brown fox jumps over the lazy dog'),
  'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592', 'sha256 fox');
eq(anon.sha256Hex('a').length, 64, 'sha256 returns 64 hex chars');

// ---------------------------------------------------------------------------
// CSV parse / serialize.
// ---------------------------------------------------------------------------
var csv = 'first,last,note\nJohn,Smith,"hello, world"\nJane,"O""Brien",line1\nBob,Jones,plain';
var parsed = parse.parseCsv(csv);
eq(parsed.headers.length, 3, 'csv header count');
eq(parsed.headers[0], 'first', 'csv header 0');
eq(parsed.rows.length, 3, 'csv row count');
eq(parsed.rows[0][2], 'hello, world', 'csv quoted comma preserved');
eq(parsed.rows[1][1], 'O"Brien', 'csv doubled-quote unescaped');
// Round-trip through serialization.
var reparsed = parse.parseCsv(parse.toCsv(parsed.headers, parsed.rows));
eq(reparsed.rows[0][2], 'hello, world', 'csv round-trip quoted comma');
eq(reparsed.rows[1][1], 'O"Brien', 'csv round-trip doubled quote');
// BOM + CRLF handling.
var bomCsv = '﻿a,b\r\n1,2\r\n3,4\r\n';
var bomP = parse.parseCsv(bomCsv);
eq(bomP.headers[0], 'a', 'BOM stripped from first header');
eq(bomP.rows.length, 2, 'CRLF rows parsed');

// ---------------------------------------------------------------------------
// Column type detection.
// ---------------------------------------------------------------------------
eq(parse.detectColumnType(['1', '2', '3']), 'number', 'all numeric -> number');
eq(parse.detectColumnType(['1', 'x', '3']), 'string', 'mixed -> string');
eq(parse.detectColumnType(['(555) 111-2222', '333']), 'string', 'phone string -> string');
eq(parse.detectColumnType(['5551112222', '5553334444']), 'number', 'numeric phone -> number');
eq(parse.detectColumnType(['', '  ', '']), 'string', 'all blank -> string');
eq(parse.detectColumnType(['-3.5', '4', '.5']), 'number', 'signed/decimal -> number');

// ---------------------------------------------------------------------------
// Name splitting.
// ---------------------------------------------------------------------------
var cf = anon.splitCommaFirst('Smith, John');
eq(cf.last, 'Smith', 'comma-first last'); eq(cf.first, 'John', 'comma-first first');
var cf2 = anon.splitCommaFirst('  Van Damme ,  Jean Claude ');
eq(cf2.last, 'Van Damme', 'comma-first strips + keeps spaces in last');
eq(cf2.first, 'Jean Claude', 'comma-first strips first');
var fl = anon.splitFirstLast('John Smith');
eq(fl.first, 'John', 'first-last first'); eq(fl.last, 'Smith', 'first-last last');
var fl2 = anon.splitFirstLast('Mary Anne Smith');
eq(fl2.first, 'Mary', 'first-last first token'); eq(fl2.last, 'Anne Smith', 'first-last remainder');

// ---------------------------------------------------------------------------
// DOB normalization (different formats collapse to one person).
// ---------------------------------------------------------------------------
eq(anon.normalizeDob('1/1/2000'), '20000101', 'dob M/D/YYYY');
eq(anon.normalizeDob('01/01/2000'), '20000101', 'dob 0-padded matches');
eq(anon.normalizeDob('2000-01-01'), '20000101', 'dob ISO');
eq(anon.normalizeDob('12/31/1999'), '19991231', 'dob end of year');

// ---------------------------------------------------------------------------
// anon_key: deterministic, hashed (not the raw key), same identity -> same key.
// ---------------------------------------------------------------------------
var idA = anon.deriveIdentity(['John', 'Smith', '1/1/2000'], { first_name: 0, last_name: 1, date_of_birth: 2 });
eq(idA.firstName, 'John', 'derive first'); eq(idA.lastName, 'Smith', 'derive last');
eq(anon.anonKeyRaw(idA), 'johsmi20000101', 'raw key composition');
var keyA = anon.anonKey(idA);
eq(keyA.length, 16, 'anon_key length 16');
ok(/^[0-9a-f]{16}$/.test(keyA), 'anon_key is lowercase hex');
ok(keyA !== 'johsmi20000101', 'anon_key is not the raw key (non-reversible at a glance)');
ok(keyA.indexOf('joh') === -1 && keyA.indexOf('smi') === -1, 'anon_key hides name fragments');
// Same person via a different DOB format -> same key.
var idA2 = anon.deriveIdentity(['John', 'Smith', '2000-01-01'], { first_name: 0, last_name: 1, date_of_birth: 2 });
eq(anon.anonKey(idA2), keyA, 'same person different dob format -> same key');
// Full-name-comma-first satisfies first + last and yields the same key.
var idA3 = anon.deriveIdentity(['Smith, John', '1/1/2000'], { full_name_last_first: 0, date_of_birth: 1 });
eq(anon.anonKey(idA3), keyA, 'full name (last, first) -> same key');
// Full-name-first-last too.
var idA4 = anon.deriveIdentity(['John Smith', '1/1/2000'], { full_name_first_last: 0, date_of_birth: 1 });
eq(anon.anonKey(idA4), keyA, 'full name (first last) -> same key');
// Different person -> different key.
var idB = anon.deriveIdentity(['Jane', 'Doe', '5/5/1990'], { first_name: 0, last_name: 1, date_of_birth: 2 });
ok(anon.anonKey(idB) !== keyA, 'different person -> different key');

// ---------------------------------------------------------------------------
// Mapping validation (collect-all).
// ---------------------------------------------------------------------------
eq(anon.validateMapping({ first_name: 0, last_name: 1, date_of_birth: 2 }).length, 0, 'valid mapping no errors');
ok(anon.validateMapping({ first_name: 0, last_name: 1 }).length === 1, 'missing dob flagged');
ok(anon.validateMapping({ date_of_birth: 2 }).length === 2, 'missing first+last flagged');
eq(anon.validateMapping({ full_name_first_last: 0, date_of_birth: 1 }).length, 0, 'full name satisfies first+last');
ok(anon.validateMapping({ full_name_first_last: 0, full_name_last_first: 1, date_of_birth: 2 }).length >= 1, 'both full names flagged');
ok(anon.validateMapping({ first_name: 0, last_name: 0, date_of_birth: 1 }).length >= 1, 'double-mapped column flagged');

// ---------------------------------------------------------------------------
// Fake data generation: consistent per person, correct fixed values.
// ---------------------------------------------------------------------------
var terms = ['first_name', 'last_name', 'ssn', 'card_number', 'email', 'phone_1', 'phone_2', 'address_line_1', 'city', 'state', 'zip_code', 'county', 'country'];
var f1 = anon.buildFakePerson(keyA, terms, { phone_1: 'string', phone_2: 'number' });
var f1b = anon.buildFakePerson(keyA, terms, { phone_1: 'string', phone_2: 'number' });
eq(f1.first_name, f1b.first_name, 'same key -> same fake first name');
eq(f1.city, f1b.city, 'same key -> same fake city');
eq(f1.ssn, '***-**-****', 'social security number masked');
eq(f1.card_number, '****-****-****-****', 'card number masked, not faked');
eq(f1.email, f1.first_name.toLowerCase() + '.' + f1.last_name.toLowerCase() + '@example.com', 'fake email is built from the fake name');
eq(f1.phone_1, '(555) 555-5555', 'string phone -> formatted');
eq(f1.phone_2, '5555555555', 'numeric phone -> digits');
ok(f1.first_name !== 'John', 'fake first name differs from real');
// Address internal consistency: the fake zip must match its record's state/county/country.
var zmatch = zipdata.ZIPS.filter(function (z) { return z.zip === f1.zip_code; })[0];
ok(zmatch != null, 'fake zip exists in table');
eq(f1.state, zmatch.state, 'fake state matches fake zip');
eq(f1.county, zmatch.county, 'fake county matches fake zip');
eq(f1.country, zmatch.country, 'fake country matches fake zip');
eq(f1.city, zmatch.city, 'fake city matches fake zip');
// A different person gets (very likely) different fakes.
var f2 = anon.buildFakePerson(anon.anonKey(idB), terms, {});
ok(f2.zip_code !== undefined, 'second person has a zip');

// ---------------------------------------------------------------------------
// Full dataset anonymize + round-trip verify.
// Build a dataset where the same person appears in multiple rows.
// ---------------------------------------------------------------------------
var headers = ['First', 'Last', 'DOB', 'SSN', 'Phone', 'Zip', 'State', 'Amount'];
var rows = [
  ['John', 'Smith', '1/1/2000', '123-45-6789', '(212) 555-1000', '10001', 'NY', '100'],
  ['Jane', 'Doe', '5/5/1990', '987-65-4321', '(305) 555-2000', '33101', 'FL', '200'],
  ['John', 'Smith', '1/1/2000', '123-45-6789', '(212) 555-1000', '10001', 'NY', '350'], // same person as row 0
  ['Bob', 'Jones', '7/4/1985', '555-11-2222', '(415) 555-3000', '94103', 'CA', '75']
];
var mapping = { first_name: 0, last_name: 1, date_of_birth: 2, ssn: 3, phone_1: 4, zip_code: 5, state: 6 };
var colTypes = parse.detectColumnTypes(headers, rows, 100);
var result = anon.anonymizeDataset({ headers: headers, rows: rows }, mapping, colTypes);

eq(result.anon.headers[result.anon.headers.length - 1], 'anon_key', 'anon file has anon_key column');
eq(result.original.headers[result.original.headers.length - 1], 'anon_key', 'original file has anon_key column');
eq(result.anon.rows.length, 4, 'anon row count preserved');
eq(result.stats.uniquePersons, 3, 'three unique persons (John twice)');

// John's two rows share an anon_key and identical fake data.
eq(result.anon.rows[0][8], result.anon.rows[2][8], 'same person same anon_key across rows');
eq(result.anon.rows[0][0], result.anon.rows[2][0], 'same person same fake first name across rows');
eq(result.anon.rows[0][4], result.anon.rows[2][4], 'same person same fake phone across rows');
ok(result.anon.rows[0][8] !== result.anon.rows[1][8], 'different persons different anon_key');

// Mapped columns were replaced; unmapped column (Amount) is untouched.
ok(result.anon.rows[0][0] !== 'John', 'first name replaced in anon output');
eq(result.anon.rows[0][3], '***-**-****', 'ssn masked in anon output');
eq(result.anon.rows[0][7], '100', 'unmapped Amount column untouched');
// Phone column here is a string dtype -> formatted fake.
eq(result.anon.rows[0][4], '(555) 555-5555', 'string phone column -> formatted fake');
// Original output preserves the real data.
eq(result.original.rows[0][0], 'John', 'original output keeps real first name');
eq(result.original.rows[0][3], '123-45-6789', 'original output keeps real ssn');

// Round-trip verification must PASS.
var vr = verify.roundTripVerify(rows, result.original, result.anon);
ok(vr.pass, 'round-trip verify passes on clean data');
eq(vr.rowCount, 4, 'verify row count');

// Numeric phone column -> digit fake.
var headers2 = ['First', 'Last', 'DOB', 'Cell'];
var rows2 = [['Amy', 'Lee', '3/3/1979', '2125551234']];
var mapping2 = { first_name: 0, last_name: 1, date_of_birth: 2, phone_1: 3 };
var ct2 = parse.detectColumnTypes(headers2, rows2, 10);
var res2 = anon.anonymizeDataset({ headers: headers2, rows: rows2 }, mapping2, ct2);
eq(res2.anon.rows[0][3], '5555555555', 'numeric phone column -> digit fake');

// ---------------------------------------------------------------------------
// Collision detection: two distinct people sharing first3+last3+DOB.
// "Jon Smitherton" and "John Smith" both -> jon/joh? No: first3 differ (jon vs joh).
// Use two genuinely-colliding distinct names: "Johnny Smithly" vs "Johnathan Smithson"
// both -> joh + smi + same DOB, but full names differ.
// ---------------------------------------------------------------------------
var cHeaders = ['Name', 'DOB'];
var cRows = [
  ['Johnny Smithly', '1/1/2000'],
  ['Johnathan Smithson', '1/1/2000']
];
var cMapping = { full_name_first_last: 0, date_of_birth: 1 };
var cRes = anon.anonymizeDataset({ headers: cHeaders, rows: cRows }, cMapping, {});
eq(cRes.stats.collisionCount, 1, 'collision bucket detected for same first3+last3+dob distinct names');
eq(cRes.stats.collidedPeople, 2, 'two people counted in the collided bucket');
ok(cRes.stats.collisionsResolved, 'collision flagged as resolved');
eq(cRes.stats.uniquePersons, 2, 'two distinct people after resolution (not collapsed to 1)');
// The two colliding people must now get DIFFERENT anon_keys...
var keyCol = cRes.anon.headers.length - 1;
var k0 = cRes.anon.rows[0][keyCol];
var k1 = cRes.anon.rows[1][keyCol];
ok(k0 !== k1, 'collision resolved: two people get different anon_keys');
// ...that share the same 16-hex base bucket with distinct ordinal suffixes.
eq(k0.slice(0, 16), k1.slice(0, 16), 'both resolved keys share the base bucket');
ok(/-\d{2}$/.test(k0) && /-\d{2}$/.test(k1), 'resolved keys carry an ordinal suffix');
// ...and DIFFERENT fake data (seeded by full identity, not the base bucket).
ok(cRes.anon.rows[0][0] !== cRes.anon.rows[1][0], 'colliding people get different fake data');
// Suffix assignment is stable regardless of row order.
var cResRev = anon.anonymizeDataset({ headers: cHeaders, rows: [cRows[1], cRows[0]] }, cMapping, {});
eq(cResRev.anon.rows[1][keyCol], k0, 'suffix stable when rows are reversed (person keeps their key)');
// No-collision datasets carry NO suffix (clean base key).
ok(!/-\d{2}$/.test(result.anon.rows[0][8]), 'non-colliding key has no suffix');
// Even with a collision, round-trip still reclaims original (files are row-aligned).
var cvr = verify.roundTripVerify(cRows, cRes.original, cRes.anon);
ok(cvr.pass, 'round-trip still passes with resolved collisions');

// Verify catches a tampered file (negative test).
var tampered = { headers: result.original.headers, rows: result.original.rows.map(function (r) { return r.slice(); }) };
tampered.rows[0][0] = 'CORRUPTED';
var badVr = verify.roundTripVerify(rows, tampered, result.anon);
ok(!badVr.pass, 'verify fails when original file is tampered');

// ---------------------------------------------------------------------------
// Required terms: first name, last name and date of birth, and nothing else.
// Every other term must be optional, one at a time and all together.
// ---------------------------------------------------------------------------
var REQUIRED = { first_name: true, last_name: true, date_of_birth: true };
var optionalTerms = anon.TERMS.filter(function (t) {
  return !REQUIRED[t] && t !== 'full_name_last_first' && t !== 'full_name_first_last';
});
eq(anon.validateMapping({ first_name: 0, last_name: 1, date_of_birth: 2 }).length, 0,
  'the three required terms alone are a complete mapping');
optionalTerms.forEach(function (term) {
  var m = { first_name: 0, last_name: 1, date_of_birth: 2 };
  m[term] = 3;
  eq(anon.validateMapping(m).length, 0, term + ' is optional and valid when assigned');
});
var allOptional = { first_name: 0, last_name: 1, date_of_birth: 2 };
optionalTerms.forEach(function (term, i) { allOptional[term] = 3 + i; });
eq(anon.validateMapping(allOptional).length, 0, 'every optional term can be assigned at once');
eq(anon.TERMS.indexOf('special_number'), -1, 'the old "special number" term is gone');
eq(anon.TERM_LABELS.ssn, 'Social Security number', 'the SSN term is labelled plainly');

// ---------------------------------------------------------------------------
// Email and card number.
// ---------------------------------------------------------------------------
var ecHeaders = ['First', 'Last', 'DOB', 'Email', 'Card'];
var ecRows = [
  ['John', 'Smith', '1/1/2000', 'john.smith@work.example.org', '4111 1111 1111 1111'],
  ['Jane', 'Doe', '5/5/1990', 'jdoe@example.net', '5555-5555-5555-4444'],
  ['John', 'Smith', '1/1/2000', 'john.smith@work.example.org', '4111 1111 1111 1111'],
  ['Bob', 'Jones', '7/4/1985', '', '']
];
var ecMapping = { first_name: 0, last_name: 1, date_of_birth: 2, email: 3, card_number: 4 };
var ecRes = anon.anonymizeDataset({ headers: ecHeaders, rows: ecRows }, ecMapping, {});
ok(/^[a-z]+\.[a-z]+@example\.com$/.test(ecRes.anon.rows[0][3]), 'fake email is firstname.lastname at example.com (' + ecRes.anon.rows[0][3] + ')');
eq(ecRes.anon.rows[0][3], ecRes.anon.rows[0][0].toLowerCase() + '.' + ecRes.anon.rows[0][1].toLowerCase() + '@example.com',
  'the fake email matches the fake name in the same row');
eq(ecRes.anon.rows[0][3], ecRes.anon.rows[2][3], 'same person keeps the same fake email across rows');
ok(ecRes.anon.rows[0][3] !== ecRes.anon.rows[1][3], 'different people get different fake emails');
ok(ecRes.anon.rows[0][3].indexOf('john') === -1, 'the real name is not left in the fake email');
eq(ecRes.anon.rows[0][4], '****-****-****-****', 'card number is masked');
eq(ecRes.anon.rows[1][4], '****-****-****-****', 'every card is masked the same way, digits and all');
ok(ecRes.anon.rows[0][4].indexOf('1111') === -1, 'no digits of the real card survive, not even the last four');
// Empty cells stay empty: a fake value there would invent data.
eq(ecRes.anon.rows[3][3], '', 'a blank email stays blank');
eq(ecRes.anon.rows[3][4], '', 'a blank card stays blank');
ok(verify.roundTripVerify(ecRows, ecRes.original, ecRes.anon).pass, 'round trip passes with email and card mapped');

// Fake emails are unique per person even when two people draw the same fake
// name, because downstream systems treat an email as a unique key.
var manyRows = [];
for (var mi = 0; mi < 400; mi++) {
  manyRows.push(['Person' + mi, 'Surname' + mi, '1/1/19' + (10 + (mi % 80)), 'p' + mi + '@example.net']);
}
var manyRes = anon.anonymizeDataset(
  { headers: ['F', 'L', 'D', 'E'], rows: manyRows },
  { first_name: 0, last_name: 1, date_of_birth: 2, email: 3 }, {}
);
var emailSeen = {};
var emailDupes = 0;
var keyCol2 = manyRes.anon.headers.length - 1;
for (mi = 0; mi < manyRes.anon.rows.length; mi++) {
  var em = manyRes.anon.rows[mi][3];
  var who = manyRes.anon.rows[mi][keyCol2];
  if (emailSeen[em] && emailSeen[em] !== who) emailDupes++;
  emailSeen[em] = who;
}
eq(emailDupes, 0, 'no fake email is shared by two different people across 400 of them');
ok(Object.keys(emailSeen).length === 400, 'each of the 400 people got their own fake email');
// Row order must not change who gets which email.
var reversed = anon.anonymizeDataset(
  { headers: ['F', 'L', 'D', 'E'], rows: manyRows.slice().reverse() },
  { first_name: 0, last_name: 1, date_of_birth: 2, email: 3 }, {}
);
eq(reversed.anon.rows[reversed.anon.rows.length - 1][3], manyRes.anon.rows[0][3],
  'reversing the rows gives the same person the same fake email');

// ---------------------------------------------------------------------------
// Column suggestions: the recommendation engine behind the per-row "Use X"
// buttons and "Accept all suggestions".
// ---------------------------------------------------------------------------
// A helper that flattens { term: {col} } into the { term: col } shape the rest
// of the tool speaks, which is also what the UI writes into the dropdowns.
function flatten(sug) {
  var out = {};
  for (var t in sug) { if (sug.hasOwnProperty(t)) out[t] = sug[t].col; }
  return out;
}
function named(sug, headers) {
  var out = {};
  for (var t in sug) { if (sug.hasOwnProperty(t)) out[t] = headers[sug[t].col]; }
  return out;
}

// The shipped sample file: this is the one-click demo path, so it has to land
// every personal column and touch none of the others.
var sampleCsv = require('fs').readFileSync(__dirname + '/samples/sample-people.csv', 'utf8');
var sampleData = parse.parseCsv(sampleCsv);
var sampleSug = suggest.suggestMapping(sampleData.headers, sampleData.rows);
var sampleNamed = named(sampleSug, sampleData.headers);
eq(sampleNamed.first_name, 'first_name', 'sample: first name suggested');
eq(sampleNamed.last_name, 'last_name', 'sample: last name suggested');
eq(sampleNamed.date_of_birth, 'dob', 'sample: dob suggested');
eq(sampleNamed.ssn, 'ssn', 'sample: ssn suggested');
eq(sampleNamed.email, 'email', 'sample: email suggested');
eq(sampleNamed.card_number, 'card_number', 'sample: card number suggested');
eq(sampleNamed.phone_1, 'phone', 'sample: phone suggested');
eq(sampleNamed.address_line_1, 'address', 'sample: address suggested');
eq(sampleNamed.city, 'city', 'sample: city suggested');
eq(sampleNamed.state, 'state', 'sample: state suggested');
eq(sampleNamed.zip_code, 'zip', 'sample: zip suggested');
eq(sampleNamed.county, 'county', 'sample: county suggested');
eq(sampleNamed.country, 'country', 'sample: country suggested');
eq(suggest.countSuggestions(sampleSug), 13, 'sample: exactly the 13 personal columns suggested');
// Accepting every suggestion must produce a mapping the tool accepts as valid,
// or the one-click demo dead-ends on an error.
eq(anon.validateMapping(flatten(sampleSug)).length, 0, 'sample: accepting all suggestions validates');
// Non-personal columns stay out of it.
var sampleCols = Object.keys(sampleNamed).map(function (t) { return sampleNamed[t]; });
ok(sampleCols.indexOf('balance') === -1, 'sample: balance not suggested');
ok(sampleCols.indexOf('plan') === -1, 'sample: plan not suggested');
ok(sampleCols.indexOf('monthly_amount') === -1, 'sample: monthly amount not suggested');
ok(sampleCols.indexOf('signup_date') === -1, 'sample: signup date not suggested');

// Real-world column names, plus the traps that a naive matcher falls into.
var messyHeaders = ['Customer First Name', 'Customer Last Name', 'Patient DOB', 'Email Address',
  'Statement Date', 'Plan Name', 'Capacity', 'HomePhone', 'Mobile', 'Street Address', 'Apt', 'Postal Code'];
var messyRows = [['John', 'Smith', '1/1/1980', 'a@b.com', '2024-01-01', 'Gold', '120',
  '(212) 555-1000', '2125559999', '1 Main St', '4B', '10001']];
var messy = named(suggest.suggestMapping(messyHeaders, messyRows), messyHeaders);
eq(messy.first_name, 'Customer First Name', 'wordy header still matches first name');
eq(messy.last_name, 'Customer Last Name', 'wordy header still matches last name');
eq(messy.date_of_birth, 'Patient DOB', 'prefixed DOB matches');
eq(messy.phone_1, 'HomePhone', 'run-together phone header matches');
eq(messy.phone_2, 'Mobile', 'a second phone column fills phone 2');
eq(messy.address_line_1, 'Street Address', 'street address matches address line 1');
eq(messy.address_line_2, 'Apt', 'apartment matches address line 2');
eq(messy.zip_code, 'Postal Code', 'postal code matches zip');
ok(messy.address_line_1 !== 'Email Address' && messy.address_line_2 !== 'Email Address', 'email address is not a street address');
ok(messy.state !== 'Statement Date', 'statement date is not a state');
ok(messy.date_of_birth !== 'Statement Date', 'a date column is not a birth date');
ok(messy.city !== 'Capacity', 'capacity is not a city');
ok(messy.full_name_first_last !== 'Plan Name' && messy.full_name_last_first !== 'Plan Name', 'plan name is not a person name');

// A whole-name column: the values decide which way round the name is written.
var lfHeaders = ['Name', 'Birth Date'];
var lf = named(suggest.suggestMapping(lfHeaders, [['Smith, John', '1/1/1980'], ['Doe, Jane', '2/2/1990']]), lfHeaders);
eq(lf.full_name_last_first, 'Name', 'comma values pick the last-first term');
eq(lf.full_name_first_last, undefined, 'only one full-name term is ever suggested');
var fl3 = named(suggest.suggestMapping(lfHeaders, [['John Smith', '1/1/1980'], ['Jane Doe', '2/2/1990']]), lfHeaders);
eq(fl3.full_name_first_last, 'Name', 'plain values pick the first-last term');
eq(fl3.full_name_last_first, undefined, 'still only one full-name term');
eq(fl3.date_of_birth, 'Birth Date', 'birth date matches alongside a name column');

// Values alone carry a column when its name says nothing.
var blindHeaders = ['col1', 'col2', 'col3', 'col4'];
var blind = named(suggest.suggestMapping(blindHeaders, [
  ['123-45-6789', '(212) 555-1000', '10001', 'NY'],
  ['987-65-4321', '(305) 555-2000', '33101', 'FL']
]), blindHeaders);
eq(blind.ssn, 'col1', 'social security shape recognized without a header');
eq(blind.phone_1, 'col2', 'phone shape recognized without a header');
eq(blind.zip_code, 'col3', 'zip shape recognized without a header');
eq(blind.state, 'col4', 'state code shape recognized without a header');
eq(blind.date_of_birth, undefined, 'a date shape alone never claims date of birth');

// A birth-date header whose values are plainly not dates is a name collision.
var vetoHeaders = ['dob', 'first', 'last'];
var veto = suggest.suggestMapping(vetoHeaders, [['unknown', 'John', 'Smith'], ['n/a', 'Jane', 'Doe']]);
eq(veto.date_of_birth, undefined, 'birth date rejected when the values are not dates');

// A lone second-slot match moves up into the first slot.
var soloHeaders = ['Mobile', 'First', 'Last', 'DOB'];
var solo = named(suggest.suggestMapping(soloHeaders, [['2125551000', 'A', 'B', '1/1/1980']]), soloHeaders);
eq(solo.phone_1, 'Mobile', 'a single phone column fills phone 1, not phone 2');
eq(solo.phone_2, undefined, 'phone 2 left empty when there is only one phone column');

// No suggestion ever double-maps a column, in any of the cases above.
[sampleSug, suggest.suggestMapping(messyHeaders, messyRows)].forEach(function (sug, i) {
  var seen = {};
  var dupes = 0;
  for (var t in sug) {
    if (!sug.hasOwnProperty(t)) continue;
    if (seen[sug[t].col]) dupes++;
    seen[sug[t].col] = true;
  }
  eq(dupes, 0, 'no column suggested twice (case ' + (i + 1) + ')');
});

// A file with nothing recognizable suggests nothing rather than guessing.
eq(suggest.countSuggestions(suggest.suggestMapping(['q1', 'q2'], [['3', '4']])), 0, 'unrecognizable file suggests nothing');
eq(suggest.countSuggestions(suggest.suggestMapping([], [])), 0, 'empty file suggests nothing');

// Email and card columns are recognized by name and by shape.
var ecsHeaders = ['first', 'last', 'dob', 'Email Address', 'Credit Card Number', 'Card Type', 'contact'];
var ecs = named(suggest.suggestMapping(ecsHeaders, [
  ['John', 'Smith', '1/1/1980', 'a@b.example.org', '4111111111111111', 'Visa', 'x@y.example.net']
]), ecsHeaders);
eq(ecs.email, 'Email Address', 'email address column matched by name');
eq(ecs.card_number, 'Credit Card Number', 'credit card column matched by name');
ok(ecs.card_number !== 'Card Type', 'a card TYPE column is not the card number');
ok(ecs.address_line_1 !== 'Email Address', 'email address is still not a street address');
var blindEc = named(suggest.suggestMapping(['a', 'b'], [
  ['someone@example.org', '4012888888881881'], ['other@example.net', '5105105105105100']
]), ['a', 'b']);
eq(blindEc.email, 'a', 'email shape recognized without a header');
eq(blindEc.card_number, 'b', 'card shape recognized without a header');
eq(blindEc.phone_1, undefined, 'a card number is not mistaken for a phone number');

// Shape helpers, directly.
ok(suggest.passesLuhn('4111111111111111'), 'a real test card passes the check digit');
ok(!suggest.passesLuhn('4111111111111112'), 'one wrong digit fails the check digit');
ok(suggest.isCardLike('378282246310005'), 'a fifteen digit Amex number reads as a card');
ok(!suggest.isCardLike('2125551000'), 'a ten digit phone number does not read as a card');
ok(!suggest.isPhoneLike('378282246310005'), 'a fifteen digit card does not read as a phone');
ok(suggest.isEmailLike('a.b@example.co.uk'), 'a multi-part domain reads as an email');
ok(!suggest.isEmailLike('not an email'), 'plain text does not read as an email');
ok(!suggest.isEmailLike('a@b'), 'a domain with no dot does not read as an email');
ok(suggest.isPhoneLike('(212) 555-1000'), 'formatted phone reads as a phone');
ok(!suggest.isPhoneLike('2024-02-14'), 'an ISO date does not read as a phone');
ok(!suggest.isPhoneLike('1500.00'), 'a decimal amount does not read as a phone');
ok(suggest.isSpecialNumberLike('123-45-6789'), 'dashed social security number recognized');
ok(!suggest.isSpecialNumberLike('123456789'), 'a bare nine-digit number is not assumed to be a social security number');
ok(suggest.isZipLike('10001') && suggest.isZipLike('10001-1234'), 'zip and zip+4 recognized');
ok(!suggest.isZipLike('1000'), 'four digits is not a zip');
ok(suggest.isStateCodeLike('ny'), 'state code recognized case-insensitively');
ok(!suggest.isStateCodeLike('XX'), 'a non-state code is rejected');
ok(suggest.isDateLike('1/1/2000') && suggest.isDateLike('2000-01-01'), 'common date formats recognized');

// ---------------------------------------------------------------------------
// No em-dashes anywhere in shipped source (copy rule).
// ---------------------------------------------------------------------------
var fs = require('fs');
var files = ['src/parse.js', 'src/anonymize.js', 'src/suggest.js', 'src/verify.js', 'src/zipdata.js', 'app.js', 'test.js'];
files.forEach(function (fp) {
  var content = fs.readFileSync(__dirname + '/' + fp, 'utf8');
  var emDash = String.fromCharCode(0x2014);
  ok(content.indexOf(emDash) === -1, 'no em-dash in ' + fp);
});

// ---------------------------------------------------------------------------
console.log('');
console.log('Assertions passed: ' + passed);
console.log('Assertions failed: ' + failed);
if (failed > 0) { process.exit(1); }
console.log('ALL PASS');
