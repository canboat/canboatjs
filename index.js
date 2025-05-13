'use strict'

/**
 * Copyright 2019 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const pgns = require('./lib/pgns')

module.exports = {
  FromPgn: require('./lib/fromPgn').Parser,
  parseN2kString: require('./lib/stringMsg').parseN2kString,
  isN2KString: require('./lib/stringMsg').isN2KString,
  toPgn: require('./lib/toPgn').toPgn,
  toActisenseSerialFormat: require('./lib/stringMsg').toActisenseSerialFormat,
  pgnToActisenseSerialFormat: require('./lib/toPgn').pgnToActisenseSerialFormat,
  pgnToActisenseN2KAsciiFormat: require('./lib/toPgn').pgnToActisenseN2KAsciiFormat,
  pgnToiKonvertSerialFormat: require('./lib/toPgn').pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat: require('./lib/toPgn').pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat: require('./lib/toPgn').pgnToYdgwFullRawFormat,
  pgnToPCDIN: require('./lib/toPgn').pgnToPCDIN,
  pgnToMXPGN: require('./lib/toPgn').pgnToMXPGN,
  canbus: require('./lib/canbus'),
  iKonvert: require('./lib/ikonvert'),
  Ydwg02: require('./lib/ydgw02'),
  Ydgw02: require('./lib/ydgw02'),
  W2k01: require('./lib/w2k01'),
  Venus: require('./lib/venus'),
  VenusMQTT: require('./lib/venus-mqtt'),
  discover: require('./lib/discovery'),
  SimpleCan: require('./lib/simpleCan'),
  YdDevice: require('./lib/yddevice'),
  addCustomPgns: pgns.addCustomPgns,
  lookupEnumerationValue: pgns.lookupEnumerationValue,
  lookupEnumerationName: pgns.lookupEnumerationName
}

try {
  module.exports.serial = require('./lib/serial')
} catch ( ex ) {
}

