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

const pgns = require('./dist/pgns')

module.exports = {
  FromPgn: require('./dist/fromPgn').Parser,
  parseN2kString: require('./dist/stringMsg').parseN2kString,
  isN2KString: require('./dist/stringMsg').isN2KString,
  toPgn: require('./dist/toPgn').toPgn,
  toActisenseSerialFormat: require('./dist/stringMsg').toActisenseSerialFormat,
  pgnToActisenseSerialFormat: require('./dist/toPgn').pgnToActisenseSerialFormat,
  pgnToActisenseN2KAsciiFormat: require('./dist/toPgn').pgnToActisenseN2KAsciiFormat,
  pgnToiKonvertSerialFormat: require('./dist/toPgn').pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat: require('./dist/toPgn').pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat: require('./dist/toPgn').pgnToYdgwFullRawFormat,
  pgnToPCDIN: require('./dist/toPgn').pgnToPCDIN,
  pgnToMXPGN: require('./dist/toPgn').pgnToMXPGN,
  canbus: require('./dist/canbus'),
  iKonvert: require('./dist/ikonvert'),
  Ydwg02: require('./dist/ydgw02'),
  Ydgw02: require('./dist/ydgw02'),
  W2k01: require('./dist/w2k01'),
  Venus: require('./dist/venus'),
  VenusMQTT: require('./dist/venus-mqtt'),
  discover: require('./dist/discovery'),
  SimpleCan: require('./dist/simpleCan'),
  YdDevice: require('./dist/yddevice'),
  addCustomPgns: pgns.addCustomPgns,
  lookupEnumerationValue: pgns.lookupEnumerationValue,
  lookupEnumerationName: pgns.lookupEnumerationName
}

try {
  module.exports.serial = require('./dist/serial')
// eslint-disable-next-line no-empty
} catch ( _ex ) {
}

