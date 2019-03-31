'use strict'

/**
 * Copyright 2016/2017 Signal K and Fabian Tollenaar <fabian@signalk.org>.
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
  serial: require('./lib/serial'),
  toPgn: require('./lib/toPgn').toPgn,
  toActisenseSerialFormat: require('./lib/toPgn').toActisenseSerialFormat,
  pgnToActisenseSerialFormat: require('./lib/toPgn').pgnToActisenseSerialFormat,
  pgnToiKonvertSerialFormat: require('./lib/toPgn').pgnToiKonvertSerialFormat,
  pgnToYdwgRawFormat: require('./lib/toPgn').pgnToYdwgRawFormat,
  canbus: require('./lib/canbus'),
  iKonvert: require('./lib/ikonvert'),
  Ydwg02: require('./lib/ydwg02')
}
