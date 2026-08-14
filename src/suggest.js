/*
 * suggest.js - guesses which column belongs to which term.
 *
 * Two signals, in this order of trust:
 *   1. The column NAME, matched against a vocabulary of everyday spellings
 *      ("dob", "Date of Birth", "Patient DOB" all mean date of birth).
 *   2. The column VALUES, matched against shapes we can recognize on sight
 *      (a Social Security number, an email address, a payment card that passes
 *      its check digit, a phone, a five digit ZIP, a state code).
 *
 * A name match always outranks a shape match, and a shape match can confirm a
 * name match but never overrules it. Nothing here changes the file; the result
 * is a recommendation the user accepts or ignores.
 *
 * Deliberate omissions:
 *   - A date shape alone never suggests date of birth. A signup date and a
 *     birth date look identical, and guessing wrong there is the one mistake
 *     that quietly corrupts the anon_key.
 *   - Negative words veto a match that reads right and is wrong: "email
 *     address" is not a street address, "statement date" is not a state.
 *
 * Works in the browser and in Node, no dependencies.
 */
(function (root, factory) {
  var api = factory(
    typeof require !== 'undefined' ? require('./anonymize.js') : (typeof self !== 'undefined' ? self.DAAnon : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.DASuggest = api;
})(this, function (DAAnon) {
  'use strict';

  var TERMS = (DAAnon && DAAnon.TERMS) || [];
  var TERM_ORDER = {};
  for (var ti = 0; ti < TERMS.length; ti++) TERM_ORDER[TERMS[ti]] = ti;

  // How much each kind of evidence is worth. A name match beats a shape match.
  var SCORE_EXACT_NAME = 100;  // the whole column name is the term
  var SCORE_WORD_NAME = 72;    // the term appears as whole words inside the name
  var SCORE_PART_NAME = 55;    // the term appears inside a run-together name
  var SCORE_SHAPE_ONLY = 50;   // the name says nothing, the values are unmistakable
  var SCORE_SHAPE_BONUS = 8;   // the values agree with the name
  var SCORE_FALLBACK_PENALTY = 5;
  var MIN_SCORE = 45;

  // Column names people actually use, per term.
  var ALIASES = {
    first_name: ['first name', 'firstname', 'first', 'fname', 'f name', 'given name', 'forename',
      'first nm', 'legal first name', 'name first'],
    last_name: ['last name', 'lastname', 'last', 'lname', 'l name', 'surname', 'family name',
      'last nm', 'legal last name', 'name last'],
    date_of_birth: ['date of birth', 'dob', 'd o b', 'birth date', 'birthdate', 'birthday',
      'date born', 'born on', 'bdate', 'birth dt', 'date of birth dob'],
    ssn: ['ssn', 'social security number', 'social security', 'social security no',
      'ss number', 'ssno', 'sin', 'national id', 'national insurance number', 'tax id',
      'tin', 'itin', 'ein'],
    card_number: ['card number', 'credit card', 'credit card number', 'debit card',
      'card no', 'cc', 'cc number', 'ccnum', 'payment card', 'card', 'pan'],
    email: ['email', 'email address', 'e mail', 'email 1', 'primary email', 'personal email',
      'work email', 'contact email', 'email addr', 'mail address'],
    phone_1: ['phone', 'phone number', 'phone no', 'telephone', 'telephone number', 'tel',
      'phone 1', 'primary phone', 'home phone', 'day phone', 'daytime phone',
      'contact number', 'contact phone'],
    phone_2: ['phone 2', 'second phone', 'secondary phone', 'alternate phone', 'alternative phone',
      'alt phone', 'other phone', 'work phone', 'mobile', 'mobile phone', 'mobile number',
      'cell', 'cell phone', 'cell number', 'evening phone'],
    address_line_1: ['address', 'address 1', 'address line 1', 'street address', 'street',
      'street name', 'addr', 'addr 1', 'mailing address', 'home address',
      'residential address', 'address one'],
    address_line_2: ['address 2', 'address line 2', 'addr 2', 'apt', 'apartment', 'unit',
      'unit number', 'suite', 'apt number', 'address two'],
    city: ['city', 'town', 'municipality', 'city name', 'mailing city', 'city town'],
    state: ['state', 'province', 'state code', 'state abbreviation', 'state abbr', 'us state',
      'state province', 'st'],
    zip_code: ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'postal', 'zip 5', 'zip5'],
    county: ['county', 'county name', 'parish', 'borough'],
    country: ['country', 'country name', 'country code', 'ctry']
  };

  // A column holding a whole name. Which of the two full-name terms it becomes
  // is decided by the values, unless the name itself says so.
  var FULL_NAME_ALIASES = ['full name', 'fullname', 'name', 'complete name', 'legal name',
    'person name', 'customer name', 'client name', 'patient name', 'student name',
    'employee name', 'member name', 'contact name', 'display name', 'individual name',
    'resident name', 'parent name', 'owner name', 'full legal name'];
  var LAST_FIRST_ALIASES = ['name last first', 'last first', 'full name last first',
    'last comma first', 'sort name', 'name lf', 'lastname firstname', 'last name first name'];

  // Words that make an otherwise good name match wrong.
  var NEGATIVE = {
    address_line_1: ['email', 'e mail', 'ip', 'url', 'web', 'website', 'domain', 'mac'],
    address_line_2: ['email', 'e mail', 'ip', 'url', 'web', 'website', 'domain'],
    // "card type", "card holder" and "card expiry" are all about a card and
    // none of them is the number.
    card_number: ['type', 'brand', 'holder', 'name', 'expiry', 'expiration', 'exp',
      'cvv', 'cvc', 'issuer', 'network', 'status', 'level', 'tier', 'last4', 'last 4'],
    state: ['statement', 'status', 'estate', 'statistic', 'stateless'],
    city: ['capacity', 'electricity'],
    full_name: ['user', 'username', 'file', 'filename', 'company', 'business', 'account',
      'product', 'plan', 'school', 'district', 'employer', 'organization', 'organisation',
      'org', 'vendor', 'provider', 'group', 'team', 'brand', 'domain', 'table', 'column',
      'field', 'database', 'report', 'sheet', 'event', 'course', 'role', 'bank',
      'insurance', 'carrier', 'pharmacy', 'clinic', 'hospital', 'practice', 'department']
  };

  // When a term is already taken, a second column that looks the same lands here.
  var FALLBACK = { phone_1: 'phone_2', address_line_1: 'address_line_2' };
  // ... and if only the second slot got filled, it moves up to the first.
  var PROMOTE = { phone_2: 'phone_1', address_line_2: 'address_line_1' };

  var US_STATE_CODES = ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS ' +
    'MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP').split(' ');
  var STATE_SET = {};
  for (var si = 0; si < US_STATE_CODES.length; si++) STATE_SET[US_STATE_CODES[si]] = true;

  // ---------------------------------------------------------------------------
  // Text helpers.
  // ---------------------------------------------------------------------------
  function norm(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(value) {
    return norm(value).replace(/ /g, '');
  }

  function hasWords(haystackNorm, needleNorm) {
    if (needleNorm === '') return false;
    return (' ' + haystackNorm + ' ').indexOf(' ' + needleNorm + ' ') !== -1;
  }

  // Score one column name against one alias. 0 means no match.
  function nameScore(headerNorm, headerCompact, alias) {
    var aliasNorm = norm(alias);
    var aliasCompact = compact(alias);
    if (aliasCompact === '') return 0;
    if (headerCompact === aliasCompact) return SCORE_EXACT_NAME;
    if (hasWords(headerNorm, aliasNorm)) return SCORE_WORD_NAME;
    // Run-together names ("customerzipcode"). Short aliases are excluded because
    // "state" hides inside "statement" and "city" inside "capacity".
    if (aliasCompact.length >= 6 && headerCompact.indexOf(aliasCompact) !== -1) return SCORE_PART_NAME;
    return 0;
  }

  // Best alias score for a term, or 0.
  function bestNameScore(headerNorm, headerCompact, aliases) {
    var best = 0;
    for (var i = 0; i < aliases.length; i++) {
      var s = nameScore(headerNorm, headerCompact, aliases[i]);
      if (s > best) best = s;
    }
    return best;
  }

  function isVetoed(headerNorm, headerCompact, key) {
    var words = NEGATIVE[key];
    if (!words) return false;
    for (var i = 0; i < words.length; i++) {
      var w = norm(words[i]);
      if (hasWords(headerNorm, w)) return true;
      var wc = compact(words[i]);
      if (wc.length >= 5 && headerCompact.indexOf(wc) !== -1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Value shapes.
  // ---------------------------------------------------------------------------
  function columnValues(rows, colIdx, limit) {
    var out = [];
    var max = limit || 12;
    for (var r = 0; r < rows.length && out.length < max; r++) {
      var row = rows[r] || [];
      var v = row[colIdx];
      if (v == null) continue;
      var s = String(v).trim();
      if (s === '') continue;
      out.push(s);
    }
    return out;
  }

  function everyValue(values, test) {
    if (!values.length) return false;
    for (var i = 0; i < values.length; i++) {
      if (!test(values[i])) return false;
    }
    return true;
  }

  function mostValues(values, test, ratio) {
    if (!values.length) return false;
    var hits = 0;
    for (var i = 0; i < values.length; i++) {
      if (test(values[i])) hits++;
    }
    return hits / values.length >= (ratio || 0.6);
  }

  function isDateLike(s) {
    if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(s)) return true;
    if (/^\d{1,2}[-\/.]\d{1,2}[-\/.](\d{2}|\d{4})$/.test(s)) return true;
    if (/^\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4}$/.test(s)) return true;
    if (/^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}$/.test(s)) return true;
    return false;
  }

  // Only the punctuated or masked forms count. A bare run of nine digits is an
  // account number as often as it is a social security number.
  function isSpecialNumberLike(s) {
    if (/^\d{3}-\d{2}-\d{4}$/.test(s)) return true;
    if (/^\d{3}\s\d{2}\s\d{4}$/.test(s)) return true;
    if (/^[*xX]{3}[-\s]?[*xX]{2}[-\s]?[*xX]{4}$/.test(s)) return true;
    return false;
  }

  // Luhn, the check digit every payment card carries. A random fifteen or
  // sixteen digit number passes it one time in ten, so it is the difference
  // between "long number" and "card number".
  function passesLuhn(digits) {
    var sum = 0;
    var alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var d = digits.charCodeAt(i) - 48;
      if (d < 0 || d > 9) return false;
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return digits.length > 0 && sum % 10 === 0;
  }

  function isCardLike(s) {
    if (!/^[\d\s\-]+$/.test(s)) return false;
    var digits = s.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    return passesLuhn(digits);
  }

  function isPhoneLike(s) {
    if (!/^[\s()+.\-]*\d[\d\s()+.\-]*$/.test(s)) return false;
    // A date and a plain decimal both survive the pattern above. "2024-02-14"
    // carries ten digits and would otherwise read as a phone number.
    if (isDateLike(s)) return false;
    if (/^[-+]?\d+\.\d+$/.test(s)) return false;
    // An American Express number is fifteen digits, inside the phone range.
    // The check digit settles which one it is.
    if (isCardLike(s)) return false;
    var digits = s.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function isEmailLike(s) {
    return /^[^@\s,;]+@[^@\s,;.]+(\.[^@\s,;.]+)+$/.test(s);
  }

  function isZipLike(s) {
    return /^\d{5}(-\d{4})?$/.test(s);
  }

  function isStateCodeLike(s) {
    return STATE_SET[s.toUpperCase()] === true;
  }

  function isCommaNameLike(s) {
    return /^[^,]+,[^,]+$/.test(s) && /[A-Za-z]/.test(s);
  }

  function isTwoPartNameLike(s) {
    return /^[A-Za-z][A-Za-z'.\-]*(\s+[A-Za-z][A-Za-z'.\-]*)+$/.test(s);
  }

  // Does the data agree with a name match? Used as a small bonus only.
  function shapeAgrees(term, values) {
    if (!values.length) return false;
    switch (term) {
      case 'date_of_birth': return mostValues(values, isDateLike);
      case 'ssn': return mostValues(values, isSpecialNumberLike);
      case 'card_number': return mostValues(values, isCardLike);
      case 'email': return mostValues(values, isEmailLike);
      case 'phone_1':
      case 'phone_2': return mostValues(values, isPhoneLike);
      case 'zip_code': return everyValue(values, isZipLike);
      case 'state': return everyValue(values, isStateCodeLike);
      case 'full_name_last_first': return mostValues(values, isCommaNameLike);
      case 'full_name_first_last': return mostValues(values, isTwoPartNameLike);
      default: return false;
    }
  }

  function reasonForName(header) {
    return 'The column is named "' + header + '".';
  }

  // ---------------------------------------------------------------------------
  // Candidate generation for one column.
  // ---------------------------------------------------------------------------
  function candidatesForColumn(header, colIdx, values, out) {
    var headerNorm = norm(header);
    var headerCompact = compact(header);
    var term, score;

    for (term in ALIASES) {
      if (!ALIASES.hasOwnProperty(term)) continue;
      if (isVetoed(headerNorm, headerCompact, term)) continue;
      score = bestNameScore(headerNorm, headerCompact, ALIASES[term]);
      if (!score) continue;
      // A birth date whose values are plainly not dates is a name collision,
      // not a birth date. Dropping it protects the anon_key.
      if (term === 'date_of_birth' && values.length && !mostValues(values, isDateLike, 0.5)) continue;
      if (shapeAgrees(term, values)) score += SCORE_SHAPE_BONUS;
      out.push({ term: term, col: colIdx, score: score, reason: reasonForName(header) });
    }

    // Whole-name columns.
    if (!isVetoed(headerNorm, headerCompact, 'full_name')) {
      var lfScore = bestNameScore(headerNorm, headerCompact, LAST_FIRST_ALIASES);
      var fullScore = bestNameScore(headerNorm, headerCompact, FULL_NAME_ALIASES);
      if (lfScore >= fullScore && lfScore > 0) {
        out.push({
          term: 'full_name_last_first', col: colIdx,
          score: lfScore + (shapeAgrees('full_name_last_first', values) ? SCORE_SHAPE_BONUS : 0),
          reason: reasonForName(header)
        });
      } else if (fullScore > 0) {
        // The values decide which way round the name is written.
        var lastFirst = mostValues(values, isCommaNameLike);
        var chosen = lastFirst ? 'full_name_last_first' : 'full_name_first_last';
        out.push({
          term: chosen, col: colIdx,
          score: fullScore + (shapeAgrees(chosen, values) ? SCORE_SHAPE_BONUS : 0),
          reason: lastFirst
            ? reasonForName(header) + ' Its values are written last name first.'
            : reasonForName(header)
        });
      }
    }

    // Shapes strong enough to stand on their own when the name says nothing.
    if (values.length) {
      if (everyValue(values, isSpecialNumberLike)) {
        out.push({ term: 'ssn', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values look like a Social Security number.' });
      }
      if (everyValue(values, isEmailLike)) {
        out.push({ term: 'email', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values look like email addresses.' });
      }
      if (everyValue(values, isCardLike)) {
        out.push({ term: 'card_number', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values pass the check digit every payment card carries.' });
      }
      if (everyValue(values, isPhoneLike)) {
        out.push({ term: 'phone_1', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values look like phone numbers.' });
      }
      if (everyValue(values, isZipLike)) {
        out.push({ term: 'zip_code', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values look like ZIP codes.' });
      }
      if (everyValue(values, isStateCodeLike)) {
        out.push({ term: 'state', col: colIdx, score: SCORE_SHAPE_ONLY, reason: 'The values look like state codes.' });
      }
      if (everyValue(values, isCommaNameLike) && mostValues(values, function (s) { return /[A-Za-z]{2},\s*[A-Za-z]{2}/.test(s); })) {
        out.push({ term: 'full_name_last_first', col: colIdx, score: SCORE_SHAPE_ONLY - 2, reason: 'The values look like names written last name first.' });
      }
    }
  }

  function isFullNameTerm(term) {
    return term === 'full_name_last_first' || term === 'full_name_first_last';
  }

  // ---------------------------------------------------------------------------
  // The public call: headers + a few sample rows in, a mapping recommendation out.
  // Returns { term: { col, score, reason } }, with every column used at most once
  // so the result is always a mapping the tool will accept.
  // ---------------------------------------------------------------------------
  function suggestMapping(headers, rows) {
    headers = headers || [];
    rows = rows || [];
    var candidates = [];
    for (var c = 0; c < headers.length; c++) {
      candidatesForColumn(headers[c], c, columnValues(rows, c), candidates);
    }

    candidates = candidates.filter(function (cand) { return cand.score >= MIN_SCORE; });
    candidates.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var ao = TERM_ORDER[a.term], bo = TERM_ORDER[b.term];
      if (ao !== bo) return ao - bo;
      return a.col - b.col;
    });

    var assigned = {};
    var usedCols = {};
    var fullNameTaken = false;

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (usedCols[cand.col]) continue;
      var term = cand.term;
      var penalty = 0;
      if (assigned[term]) {
        var fb = FALLBACK[term];
        if (!fb || assigned[fb]) continue;
        term = fb;
        penalty = SCORE_FALLBACK_PENALTY;
      }
      // Only one full-name column, because the tool rejects both at once.
      if (isFullNameTerm(term)) {
        if (fullNameTaken) continue;
        fullNameTaken = true;
      }
      assigned[term] = { col: cand.col, score: cand.score - penalty, reason: cand.reason };
      usedCols[cand.col] = true;
    }

    // A lone second phone or second address line moves into the first slot, so
    // the user never sees "Phone 2" filled with "Phone 1" left empty.
    for (var second in PROMOTE) {
      if (!PROMOTE.hasOwnProperty(second)) continue;
      var first = PROMOTE[second];
      if (assigned[second] && !assigned[first]) {
        assigned[first] = assigned[second];
        delete assigned[second];
      }
    }

    return assigned;
  }

  function countSuggestions(suggestions) {
    var n = 0;
    for (var t in suggestions) {
      if (suggestions.hasOwnProperty(t)) n++;
    }
    return n;
  }

  return {
    ALIASES: ALIASES,
    FULL_NAME_ALIASES: FULL_NAME_ALIASES,
    MIN_SCORE: MIN_SCORE,
    norm: norm,
    compact: compact,
    nameScore: nameScore,
    isDateLike: isDateLike,
    isSpecialNumberLike: isSpecialNumberLike,
    isEmailLike: isEmailLike,
    isCardLike: isCardLike,
    passesLuhn: passesLuhn,
    isPhoneLike: isPhoneLike,
    isZipLike: isZipLike,
    isStateCodeLike: isStateCodeLike,
    columnValues: columnValues,
    suggestMapping: suggestMapping,
    countSuggestions: countSuggestions
  };
});
