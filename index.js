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

module.exports = {
  FromPgn: require('./lib/fromPgn').Parser,
  parseN2kString: require('./lib/stringMsg').parseN2kString,
  serial: require('./lib/serial'),
  toPgn: require('./lib/toPgn').toPgn,
  toActisenseSerialFormat: require('./lib/stringMsg').toActisenseSerialFormat,
  pgnToActisenseSerialFormat: require('./lib/toPgn').pgnToActisenseSerialFormat,
  pgnToiKonvertSerialFormat: require('./lib/toPgn').pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat: require('./lib/toPgn').pgnToYdgwRawFormat,
  canbus: require('./lib/canbus'),
  iKonvert: require('./lib/ikonvert'),
  Ydwg02: require('./lib/ydgw02'),
  Ydgw02: require('./lib/ydgw02'),
  Venus: require('./lib/venus'),
  VenusMQTT: require('./lib/venus-mqtt'),
  discover: require('./lib/discovery')
}
