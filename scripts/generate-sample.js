/*
 * generate-sample.js - deterministically (re)generates samples/sample-people.csv,
 * the fake dataset the UI offers as a one-click "try it" download.
 *
 * Plain Node, no dependencies, no network. Uses a seeded PRNG so re-running this
 * script reproduces the output file byte-for-byte.
 *
 * IMPORTANT: the first 6 data rows below reproduce the original hand-written
 * sample, in the same order and with all ten of its original columns
 * byte-identical. README.md's "Worked example" section
 * (Collision resolution) hardcodes the exact anon_key hashes those 6 rows
 * produce. Changing their content or order would make that documentation
 * wrong, so this script treats them as fixed and only ADDS new rows after
 * them. The new random rows are drawn from name pools that exclude every
 * first-3-letter prefix used by those 6 people's identity buckets, so no
 * generated row can land in (or resize) their buckets. See PROTECTED_* below
 * and the assertion at the bottom of this file, which checks that guarantee
 * at generation time rather than assuming it holds.
 *
 * Run: node scripts/generate-sample.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) - same algorithm as src/anonymize.js, duplicated
// locally so this script has zero dependencies on the app's own modules.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rand = mulberry32(0xda7a5eed); // fixed seed -> deterministic, reproducible output

function pick(list) { return list[Math.floor(rand() * list.length)]; }
function randInt(min, max) { return min + Math.floor(rand() * (max - min + 1)); }
function pad2(v) { v = String(v); return v.length < 2 ? '0' + v : v; }
function chance(p) { return rand() < p; }

function quoteField(value) {
  var s = value == null ? '' : String(value);
  if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ---------------------------------------------------------------------------
// Header. Columns the tool maps: first_name, last_name, dob, ssn (special
// number), phone, address, city, state, zip, county, country. Three columns
// (plan, monthly_amount, signup_date) are deliberately left UNMAPPED so the
// preview shows the reader exactly what changes vs. what survives untouched.
// ---------------------------------------------------------------------------
var HEADERS = ['first_name', 'last_name', 'dob', 'ssn', 'phone', 'address',
  'city', 'state', 'zip', 'balance', 'county', 'country', 'plan', 'monthly_amount', 'signup_date'];

// ---------------------------------------------------------------------------
// Legacy 6 rows - DO NOT change these values or their order. They back the
// exact anon_key values quoted in README.md's collision-resolution example.
// All TEN columns of the original samples/sample-people.csv
// (first_name,last_name,dob,ssn,phone,address,city,state,zip,balance) are
// reproduced byte-identically here; county,country,plan,monthly_amount and
// signup_date are appended after them.
//
// `balance` is an account balance and varies per row. `monthly_amount` is what
// the plan costs, so it is always AMOUNT_BY_PLAN[plan] - including on these six
// rows. Keeping the two apart is the point: a reader who sees a Basic plan
// billed at $1500.00 learns nothing except that the sample is broken.
// ---------------------------------------------------------------------------
var LEGACY_ROWS = [
  ['John', 'Smith', '1/1/2000', '123-45-6789', '(212) 555-1000', '123 Main St', 'New York', 'NY', '10001', '1500.00', 'New York County', 'USA', 'Basic', '19.99', '2024-02-14'],
  ['Jane', 'Doe', '5/5/1990', '987-65-4321', '(305) 555-2000', '45 Ocean Dr', 'Miami', 'FL', '33101', '2200.50', 'Miami-Dade County', 'USA', 'Pro', '49.99', '2023-11-03'],
  ['John', 'Smith', '1/1/2000', '123-45-6789', '(212) 555-1000', '123 Main St', 'New York', 'NY', '10001', '3100.00', 'New York County', 'USA', 'Pro', '49.99', '2024-02-14'],
  ['Robert', 'Johnson', '7/4/1985', '555-11-2222', '(415) 555-3000', '9 Market St', 'San Francisco', 'CA', '94103', '750.25', 'San Francisco County', 'USA', 'Free', '0.00', '2024-05-20'],
  ['Johnny', 'Smithly', '3/3/1970', '111-22-3333', '(312) 555-4000', '1 State St', 'Chicago', 'IL', '60601', '900.00', 'Cook County', 'USA', 'Basic', '19.99', '2023-08-09'],
  ['Johnathan', 'Smithson', '3/3/1970', '444-55-6666', '(312) 555-5000', '2 State St', 'Chicago', 'IL', '60601', '1200.00', 'Cook County', 'USA', 'Premium', '99.99', '2023-09-01']
];

// The identity buckets the legacy rows occupy: first3(first) + first3(last) + normalizedDob.
// (Mirrors anon.first3 + anon.normalizeDob logic; duplicated here in plain JS
// so this generator does not depend on src/anonymize.js.)
var PROTECTED_BUCKETS = [
  'joh' + 'smi' + '20000101', // John Smith
  'jan' + 'doe' + '19900505', // Jane Doe
  'rob' + 'joh' + '19850704', // Robert Johnson
  'joh' + 'smi' + '19700303'  // Johnny Smithly / Johnathan Smithson (already a 2-person bucket)
];

// ---------------------------------------------------------------------------
// Pools for the newly generated rows. First names deliberately exclude any
// name starting "joh"/"jan"/"rob", and last names exclude "smi"/"doe"/"joh" -
// the exact first-3-letter prefixes used by the legacy identities above - so
// no generated identity can share a bucket with them, regardless of DOB.
// The three named repeaters (Maria Gonzalez, David Chen, Priya Patel) are
// also excluded from these pools so a random single can never accidentally
// reuse one of their names.
// ---------------------------------------------------------------------------
// These pools must stay DISJOINT from the fake-name pools in src/anonymize.js.
// If a real name here also exists there, the anonymizer can replace a cell with
// itself, and the sample then shows a "personal" column that visibly did not
// change. ('Sarah' and 'Nguyen' used to overlap; that is why they are gone.)
// The assertion near the bottom of this file enforces the guarantee for real.
var FIRST_NAMES = ['Anika', 'Kevin', 'Amanda', 'Carlos', 'Wei', 'Fatima', 'Derek', 'Nicole',
  'Marcus', 'Elena', 'Tyler', 'Aisha', 'Brandon', 'Sophia', 'Malik', 'Rachel', 'Omar', 'Grace',
  'Trevor', 'Yuki', 'Isabella', 'Connor', 'Zara', 'Hunter', 'Chloe', 'Diego', 'Brooke', 'Felix',
  'Camille', 'Ahmed', 'Ingrid', 'Xavier', 'Natasha', 'Gabriel', 'Leilani', 'Mateo', 'Simone',
  'Oliver', 'Harper', 'Lucas', 'Ava', 'Noah', 'Mila', 'Ezra', 'Selena', 'Quentin', 'Bianca'];

var LAST_NAMES = ['Nakamura', 'Alvarez', 'Kim', 'Fitzgerald', 'Ahmadi', 'Rossi', 'Dubois', 'Okafor',
  'Kowalski', 'Silva', 'Tanaka', 'Reyes', 'Bianchi', 'Haddad', 'Petrov', 'Larsen', 'Diallo',
  'Marchetti', 'Yamamoto', 'Osei', 'Kaur', 'Vasquez', 'Novak', 'Haruna', 'Delacroix', 'Mbeki',
  'Andersson', 'Castillo', 'Ferreira', 'Yilmaz', 'Choudhury', 'Blackwood', 'Sorensen', 'Whitfield',
  'Abernathy', 'Castellano', 'Riordan', 'Okonkwo', 'Lindqvist', 'Beaumont', 'Villanueva', 'Hassan'];

var STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Elm St', 'Washington Ave', 'Park Blvd',
  'Lake Rd', 'Hill St', 'Sunset Blvd', 'Pine St', 'River Rd', 'Church St', 'Highland Ave',
  'Franklin St', 'Union Ave', 'Willow Way', 'Spring St', 'Birch Ct', 'Meadow Ln', 'Ridge Rd',
  'Valley View Dr', 'Chestnut St', 'Magnolia Ave'];

var CITY_TABLE = [
  ['Austin', 'TX', '78701', 'Travis County'],
  ['Denver', 'CO', '80202', 'Denver County'],
  ['Seattle', 'WA', '98101', 'King County'],
  ['Boston', 'MA', '02108', 'Suffolk County'],
  ['Phoenix', 'AZ', '85001', 'Maricopa County'],
  ['Atlanta', 'GA', '30301', 'Fulton County'],
  ['Portland', 'OR', '97201', 'Multnomah County'],
  ['Nashville', 'TN', '37201', 'Davidson County'],
  ['Minneapolis', 'MN', '55401', 'Hennepin County'],
  ['Raleigh', 'NC', '27601', 'Wake County'],
  ['Salt Lake City', 'UT', '84101', 'Salt Lake County'],
  ['Albuquerque', 'NM', '87101', 'Bernalillo County'],
  ['Columbus', 'OH', '43085', 'Franklin County'],
  ['Sacramento', 'CA', '95814', 'Sacramento County'],
  ['Kansas City', 'MO', '64105', 'Jackson County'],
  ['Charlotte', 'NC', '28202', 'Mecklenburg County'],
  ['Pittsburgh', 'PA', '15222', 'Allegheny County'],
  ['Milwaukee', 'WI', '53202', 'Milwaukee County'],
  ['Richmond', 'VA', '23219', 'Richmond City County'],
  ['Boise', 'ID', '83702', 'Ada County']
];

var PLANS = ['Free', 'Basic', 'Pro', 'Premium'];
var AMOUNT_BY_PLAN = { Free: '0.00', Basic: '19.99', Pro: '49.99', Premium: '99.99' };

function randSsn() {
  return randInt(100, 899) + '-' + randInt(10, 99) + '-' + randInt(1000, 9999);
}
function randPhone() {
  return '(' + randInt(200, 989) + ') 555-' + pad2(randInt(0, 99)) + randInt(10, 99);
}
function randDob() {
  var year = randInt(1950, 2005); // safe range for the M/D/YY 2-digit format (see note below)
  var month = randInt(1, 12);
  var day = randInt(1, 28);
  var f = rand();
  if (f < 1 / 3) return month + '/' + day + '/' + year;                       // M/D/YYYY
  if (f < 2 / 3) return year + '-' + pad2(month) + '-' + pad2(day);           // YYYY-MM-DD
  return month + '/' + day + '/' + String(year).slice(-2);                    // M/D/YY
  // Safe because normalizeDob() maps 2-digit year yy to 1900+yy when yy>=30,
  // else 2000+yy. Every year in [1950,2005] has yy in [50,99] U [00,05],
  // both of which round-trip correctly under that rule.
}
function randSignup() {
  return randInt(2021, 2026) + '-' + pad2(randInt(1, 12)) + '-' + pad2(randInt(1, 28));
}

// ---------------------------------------------------------------------------
// Three repeated people: same identity + contact details across multiple
// rows (proves the shared anon_key is stable), with plan/monthly_amount
// varying per occurrence (repeat billing events) while signup_date stays
// fixed per person (you only sign up once).
// ---------------------------------------------------------------------------
var REPEATERS = [
  {
    firstName: 'Maria', lastName: 'Gonzalez', dob: '9/14/1988', ssn: '201-33-4455',
    phone: '(512) 555-7712', address: '884 Sunset Blvd', city: 'Austin', state: 'TX',
    zip: '78701', county: 'Travis County', country: 'USA', signup: '2022-06-01',
    plans: ['Basic', 'Basic', 'Pro'], amounts: ['19.99', '19.99', '49.99'],
    balances: ['320.00', '145.50', '0.00'],
    insertAt: [4, 54, 114]
  },
  {
    firstName: 'David', lastName: 'Chen', dob: '1979-11-02', ssn: '',
    phone: '(206) 555-7788', address: '12 Birch Ct', city: 'Seattle', state: 'WA',
    zip: '98101', county: 'King County', country: 'USA', signup: '2021-03-15',
    plans: ['Pro', 'Pro'], amounts: ['49.99', '49.99'],
    balances: ['0.00', '49.99'],
    insertAt: [24, 84]
  },
  {
    firstName: 'Priya', lastName: 'Patel', dob: '6/23/95', ssn: '344-98-1122',
    phone: '(303) 555-9091', address: '27 Meadow Ln', city: 'Denver', state: 'CO',
    zip: '80202', county: '', country: 'USA', signup: '2023-01-20',
    plans: ['Free', 'Basic'], amounts: ['0.00', '19.99'],
    balances: ['0.00', '19.99'],
    insertAt: [39, 99]
  }
];

// Total new rows after the legacy 6: 137 random singles + 7 repeater occurrences = 144.
var NEW_ROW_COUNT = 144;
var slots = new Array(NEW_ROW_COUNT).fill(null);

REPEATERS.forEach(function (person) {
  person.insertAt.forEach(function (idx, occurrenceIdx) {
    slots[idx] = [
      person.firstName, person.lastName, person.dob, person.ssn, person.phone,
      person.address, person.city, person.state, person.zip,
      person.balances[occurrenceIdx], person.county, person.country,
      person.plans[occurrenceIdx], person.amounts[occurrenceIdx], person.signup
    ];
  });
});

function randomSingleRow() {
  var firstName = pick(FIRST_NAMES);
  var lastName = pick(LAST_NAMES);
  var dob = randDob();
  var ssn = chance(0.08) ? '' : randSsn();
  var phone = chance(0.04) ? '' : randPhone();
  var cityRec = pick(CITY_TABLE);
  var streetNum = randInt(100, 9899);
  var address = streetNum + ' ' + pick(STREETS);
  var county = chance(0.12) ? '' : cityRec[3];
  var country = chance(0.15) ? '' : 'USA';
  var plan = pick(PLANS);
  var amount = AMOUNT_BY_PLAN[plan];
  var balance = chance(0.55) ? '0.00' : (randInt(1, 4200) + '.' + pad2(randInt(0, 99)));
  var signup = chance(0.05) ? '' : randSignup();
  return [firstName, lastName, dob, ssn, phone, address, cityRec[0], cityRec[1], cityRec[2],
    balance, county, country, plan, amount, signup];
}

for (var i = 0; i < NEW_ROW_COUNT; i++) {
  if (slots[i] === null) slots[i] = randomSingleRow();
}

var ALL_ROWS = LEGACY_ROWS.concat(slots);

// ---------------------------------------------------------------------------
// Safety assertion: no generated row (rows 6+) may fall into any protected
// bucket, which would either merge into a legacy person or resize the
// existing Smithly/Smithson collision bucket and invalidate README.md.
// Mirrors first3()+normalizeDob() from src/anonymize.js in plain JS.
// ---------------------------------------------------------------------------
function first3(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3); }
function normalizeDobLocal(v) {
  var s = String(v || '').trim();
  var m;
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return m[1] + pad2(m[2]) + pad2(m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) return m[3] + pad2(m[1]) + pad2(m[2]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
  if (m) {
    var yy = parseInt(m[3], 10);
    var yyyy = (yy >= 30 ? 1900 : 2000) + yy;
    return String(yyyy) + pad2(m[1]) + pad2(m[2]);
  }
  return s.replace(/\D/g, '');
}

var violations = [];
for (i = LEGACY_ROWS.length; i < ALL_ROWS.length; i++) {
  var row = ALL_ROWS[i];
  var bucket = first3(row[0]) + first3(row[1]) + normalizeDobLocal(row[2]);
  if (PROTECTED_BUCKETS.indexOf(bucket) !== -1) {
    violations.push('row ' + i + ' (' + row[0] + ' ' + row[1] + ', dob ' + row[2] + ') collides with protected bucket ' + bucket);
  }
}
if (violations.length) {
  console.error('REFUSING TO WRITE: generated rows collide with protected legacy buckets:');
  violations.forEach(function (v) { console.error('  ' + v); });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write the file.
// ---------------------------------------------------------------------------
var lines = [HEADERS.map(quoteField).join(',')];
ALL_ROWS.forEach(function (row) { lines.push(row.map(quoteField).join(',')); });
var csvText = lines.join('\n') + '\n';

// ---------------------------------------------------------------------------
// Safety assertion: run the REAL anonymizer over the dataset we are about to
// write and refuse to ship a sample in which any mapped personal cell survives
// unchanged. The tool picks fake names from its own pool; if that pool shares a
// name with ours, a cell can be "anonymized" into itself, and the very first
// thing the sample is supposed to teach ("your personal columns get replaced")
// is then false on that row. Blank optional cells are skipped: they cannot
// change. This runs before the write, so a violation leaves the old file intact.
// ---------------------------------------------------------------------------
var parse = require('../src/parse.js');
var anon = require('../src/anonymize.js');

var checkDs = parse.parseCsv(csvText);
var checkMapping = {
  first_name: HEADERS.indexOf('first_name'),
  last_name: HEADERS.indexOf('last_name'),
  date_of_birth: HEADERS.indexOf('dob'),
  special_number: HEADERS.indexOf('ssn'),
  phone_1: HEADERS.indexOf('phone'),
  address_line_1: HEADERS.indexOf('address'),
  city: HEADERS.indexOf('city'),
  state: HEADERS.indexOf('state'),
  zip_code: HEADERS.indexOf('zip'),
  county: HEADERS.indexOf('county'),
  country: HEADERS.indexOf('country')
};
var checkOut = anon.anonymizeDataset(
  checkDs, checkMapping, parse.detectColumnTypes(checkDs.headers, checkDs.rows, 1000)
);
var selfMapped = [];
['first_name', 'last_name', 'dob', 'ssn', 'phone', 'address'].forEach(function (name) {
  var idx = HEADERS.indexOf(name);
  checkDs.rows.forEach(function (row, r) {
    var original = row[idx];
    if (original === '' || original == null) return;
    if (checkOut.anon.rows[r][idx] === original) {
      selfMapped.push('row ' + r + ' column ' + name + ' stayed "' + original + '"');
    }
  });
});
if (selfMapped.length) {
  console.error('ABORT: the anonymizer replaced a personal cell with itself. ' +
    'A name in this script\'s pools probably also exists in src/anonymize.js.');
  selfMapped.forEach(function (m) { console.error('  ' + m); });
  process.exit(1);
}

var outPath = path.join(__dirname, '..', 'samples', 'sample-people.csv');
fs.writeFileSync(outPath, csvText, 'utf8');

console.log('Wrote ' + outPath);
console.log('Rows: ' + ALL_ROWS.length + ' data rows + 1 header = ' + (ALL_ROWS.length + 1) + ' lines');
console.log('Protected-bucket check: 0 violations across ' + (ALL_ROWS.length - LEGACY_ROWS.length) + ' generated rows');
console.log('Repeated people: John Smith (legacy, 2 rows), Maria Gonzalez (3), David Chen (2), Priya Patel (2)');
console.log('Near-collision pair (reused from legacy, keeps README worked example valid): Johnny Smithly / Johnathan Smithson, both 3/3/1970');
