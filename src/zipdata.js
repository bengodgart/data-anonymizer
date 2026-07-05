/*
 * zipdata.js - a small table of real US ZIP records used to build fake
 * addresses that stay internally consistent: the same ZIP always carries the
 * same city, state, county, and country. Picking one record (seeded by a
 * person's key) fixes every address field for that person at once.
 * Works in the browser and in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.DAZip = api;
})(this, function () {
  'use strict';

  // { zip, city, state, county, country }. Country is USA for every row here.
  var ZIPS = [
    { zip: '10001', city: 'New York', state: 'NY', county: 'New York', country: 'USA' },
    { zip: '11201', city: 'Brooklyn', state: 'NY', county: 'Kings', country: 'USA' },
    { zip: '12207', city: 'Albany', state: 'NY', county: 'Albany', country: 'USA' },
    { zip: '02108', city: 'Boston', state: 'MA', county: 'Suffolk', country: 'USA' },
    { zip: '02139', city: 'Cambridge', state: 'MA', county: 'Middlesex', country: 'USA' },
    { zip: '19104', city: 'Philadelphia', state: 'PA', county: 'Philadelphia', country: 'USA' },
    { zip: '15213', city: 'Pittsburgh', state: 'PA', county: 'Allegheny', country: 'USA' },
    { zip: '20001', city: 'Washington', state: 'DC', county: 'District of Columbia', country: 'USA' },
    { zip: '21201', city: 'Baltimore', state: 'MD', county: 'Baltimore City', country: 'USA' },
    { zip: '23219', city: 'Richmond', state: 'VA', county: 'Richmond City', country: 'USA' },
    { zip: '27601', city: 'Raleigh', state: 'NC', county: 'Wake', country: 'USA' },
    { zip: '28202', city: 'Charlotte', state: 'NC', county: 'Mecklenburg', country: 'USA' },
    { zip: '30303', city: 'Atlanta', state: 'GA', county: 'Fulton', country: 'USA' },
    { zip: '32202', city: 'Jacksonville', state: 'FL', county: 'Duval', country: 'USA' },
    { zip: '33602', city: 'Tampa', state: 'FL', county: 'Hillsborough', country: 'USA' },
    { zip: '33101', city: 'Miami', state: 'FL', county: 'Miami-Dade', country: 'USA' },
    { zip: '32801', city: 'Orlando', state: 'FL', county: 'Orange', country: 'USA' },
    { zip: '35203', city: 'Birmingham', state: 'AL', county: 'Jefferson', country: 'USA' },
    { zip: '37203', city: 'Nashville', state: 'TN', county: 'Davidson', country: 'USA' },
    { zip: '38103', city: 'Memphis', state: 'TN', county: 'Shelby', country: 'USA' },
    { zip: '40202', city: 'Louisville', state: 'KY', county: 'Jefferson', country: 'USA' },
    { zip: '43215', city: 'Columbus', state: 'OH', county: 'Franklin', country: 'USA' },
    { zip: '44113', city: 'Cleveland', state: 'OH', county: 'Cuyahoga', country: 'USA' },
    { zip: '45202', city: 'Cincinnati', state: 'OH', county: 'Hamilton', country: 'USA' },
    { zip: '46204', city: 'Indianapolis', state: 'IN', county: 'Marion', country: 'USA' },
    { zip: '48226', city: 'Detroit', state: 'MI', county: 'Wayne', country: 'USA' },
    { zip: '53202', city: 'Milwaukee', state: 'WI', county: 'Milwaukee', country: 'USA' },
    { zip: '55401', city: 'Minneapolis', state: 'MN', county: 'Hennepin', country: 'USA' },
    { zip: '60601', city: 'Chicago', state: 'IL', county: 'Cook', country: 'USA' },
    { zip: '63101', city: 'St. Louis', state: 'MO', county: 'St. Louis City', country: 'USA' },
    { zip: '64106', city: 'Kansas City', state: 'MO', county: 'Jackson', country: 'USA' },
    { zip: '70112', city: 'New Orleans', state: 'LA', county: 'Orleans', country: 'USA' },
    { zip: '73102', city: 'Oklahoma City', state: 'OK', county: 'Oklahoma', country: 'USA' },
    { zip: '75201', city: 'Dallas', state: 'TX', county: 'Dallas', country: 'USA' },
    { zip: '77002', city: 'Houston', state: 'TX', county: 'Harris', country: 'USA' },
    { zip: '78205', city: 'San Antonio', state: 'TX', county: 'Bexar', country: 'USA' },
    { zip: '78701', city: 'Austin', state: 'TX', county: 'Travis', country: 'USA' },
    { zip: '80202', city: 'Denver', state: 'CO', county: 'Denver', country: 'USA' },
    { zip: '84101', city: 'Salt Lake City', state: 'UT', county: 'Salt Lake', country: 'USA' },
    { zip: '85004', city: 'Phoenix', state: 'AZ', county: 'Maricopa', country: 'USA' },
    { zip: '87102', city: 'Albuquerque', state: 'NM', county: 'Bernalillo', country: 'USA' },
    { zip: '89101', city: 'Las Vegas', state: 'NV', county: 'Clark', country: 'USA' },
    { zip: '90012', city: 'Los Angeles', state: 'CA', county: 'Los Angeles', country: 'USA' },
    { zip: '92101', city: 'San Diego', state: 'CA', county: 'San Diego', country: 'USA' },
    { zip: '94103', city: 'San Francisco', state: 'CA', county: 'San Francisco', country: 'USA' },
    { zip: '95814', city: 'Sacramento', state: 'CA', county: 'Sacramento', country: 'USA' },
    { zip: '97201', city: 'Portland', state: 'OR', county: 'Multnomah', country: 'USA' },
    { zip: '98101', city: 'Seattle', state: 'WA', county: 'King', country: 'USA' },
    { zip: '99501', city: 'Anchorage', state: 'AK', county: 'Anchorage', country: 'USA' },
    { zip: '96813', city: 'Honolulu', state: 'HI', county: 'Honolulu', country: 'USA' }
  ];

  return { ZIPS: ZIPS };
});
