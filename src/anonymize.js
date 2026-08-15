/*
 * anonymize.js - the anonymization core.
 * - Derives a person's identity (first / last / date of birth) from the
 *   column mapping, including the two "full name" splitting rules.
 * - Builds a non-reversible anon_key = SHA-256 of first3(first)+first3(last)+dob.
 * - Generates fake data that is stable per person (same person -> same fakes)
 *   and internally consistent (address fields all agree on one ZIP record).
 *
 * Self-contained: a pure-JS SHA-256 and a seeded PRNG so the exact same output
 * is produced in the browser and in Node with no dependencies and no async.
 * Works in the browser and in Node.
 */
(function (root, factory) {
  var api = factory(
    typeof require !== 'undefined' ? require('./zipdata.js') : (typeof self !== 'undefined' ? self.DAZip : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.DAAnon = api;
})(this, function (DAZip) {
  'use strict';

  var ZIPS = (DAZip && DAZip.ZIPS) || [];

  // The common terms a user can map columns to. Order is display order.
  // Only first name, last name and date of birth are ever required, because
  // those three are what the anon_key is built from. Every other term is
  // optional and is simply left alone when it is not assigned.
  var TERMS = [
    'first_name', 'last_name', 'full_name_last_first', 'full_name_first_last',
    'date_of_birth', 'ssn', 'card_number', 'email', 'phone_1', 'phone_2',
    'address_line_1', 'address_line_2', 'city', 'state', 'zip_code',
    'county', 'country'
  ];

  var TERM_LABELS = {
    first_name: 'First name',
    last_name: 'Last name',
    full_name_last_first: 'Full name (last, first)',
    full_name_first_last: 'Full name (first last)',
    date_of_birth: 'Date of birth',
    ssn: 'Social Security number',
    card_number: 'Card number',
    email: 'Email address',
    phone_1: 'Phone 1',
    phone_2: 'Phone 2',
    address_line_1: 'Address line 1',
    address_line_2: 'Address line 2',
    city: 'City',
    state: 'State',
    zip_code: 'ZIP code',
    county: 'County',
    country: 'Country'
  };

  var ADDRESS_TERMS = ['address_line_1', 'address_line_2', 'city', 'state', 'zip_code', 'county', 'country'];

  // Encode a JS string as UTF-8 bytes, one byte per character, so the hash
  // below can consume any name in any script. Without this, a name outside
  // Latin-1 (Chinese, Japanese, Korean, Arabic, an emoji) made the hash bail
  // out and return an empty string, and every such person then shared one
  // signature and therefore one fake identity. ASCII passes through unchanged,
  // so keys for Latin-alphabet names are exactly what they always were.
  function utf8Bytes(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out += String.fromCharCode(c);
      } else if (c < 0x800) {
        out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length &&
                 str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00);
        out += String.fromCharCode(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Pure-JS SHA-256 (returns lowercase hex). Deterministic, sync, dependency-free.
  // ---------------------------------------------------------------------------
  function sha256Hex(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var result = '';
    var words = [];
    var asciiBitLength = ascii.length * 8;

    var hash = sha256Hex.h = sha256Hex.h || [];
    var k = sha256Hex.k = sha256Hex.k || [];
    var primeCounter = k.length;

    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }

    // Fresh working copy of the initial hash values each call.
    hash = hash.slice(0, 8);

    ascii = utf8Bytes(String(ascii == null ? '' : ascii));
    asciiBitLength = ascii.length * 8;

    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (j = 0; j < words.length; ) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = i < 16 ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  // Seeded PRNG (mulberry32). Deterministic given a 32-bit seed.
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

  // Turn the first 8 hex chars of the person key hash into a 32-bit seed.
  function seedFromKey(keyHash) {
    return parseInt(keyHash.slice(0, 8), 16) >>> 0;
  }

  // ---------------------------------------------------------------------------
  // Fake value vocabularies.
  // ---------------------------------------------------------------------------
  var FIRST_NAMES = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
    'Anthony', 'Margaret', 'Mark', 'Betty', 'Donald', 'Sandra', 'Steven', 'Ashley',
    'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna', 'Kenneth', 'Michelle'];
  var LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
    'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
    'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'];
  var STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Elm St', 'Washington Ave',
    'Park Blvd', 'Lake Rd', 'Hill St', 'Sunset Blvd', 'Pine St', 'River Rd',
    'Church St', 'Highland Ave', 'Franklin St', 'Union Ave', 'Willow Way', 'Spring St'];
  var UNIT_TYPES = ['Apt', 'Unit', 'Ste'];

  function pick(list, rand) {
    return list[Math.floor(rand() * list.length)];
  }

  // ---------------------------------------------------------------------------
  // Identity helpers.
  // ---------------------------------------------------------------------------
  function splitCommaFirst(value) {
    var s = value == null ? '' : String(value);
    var idx = s.indexOf(',');
    if (idx === -1) {
      // No comma: treat the whole thing as the last name, no first.
      return { first: '', last: s.trim() };
    }
    return { last: s.slice(0, idx).trim(), first: s.slice(idx + 1).trim() };
  }

  function splitFirstLast(value) {
    var s = value == null ? '' : String(value).trim();
    if (s === '') return { first: '', last: '' };
    var idx = s.indexOf(' ');
    if (idx === -1) return { first: s, last: '' };
    return { first: s.slice(0, idx).trim(), last: s.slice(idx + 1).trim() };
  }

  // Normalize a date of birth to YYYYMMDD digits so 1/1/2000 and 01/01/2000
  // collapse to the same person. Falls back to stripped digits if unparseable.
  function normalizeDob(value) {
    var s = value == null ? '' : String(value).trim();
    if (s === '') return '';
    var m;
    // YYYY-MM-DD or YYYY/MM/DD
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return m[1] + pad2(m[2]) + pad2(m[3]);
    // M/D/YYYY or M-D-YYYY
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (m) return m[3] + pad2(m[1]) + pad2(m[2]);
    // M/D/YY -> assume 19YY for >= 30 else 20YY
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})$/);
    if (m) {
      var yy = parseInt(m[3], 10);
      var yyyy = (yy >= 30 ? 1900 : 2000) + yy;
      return String(yyyy) + pad2(m[1]) + pad2(m[2]);
    }
    // Fallback: whatever digits are present, so identical raw strings still match.
    return s.replace(/\D/g, '');
  }

  function pad2(v) {
    var s = String(v);
    return s.length < 2 ? '0' + s : s;
  }

  function first3(value) {
    var s = (value == null ? '' : String(value)).toLowerCase().replace(/[^a-z0-9]/g, '');
    return s.slice(0, 3);
  }

  // Resolve first / last / dob for a row given the mapping (term -> column index).
  function deriveIdentity(row, mapping) {
    var firstName = '';
    var lastName = '';
    if (mapping.full_name_last_first != null) {
      var a = splitCommaFirst(row[mapping.full_name_last_first]);
      firstName = a.first;
      lastName = a.last;
    } else if (mapping.full_name_first_last != null) {
      var b = splitFirstLast(row[mapping.full_name_first_last]);
      firstName = b.first;
      lastName = b.last;
    }
    if (mapping.first_name != null) firstName = String(row[mapping.first_name] == null ? '' : row[mapping.first_name]).trim();
    if (mapping.last_name != null) lastName = String(row[mapping.last_name] == null ? '' : row[mapping.last_name]).trim();
    var dobRaw = mapping.date_of_birth != null ? row[mapping.date_of_birth] : '';
    return { firstName: firstName, lastName: lastName, dobRaw: dobRaw, dobNorm: normalizeDob(dobRaw) };
  }

  // The raw (human-readable) key BEFORE hashing.
  function anonKeyRaw(identity) {
    return first3(identity.firstName) + first3(identity.lastName) + identity.dobNorm;
  }

  // The published anon_key: 16 hex chars of SHA-256(rawKey). Non-reversible at a glance.
  function anonKey(identity) {
    return sha256Hex(anonKeyRaw(identity)).slice(0, 16);
  }

  // ---------------------------------------------------------------------------
  // Fake data generation for one person, keyed by their anon_key hash.
  // Returns a map term -> fake string, consistent and internally coherent.
  // columnTypes maps a term's column index -> 'number' | 'string' (for phones).
  // ---------------------------------------------------------------------------
  function buildFakePerson(keyHash, terms, phoneTypes) {
    var rand = mulberry32(seedFromKey(keyHash));
    var fakeFirst = pick(FIRST_NAMES, rand);
    var fakeLast = pick(LAST_NAMES, rand);

    // One ZIP record fixes city/state/zip/county/country together.
    var zrec = ZIPS.length ? ZIPS[Math.floor(rand() * ZIPS.length)] : { zip: '00000', city: '', state: '', county: '', country: 'USA' };
    var streetNum = 100 + Math.floor(rand() * 9800);
    var street = pick(STREETS, rand);
    var hasUnit = rand() < 0.35;
    var unit = hasUnit ? (pick(UNIT_TYPES, rand) + ' ' + (1 + Math.floor(rand() * 400))) : '';

    // Fake DOB: a plausible date, formatted M/D/YYYY, stable for this person.
    var year = 1950 + Math.floor(rand() * 55);
    var month = 1 + Math.floor(rand() * 12);
    var day = 1 + Math.floor(rand() * 28);
    var fakeDob = month + '/' + day + '/' + year;

    var out = {};
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      switch (t) {
        case 'first_name': out[t] = fakeFirst; break;
        case 'last_name': out[t] = fakeLast; break;
        case 'full_name_last_first': out[t] = fakeLast + ', ' + fakeFirst; break;
        case 'full_name_first_last': out[t] = fakeFirst + ' ' + fakeLast; break;
        case 'date_of_birth': out[t] = fakeDob; break;
        // Two masks rather than fakes. A made-up SSN or card number is a real
        // one for somebody, and neither is worth inventing.
        case 'ssn': out[t] = '***-**-****'; break;
        case 'card_number': out[t] = '****-****-****-****'; break;
        // example.com is reserved by the IANA for exactly this, so a fake
        // address can never reach a real inbox. Uniqueness across people is
        // settled later, in anonymizeDataset.
        case 'email': out[t] = fakeFirst.toLowerCase() + '.' + fakeLast.toLowerCase() + '@example.com'; break;
        case 'phone_1':
        case 'phone_2':
          out[t] = (phoneTypes && phoneTypes[t] === 'number') ? '5555555555' : '(555) 555-5555';
          break;
        case 'address_line_1': out[t] = streetNum + ' ' + street; break;
        case 'address_line_2': out[t] = unit; break;
        case 'city': out[t] = zrec.city; break;
        case 'state': out[t] = zrec.state; break;
        case 'zip_code': out[t] = zrec.zip; break;
        case 'county': out[t] = zrec.county; break;
        case 'country': out[t] = zrec.country; break;
        default: break;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Mapping validation. Returns an array of error strings (empty = valid).
  // Rules: first name, last name, and date of birth must each be satisfied.
  // A full-name mapping satisfies BOTH first and last name.
  // ---------------------------------------------------------------------------
  function validateMapping(mapping) {
    var errors = [];
    var hasFull = mapping.full_name_last_first != null || mapping.full_name_first_last != null;
    var hasFirst = mapping.first_name != null || hasFull;
    var hasLast = mapping.last_name != null || hasFull;
    if (!hasFirst) errors.push('First name must be assigned (directly or via a full-name column).');
    if (!hasLast) errors.push('Last name must be assigned (directly or via a full-name column).');
    if (mapping.date_of_birth == null) errors.push('Date of birth must be assigned.');
    if (mapping.full_name_last_first != null && mapping.full_name_first_last != null) {
      errors.push('Assign only one full-name format, not both.');
    }
    // A column must not be mapped to two different terms.
    var used = {};
    for (var term in mapping) {
      if (!mapping.hasOwnProperty(term)) continue;
      var col = mapping[term];
      if (col == null) continue;
      if (used[col] != null) {
        errors.push('Column #' + (col + 1) + ' is mapped to more than one term.');
      }
      used[col] = term;
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Anonymize a whole dataset.
  // dataset: { headers:[...], rows:[[...]] }
  // mapping: { term: columnIndex, ... } (only assigned terms present)
  // columnTypes: { columnIndex: 'number'|'string' } for phone dtype selection
  // Returns { anon, original, stats } where anon/original are { headers, rows }
  // each with an appended 'anon_key' column.
  // ---------------------------------------------------------------------------
  function padLeft(s, width) {
    s = String(s);
    while (s.length < width) s = '0' + s;
    return s;
  }

  // The full-identity signature: the COMPLETE normalized first name, last name,
  // and DOB. This is what genuinely identifies a person. It is what lets us tell
  // two people apart even when their first3+last3+DOB (the base bucket) collide.
  // Keys for rows that carry no identity are prefixed so nobody mistakes one
  // for a person, and so they can be filtered out of a count of people.
  var UNIDENTIFIED_PREFIX = 'unknown-';

  // A stable stand-in for a row that has no identity: its whole content, in
  // column order, escaped so no combination of cell values can imitate another
  // row. Row position is deliberately not used, so re-running on a sorted copy
  // of the same file produces the same keys.
  function rowFingerprint(row) {
    var parts = [];
    for (var i = 0; i < row.length; i++) {
      var v = row[i] == null ? '' : String(row[i]);
      parts.push(v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'));
    }
    return parts.join('|');
  }

  function identitySignature(identity) {
    return String(identity.firstName).trim().toLowerCase() + '|' +
      String(identity.lastName).trim().toLowerCase() + '|' + identity.dobNorm;
  }

  function anonymizeDataset(dataset, mapping, columnTypes) {
    var headers = dataset.headers;
    var rows = dataset.rows;

    // Which terms are assigned, and phone dtype per phone term.
    var assignedTerms = [];
    var phoneTypes = {};
    for (var t = 0; t < TERMS.length; t++) {
      var term = TERMS[t];
      if (mapping[term] != null) {
        assignedTerms.push(term);
        if (term === 'phone_1' || term === 'phone_2') {
          phoneTypes[term] = (columnTypes && columnTypes[mapping[term]]) || 'string';
        }
      }
    }

    // Pass 1: for every row, compute its base bucket key (first3+last3+DOB, hashed)
    // and its full-identity signature. Group signatures by bucket so we can spot
    // buckets that contain more than one real person.
    var rowInfo = new Array(rows.length);
    var buckets = {}; // baseKey -> { signature: true, ... }
    var people = {};  // sigHash -> true, one entry per distinct person
    var unidentifiedRows = 0;
    for (var r = 0; r < rows.length; r++) {
      var identity = deriveIdentity(rows[r], mapping);
      var raw = anonKeyRaw(identity);
      var baseKey, sig;
      var identified = raw !== '';
      if (identified) {
        baseKey = sha256Hex(raw).slice(0, 16);
        sig = identitySignature(identity);
      } else {
        // No name and no date of birth: there is nothing here that identifies a
        // person. Hashing that emptiness would give every such row the same key
        // and merge strangers into one person, so each distinct row becomes its
        // own record instead, under a key that says so. Two rows that are
        // identical in every column are indistinguishable and do stay together.
        var rowText = rowFingerprint(rows[r]);
        baseKey = UNIDENTIFIED_PREFIX + sha256Hex(rowText).slice(0, 12);
        sig = 'unidentified|' + rowText;
        unidentifiedRows++;
      }
      var sigHash = sha256Hex(sig);
      rowInfo[r] = { baseKey: baseKey, sig: sig, sigHash: sigHash, identified: identified };
      (buckets[baseKey] || (buckets[baseKey] = {}))[sig] = true;
      people[sigHash] = true;
    }

    // Resolve collisions: any bucket holding 2+ distinct signatures gets a stable
    // ordinal suffix per signature, assigned in sorted-signature order so the same
    // person always receives the same suffix regardless of row order.
    var suffixMap = {}; // baseKey -> { signature: '-NN' }
    var collidedBuckets = 0;
    var collidedPeople = 0;
    for (var bk in buckets) {
      if (!buckets.hasOwnProperty(bk)) continue;
      var sigs = Object.keys(buckets[bk]).sort();
      if (sigs.length > 1) {
        collidedBuckets++;
        collidedPeople += sigs.length;
        var width = Math.max(2, String(sigs.length).length);
        var m = {};
        for (var si = 0; si < sigs.length; si++) {
          m[sigs[si]] = '-' + padLeft(si + 1, width);
        }
        suffixMap[bk] = m;
      }
    }

    // Every person's fake record, built once, in sorted-signature order so the
    // result never depends on the order the rows arrived in.
    //
    // The name pools are finite, so two different people can legitimately draw
    // the same fake name. That is fine for a name and wrong for an email
    // address, which downstream systems treat as unique, so a second person
    // holding an address already taken gets a counted variant of it
    // (james.smith2@example.com). Sorting first is what keeps that stable.
    var fakeCache = {};
    var emailOwner = {};
    Object.keys(people).sort().forEach(function (sigHash) {
      var fake = buildFakePerson(sigHash, assignedTerms, phoneTypes);
      if (fake.email) {
        var candidate = fake.email;
        var n = 1;
        while (emailOwner[candidate]) {
          n++;
          candidate = fake.email.replace('@', String(n) + '@');
        }
        emailOwner[candidate] = sigHash;
        fake.email = candidate;
      }
      fakeCache[sigHash] = fake;
    });

    // Pass 2: build both output files. The anon_key is the base bucket key, plus
    // the disambiguation suffix when its bucket collided. Fake data is seeded from
    // the FULL identity signature, so two different people in a collided bucket get
    // different fake records as well as different keys.
    var uniqueKeys = {};
    var unidentifiedKeys = {};
    var anonRows = new Array(rows.length);
    var originalRows = new Array(rows.length);

    for (r = 0; r < rows.length; r++) {
      var info = rowInfo[r];
      var suffix = suffixMap[info.baseKey] ? suffixMap[info.baseKey][info.sig] : '';
      var anonK = info.baseKey + suffix;
      if (info.identified) uniqueKeys[anonK] = true;
      else unidentifiedKeys[anonK] = true;

      var fake = fakeCache[info.sigHash];

      // Anonymized row: copy original, overwrite mapped columns, append anon_key.
      var anonRow = rows[r].slice();
      for (var a = 0; a < assignedTerms.length; a++) {
        var at = assignedTerms[a];
        var cell = rows[r][mapping[at]];
        // An empty cell stays empty. Writing a fake value into it would invent
        // a phone number the person never gave or a card they never had, and
        // would silently change how many values are missing in the file.
        if (cell == null || String(cell).trim() === '') continue;
        anonRow[mapping[at]] = fake[at];
      }
      anonRow.push(anonK);
      anonRows[r] = anonRow;

      // Original row plus the same anon_key.
      var origRow = rows[r].slice();
      origRow.push(anonK);
      originalRows[r] = origRow;
    }

    var outHeaders = headers.concat(['anon_key']);
    return {
      anon: { headers: outHeaders, rows: anonRows },
      original: { headers: outHeaders, rows: originalRows },
      stats: {
        rowCount: rows.length,
        uniquePersons: Object.keys(uniqueKeys).length,
        collisionCount: collidedBuckets,
        collidedPeople: collidedPeople,
        collisionsResolved: collidedBuckets > 0,
        // Rows that carried no name and no date of birth, and how many distinct
        // records they became. Kept out of uniquePersons, which counts people
        // the file could actually identify.
        unidentifiedRows: unidentifiedRows,
        unidentifiedKeys: Object.keys(unidentifiedKeys).length,
        assignedTerms: assignedTerms
      }
    };
  }

  return {
    TERMS: TERMS,
    TERM_LABELS: TERM_LABELS,
    ADDRESS_TERMS: ADDRESS_TERMS,
    sha256Hex: sha256Hex,
    mulberry32: mulberry32,
    splitCommaFirst: splitCommaFirst,
    splitFirstLast: splitFirstLast,
    normalizeDob: normalizeDob,
    first3: first3,
    deriveIdentity: deriveIdentity,
    anonKeyRaw: anonKeyRaw,
    anonKey: anonKey,
    identitySignature: identitySignature,
    buildFakePerson: buildFakePerson,
    validateMapping: validateMapping,
    anonymizeDataset: anonymizeDataset
  };
});
