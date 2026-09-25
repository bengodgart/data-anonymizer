/*
 * check-sample.js - proves samples/sample-people.csv actually works end to
 * end through the real pipeline (no browser harness exists in this repo, so
 * this drives the same modules the worker uses: parse -> anonymize -> verify).
 *
 * Run: node scripts/check-sample.js
 * Exit 0 = all checks passed.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var parse = require('../src/parse.js');
var anon = require('../src/anonymize.js');
var verify = require('../src/verify.js');

var csvPath = path.join(__dirname, '..', 'samples', 'sample-people.csv');
var csvText = fs.readFileSync(csvPath, 'utf8');

var dataset = parse.parseCsv(csvText);
var colTypes = parse.detectColumnTypes(dataset.headers, dataset.rows, 1000);

// First run: the name route (first name, last name, date of birth), with the
// customer_number column left unassigned, so the collision example still runs.
var mapping = {
  first_name: dataset.headers.indexOf('first_name'),
  last_name: dataset.headers.indexOf('last_name'),
  date_of_birth: dataset.headers.indexOf('dob'),
  ssn: dataset.headers.indexOf('ssn'),
  email: dataset.headers.indexOf('email'),
  card_number: dataset.headers.indexOf('card_number'),
  phone_1: dataset.headers.indexOf('phone'),
  address_line_1: dataset.headers.indexOf('address'),
  city: dataset.headers.indexOf('city'),
  state: dataset.headers.indexOf('state'),
  zip_code: dataset.headers.indexOf('zip'),
  county: dataset.headers.indexOf('county'),
  country: dataset.headers.indexOf('country')
};
Object.keys(mapping).forEach(function (term) {
  if (mapping[term] === -1) throw new Error('Expected column for ' + term + ' not found in header row');
});

var mapErrors = anon.validateMapping(mapping);
var failures = 0;
function check(cond, msg) {
  if (cond) { console.log('OK   ' + msg); }
  else { failures++; console.log('FAIL ' + msg); }
}

check(mapErrors.length === 0, 'mapping validates with no errors (' + JSON.stringify(mapErrors) + ')');

var out = anon.anonymizeDataset(dataset, mapping, colTypes);
var vr = verify.roundTripVerify(dataset.rows, out.original, out.anon);

check(vr.pass, 'round-trip verify passes');
console.log('     checks: ' + vr.checks.map(function (c) { return c.name + '=' + c.ok; }).join(', '));
console.log('     stats: rows=' + out.stats.rowCount + ' uniquePersons=' + out.stats.uniquePersons +
  ' collisionsResolved=' + out.stats.collisionCount + ' collidedPeople=' + out.stats.collidedPeople);

var keyCol = out.anon.headers.length - 1;
function keysFor(firstName, lastName, dobRaw) {
  var keys = [];
  for (var r = 0; r < dataset.rows.length; r++) {
    if (dataset.rows[r][mapping.first_name] === firstName &&
        dataset.rows[r][mapping.last_name] === lastName &&
        dataset.rows[r][mapping.date_of_birth] === dobRaw) {
      keys.push(out.anon.rows[r][keyCol]);
    }
  }
  return keys;
}
function allSame(arr) { return arr.every(function (k) { return k === arr[0]; }); }

// Repeated people: same identity across multiple rows must share ONE stable anon_key.
var johnKeys = keysFor('John', 'Smith', '1/1/2000');
check(johnKeys.length === 2 && allSame(johnKeys), 'John Smith (legacy repeat, 2 rows) shares one anon_key: ' + johnKeys.join(','));

var mariaKeys = keysFor('Maria', 'Gonzalez', '9/14/1988');
check(mariaKeys.length === 3 && allSame(mariaKeys), 'Maria Gonzalez (3 rows) shares one anon_key: ' + mariaKeys.join(','));

var davidKeys = keysFor('David', 'Chen', '1979-11-02');
check(davidKeys.length === 2 && allSame(davidKeys), 'David Chen (2 rows) shares one anon_key: ' + davidKeys.join(','));

var priyaKeys = keysFor('Priya', 'Patel', '6/23/95');
check(priyaKeys.length === 2 && allSame(priyaKeys), 'Priya Patel (2 rows) shares one anon_key: ' + priyaKeys.join(','));

// Near-collision pair must resolve to DIFFERENT keys (not merged).
var smithlyKeys = keysFor('Johnny', 'Smithly', '3/3/1970');
var smithsonKeys = keysFor('Johnathan', 'Smithson', '3/3/1970');
check(
  smithlyKeys.length === 1 && smithsonKeys.length === 1 && smithlyKeys[0] !== smithsonKeys[0],
  'near-collision pair (Johnny Smithly / Johnathan Smithson) got different anon_keys: ' + smithlyKeys[0] + ' vs ' + smithsonKeys[0]
);
check(out.stats.collisionCount >= 1, 'stats report at least one resolved collision bucket (got ' + out.stats.collisionCount + ')');

// Non-personal columns must survive completely untouched (pass-through).
var passthroughCols = ['balance', 'plan', 'monthly_amount', 'signup_date'];
var passthroughOk = true;
passthroughCols.forEach(function (name) {
  var idx = dataset.headers.indexOf(name);
  for (var r = 0; r < dataset.rows.length; r++) {
    if (out.anon.rows[r][idx] !== dataset.rows[r][idx]) { passthroughOk = false; }
  }
});
check(passthroughOk, 'unmapped columns (balance, plan, monthly_amount, signup_date) pass through unchanged in the anonymized file');

// Mapped personal fields must actually have changed in the anonymized output.
var changedOk = true;
['first_name', 'last_name', 'dob', 'ssn', 'phone', 'address'].forEach(function (name) {
  var idx = dataset.headers.indexOf(name);
  for (var r = 0; r < dataset.rows.length; r++) {
    var orig = dataset.rows[r][idx];
    if (orig === '' || orig == null) continue; // blank optional cells can't "change"
    if (out.anon.rows[r][idx] === orig) { changedOk = false; }
  }
});
check(changedOk, 'mapped personal columns are replaced with fake data in the anonymized file');

// Second run: the mapping "Accept all suggestions" builds, which also maps
// customer_number to Record ID. Keys now come from the customer number.
var ridMapping = JSON.parse(JSON.stringify(mapping));
ridMapping.record_id = dataset.headers.indexOf('customer_number');
check(ridMapping.record_id !== -1, 'sample has a customer_number column');
check(anon.validateMapping(ridMapping).length === 0, 'Record ID mapping validates');
var ridOut = anon.anonymizeDataset(dataset, ridMapping, colTypes);
check(verify.roundTripVerify(dataset.rows, ridOut.original, ridOut.anon).pass, 'Record ID run: round-trip verify passes');
var ridKeys = {};
dataset.rows.forEach(function (row, r) {
  var id = row[ridMapping.record_id];
  var k = ridOut.anon.rows[r][ridOut.anon.headers.length - 1];
  (ridKeys[id] || (ridKeys[id] = {}))[k] = true;
});
check(Object.keys(ridKeys).every(function (id) { return Object.keys(ridKeys[id]).length === 1; }),
  'Record ID run: every customer number maps to exactly one anon_key');
check(ridOut.stats.uniquePersons === Object.keys(ridKeys).length,
  'Record ID run: one person per customer number (' + ridOut.stats.uniquePersons + ')');
var idIdx = ridMapping.record_id;
check(dataset.rows.every(function (row, r) { return ridOut.anon.rows[r][idIdx] !== row[idIdx]; }),
  'Record ID run: the real customer number is replaced in every row');

// Third run: the same file with the birth date left unassigned. Keyed by the
// customer number alone, it must still validate and round-trip.
var noDobMapping = JSON.parse(JSON.stringify(ridMapping));
delete noDobMapping.date_of_birth;
check(anon.validateMapping(noDobMapping).length === 0, 'Record ID with no date of birth validates');
var noDobOut = anon.anonymizeDataset(dataset, noDobMapping, colTypes);
check(verify.roundTripVerify(dataset.rows, noDobOut.original, noDobOut.anon).pass, 'no date of birth run: round-trip verify passes');
check(noDobOut.stats.uniquePersons === ridOut.stats.uniquePersons, 'no date of birth run: same people as with it');

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : (failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
